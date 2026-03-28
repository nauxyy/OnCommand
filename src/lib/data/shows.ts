import { SAMPLE_CUES, SAMPLE_SCRIPT_LINES } from "@/lib/constants";
import { createDefaultEditorData, normalizeEditorDraft } from "@/lib/editor/document";
import { parseScriptToEditorData } from "@/lib/editor/parser";
import { hasSupabaseEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Cue, EditorAct, EditorCue, EditorLine, ScriptLine, ShowEditorData, ShowEditorDraft } from "@/lib/types";

export interface ShowSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt?: string;
}

interface MembershipSelectRow {
  shows:
    | {
        id: string;
        title: string;
        created_at: string;
        updated_at?: string | null;
      }
    | Array<{
        id: string;
        title: string;
        created_at: string;
        updated_at?: string | null;
      }>;
}

interface ShowRow {
  id: string;
  title: string;
  created_at: string;
  updated_at?: string | null;
}

interface MembershipRow {
  show_id: string;
  role: string;
}

interface ScriptRow {
  id: string;
  raw_text: string;
  source_type: string;
}

interface SceneRow {
  id: string;
  show_id: string;
  act_number: number;
  title: string;
  sort_index: number;
}

interface LineRow {
  id: number;
  scene_id: string | null;
  show_id: string;
  act_number: number;
  line_number: number;
  character_name: string;
  line_text: string;
  line_type: string | null;
  sort_index: number | null;
}

interface CueRow {
  id: string;
  show_id: string;
  line_id: number;
  department: string;
  cue_text: string;
  standby_offset_ms: number;
  go_offset_ms: number;
  diagram_image_url: string | null;
  anchor_gap_index: number | null;
}

let demoShowDraftOverride: ShowEditorData | null = null;

type SupabaseLikeError = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
};

type ShowIdOnlyRow = {
  show_id: string;
};

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function normalizeShow(row: MembershipSelectRow): ShowSummary {
  const shows = Array.isArray(row.shows) ? row.shows[0] : row.shows;
  return {
    id: shows.id,
    title: shows.title,
    createdAt: shows.created_at,
    updatedAt: shows.updated_at ?? undefined,
  };
}

function formatSupabaseError(error: SupabaseLikeError | null | undefined) {
  if (!error) return "unknown error";

  if (error instanceof Error) {
    return error.message;
  }

  const parts = [
    error.code ? `code=${error.code}` : null,
    error.message ?? null,
    error.details ? `details=${error.details}` : null,
    error.hint ? `hint=${error.hint}` : null,
  ].filter(Boolean);

  if (parts.length) return parts.join(" | ");

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isMissingColumnError(error: SupabaseLikeError | null | undefined, columnName: string) {
  return error?.code === "42703" && (error.message?.includes(columnName) || error.hint?.includes(columnName));
}

function isMissingRelationError(error: SupabaseLikeError | null | undefined, relationName: string) {
  return error?.code === "42P01" && error.message?.includes(relationName);
}

function isRecursivePolicyError(error: SupabaseLikeError | null | undefined, relationName: string) {
  return error?.code === "42P17" && error.message?.includes(relationName);
}

function normalizeDepartmentRole(value: string) {
  return value === "stage_crew" ? "stage_manager" : value;
}

function toLegacyDepartmentRole(value: string) {
  return value === "stage_manager" ? "stage_crew" : value;
}

function isCueDepartmentConstraintError(error: SupabaseLikeError | null | undefined) {
  return error?.code === "23514" && (error.message?.includes("cues_department_check") ?? false);
}

function getUserFacingSupabaseErrorMessage(error: SupabaseLikeError | null | undefined, fallback: string) {
  if (!error) return fallback;

  if (
    isRecursivePolicyError(error, "shows") ||
    isRecursivePolicyError(error, "show_memberships") ||
    isMissingColumnError(error, "director_user_id") ||
    isMissingColumnError(error, "updated_at") ||
    isMissingColumnError(error, "source_type") ||
    isMissingColumnError(error, "scene_id") ||
    isMissingColumnError(error, "line_type") ||
    isMissingColumnError(error, "sort_index") ||
    isMissingColumnError(error, "anchor_gap_index") ||
    isMissingRelationError(error, "script_scenes")
  ) {
    return "Database migration required. Apply `supabase/migrations/20260328_show_editor_v1.sql`, then reload and try again.";
  }

  return error.message?.trim() || fallback;
}

async function getEditorMigrationRequirementMessage(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
) {
  const showsCheck = await supabase.from("shows").select("updated_at").limit(1);
  if (isRecursivePolicyError(showsCheck.error, "shows")) {
    return "Database RLS migration required. Rerun `supabase/migrations/20260328_show_editor_v1.sql`, then reload and try again.";
  }
  if (isMissingColumnError(showsCheck.error, "updated_at")) {
    return "Database migration required. Apply `supabase/migrations/20260328_show_editor_v1.sql`, then reload and try again.";
  }

  if (showsCheck.error) {
    console.error("[getEditorMigrationRequirementMessage] shows check failed:", formatSupabaseError(showsCheck.error));
    return "Failed to verify the database schema for the editor.";
  }

  const directorCheck = await supabase.from("shows").select("director_user_id").limit(1);
  if (isRecursivePolicyError(directorCheck.error, "shows")) {
    return "Database RLS migration required. Rerun `supabase/migrations/20260328_show_editor_v1.sql`, then reload and try again.";
  }
  if (isMissingColumnError(directorCheck.error, "director_user_id")) {
    return "Database migration required. Apply `supabase/migrations/20260328_show_editor_v1.sql`, then reload and try again.";
  }

  if (directorCheck.error) {
    console.error("[getEditorMigrationRequirementMessage] director_user_id check failed:", formatSupabaseError(directorCheck.error));
    return "Failed to verify the database schema for the editor.";
  }

  const scenesCheck = await supabase.from("script_scenes").select("id").limit(1);
  if (isMissingRelationError(scenesCheck.error, "script_scenes")) {
    return "Database migration required. Apply `supabase/migrations/20260328_show_editor_v1.sql`, then reload and try again.";
  }

  if (scenesCheck.error) {
    console.error("[getEditorMigrationRequirementMessage] script_scenes check failed:", formatSupabaseError(scenesCheck.error));
    return "Failed to verify the database schema for the editor.";
  }

  return null;
}

async function listShowsByIds(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  showIds: string[],
) {
  if (!showIds.length) return [] as ShowSummary[];

  const primary = await supabase
    .from("shows")
    .select("id, title, created_at, updated_at")
    .in("id", showIds)
    .order("updated_at", { ascending: false });

  if (!primary.error && primary.data) {
    return (primary.data as ShowRow[]).map((show) => ({
      id: show.id,
      title: show.title,
      createdAt: show.created_at,
      updatedAt: show.updated_at ?? undefined,
    }));
  }

  if (!isMissingColumnError(primary.error, "updated_at")) {
    console.error("[listShowsByIds] primary query failed:", formatSupabaseError(primary.error));
  }

  const fallback = await supabase
    .from("shows")
    .select("id, title, created_at")
    .in("id", showIds)
    .order("created_at", { ascending: false });

  if (fallback.error || !fallback.data) {
    console.error("[listShowsByIds] fallback query failed:", formatSupabaseError(fallback.error));
    return null;
  }

  return (fallback.data as ShowRow[]).map((show) => ({
    id: show.id,
    title: show.title,
    createdAt: show.created_at,
    updatedAt: show.created_at,
  }));
}

async function listOwnedShowsForCurrentUser(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
) {
  const primary = await supabase
    .from("shows")
    .select("id, title, created_at, updated_at")
    .eq("director_user_id", userId)
    .order("updated_at", { ascending: false });

  if (!primary.error && primary.data) {
    return (primary.data as ShowRow[]).map((show) => ({
      id: show.id,
      title: show.title,
      createdAt: show.created_at,
      updatedAt: show.updated_at ?? undefined,
    }));
  }

  if (!isMissingColumnError(primary.error, "updated_at")) {
    console.error("[listOwnedShowsForCurrentUser] primary query failed:", formatSupabaseError(primary.error));
  }

  const fallback = await supabase
    .from("shows")
    .select("id, title, created_at")
    .eq("director_user_id", userId)
    .order("created_at", { ascending: false });

  if (fallback.error || !fallback.data) {
    console.error("[listOwnedShowsForCurrentUser] fallback query failed:", formatSupabaseError(fallback.error));
    return null;
  }

  return (fallback.data as ShowRow[]).map((show) => ({
    id: show.id,
    title: show.title,
    createdAt: show.created_at,
    updatedAt: show.created_at,
  }));
}

function buildDemoEditorData(showId: string, title = "Demo Show"): ShowEditorData {
  const acts = new Map<number, EditorAct>();
  const sceneKeyById = new Map<number, string>();

  SAMPLE_SCRIPT_LINES.forEach((line) => {
    if (!acts.has(line.actNumber)) {
      acts.set(line.actNumber, { actNumber: line.actNumber, scenes: [] });
    }

    const act = acts.get(line.actNumber);
    if (!act) return;

    let currentScene = act.scenes[act.scenes.length - 1];
    const nextSceneTitle = line.sceneSeparator?.trim();
    if (!currentScene || nextSceneTitle) {
      currentScene = {
        id: `scene-${line.id}`,
        actNumber: line.actNumber,
        title: nextSceneTitle || `Scene ${act.scenes.length + 1}`,
        sortIndex: act.scenes.length,
        lines: [],
      };
      act.scenes.push(currentScene);
    }

    sceneKeyById.set(line.id, currentScene.id);
    currentScene.lines.push({
      id: `line-${line.id}`,
      lineNumber: line.lineNumber,
      character: line.character,
      text: line.text,
      lineType: "dialogue",
      sortIndex: currentScene.lines.length,
      cues: [],
    });
  });

  SAMPLE_CUES.forEach((cue) => {
    for (const act of acts.values()) {
      for (const scene of act.scenes) {
        const line = scene.lines.find((item) => item.id === `line-${cue.lineId}`);
        if (!line) continue;
        line.cues.push({
          id: cue.id,
          department: cue.department,
          anchorGapIndex: cue.anchorGapIndex,
          text: cue.text,
          standbyOffsetMs: cue.standbyOffsetMs,
          goOffsetMs: cue.goOffsetMs,
          diagramUrl: cue.diagramUrl,
        });
      }
    }
  });

  return normalizeEditorDraft({
    showId,
    title,
    revision: "demo",
    sourceText: SAMPLE_SCRIPT_LINES.map((line) => `${line.character}: ${line.text}`).join("\n"),
    acts: Array.from(acts.values()).sort((a, b) => a.actNumber - b.actNumber),
  });
}

function getDemoEditorData(showId: string) {
  if (!demoShowDraftOverride) {
    return buildDemoEditorData(showId);
  }

  return normalizeEditorDraft({
    ...demoShowDraftOverride,
    showId,
  });
}

function buildLiveDataFromEditor(editor: ShowEditorData): { script: ScriptLine[]; cues: Cue[] } {
  const script: ScriptLine[] = [];
  const cues: Cue[] = [];
  let nextLineId = 1;
  const persistedLineIdByEditorId = new Map<string, number>();

  editor.acts.forEach((act) => {
    act.scenes.forEach((scene) => {
      scene.lines.forEach((line, lineIndex) => {
        const lineId = Number.parseInt(line.id.replace(/\D+/g, ""), 10);
        const safeLineId = Number.isFinite(lineId) ? lineId : nextLineId;
        nextLineId = Math.max(nextLineId, safeLineId + 1);
        persistedLineIdByEditorId.set(line.id, safeLineId);
        script.push({
          id: safeLineId,
          actNumber: act.actNumber,
          lineNumber: line.lineNumber,
          character: line.character,
          text: line.text,
          lineType: line.lineType,
          sceneSeparator: lineIndex === 0 ? scene.title : undefined,
        });
      });
    });
  });

  editor.acts.forEach((act) => {
    act.scenes.forEach((scene) => {
      scene.lines.forEach((line) => {
        const liveLineId = persistedLineIdByEditorId.get(line.id);
        if (!liveLineId) return;
        line.cues.forEach((cue) => {
          cues.push({
            id: cue.id,
            lineId: liveLineId,
            anchorGapIndex: cue.anchorGapIndex,
            department: normalizeDepartmentRole(cue.department),
            text: cue.text,
            standbyOffsetMs: cue.standbyOffsetMs,
            goOffsetMs: cue.goOffsetMs,
            diagramUrl: cue.diagramUrl,
            anchorWordStart: cue.anchorGapIndex,
            anchorWordEnd: cue.anchorGapIndex,
          });
        });
      });
    });
  });

  return { script, cues };
}

function buildEditorDataFromRows({
  showId,
  title,
  revision,
  sourceText,
  scenes,
  lines,
  cues,
}: {
  showId: string;
  title: string;
  revision: string;
  sourceText: string;
  scenes: SceneRow[];
  lines: LineRow[];
  cues: CueRow[];
}): ShowEditorData {
  if (!scenes.length) {
    return {
      ...createDefaultEditorData(showId, title, sourceText),
      revision,
    };
  }

  const cueByLineId = new Map<number, EditorCue[]>();
  cues.forEach((cue) => {
    const existing = cueByLineId.get(cue.line_id) ?? [];
    existing.push({
      id: cue.id,
      department: normalizeDepartmentRole(cue.department),
      anchorGapIndex: cue.anchor_gap_index ?? 0,
      text: cue.cue_text,
      standbyOffsetMs: cue.standby_offset_ms,
      goOffsetMs: cue.go_offset_ms,
      diagramUrl: cue.diagram_image_url ?? undefined,
    });
    cueByLineId.set(cue.line_id, existing);
  });

  const linesBySceneId = new Map<string, EditorLine[]>();
  lines.forEach((line) => {
    if (!line.scene_id) return;
    const sceneLines = linesBySceneId.get(line.scene_id) ?? [];
    sceneLines.push({
      id: `line-${line.id}`,
      lineNumber: line.line_number,
      character: line.character_name,
      text: line.line_text,
      lineType: "dialogue",
      sortIndex: line.sort_index ?? sceneLines.length,
      cues: cueByLineId.get(line.id) ?? [],
    });
    linesBySceneId.set(line.scene_id, sceneLines);
  });

  const actsByNumber = new Map<number, EditorAct>();
  scenes.forEach((scene) => {
    const nextAct = actsByNumber.get(scene.act_number) ?? { actNumber: scene.act_number, scenes: [] };
    nextAct.scenes.push({
      id: scene.id,
      actNumber: scene.act_number,
      title: scene.title,
      sortIndex: scene.sort_index,
      lines: (linesBySceneId.get(scene.id) ?? []).sort((a, b) => a.sortIndex - b.sortIndex),
    });
    actsByNumber.set(scene.act_number, nextAct);
  });

  return normalizeEditorDraft({
    showId,
    title,
    revision,
    sourceText,
    acts: Array.from(actsByNumber.values()).sort((a, b) => a.actNumber - b.actNumber),
  });
}

async function getCurrentUserId() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    console.error("[getCurrentUserId] auth lookup failed:", error);
    return { supabase, userId: null as string | null };
  }

  return { supabase, userId: user?.id ?? null };
}

async function verifyShowMembership(showId: string, userId: string) {
  if (showId !== "demo-show" && !isUuidLike(showId)) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("show_memberships")
    .select("show_id, role")
    .eq("show_id", showId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[verifyShowMembership] membership lookup failed:", { showId, userId, error: formatSupabaseError(error) });
    return null;
  }

  return (data as MembershipRow | null) ?? null;
}

async function persistEditorDraft(draft: ShowEditorDraft) {
  const normalized = normalizeEditorDraft(draft);
  const supabase = await createSupabaseServerClient();
  const nextUpdatedAt = new Date().toISOString();

  const { error: showUpdateError } = await supabase
    .from("shows")
    .update({
      title: normalized.title,
      updated_at: nextUpdatedAt,
    })
    .eq("id", normalized.showId);

  if (showUpdateError) {
    console.error("[persistEditorDraft] show update failed:", { showId: normalized.showId, error: showUpdateError });
    return {
      ok: false as const,
      error: getUserFacingSupabaseErrorMessage(showUpdateError, "Failed to save show details."),
    };
  }

  const { data: existingScript, error: existingScriptError } = await supabase
    .from("scripts")
    .select("id")
    .eq("show_id", normalized.showId)
    .maybeSingle();

  if (existingScriptError) {
    console.error("[persistEditorDraft] script lookup failed:", { showId: normalized.showId, error: existingScriptError });
    return {
      ok: false as const,
      error: getUserFacingSupabaseErrorMessage(existingScriptError, "Failed to load current script state."),
    };
  }

  if (existingScript?.id) {
    const { error: scriptUpdateError } = await supabase
      .from("scripts")
      .update({
        source_type: "paste",
        raw_text: normalized.sourceText,
        updated_at: nextUpdatedAt,
      })
      .eq("id", existingScript.id);

    if (scriptUpdateError) {
      console.error("[persistEditorDraft] script update failed:", { showId: normalized.showId, error: scriptUpdateError });
      return {
        ok: false as const,
        error: getUserFacingSupabaseErrorMessage(scriptUpdateError, "Failed to save script source."),
      };
    }
  } else {
    const { error: scriptInsertError } = await supabase.from("scripts").insert({
      show_id: normalized.showId,
      source_type: "paste",
      raw_text: normalized.sourceText,
      updated_at: nextUpdatedAt,
    });

    if (scriptInsertError) {
      console.error("[persistEditorDraft] script insert failed:", { showId: normalized.showId, error: scriptInsertError });
      return {
        ok: false as const,
        error: getUserFacingSupabaseErrorMessage(scriptInsertError, "Failed to create script source."),
      };
    }
  }

  const { error: cueDeleteError } = await supabase.from("cues").delete().eq("show_id", normalized.showId);
  if (cueDeleteError) {
    console.error("[persistEditorDraft] cue delete failed:", { showId: normalized.showId, error: cueDeleteError });
    return {
      ok: false as const,
      error: getUserFacingSupabaseErrorMessage(cueDeleteError, "Failed to clear previous cues."),
    };
  }

  const { error: lineDeleteError } = await supabase.from("script_lines").delete().eq("show_id", normalized.showId);
  if (lineDeleteError) {
    console.error("[persistEditorDraft] line delete failed:", { showId: normalized.showId, error: lineDeleteError });
    return {
      ok: false as const,
      error: getUserFacingSupabaseErrorMessage(lineDeleteError, "Failed to clear previous lines."),
    };
  }

  const { error: sceneDeleteError } = await supabase.from("script_scenes").delete().eq("show_id", normalized.showId);
  if (sceneDeleteError) {
    console.error("[persistEditorDraft] scene delete failed:", { showId: normalized.showId, error: sceneDeleteError });
    return {
      ok: false as const,
      error: getUserFacingSupabaseErrorMessage(sceneDeleteError, "Failed to clear previous scenes."),
    };
  }

  const CHUNK_SIZE = 400;
  const sceneRows = normalized.acts.flatMap((act) =>
    act.scenes.map((scene) => ({
      show_id: normalized.showId,
      act_number: act.actNumber,
      title: scene.title,
      sort_index: scene.sortIndex,
      updated_at: nextUpdatedAt,
    })),
  );

  for (let start = 0; start < sceneRows.length; start += CHUNK_SIZE) {
    const batch = sceneRows.slice(start, start + CHUNK_SIZE);
    const { error: sceneInsertError } = await supabase.from("script_scenes").insert(batch);
    if (sceneInsertError) {
      console.error("[persistEditorDraft] scene batch insert failed:", {
        showId: normalized.showId,
        start,
        count: batch.length,
        error: sceneInsertError,
      });
      return {
        ok: false as const,
        error: getUserFacingSupabaseErrorMessage(sceneInsertError, "Failed to save scenes."),
      };
    }
  }

  const { data: insertedScenes, error: insertedScenesError } = await supabase
    .from("script_scenes")
    .select("id, act_number, sort_index")
    .eq("show_id", normalized.showId);

  if (insertedScenesError || !insertedScenes) {
    console.error("[persistEditorDraft] inserted scene lookup failed:", {
      showId: normalized.showId,
      error: insertedScenesError,
    });
    return {
      ok: false as const,
      error: getUserFacingSupabaseErrorMessage(insertedScenesError, "Failed to load saved scenes."),
    };
  }

  const sceneIdByKey = new Map<string, string>();
  (insertedScenes as Array<{ id: string; act_number: number; sort_index: number }>).forEach((scene) => {
    sceneIdByKey.set(`${scene.act_number}:${scene.sort_index}`, scene.id);
  });

  const lineRows: Array<{
    show_id: string;
    scene_id: string;
    act_number: number;
    line_number: number;
    character_name: string;
    line_text: string;
    line_type: string;
    sort_index: number;
    updated_at: string;
  }> = [];

  const lineCueBlueprints: Array<{
    actNumber: number;
    lineNumber: number;
    cues: EditorCue[];
  }> = [];

  normalized.acts.forEach((act) => {
    act.scenes.forEach((scene) => {
      const sceneId = sceneIdByKey.get(`${act.actNumber}:${scene.sortIndex}`);
      if (!sceneId) return;

      scene.lines.forEach((line) => {
        lineRows.push({
          show_id: normalized.showId,
          scene_id: sceneId,
          act_number: act.actNumber,
          line_number: line.lineNumber,
          character_name: line.character,
          line_text: line.text,
          line_type: line.lineType,
          sort_index: line.sortIndex,
          updated_at: nextUpdatedAt,
        });
        lineCueBlueprints.push({
          actNumber: act.actNumber,
          lineNumber: line.lineNumber,
          cues: line.cues,
        });
      });
    });
  });

  for (let start = 0; start < lineRows.length; start += CHUNK_SIZE) {
    const batch = lineRows.slice(start, start + CHUNK_SIZE);
    const { error: lineInsertError } = await supabase.from("script_lines").insert(batch);
    if (lineInsertError) {
      console.error("[persistEditorDraft] line batch insert failed:", {
        showId: normalized.showId,
        start,
        count: batch.length,
        error: lineInsertError,
      });
      return {
        ok: false as const,
        error: getUserFacingSupabaseErrorMessage(lineInsertError, "Failed to save lines."),
      };
    }
  }

  const { data: insertedLines, error: insertedLinesError } = await supabase
    .from("script_lines")
    .select("id, act_number, line_number")
    .eq("show_id", normalized.showId);

  if (insertedLinesError || !insertedLines) {
    console.error("[persistEditorDraft] inserted line lookup failed:", {
      showId: normalized.showId,
      error: insertedLinesError,
    });
    return {
      ok: false as const,
      error: getUserFacingSupabaseErrorMessage(insertedLinesError, "Failed to load saved lines."),
    };
  }

  const lineIdByKey = new Map<string, number>();
  (insertedLines as Array<{ id: number; act_number: number; line_number: number }>).forEach((line) => {
    lineIdByKey.set(`${line.act_number}:${line.line_number}`, line.id);
  });

  const cueRows: Array<{
    show_id: string;
    line_id: number;
    anchor_gap_index: number;
    anchor_word_start: number;
    anchor_word_end: number;
    department: string;
    cue_text: string;
    standby_offset_ms: number;
    go_offset_ms: number;
    diagram_image_url: string | null;
    updated_at: string;
  }> = [];

  lineCueBlueprints.forEach((lineBlueprint) => {
    const lineId = lineIdByKey.get(`${lineBlueprint.actNumber}:${lineBlueprint.lineNumber}`);
    if (typeof lineId !== "number") return;

    lineBlueprint.cues.forEach((cue) => {
      cueRows.push({
        show_id: normalized.showId,
        line_id: lineId,
        anchor_gap_index: cue.anchorGapIndex,
        anchor_word_start: cue.anchorGapIndex,
        anchor_word_end: cue.anchorGapIndex,
        department: normalizeDepartmentRole(cue.department),
        cue_text: cue.text,
        standby_offset_ms: cue.standbyOffsetMs,
        go_offset_ms: cue.goOffsetMs,
        diagram_image_url: cue.diagramUrl ?? null,
        updated_at: nextUpdatedAt,
      });
    });
  });

  for (let start = 0; start < cueRows.length; start += CHUNK_SIZE) {
    const batch = cueRows.slice(start, start + CHUNK_SIZE);
    const { error: cueInsertError } = await supabase.from("cues").insert(batch);
    if (cueInsertError) {
      if (isCueDepartmentConstraintError(cueInsertError)) {
        const legacyBatch = batch.map((row) => ({ ...row, department: toLegacyDepartmentRole(row.department) }));
        const { error: legacyCueInsertError } = await supabase.from("cues").insert(legacyBatch);
        if (!legacyCueInsertError) {
          console.log("[persistEditorDraft] cues inserted using legacy stage_crew department fallback.", {
            showId: normalized.showId,
            start,
            count: batch.length,
          });
          continue;
        }
        console.error("[persistEditorDraft] legacy cue batch insert failed:", {
          showId: normalized.showId,
          start,
          count: batch.length,
          error: legacyCueInsertError,
        });
      }

      console.error("[persistEditorDraft] cue batch insert failed:", {
        showId: normalized.showId,
        start,
        count: batch.length,
        error: cueInsertError,
      });
      return {
        ok: false as const,
        error: getUserFacingSupabaseErrorMessage(cueInsertError, "Failed to save cues."),
      };
    }
  }

  return { ok: true as const, revision: nextUpdatedAt };
}

export async function listShowsForCurrentUser(): Promise<ShowSummary[]> {
  if (!hasSupabaseEnv()) {
    return [
      {
        id: "demo-show",
        title: demoShowDraftOverride?.title ?? "Demo Show",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
  }

  const { supabase, userId } = await getCurrentUserId();
  if (!userId) return [];

  const primaryQuery = supabase
    .from("show_memberships")
    .select("show_id, shows!inner(id, title, created_at, updated_at)")
    .eq("user_id", userId)
    .order("updated_at", { referencedTable: "shows", ascending: false });

  const { data, error } = await primaryQuery;

  if (error || !data) {
    if (isRecursivePolicyError(error, "shows") || isRecursivePolicyError(error, "show_memberships")) {
      console.error(
        "[listShowsForCurrentUser] recursive RLS policy detected. Rerun supabase/migrations/20260328_show_editor_v1.sql.",
      );
      return [];
    }

    if (!isMissingColumnError(error, "updated_at")) {
      console.error("[listShowsForCurrentUser] primary query failed:", formatSupabaseError(error));
    }

    const membershipIdsQuery = await supabase
      .from("show_memberships")
      .select("show_id")
      .eq("user_id", userId);

    if (!membershipIdsQuery.error && membershipIdsQuery.data) {
      const showIds = Array.from(new Set((membershipIdsQuery.data as ShowIdOnlyRow[]).map((row) => row.show_id).filter(Boolean)));
      const byMembershipIds = await listShowsByIds(supabase, showIds);
      if (byMembershipIds) {
        return byMembershipIds;
      }
    } else {
      if (isRecursivePolicyError(membershipIdsQuery.error, "show_memberships")) {
        console.error(
          "[listShowsForCurrentUser] recursive RLS policy detected in show_memberships. Rerun supabase/migrations/20260328_show_editor_v1.sql.",
        );
        return [];
      }
      console.error("[listShowsForCurrentUser] membership id fallback failed:", formatSupabaseError(membershipIdsQuery.error));
    }

    const ownedShows = await listOwnedShowsForCurrentUser(supabase, userId);
    if (ownedShows) {
      return ownedShows;
    }

    return [];
  }

  return (data as MembershipSelectRow[]).reduce<ShowSummary[]>((acc, row) => {
    if (!row.shows) return acc;
    acc.push(normalizeShow(row));
    return acc;
  }, []);
}

export async function createShowForCurrentUser(input: { title: string; sourceText?: string }) {
  const title = input.title.trim();
  const sourceText = input.sourceText?.trim() ?? "";

  if (!title) {
    return { ok: false as const, error: "A show title is required." };
  }

  if (!hasSupabaseEnv()) {
    return { ok: false as const, error: "Supabase must be configured before creating shows." };
  }

  const { supabase, userId } = await getCurrentUserId();
  if (!userId) {
    return { ok: false as const, error: "You must sign in before creating a show." };
  }

  const migrationRequirementMessage = await getEditorMigrationRequirementMessage(supabase);
  if (migrationRequirementMessage) {
    return { ok: false as const, error: migrationRequirementMessage };
  }

  console.log("[createShowForCurrentUser]", { title, userId });

  const { data: show, error: showError } = await supabase
    .from("shows")
    .insert({ title, director_user_id: userId })
    .select("id, title, created_at, updated_at")
    .single();

  let insertedShow = show;
  if (showError || !insertedShow) {
    if (!isMissingColumnError(showError, "updated_at")) {
      console.error("[createShowForCurrentUser] primary show insert failed:", formatSupabaseError(showError));
    }

    const fallbackInsert = await supabase
      .from("shows")
      .insert({ title, director_user_id: userId })
      .select("id, title, created_at")
      .single();

    if (fallbackInsert.error || !fallbackInsert.data) {
      console.error("[createShowForCurrentUser] fallback show insert failed:", formatSupabaseError(fallbackInsert.error));
      return {
        ok: false as const,
        error: getUserFacingSupabaseErrorMessage(fallbackInsert.error, "Failed to create the show."),
      };
    }

    insertedShow = {
      ...fallbackInsert.data,
      updated_at: fallbackInsert.data.created_at,
    } as typeof show;
  }

  if (!insertedShow) {
    console.error("[createShowForCurrentUser] no inserted show returned after fallback.");
    return { ok: false as const, error: "Failed to create the show." };
  }

  const { error: membershipError } = await supabase.from("show_memberships").insert({
    show_id: insertedShow.id,
    user_id: userId,
    role: "director",
  });

  if (membershipError) {
    console.error("[createShowForCurrentUser] membership insert failed:", formatSupabaseError(membershipError));
    return {
      ok: false as const,
      error: getUserFacingSupabaseErrorMessage(membershipError, "Failed to create the show membership."),
    };
  }

  if (sourceText) {
    const { error: scriptUpsertError } = await supabase.from("scripts").upsert(
      {
        show_id: insertedShow.id,
        source_type: "paste",
        raw_text: sourceText,
        updated_at: insertedShow.updated_at ?? insertedShow.created_at,
      },
      { onConflict: "show_id" },
    );

    if (scriptUpsertError) {
      console.error("[createShowForCurrentUser] script upsert failed:", formatSupabaseError(scriptUpsertError));
      return {
        ok: false as const,
        error: getUserFacingSupabaseErrorMessage(scriptUpsertError, "Failed to save the imported script."),
      };
    }
  }

  return { ok: true as const, showId: insertedShow.id };
}

export async function getShowEditorData(showId: string): Promise<ShowEditorData | null> {
  if (showId === "demo-show") {
    return getDemoEditorData(showId);
  }

  if (!isUuidLike(showId)) return null;

  if (!hasSupabaseEnv()) {
    return createDefaultEditorData(showId, showId);
  }

  const { supabase, userId } = await getCurrentUserId();
  if (!userId) return null;

  const membership = await verifyShowMembership(showId, userId);
  if (!membership) return null;

  const [showResult, scriptResult, scenesResult] = await Promise.all([
    supabase
      .from("shows")
      .select("id, title, created_at, updated_at")
      .eq("id", showId)
      .maybeSingle(),
    supabase
      .from("scripts")
      .select("id, raw_text, source_type")
      .eq("show_id", showId)
      .maybeSingle(),
    supabase
      .from("script_scenes")
      .select("id, show_id, act_number, title, sort_index")
      .eq("show_id", showId)
      .order("act_number", { ascending: true })
      .order("sort_index", { ascending: true }),
  ]);

  const { data: show, error: showError } = showResult;
  if (showError || !show) {
    console.error("[getShowEditorData] show lookup failed:", { showId, error: formatSupabaseError(showError) });
    return null;
  }

  const { data: scriptRow, error: scriptError } = scriptResult;
  if (scriptError) {
    console.error("[getShowEditorData] script lookup failed:", { showId, error: formatSupabaseError(scriptError) });
    return null;
  }

  const { data: scenes, error: scenesError } = scenesResult;

  if (scenesError || !scenes) {
    console.error("[getShowEditorData] scene lookup failed:", { showId, error: formatSupabaseError(scenesError) });
    return null;
  }

  const showRow = show as ShowRow;
  const rawSourceText = (scriptRow as ScriptRow | null)?.raw_text ?? "";
  const revision = showRow.updated_at ?? showRow.created_at;

  if (!scenes.length) {
    if (rawSourceText.trim()) {
      const parsedDraft = parseScriptToEditorData(showId, showRow.title, rawSourceText);
      return {
        ...parsedDraft,
        revision,
      };
    }

    return {
      ...createDefaultEditorData(showId, showRow.title, rawSourceText),
      revision,
    };
  }

  const { data: lines, error: linesError } = await supabase
    .from("script_lines")
    .select("id, scene_id, show_id, act_number, line_number, character_name, line_text, line_type, sort_index")
    .eq("show_id", showId)
    .order("act_number", { ascending: true })
    .order("line_number", { ascending: true });

  if (linesError || !lines) {
    console.error("[getShowEditorData] line lookup failed:", { showId, error: linesError });
    return null;
  }

  const { data: cues, error: cuesError } = await supabase
    .from("cues")
    .select("id, show_id, line_id, department, cue_text, standby_offset_ms, go_offset_ms, diagram_image_url, anchor_gap_index")
    .eq("show_id", showId)
    .order("line_id", { ascending: true });

  if (cuesError || !cues) {
    console.error("[getShowEditorData] cue lookup failed:", { showId, error: cuesError });
    return null;
  }

  return buildEditorDataFromRows({
    showId,
    title: showRow.title,
    revision,
    sourceText: rawSourceText,
    scenes: scenes as SceneRow[],
    lines: lines as LineRow[],
    cues: cues as CueRow[],
  });
}

export async function saveShowEditorDraftForCurrentUser(draft: ShowEditorDraft) {
  const normalized = normalizeEditorDraft(draft);

  if (normalized.showId === "demo-show") {
    const nextEditor = normalizeEditorDraft({
      ...normalized,
      showId: "demo-show",
      revision: new Date().toISOString(),
    });
    demoShowDraftOverride = nextEditor;
    return { ok: true as const, editor: nextEditor };
  }

  if (!hasSupabaseEnv()) {
    return { ok: false as const, error: "Supabase must be configured before saving shows." };
  }

  const { supabase, userId } = await getCurrentUserId();
  if (!userId) {
    return { ok: false as const, error: "You must sign in before editing a show." };
  }

  const migrationRequirementMessage = await getEditorMigrationRequirementMessage(supabase);
  if (migrationRequirementMessage) {
    return { ok: false as const, error: migrationRequirementMessage };
  }

  const membership = await verifyShowMembership(normalized.showId, userId);
  if (!membership) {
    return { ok: false as const, error: "You do not have access to edit this show." };
  }

  console.log("[saveShowEditorDraftForCurrentUser]", {
    showId: normalized.showId,
    title: normalized.title,
    userId,
  });

  const { data: show, error: showError } = await supabase
    .from("shows")
    .select("updated_at, created_at")
    .eq("id", normalized.showId)
    .maybeSingle();

  if (showError || !show) {
    console.error("[saveShowEditorDraftForCurrentUser] show revision lookup failed:", { showId: normalized.showId, error: showError });
    return { ok: false as const, error: "Failed to load the current show revision." };
  }

  const currentRevision = (show as Pick<ShowRow, "updated_at" | "created_at">).updated_at ?? show.created_at;
  if (normalized.revision !== currentRevision) {
    return {
      ok: false as const,
      error: "This show changed since you loaded it. Refresh and try again.",
    };
  }

  const persistResult = await persistEditorDraft(normalized);
  if (!persistResult.ok) {
    return persistResult;
  }

  const nextEditor = await getShowEditorData(normalized.showId);
  if (!nextEditor) {
    return { ok: false as const, error: "The show saved, but the updated editor could not be reloaded." };
  }

  return {
    ok: true as const,
    editor: nextEditor,
  };
}

export async function renameShowTitleForCurrentUser(input: { showId: string; title: string }) {
  const showId = input.showId.trim();
  const title = input.title.trim();

  if (!showId) {
    return { ok: false as const, error: "Show ID is required." };
  }

  if (!title) {
    return { ok: false as const, error: "Show title is required." };
  }

  if (showId === "demo-show") {
    const base = getDemoEditorData(showId);
    demoShowDraftOverride = normalizeEditorDraft({
      ...base,
      title,
      revision: new Date().toISOString(),
    });
    return { ok: true as const };
  }

  if (!hasSupabaseEnv()) {
    return { ok: false as const, error: "Supabase must be configured before renaming shows." };
  }

  const { userId } = await getCurrentUserId();
  if (!userId) {
    return { ok: false as const, error: "You must sign in before editing a show." };
  }

  const membership = await verifyShowMembership(showId, userId);
  if (!membership) {
    return { ok: false as const, error: "You do not have access to edit this show." };
  }

  const supabase = await createSupabaseServerClient();
  const nextUpdatedAt = new Date().toISOString();

  console.log("[renameShowTitleForCurrentUser]", { showId, userId, title });

  const { error } = await supabase
    .from("shows")
    .update({
      title,
      updated_at: nextUpdatedAt,
    })
    .eq("id", showId);

  if (error) {
    console.error("[renameShowTitleForCurrentUser] update failed:", { showId, userId, error });
    return {
      ok: false as const,
      error: getUserFacingSupabaseErrorMessage(error, "Failed to rename show."),
    };
  }

  return { ok: true as const };
}

export async function deleteShowForCurrentUser(showIdInput: string) {
  const showId = showIdInput.trim();

  if (!showId) {
    return { ok: false as const, error: "Show ID is required." };
  }

  if (showId === "demo-show") {
    return { ok: false as const, error: "The demo show cannot be deleted." };
  }

  if (!isUuidLike(showId)) {
    return { ok: false as const, error: "Invalid show ID." };
  }

  if (!hasSupabaseEnv()) {
    return { ok: false as const, error: "Supabase must be configured before deleting shows." };
  }

  const { supabase, userId } = await getCurrentUserId();
  if (!userId) {
    return { ok: false as const, error: "You must sign in before deleting a show." };
  }

  const membership = await verifyShowMembership(showId, userId);
  if (!membership || membership.role !== "director") {
    return { ok: false as const, error: "Only the director can delete this show." };
  }

  console.log("[deleteShowForCurrentUser]", { showId, userId });

  const { error } = await supabase.from("shows").delete().eq("id", showId);
  if (error) {
    console.error("[deleteShowForCurrentUser] delete failed:", { showId, userId, error: formatSupabaseError(error) });
    return {
      ok: false as const,
      error: getUserFacingSupabaseErrorMessage(error, "Failed to delete show."),
    };
  }

  return { ok: true as const };
}

export async function getScriptAndCues(showId: string): Promise<{ script: ScriptLine[]; cues: Cue[] }> {
  if (showId === "demo-show") {
    const editor = getDemoEditorData(showId);
    return buildLiveDataFromEditor(editor);
  }

  const editor = await getShowEditorData(showId);
  if (!editor) {
    return { script: [], cues: [] };
  }

  return buildLiveDataFromEditor(editor);
}

export async function getShowTitle(showId: string): Promise<string> {
  if (showId === "demo-show") {
    return demoShowDraftOverride?.title ?? "Demo Show";
  }

  if (!isUuidLike(showId)) {
    return showId;
  }

  if (!hasSupabaseEnv()) {
    return showId;
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from("shows").select("title").eq("id", showId).maybeSingle();
    if (error || !data?.title) {
      if (error) {
        console.error("[getShowTitle] title lookup failed:", { showId, error: formatSupabaseError(error) });
      }
      return showId;
    }
    return data.title;
  } catch (error) {
    console.error("[getShowTitle] unexpected error:", { showId, error });
    return showId;
  }
}
