import { z } from "zod";
import { normalizeEditorDraft } from "@/lib/editor/document";
import type { ShowEditorDraft } from "@/lib/types";

export const PROPRIETARY_SCRIPT_MAGIC = "ONCOMMAND_SCRIPT_V1";
export const PROPRIETARY_SCRIPT_EXTENSION = ".onscript";

const cueSchema = z.object({
  id: z.string().min(1),
  department: z.string().min(1),
  anchorGapIndex: z.number().int().min(0),
  text: z.string(),
  standbyOffsetMs: z.number().int(),
  goOffsetMs: z.number().int(),
  diagramUrl: z.string().optional(),
});

const lineSchema = z.object({
  id: z.string().min(1),
  lineNumber: z.number().int().min(1),
  character: z.string(),
  text: z.string(),
  lineType: z.enum(["dialogue", "stage_direction"]),
  sortIndex: z.number().int().min(0),
  cues: z.array(cueSchema),
});

const sceneSchema = z.object({
  id: z.string().min(1),
  actNumber: z.number().int().min(1),
  title: z.string(),
  sortIndex: z.number().int().min(0),
  lines: z.array(lineSchema),
});

const draftSchema = z.object({
  showId: z.string().min(1),
  title: z.string().min(1),
  revision: z.string().min(1),
  sourceText: z.string(),
  acts: z.array(
    z.object({
      actNumber: z.number().int().min(1),
      scenes: z.array(sceneSchema),
    }),
  ),
});

const compactCueSchema = z.object({
  id: z.string().min(1).optional(),
  department: z.string().min(1),
  anchorGapIndex: z.number().int().min(0).optional(),
  text: z.string().optional(),
  standbyOffsetMs: z.number().int().optional(),
  goOffsetMs: z.number().int().optional(),
  diagramUrl: z.string().optional(),
});

const compactLineSchema = z.object({
  id: z.string().min(1).optional(),
  lineNumber: z.number().int().min(1).optional(),
  character: z.string().optional(),
  text: z.string().optional(),
  lineType: z.enum(["dialogue", "stage_direction"]).optional(),
  cues: z.array(compactCueSchema).optional(),
});

const compactSceneSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().optional(),
  lines: z.array(compactLineSchema),
});

const compactActSchema = z.object({
  id: z.string().min(1).optional(),
  actNumber: z.number().int().min(1).optional(),
  scenes: z.array(compactSceneSchema),
});

const compactScriptSchema = z.object({
  title: z.string().optional(),
  sourceText: z.string().optional(),
  acts: z.array(compactActSchema),
});

export function serializeProprietaryShowDraft(draft: ShowEditorDraft) {
  const normalized = normalizeEditorDraft(draft);
  return `${PROPRIETARY_SCRIPT_MAGIC}\n${JSON.stringify(normalized)}`;
}

export function parseProprietaryShowDraft(raw: string) {
  const trimmed = raw.trim();
  const prefix = `${PROPRIETARY_SCRIPT_MAGIC}\n`;
  if (!trimmed.startsWith(prefix)) {
    return { ok: false as const, error: "Invalid script file format header." };
  }

  const payload = trimmed.slice(prefix.length);
  try {
    const parsed = JSON.parse(payload) as unknown;
    const validated = draftSchema.safeParse(parsed);
    if (validated.success) {
      return { ok: true as const, draft: normalizeEditorDraft(validated.data) };
    }

    const compactValidated = compactScriptSchema.safeParse(parsed);
    if (!compactValidated.success) {
      return { ok: false as const, error: "Script file data is invalid or incomplete." };
    }

    const compact = compactValidated.data;
    const draft: ShowEditorDraft = {
      showId: "imported-show",
      title: compact.title?.trim() || "Imported Show",
      revision: "imported",
      sourceText:
        compact.sourceText ??
        compact.acts
          .flatMap((act) => act.scenes)
          .flatMap((scene) => scene.lines)
          .map((line) => {
            const character = (line.character ?? "").trim();
            const text = (line.text ?? "").trim();
            if (!text) return "";
            return character ? `${character}: ${text}` : text;
          })
          .filter(Boolean)
          .join("\n"),
      acts: compact.acts.map((act, actIndex) => ({
        actNumber: act.actNumber ?? actIndex + 1,
        scenes: act.scenes.map((scene, sceneIndex) => ({
          id: scene.id ?? `scene-${actIndex + 1}-${sceneIndex + 1}`,
          actNumber: act.actNumber ?? actIndex + 1,
          title: scene.title?.trim() || `Scene ${sceneIndex + 1}`,
          sortIndex: sceneIndex,
          lines: scene.lines.map((line, lineIndex) => ({
            id: line.id ?? `line-${actIndex + 1}-${sceneIndex + 1}-${lineIndex + 1}`,
            lineNumber: line.lineNumber ?? lineIndex + 1,
            character: line.character ?? "",
            text: line.text ?? "",
            lineType: line.lineType ?? "dialogue",
            sortIndex: lineIndex,
            cues: (line.cues ?? []).map((cue, cueIndex) => ({
              id: cue.id ?? `cue-${actIndex + 1}-${sceneIndex + 1}-${lineIndex + 1}-${cueIndex + 1}`,
              department: cue.department,
              anchorGapIndex: cue.anchorGapIndex ?? 0,
              text: cue.text ?? "",
              standbyOffsetMs: cue.standbyOffsetMs ?? 5000,
              goOffsetMs: cue.goOffsetMs ?? 0,
              diagramUrl: cue.diagramUrl,
            })),
          })),
        })),
      })),
    };

    return { ok: true as const, draft: normalizeEditorDraft(draft) };
  } catch (error) {
    console.error("[parseProprietaryShowDraft] failed:", error);
    return { ok: false as const, error: "Script file could not be parsed." };
  }
}

export function buildProprietaryFilename(title: string) {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "show-script"}${PROPRIETARY_SCRIPT_EXTENSION}`;
}
