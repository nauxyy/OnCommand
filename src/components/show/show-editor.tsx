"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveShowEditorDraftAction } from "@/app/actions/shows";
import { DEPARTMENT_COLORS } from "@/lib/constants";
import {
  DEPARTMENT_ROLES,
  createDefaultEditorData,
  createEditorId,
  createEmptyCue,
  createEmptyLine,
  createEmptyScene,
  normalizeEditorDraft,
  splitLineWords,
} from "@/lib/editor/document";
import { buildProprietaryFilename, parseProprietaryShowDraft, serializeProprietaryShowDraft } from "@/lib/editor/proprietary-format";
import type { DepartmentRole, EditorAct, EditorCue, EditorLine, LineType, ShowEditorData } from "@/lib/types";

type CueSelection = {
  lineId: string;
  cueId: string;
};

type CueDragPayload =
  | {
      mode: "palette";
      department: DepartmentRole;
    }
  | {
      mode: "existing";
      cueId: string;
      fromLineId: string;
    };

type CueDropTarget = {
  lineId: string;
  gapIndex: number;
};

type LineDragPayload = {
  mode: "line";
  lineId: string;
};

type LineTemplateDragPayload = {
  mode: "line_template";
  lineType: LineType;
};

type LineTransferPayload = LineDragPayload | LineTemplateDragPayload;

type StructureTemplateDragPayload = {
  mode: "act_template" | "scene_template";
};

type LineDropTarget = {
  lineId: string;
  position: "before" | "after";
};

type LineSourceAnchor = {
  actIndex: number;
  sceneIndex: number;
  lineIndex: number;
};

const CUE_DRAG_MIME = "application/x-oncommand-cue";
const LINE_DRAG_MIME = "application/x-oncommand-line";
const STRUCTURE_DRAG_MIME = "application/x-oncommand-structure";
const SCENE_CUE_PREFIX = "[[SCENE]] ";

function cloneDraft(value: ShowEditorData) {
  if (typeof structuredClone === "function") {
    return structuredClone(value) as ShowEditorData;
  }

  return JSON.parse(JSON.stringify(value)) as ShowEditorData;
}

function roleLabel(role: DepartmentRole) {
  return String(role)
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) {
    return items;
  }

  const copy = [...items];
  const [moved] = copy.splice(fromIndex, 1);
  if (typeof moved === "undefined") return items;
  copy.splice(toIndex, 0, moved);
  return copy;
}

function setDraggedElementOpacity(target: EventTarget | null) {
  if (target instanceof HTMLElement) {
    target.style.opacity = "0.55";
  }
}

function clearDraggedElementOpacity(target: EventTarget | null) {
  if (target instanceof HTMLElement) {
    target.style.opacity = "";
  }
}

function getCueChipText(cue: EditorCue, previewRole: DepartmentRole) {
  const label = roleLabel(cue.department);
  const cueText = stripSceneCuePrefix(cue.text).trim();
  if (previewRole !== "director" && previewRole === cue.department && cueText) {
    return `${label}: ${cueText}`;
  }
  return cueText ? `${label}: ${cueText}` : label;
}

function getHoverSummary(cue: EditorCue) {
  const parts = [
    roleLabel(cue.department),
    stripSceneCuePrefix(cue.text).trim() || "No cue text yet.",
  ];
  if (cue.diagramUrl?.trim()) {
    parts.push("Diagram linked");
  }
  return parts.join(" · ");
}

function isSceneScopedCue(cue: EditorCue) {
  return cue.text.startsWith(SCENE_CUE_PREFIX);
}

function stripSceneCuePrefix(text: string) {
  return text.startsWith(SCENE_CUE_PREFIX) ? text.slice(SCENE_CUE_PREFIX.length) : text;
}

function withSceneCuePrefix(text: string) {
  const normalized = stripSceneCuePrefix(text).trim();
  return `${SCENE_CUE_PREFIX}${normalized}`;
}

function getReadableTextColor(hexColor: string) {
  const normalized = hexColor.replace("#", "");
  if (normalized.length !== 6) return "#111827";
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.55 ? "#111827" : "#f8fafc";
}

function getLinePrefix(line: EditorLine) {
  const speaker = line.character.trim();
  return speaker ? `${speaker}:` : "";
}

function getLinePrefixClass() {
  return "text-sky-300";
}

function findLineLocation(acts: EditorAct[], lineId: string) {
  for (let actIndex = 0; actIndex < acts.length; actIndex += 1) {
    const act = acts[actIndex];
    for (let sceneIndex = 0; sceneIndex < act.scenes.length; sceneIndex += 1) {
      const scene = act.scenes[sceneIndex];
      const lineIndex = scene.lines.findIndex((line) => line.id === lineId);
      if (lineIndex >= 0) {
        return { actIndex, sceneIndex, lineIndex };
      }
    }
  }
  return null;
}

function findCueLocation(acts: EditorAct[], cueId: string) {
  for (let actIndex = 0; actIndex < acts.length; actIndex += 1) {
    const act = acts[actIndex];
    for (let sceneIndex = 0; sceneIndex < act.scenes.length; sceneIndex += 1) {
      const scene = act.scenes[sceneIndex];
      for (let lineIndex = 0; lineIndex < scene.lines.length; lineIndex += 1) {
        const cueIndex = scene.lines[lineIndex].cues.findIndex((cue) => cue.id === cueId);
        if (cueIndex >= 0) {
          return { actIndex, sceneIndex, lineIndex, cueIndex };
        }
      }
    }
  }
  return null;
}

function parseCueDragPayload(raw: string): CueDragPayload | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("oncommand-cue:")) {
    return parseCueDragPayload(trimmed.slice("oncommand-cue:".length));
  }

  if (DEPARTMENT_ROLES.includes(trimmed as DepartmentRole)) {
    return { mode: "palette", department: trimmed as DepartmentRole };
  }

  try {
    const parsed = JSON.parse(trimmed) as CueDragPayload;
    if (parsed.mode === "palette" && typeof parsed.department === "string") return parsed;
    if (parsed.mode === "existing" && typeof parsed.cueId === "string" && typeof parsed.fromLineId === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest("textarea")) return true;
  if (target.closest("input")) return true;
  if (target.closest("[contenteditable='true']")) return true;
  return false;
}

function resolveCuePayloadFromDataTransfer(dataTransfer: DataTransfer): CueDragPayload | null {
  return (
    parseCueDragPayload(dataTransfer.getData(CUE_DRAG_MIME)) ??
    parseCueDragPayload(dataTransfer.getData("application/json")) ??
    parseCueDragPayload(dataTransfer.getData("text/plain"))
  );
}

function parseLineTransferPayload(raw: string): LineTransferPayload | null {
  try {
    const parsed = JSON.parse(raw) as LineTransferPayload;
    if (parsed.mode === "line" && typeof parsed.lineId === "string") return parsed;
    if (parsed.mode === "line_template" && parsed.lineType === "dialogue") return parsed;
    return null;
  } catch {
    return null;
  }
}

function CuePalette({
  onDragStart,
  onDragEnd,
  onLineTemplateDragStart,
  onLineTemplateDragEnd,
  onCreateAct,
  onCreateScene,
  onStructureTemplateDragStart,
  onStructureTemplateDragEnd,
}: {
  onDragStart: (payload: CueDragPayload) => void;
  onDragEnd: () => void;
  onLineTemplateDragStart: (lineType: LineType) => void;
  onLineTemplateDragEnd: () => void;
  onCreateAct: () => void;
  onCreateScene: () => void;
  onStructureTemplateDragStart: (mode: "act_template" | "scene_template") => void;
  onStructureTemplateDragEnd: () => void;
}) {
  return (
    <div className="sticky top-4 z-30 rounded-xl border border-sky-700/40 bg-zinc-950/95 p-3 shadow-2xl backdrop-blur">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-2 text-xs uppercase tracking-[0.24em] text-zinc-500">Line tools</p>
          {(["dialogue"] as const).map((lineType) => (
            <span
              key={lineType}
              draggable
              onDragStart={(event) => {
                const payload: LineTemplateDragPayload = { mode: "line_template", lineType };
                event.dataTransfer.setData(LINE_DRAG_MIME, JSON.stringify(payload));
                event.dataTransfer.effectAllowed = "copy";
                setDraggedElementOpacity(event.currentTarget);
                onLineTemplateDragStart(lineType);
              }}
              onDragEnd={(event) => {
                clearDraggedElementOpacity(event.currentTarget);
                onLineTemplateDragEnd();
              }}
              className="cursor-grab rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 active:cursor-grabbing"
            >
              Dialogue line
            </span>
          ))}
          <button
            type="button"
            draggable
            onDragStart={(event) => {
              const payload: StructureTemplateDragPayload = { mode: "scene_template" };
              event.dataTransfer.setData(STRUCTURE_DRAG_MIME, JSON.stringify(payload));
              event.dataTransfer.effectAllowed = "copy";
              setDraggedElementOpacity(event.currentTarget);
              onStructureTemplateDragStart(payload.mode);
            }}
            onDragEnd={(event) => {
              clearDraggedElementOpacity(event.currentTarget);
              onStructureTemplateDragEnd();
            }}
            onClick={onCreateScene}
            className="cursor-grab rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 active:cursor-grabbing"
          >
            Add scene
          </button>
          <button
            type="button"
            draggable
            onDragStart={(event) => {
              const payload: StructureTemplateDragPayload = { mode: "act_template" };
              event.dataTransfer.setData(STRUCTURE_DRAG_MIME, JSON.stringify(payload));
              event.dataTransfer.effectAllowed = "copy";
              setDraggedElementOpacity(event.currentTarget);
              onStructureTemplateDragStart(payload.mode);
            }}
            onDragEnd={(event) => {
              clearDraggedElementOpacity(event.currentTarget);
              onStructureTemplateDragEnd();
            }}
            onClick={onCreateAct}
            className="cursor-grab rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 active:cursor-grabbing"
          >
            Add act
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-2 text-xs uppercase tracking-[0.24em] text-zinc-500">Cue palette</p>
          {DEPARTMENT_ROLES.map((role) => (
            <span
              key={role}
              draggable
              onDragStart={(event) => {
                const payload: CueDragPayload = { mode: "palette", department: role };
                const encoded = JSON.stringify(payload);
                event.dataTransfer.setData(CUE_DRAG_MIME, encoded);
                event.dataTransfer.setData("application/json", encoded);
                event.dataTransfer.setData("text/plain", `oncommand-cue:${encoded}`);
                event.dataTransfer.effectAllowed = "copy";
                setDraggedElementOpacity(event.currentTarget);
                onDragStart(payload);
              }}
              onDragEnd={(event) => {
                clearDraggedElementOpacity(event.currentTarget);
                onDragEnd();
              }}
              className="cursor-grab rounded-full border px-3 py-1.5 text-xs font-semibold text-white active:cursor-grabbing"
              style={{
                borderColor: DEPARTMENT_COLORS[role] ?? "#52525b",
                backgroundColor: `${DEPARTMENT_COLORS[role] ?? "#52525b"}33`,
              }}
            >
              {roleLabel(role)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function CueChip({
  cue,
  previewRole,
  active,
  hideHoverPreview,
  onSelect,
  lineId,
  onDragStart,
  onDragEnd,
}: {
  cue: EditorCue;
  previewRole: DepartmentRole;
  active: boolean;
  hideHoverPreview: boolean;
  onSelect: () => void;
  lineId: string;
  onDragStart: (payload: CueDragPayload) => void;
  onDragEnd: () => void;
}) {
  const color = DEPARTMENT_COLORS[cue.department] ?? "#52525b";
  const tooltipTextColor = getReadableTextColor(color);

  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => {
        const payload: CueDragPayload = { mode: "existing", cueId: cue.id, fromLineId: lineId };
        const encoded = JSON.stringify(payload);
        event.dataTransfer.setData(CUE_DRAG_MIME, encoded);
        event.dataTransfer.setData("application/json", encoded);
        event.dataTransfer.setData("text/plain", `oncommand-cue:${encoded}`);
        event.dataTransfer.effectAllowed = "move";
        setDraggedElementOpacity(event.currentTarget);
        onDragStart(payload);
      }}
      onDragEnd={(event) => {
        clearDraggedElementOpacity(event.currentTarget);
        onDragEnd();
      }}
      onPointerUp={(event) => {
        event.currentTarget.blur();
      }}
      onClick={onSelect}
      title={getHoverSummary(cue)}
      className={[
        "group relative inline-flex h-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border-2 px-2 text-[11px] font-bold leading-none shadow-md outline-none ring-0 ring-offset-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0",
        active ? "brightness-110" : "",
      ].join(" ")}
      style={{
        borderColor: color,
        backgroundColor: `${color}44`,
        color: "#ffffff",
        WebkitTapHighlightColor: "transparent",
      }}
      aria-label={getCueChipText(cue, previewRole)}
    >
      <span>{roleLabel(cue.department)}</span>
      <span
        className={[
          "pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-64 -translate-x-1/2 rounded-lg border p-2 text-left text-xs leading-relaxed whitespace-pre-wrap break-words shadow-2xl",
          hideHoverPreview ? "" : "group-hover:block",
        ].join(" ")}
        style={{
          borderColor: color,
          backgroundColor: color,
          color: tooltipTextColor,
        }}
      >
        {getHoverSummary(cue)}
      </span>
    </button>
  );
}

function GapDropTargetMarker({
  cueDragActive,
  active,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  cueDragActive: boolean;
  active: boolean;
  onDragOver: (event: React.DragEvent<HTMLSpanElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: React.DragEvent<HTMLSpanElement>) => void;
}) {
  return (
    <span
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={[
        "relative inline-flex h-8 shrink-0 items-center justify-center align-middle transition-[width,opacity]",
        cueDragActive && active ? "w-3 opacity-100" : "w-0 opacity-0",
      ].join(" ")}
    >
      <span
        className={[
          "h-6 w-[2px] rounded-full transition-all",
          cueDragActive && active ? "bg-sky-400 shadow-[0_0_0_4px_rgba(56,189,248,0.16)]" : "bg-transparent",
        ].join(" ")}
      />
    </span>
  );
}

function ScriptLineCuePlanner({
  line,
  previewRole,
  cueDragActive,
  activeCueDragPayload,
  selectedCueId,
  dropTarget,
  onCueSelect,
  onDropCue,
  onDropTargetChange,
  onCueDragStart,
  onDragEnd,
}: {
  line: EditorLine;
  previewRole: DepartmentRole;
  cueDragActive: boolean;
  activeCueDragPayload: CueDragPayload | null;
  selectedCueId: string | null;
  dropTarget: CueDropTarget | null;
  onCueSelect: (cue: EditorCue) => void;
  onDropCue: (gapIndex: number, payload: CueDragPayload) => void;
  onDropTargetChange: (target: CueDropTarget | null) => void;
  onCueDragStart: (payload: CueDragPayload) => void;
  onDragEnd: () => void;
}) {
  const words = splitLineWords(line.text);
  const cuesByGap = new Map<number, EditorCue[]>();
  const linePrefix = getLinePrefix(line);
  const linePrefixClass = getLinePrefixClass();

  function resolveCuePayloadFromDataTransfer(event: React.DragEvent<HTMLElement>) {
    if (activeCueDragPayload) return activeCueDragPayload;

    const custom = event.dataTransfer.getData(CUE_DRAG_MIME);
    const json = event.dataTransfer.getData("application/json");
    const plain = event.dataTransfer.getData("text/plain");

    return parseCueDragPayload(custom) ?? parseCueDragPayload(json) ?? parseCueDragPayload(plain);
  }

  function setNearestGapFromWord(event: React.DragEvent<HTMLSpanElement>, wordIndex: number) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    const midpoint = bounds.left + bounds.width / 2;
    const gapIndex = event.clientX <= midpoint ? wordIndex : wordIndex + 1;
    onDropTargetChange({ lineId: line.id, gapIndex });
    return gapIndex;
  }

  line.cues.forEach((cue) => {
    const next = cuesByGap.get(cue.anchorGapIndex) ?? [];
    next.push(cue);
    cuesByGap.set(cue.anchorGapIndex, next);
  });

  const gapCount = Math.max(words.length, 0) + 1;

  return (
    <div
      className="min-w-0"
      onDragOver={(event) => {
        const payload = resolveCuePayloadFromDataTransfer(event);
        if (!payload) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = payload.mode === "palette" ? "copy" : "move";
      }}
      onDrop={(event) => {
        const payload = resolveCuePayloadFromDataTransfer(event);
        if (!payload) return;
        event.preventDefault();
        event.stopPropagation();
        const targetGapIndex = dropTarget?.lineId === line.id ? dropTarget.gapIndex : words.length;
        onDropTargetChange(null);
        onDropCue(targetGapIndex, payload);
      }}
    >
      <div className="text-[1.05rem] leading-8 text-zinc-100">
                {linePrefix ? <span className={["font-medium", linePrefixClass].join(" ")}>{linePrefix} </span> : null}
        {Array.from({ length: gapCount }).map((_, gapIndex) => {
          const gapCues = cuesByGap.get(gapIndex) ?? [];
          const isActiveGap = dropTarget?.lineId === line.id && dropTarget.gapIndex === gapIndex;

          return (
            <span key={`gap-${line.id}-${gapIndex}`} className="contents">
              <GapDropTargetMarker
                cueDragActive={cueDragActive}
                active={isActiveGap}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  onDropTargetChange({ lineId: line.id, gapIndex });
                }}
                onDragLeave={() => {
                  if (isActiveGap) onDropTargetChange(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const payload = resolveCuePayloadFromDataTransfer(event);
                  onDropTargetChange(null);
                  if (!payload) return;
                  onDropCue(gapIndex, payload);
                }}
              />

              {gapCues.length ? (
                <span className="mx-0.5 inline-flex flex-col items-center gap-1 align-middle">
                  {gapCues.map((cue) => (
                    <CueChip
                      key={cue.id}
                      cue={cue}
                      lineId={line.id}
                      previewRole={previewRole}
                      active={selectedCueId === cue.id}
                      hideHoverPreview={cueDragActive}
                      onSelect={() => onCueSelect(cue)}
                      onDragStart={onCueDragStart}
                      onDragEnd={onDragEnd}
                    />
                  ))}
                </span>
              ) : null}

              {gapIndex < words.length ? (
                <span
                  onDragOver={(event) => {
                    setNearestGapFromWord(event, gapIndex);
                  }}
                  onDrop={(event) => {
                    const payload = resolveCuePayloadFromDataTransfer(event);
                    if (!payload) return;
                    event.stopPropagation();
                    const nearestGapIndex = setNearestGapFromWord(event, gapIndex);
                    onDropTargetChange(null);
                    onDropCue(nearestGapIndex, payload);
                  }}
                  className="text-zinc-100"
                >
                  {gapCues.length ? " " : ""}
                  {words[gapIndex]}{" "}
                </span>
              ) : null}
            </span>
          );
        })}
      </div>

      {!words.length ? <p className="mt-2 text-sm text-zinc-500">This line is empty. Drop a department on the marker, then fill in the cue details.</p> : null}
    </div>
  );
}

export function ShowEditor({ initialData }: { initialData: ShowEditorData }) {
  const router = useRouter();
  const [savedData, setSavedData] = useState(() => normalizeEditorDraft(initialData));
  const [draft, setDraft] = useState(() => normalizeEditorDraft(initialData));
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedCue, setSelectedCue] = useState<CueSelection | null>(null);
  const [activeCueDragPayload, setActiveCueDragPayload] = useState<CueDragPayload | null>(null);
  const previewRole: DepartmentRole = "director";
  const [showSourceText, setShowSourceText] = useState(false);
  const [cueDragActive, setCueDragActive] = useState(false);
  const [dropTarget, setDropTarget] = useState<CueDropTarget | null>(null);
  const [lineDropTarget, setLineDropTarget] = useState<LineDropTarget | null>(null);
  const [draggingLineId, setDraggingLineId] = useState<string | null>(null);
  const [draggingLineTemplate, setDraggingLineTemplate] = useState<LineType | null>(null);
  const [draggingStructureTemplate, setDraggingStructureTemplate] = useState<"act_template" | "scene_template" | null>(null);
  const [actInsertIndex, setActInsertIndex] = useState<number | null>(null);
  const [sceneInsertTarget, setSceneInsertTarget] = useState<{ actIndex: number; sceneIndex: number } | null>(null);
  const [sceneCueDropTarget, setSceneCueDropTarget] = useState<{ actIndex: number; sceneIndex: number } | null>(null);
  const [draggingLineSourceAnchor, setDraggingLineSourceAnchor] = useState<LineSourceAnchor | null>(null);
  const [expandedLineId, setExpandedLineId] = useState<string | null>(null);
  const [lineMenuId, setLineMenuId] = useState<string | null>(null);
  const [cueQuickDialog, setCueQuickDialog] = useState<{
    open: boolean;
    lineId: string;
    cueId: string;
    text: string;
  } | null>(null);
  const [sceneEditDialog, setSceneEditDialog] = useState<{
    open: boolean;
    actIndex: number;
    sceneIndex: number;
    title: string;
  } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
  }>({
    open: false,
    title: "",
    description: "",
    confirmLabel: "Delete",
  });
  const confirmActionRef = useRef<(() => void) | null>(null);
  const cueQuickInputRef = useRef<HTMLTextAreaElement | null>(null);
  const sceneEditInputRef = useRef<HTMLInputElement | null>(null);
  const [isPending, startTransition] = useTransition();

  const persistedSnapshot = JSON.stringify(savedData);
  const currentSnapshot = JSON.stringify(draft);
  const isDirty = persistedSnapshot !== currentSnapshot;

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("oncommand:editor-dirty", { detail: { isDirty } }));
  }, [isDirty]);

  const resetEditorDraft = useCallback(() => {
    setDraft(savedData);
    setSelectedCue(null);
    setActiveCueDragPayload(null);
    setCueDragActive(false);
    setDropTarget(null);
    setSceneCueDropTarget(null);
    setLineDropTarget(null);
    setDraggingLineId(null);
    setDraggingLineTemplate(null);
    setDraggingLineSourceAnchor(null);
    setExpandedLineId(null);
    setLineMenuId(null);
    setSaveError(null);
    setSaveMessage("Reverted to last loaded state.");
  }, [savedData]);

  const saveEditorDraft = useCallback(() => {
    setSaveError(null);
    setSaveMessage(null);
    startTransition(async () => {
      const result = await saveShowEditorDraftAction(draft);
      if (!result.ok) {
        setSaveError(result.error ?? "Failed to save this show.");
        return;
      }

      if (!result.editor) {
        setSaveError("The show saved, but the editor could not be refreshed.");
        return;
      }

      setDraft(result.editor);
      setSavedData(result.editor);
      setSaveMessage("Saved.");
      router.refresh();
    });
  }, [draft, router]);

  const applyDraftUpdate = useCallback((updater: (next: ShowEditorData) => void) => {
    setSaveMessage(null);
    setSaveError(null);
    setDraft((previous) => {
      const next = cloneDraft(previous);
      updater(next);
      return normalizeEditorDraft(next);
    });
  }, []);

  const removeCueById = useCallback((cueId: string) => {
    applyDraftUpdate((next) => {
      const location = findCueLocation(next.acts, cueId);
      if (!location) return;
      next.acts[location.actIndex].scenes[location.sceneIndex].lines[location.lineIndex].cues.splice(location.cueIndex, 1);
    });
    setSelectedCue((previous) => (previous?.cueId === cueId ? null : previous));
  }, [applyDraftUpdate]);

  const selectedCueData = useMemo(() => {
    if (!selectedCue) return null;
    const lineLocation = findLineLocation(draft.acts, selectedCue.lineId);
    if (!lineLocation) return null;
    const line = draft.acts[lineLocation.actIndex].scenes[lineLocation.sceneIndex].lines[lineLocation.lineIndex];
    const cue = line.cues.find((item) => item.id === selectedCue.cueId);
    if (!cue) return null;
    return {
      location: lineLocation,
      line,
      cue,
    };
  }, [draft, selectedCue]);

  useEffect(() => {
    if (!lineMenuId) return;

    const closeMenu = () => setLineMenuId(null);
    document.addEventListener("pointerdown", closeMenu);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
    };
  }, [lineMenuId]);

  useEffect(() => {
    const onSaveRequest = () => {
      if (isPending || !isDirty) return;
      saveEditorDraft();
    };
    const onResetRequest = () => {
      resetEditorDraft();
    };
    const onExportRequest = () => {
      try {
        const serialized = serializeProprietaryShowDraft(draft);
        const blob = new Blob([serialized], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = buildProprietaryFilename(draft.title);
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        setSaveError(null);
        setSaveMessage("Exported script file.");
      } catch (error) {
        console.error("[ShowEditor] export failed:", error);
        setSaveError("Failed to export script file.");
      }
    };
    const onImportScript = (event: Event) => {
      const custom = event as CustomEvent<{ fileName?: string; content?: string }>;
      const content = custom.detail?.content;
      if (!content) {
        setSaveError("Import file is empty.");
        return;
      }

      const parsed = parseProprietaryShowDraft(content);
      if (!parsed.ok) {
        setSaveError(parsed.error);
        return;
      }

      const imported = normalizeEditorDraft({
        ...parsed.draft,
        showId: draft.showId,
        title: draft.title,
        revision: savedData.revision,
      });
      setDraft(imported);
      setSelectedCue(null);
      setActiveCueDragPayload(null);
      setCueDragActive(false);
      setDropTarget(null);
      setLineDropTarget(null);
      setDraggingLineId(null);
      setDraggingLineTemplate(null);
      setDraggingLineSourceAnchor(null);
      setExpandedLineId(null);
      setLineMenuId(null);
      setSaveError(null);
      setSaveMessage("Imported script file. Review and click Save.");
    };

    window.addEventListener("oncommand:save-request", onSaveRequest);
    window.addEventListener("oncommand:reset-request", onResetRequest);
    window.addEventListener("oncommand:export-request", onExportRequest);
    window.addEventListener("oncommand:import-script", onImportScript as EventListener);
    return () => {
      window.removeEventListener("oncommand:save-request", onSaveRequest);
      window.removeEventListener("oncommand:reset-request", onResetRequest);
      window.removeEventListener("oncommand:export-request", onExportRequest);
      window.removeEventListener("oncommand:import-script", onImportScript as EventListener);
    };
  }, [draft, isDirty, isPending, resetEditorDraft, saveEditorDraft, savedData.revision]);

  useEffect(() => {
    if (!cueQuickDialog?.open) return;
    cueQuickInputRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setCueQuickDialog((current) => {
          if (!current) return current;
          if (!current.text.trim()) {
            removeCueById(current.cueId);
          }
          return null;
        });
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        setCueQuickDialog((current) => {
          if (!current) return current;
          applyDraftUpdate((next) => {
            const location = findCueLocation(next.acts, current.cueId);
            if (!location) return;
            const cue = next.acts[location.actIndex].scenes[location.sceneIndex].lines[location.lineIndex].cues[location.cueIndex];
            cue.text = isSceneScopedCue(cue) ? withSceneCuePrefix(current.text) : current.text;
          });
          return null;
        });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [cueQuickDialog, removeCueById, applyDraftUpdate]);

  useEffect(() => {
    if (!sceneEditDialog?.open) return;
    sceneEditInputRef.current?.focus();
  }, [sceneEditDialog]);

  useEffect(() => {
    if (!sceneEditDialog?.open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSceneEditDialog(null);
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        setSceneEditDialog((current) => {
          if (!current) return current;
          const nextTitle = current.title.trim();
          if (!nextTitle) return current;
          applyDraftUpdate((next) => {
            next.acts[current.actIndex].scenes[current.sceneIndex].title = nextTitle;
          });
          return null;
        });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [sceneEditDialog?.open, applyDraftUpdate]);

  useEffect(() => {
    if (!confirmDialog.open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        confirmActionRef.current = null;
        setConfirmDialog((previous) => ({ ...previous, open: false }));
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const action = confirmActionRef.current;
        confirmActionRef.current = null;
        setConfirmDialog((previous) => ({ ...previous, open: false }));
        action?.();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [confirmDialog.open]);

  function openConfirmDialog(input: {
    title: string;
    description: string;
    confirmLabel?: string;
    onConfirm: () => void;
  }) {
    confirmActionRef.current = input.onConfirm;
    setConfirmDialog({
      open: true,
      title: input.title,
      description: input.description,
      confirmLabel: input.confirmLabel ?? "Delete",
    });
  }

  function cancelConfirmDialog() {
    confirmActionRef.current = null;
    setConfirmDialog((previous) => ({ ...previous, open: false }));
  }

  function confirmDialogAction() {
    const action = confirmActionRef.current;
    confirmActionRef.current = null;
    setConfirmDialog((previous) => ({ ...previous, open: false }));
    action?.();
  }

  function commitLineTransferAtTarget(payload: LineTransferPayload, target: LineDropTarget) {
    applyDraftUpdate((next) => {
      const targetLocation = findLineLocation(next.acts, target.lineId);
      if (!targetLocation) return;
      const targetScene = next.acts[targetLocation.actIndex].scenes[targetLocation.sceneIndex];
      const insertIndex = targetLocation.lineIndex + (target.position === "after" ? 1 : 0);

      if (payload.mode === "line") {
        const sourceLocation = findLineLocation(next.acts, payload.lineId);
        if (!sourceLocation) return;
        const sourceScene = next.acts[sourceLocation.actIndex].scenes[sourceLocation.sceneIndex];
        const [movedLine] = sourceScene.lines.splice(sourceLocation.lineIndex, 1);
        if (!movedLine) return;

        let targetInsertIndex = insertIndex;
        if (
          sourceLocation.actIndex === targetLocation.actIndex &&
          sourceLocation.sceneIndex === targetLocation.sceneIndex &&
          sourceLocation.lineIndex < targetInsertIndex
        ) {
          targetInsertIndex -= 1;
        }
        targetScene.lines.splice(targetInsertIndex, 0, movedLine);
        return;
      }

      const createdLine = createEmptyLine();
      targetScene.lines.splice(insertIndex, 0, createdLine);
      setExpandedLineId(createdLine.id);
    });
  }

  function resolveActiveLineTransferPayload(rawPayload: string): LineTransferPayload | null {
    if (draggingLineId) {
      return { mode: "line", lineId: draggingLineId };
    }
    if (draggingLineTemplate) {
      return { mode: "line_template", lineType: draggingLineTemplate };
    }
    return parseLineTransferPayload(rawPayload);
  }

  function commitCueDropAtTarget(payload: CueDragPayload, target: CueDropTarget) {
    const nextCueId = payload.mode === "palette" ? createEditorId("cue") : payload.cueId;

    applyDraftUpdate((next) => {
      const targetLocation = findLineLocation(next.acts, target.lineId);
      if (!targetLocation) return;
      const targetLine = next.acts[targetLocation.actIndex].scenes[targetLocation.sceneIndex].lines[targetLocation.lineIndex];

      if (payload.mode === "palette") {
        const cue = {
          ...createEmptyCue(payload.department, target.gapIndex),
          id: nextCueId,
        };
        targetLine.cues.push(cue);
        return;
      }

      const sourceLocation = findLineLocation(next.acts, payload.fromLineId);
      if (!sourceLocation) return;
      const sourceLine = next.acts[sourceLocation.actIndex].scenes[sourceLocation.sceneIndex].lines[sourceLocation.lineIndex];
      const cueIndex = sourceLine.cues.findIndex((cue) => cue.id === payload.cueId);
      if (cueIndex < 0) return;

      const [movedCue] = sourceLine.cues.splice(cueIndex, 1);
      if (!movedCue) return;
      movedCue.anchorGapIndex = target.gapIndex;
      targetLine.cues.push(movedCue);
    });

    setSelectedCue({ lineId: target.lineId, cueId: nextCueId });
    if (payload.mode === "palette") {
      setCueQuickDialog({
        open: true,
        lineId: target.lineId,
        cueId: nextCueId,
        text: "",
      });
    }
  }

  function commitCueDropToScene(payload: CueDragPayload, actIndex: number, sceneIndex: number) {
    const nextCueId = payload.mode === "palette" ? createEditorId("cue") : payload.cueId;
    let targetLineId = "";

    applyDraftUpdate((next) => {
      const scene = next.acts[actIndex]?.scenes[sceneIndex];
      if (!scene) return;

      if (!scene.lines.length) {
        setSaveError("Add at least one script line to this scene before adding scene-change cues.");
        return;
      }

      const targetLine = scene.lines[0];
      if (!targetLine) return;
      targetLineId = targetLine.id;

      if (payload.mode === "palette") {
        targetLine.cues.push({
          ...createEmptyCue(payload.department, 0),
          id: nextCueId,
          text: withSceneCuePrefix("Scene change"),
        });
        return;
      }

      const sourceLocation = findLineLocation(next.acts, payload.fromLineId);
      if (!sourceLocation) return;
      const sourceLine = next.acts[sourceLocation.actIndex].scenes[sourceLocation.sceneIndex].lines[sourceLocation.lineIndex];
      const cueIndex = sourceLine.cues.findIndex((cue) => cue.id === payload.cueId);
      if (cueIndex < 0) return;
      const [movedCue] = sourceLine.cues.splice(cueIndex, 1);
      if (!movedCue) return;
      movedCue.anchorGapIndex = 0;
      movedCue.text = withSceneCuePrefix(movedCue.text);
      targetLine.cues.push(movedCue);
    });

    if (!targetLineId) return;
    setSelectedCue({ lineId: targetLineId, cueId: nextCueId });
    if (payload.mode === "palette") {
      setCueQuickDialog({
        open: true,
        lineId: targetLineId,
        cueId: nextCueId,
        text: "Scene change",
      });
    }
  }

  return (
    <div
      className="space-y-4"
      onDragOverCapture={(event) => {
        const payload = activeCueDragPayload ?? resolveCuePayloadFromDataTransfer(event.dataTransfer);
        if (!payload) return;

        if (isTextEntryTarget(event.target)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "none";
          return;
        }

        if (!dropTarget) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = payload.mode === "palette" ? "copy" : "move";
      }}
      onDropCapture={(event) => {
        const payload = activeCueDragPayload ?? resolveCuePayloadFromDataTransfer(event.dataTransfer);
        if (!payload) return;

        if (isTextEntryTarget(event.target)) {
          event.preventDefault();
          event.stopPropagation();
          setCueDragActive(false);
          setDropTarget(null);
          setActiveCueDragPayload(null);
          return;
        }

        if (!dropTarget) return;
        event.preventDefault();
        event.stopPropagation();
        commitCueDropAtTarget(payload, dropTarget);
        setDropTarget(null);
        setCueDragActive(false);
        setActiveCueDragPayload(null);
      }}
    >
      {saveError ? <p className="text-sm text-rose-300">{saveError}</p> : null}
      {saveMessage ? <p className="text-sm text-emerald-300">{saveMessage}</p> : null}

      <CuePalette
        onDragStart={(payload) => {
          setCueDragActive(true);
          setActiveCueDragPayload(payload);
        }}
        onDragEnd={() => {
          setCueDragActive(false);
          setDropTarget(null);
          setSceneCueDropTarget(null);
          setActiveCueDragPayload(null);
        }}
        onLineTemplateDragStart={(lineType) => {
          setDraggingLineTemplate(lineType);
          setDraggingLineSourceAnchor(null);
        }}
        onLineTemplateDragEnd={() => {
          setDraggingLineTemplate(null);
          setLineDropTarget(null);
          setDraggingLineSourceAnchor(null);
        }}
        onStructureTemplateDragStart={(mode) => {
          setDraggingStructureTemplate(mode);
          setActInsertIndex(null);
          setSceneInsertTarget(null);
        }}
        onStructureTemplateDragEnd={() => {
          setDraggingStructureTemplate(null);
          setActInsertIndex(null);
          setSceneInsertTarget(null);
        }}
        onCreateScene={() =>
          applyDraftUpdate((next) => {
            const targetActIndex = Math.max(next.acts.length - 1, 0);
            if (!next.acts[targetActIndex]) {
              next.acts.push({ actNumber: 1, scenes: [createEmptyScene(1, "Scene 1")] });
              return;
            }
            const targetAct = next.acts[targetActIndex];
            targetAct.scenes.push(createEmptyScene(targetAct.actNumber, `Scene ${targetAct.scenes.length + 1}`));
          })
        }
        onCreateAct={() =>
          applyDraftUpdate((next) => {
            const nextActNumber = next.acts.length + 1;
            next.acts.push({
              actNumber: nextActNumber,
              scenes: [createEmptyScene(nextActNumber, "Scene 1")],
            });
          })
        }
      />

      <section className="space-y-4">
        {draft.acts.map((act, actIndex) => (
          <div key={`act-wrap-${act.actNumber}`} className="space-y-0">
            <div
              className={[
                "relative rounded-xl border border-zinc-800 bg-zinc-900 p-4 shadow-lg",
                draggingStructureTemplate === "act_template" ? "cursor-copy" : "",
              ].join(" ")}
              onDragOver={(event) => {
                if (draggingStructureTemplate !== "act_template") return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                const bounds = event.currentTarget.getBoundingClientRect();
                const insertIndex = event.clientY < bounds.top + bounds.height / 2 ? actIndex : actIndex + 1;
                if (actInsertIndex !== insertIndex) {
                  setActInsertIndex(insertIndex);
                }
              }}
              onDrop={(event) => {
                if (draggingStructureTemplate !== "act_template") return;
                event.preventDefault();
                event.stopPropagation();
                const insertIndex = actInsertIndex ?? actIndex + 1;
                applyDraftUpdate((next) => {
                  next.acts.splice(insertIndex, 0, {
                    actNumber: next.acts.length + 1,
                    scenes: [createEmptyScene(insertIndex + 1, "Scene 1")],
                  });
                });
                setDraggingStructureTemplate(null);
                setActInsertIndex(null);
              }}
            >
            {draggingStructureTemplate === "act_template" && actInsertIndex === actIndex ? (
              <div className="pointer-events-none absolute -top-2 left-0 right-0 z-20 h-[2px] rounded-full bg-sky-500/85" />
            ) : null}
            {draggingStructureTemplate === "act_template" &&
            actIndex === draft.acts.length - 1 &&
            actInsertIndex === draft.acts.length ? (
              <div className="pointer-events-none absolute -bottom-2 left-0 right-0 z-20 h-[2px] rounded-full bg-sky-500/85" />
            ) : null}
            <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 pb-3">
              <h2 className="text-lg font-semibold text-white">Act {act.actNumber}</h2>
              <button
                type="button"
                disabled={actIndex === 0}
                onClick={() =>
                  applyDraftUpdate((next) => {
                    next.acts = moveItem(next.acts, actIndex, actIndex - 1);
                  })
                }
                className="cursor-pointer rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Move up
              </button>
              <button
                type="button"
                disabled={actIndex === draft.acts.length - 1}
                onClick={() =>
                  applyDraftUpdate((next) => {
                    next.acts = moveItem(next.acts, actIndex, actIndex + 1);
                  })
                }
                className="cursor-pointer rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Move down
              </button>
              <button
                type="button"
                disabled={draft.acts.length === 1}
                onClick={() =>
                  openConfirmDialog({
                    title: "Delete act?",
                    description: `Act ${act.actNumber} and all its scenes/lines will be removed.`,
                    onConfirm: () =>
                      applyDraftUpdate((next) => {
                        next.acts.splice(actIndex, 1);
                      }),
                  })
                }
                className="cursor-pointer rounded-md border border-rose-700 px-2 py-1 text-xs text-rose-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Remove act
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {act.scenes.map((scene, sceneIndex) => (
                <div key={`scene-wrap-${scene.id}`} className="space-y-0">
                  <div
                    className={[
                      "relative rounded-xl border border-zinc-800 bg-zinc-950/70 p-4",
                      draggingStructureTemplate === "scene_template" ? "cursor-copy" : "",
                    ].join(" ")}
                    onDragOver={(event) => {
                      if (draggingStructureTemplate !== "scene_template") return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "copy";
                      const bounds = event.currentTarget.getBoundingClientRect();
                      const insertSceneIndex = event.clientY < bounds.top + bounds.height / 2 ? sceneIndex : sceneIndex + 1;
                      const nextTarget = { actIndex, sceneIndex: insertSceneIndex };
                      if (
                        sceneInsertTarget?.actIndex !== nextTarget.actIndex ||
                        sceneInsertTarget.sceneIndex !== nextTarget.sceneIndex
                      ) {
                        setSceneInsertTarget(nextTarget);
                      }
                    }}
                    onDrop={(event) => {
                      if (draggingStructureTemplate !== "scene_template") return;
                      event.preventDefault();
                      event.stopPropagation();
                      const insertSceneIndex = sceneInsertTarget?.actIndex === actIndex ? sceneInsertTarget.sceneIndex : sceneIndex + 1;
                      applyDraftUpdate((next) => {
                        const targetAct = next.acts[actIndex];
                        if (!targetAct) return;
                        targetAct.scenes.splice(insertSceneIndex, 0, createEmptyScene(targetAct.actNumber, `Scene ${insertSceneIndex + 1}`));
                      });
                      setDraggingStructureTemplate(null);
                      setSceneInsertTarget(null);
                    }}
                  >
                  {draggingStructureTemplate === "scene_template" &&
                  sceneInsertTarget?.actIndex === actIndex &&
                  sceneInsertTarget.sceneIndex === sceneIndex ? (
                    <div className="pointer-events-none absolute -top-2 left-0 right-0 z-20 h-[2px] rounded-full bg-sky-500/85" />
                  ) : null}
                  {draggingStructureTemplate === "scene_template" &&
                  sceneIndex === act.scenes.length - 1 &&
                  sceneInsertTarget?.actIndex === actIndex &&
                  sceneInsertTarget.sceneIndex === act.scenes.length ? (
                    <div className="pointer-events-none absolute -bottom-2 left-0 right-0 z-20 h-[2px] rounded-full bg-sky-500/85" />
                  ) : null}
                  <div
                    className={[
                      "rounded-xl border border-indigo-500/60 bg-indigo-950/30 p-4 transition-all duration-150",
                      sceneCueDropTarget?.actIndex === actIndex && sceneCueDropTarget.sceneIndex === sceneIndex
                        ? "ring-2 ring-sky-400 bg-indigo-900/40"
                        : "",
                    ].join(" ")}
                    onDragOver={(event) => {
                      const payload = activeCueDragPayload ?? resolveCuePayloadFromDataTransfer(event.dataTransfer);
                      if (!payload) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = payload.mode === "palette" ? "copy" : "move";
                      if (sceneCueDropTarget?.actIndex !== actIndex || sceneCueDropTarget.sceneIndex !== sceneIndex) {
                        setSceneCueDropTarget({ actIndex, sceneIndex });
                      }
                    }}
                    onDragLeave={() => {
                      if (sceneCueDropTarget?.actIndex === actIndex && sceneCueDropTarget.sceneIndex === sceneIndex) {
                        setSceneCueDropTarget(null);
                      }
                    }}
                    onDrop={(event) => {
                      const payload = activeCueDragPayload ?? resolveCuePayloadFromDataTransfer(event.dataTransfer);
                      if (!payload) return;
                      event.preventDefault();
                      event.stopPropagation();
                      commitCueDropToScene(payload, actIndex, sceneIndex);
                      setCueDragActive(false);
                      setDropTarget(null);
                      setSceneCueDropTarget(null);
                      setActiveCueDragPayload(null);
                    }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-indigo-200">{scene.title}</p>
                        <p className="mt-1 text-xs uppercase tracking-wide text-zinc-500">Act {act.actNumber} · Scene {sceneIndex + 1}</p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={sceneIndex === 0}
                          onClick={() =>
                            applyDraftUpdate((next) => {
                              next.acts[actIndex].scenes = moveItem(next.acts[actIndex].scenes, sceneIndex, sceneIndex - 1);
                            })
                          }
                          className="cursor-pointer rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Move up
                        </button>
                        <button
                          type="button"
                          disabled={sceneIndex === act.scenes.length - 1}
                          onClick={() =>
                            applyDraftUpdate((next) => {
                              next.acts[actIndex].scenes = moveItem(next.acts[actIndex].scenes, sceneIndex, sceneIndex + 1);
                            })
                          }
                          className="cursor-pointer rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Move down
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSceneEditDialog({
                              open: true,
                              actIndex,
                              sceneIndex,
                              title: scene.title,
                            });
                          }}
                          className="cursor-pointer rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-200"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={act.scenes.length === 1}
                          onPointerDown={(event) => {
                            if (act.scenes.length === 1) return;
                            event.preventDefault();
                            openConfirmDialog({
                              title: "Delete scene?",
                              description: `Scene "${scene.title || `Scene ${sceneIndex + 1}`}" and all its lines/cues will be removed.`,
                              onConfirm: () =>
                                applyDraftUpdate((next) => {
                                  next.acts[actIndex].scenes.splice(sceneIndex, 1);
                                }),
                            });
                          }}
                          onClick={() =>
                            openConfirmDialog({
                              title: "Delete scene?",
                              description: `Scene "${scene.title || `Scene ${sceneIndex + 1}`}" and all its lines/cues will be removed.`,
                              onConfirm: () =>
                                applyDraftUpdate((next) => {
                                  next.acts[actIndex].scenes.splice(sceneIndex, 1);
                                }),
                            })
                          }
                          className="cursor-pointer rounded-md border border-rose-700 px-2 py-1 text-xs text-rose-200 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Remove scene
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {scene.lines[0]?.cues.filter((cue) => isSceneScopedCue(cue)).length ? (
                        scene.lines[0]?.cues.filter((cue) => isSceneScopedCue(cue)).map((cue) => (
                          (() => {
                            const color = DEPARTMENT_COLORS[cue.department] ?? "#52525b";
                            return (
                          <button
                            key={`scene-cue-${cue.id}`}
                            type="button"
                            onClick={() => {
                              const sceneStartLineId = scene.lines[0]?.id;
                              if (!sceneStartLineId) return;
                              setSelectedCue({ lineId: sceneStartLineId, cueId: cue.id });
                              setCueQuickDialog({
                                open: true,
                                lineId: sceneStartLineId,
                                cueId: cue.id,
                                text: stripSceneCuePrefix(cue.text),
                              });
                            }}
                            className="inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-medium"
                            style={{
                              borderColor: color,
                              backgroundColor: `${color}55`,
                              color: "#ffffff",
                            }}
                          >
                            {roleLabel(cue.department)}: {stripSceneCuePrefix(cue.text) || "No cue text"}
                          </button>
                            );
                          })()
                        ))
                      ) : (
                        <p className="text-xs text-zinc-400">Drag cue palette chips into this scene to add scene-level cues.</p>
                      )}
                    </div>
                  </div>

                  <div
                    className="mt-4 space-y-3 border-l border-zinc-800/70 pl-4"
                    onDragOver={(event) => {
                      const payload = resolveActiveLineTransferPayload(event.dataTransfer.getData(LINE_DRAG_MIME));
                      if (!payload) return;
                      const target = event.target as HTMLElement | null;
                      const overLine = target?.closest?.("[data-line-id]");
                      if (overLine || !lineDropTarget) return;

                      const activeTargetLine = event.currentTarget.querySelector<HTMLElement>(`[data-line-id="${lineDropTarget.lineId}"]`);
                      if (!activeTargetLine) {
                        setLineDropTarget(null);
                        return;
                      }

                      const rect = activeTargetLine.getBoundingClientRect();
                      const withinHorizontal = event.clientX >= rect.left && event.clientX <= rect.right;
                      const withinVerticalIndicatorBand = event.clientY >= rect.top - 12 && event.clientY <= rect.bottom + 12;
                      if (!withinHorizontal || !withinVerticalIndicatorBand) {
                        setLineDropTarget(null);
                      }
                    }}
                    onDrop={(event) => {
                      const payload = resolveActiveLineTransferPayload(event.dataTransfer.getData(LINE_DRAG_MIME));
                      if (!payload) return;
                      const target = event.target as HTMLElement | null;
                      const overLine = target?.closest?.("[data-line-id]");
                      if (!overLine) {
                        if (payload && lineDropTarget) {
                          // Dropped on the visual indicator gap; commit using current target.
                          commitLineTransferAtTarget(payload, lineDropTarget);
                        }

                        setLineDropTarget(null);
                        setDraggingLineId(null);
                        setDraggingLineTemplate(null);
                        setDraggingLineSourceAnchor(null);
                      }
                    }}
                  >
                    {scene.lines.length ? (
                      scene.lines.map((line, lineIndex) => {
                        const isSelectedLine = selectedCueData?.line.id === line.id;
                        const selectedCueId = isSelectedLine ? selectedCueData?.cue.id ?? null : null;
                        const isLineDetailsOpen = expandedLineId === line.id;
                        const isLineDropBefore = lineDropTarget?.lineId === line.id && lineDropTarget.position === "before";
                        const isLineDropAfter = lineDropTarget?.lineId === line.id && lineDropTarget.position === "after";
                        const isLineDragActive = Boolean(draggingLineId || draggingLineTemplate);

                        return (
                          <div
                            key={line.id}
                            data-line-id={line.id}
                            className={[
                              "relative rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3 transition-opacity",
                              draggingLineSourceAnchor &&
                              draggingLineSourceAnchor.actIndex === actIndex &&
                              draggingLineSourceAnchor.sceneIndex === sceneIndex &&
                              draggingLineSourceAnchor.lineIndex === lineIndex
                                ? "opacity-40"
                                : "",
                            ].join(" ")}
                            onDragOver={(event) => {
                              const payload = resolveActiveLineTransferPayload(event.dataTransfer.getData(LINE_DRAG_MIME));
                              if (!payload) return;
                              if (payload.mode === "line" && payload.lineId === line.id) return;
                              event.preventDefault();
                              event.dataTransfer.dropEffect = payload.mode === "line" ? "move" : "copy";
                              const bounds = event.currentTarget.getBoundingClientRect();
                              const relativeY = event.clientY - bounds.top;
                              const midpoint = bounds.height / 2;
                              const deadZonePx = 8;
                              let position: "before" | "after";

                              if (Math.abs(relativeY - midpoint) <= deadZonePx && lineDropTarget?.lineId === line.id) {
                                // Keep the previous side near center to avoid flashing.
                                position = lineDropTarget.position;
                              } else {
                                position = relativeY < midpoint ? "before" : "after";
                              }

                              if (lineDropTarget?.lineId !== line.id || lineDropTarget.position !== position) {
                                setLineDropTarget({ lineId: line.id, position });
                              }
                            }}
                            onDrop={(event) => {
                              const payload = resolveActiveLineTransferPayload(event.dataTransfer.getData(LINE_DRAG_MIME));
                              setLineDropTarget(null);
                              setDraggingLineId(null);
                              setDraggingLineTemplate(null);
                              setDraggingLineSourceAnchor(null);
                              if (!payload) return;
                              if (payload.mode === "line" && payload.lineId === line.id) return;
                              event.preventDefault();
                              event.stopPropagation();
                              if (lineDropTarget) {
                                commitLineTransferAtTarget(payload, lineDropTarget);
                                return;
                              }

                              // Safety fallback: compute local side if target wasn't set for any reason.
                              const bounds = event.currentTarget.getBoundingClientRect();
                              const position = event.clientY - bounds.top < bounds.height / 2 ? "before" : "after";
                              commitLineTransferAtTarget(payload, { lineId: line.id, position });
                            }}
                          >
                            {isLineDragActive && isLineDropBefore ? (
                              <div className="pointer-events-none absolute -top-2 left-0 right-0 flex items-center">
                                <div className="h-[3px] w-full rounded-full bg-sky-400" />
                              </div>
                            ) : null}
                            {isLineDragActive && isLineDropAfter ? (
                              <div className="pointer-events-none absolute -bottom-2 left-0 right-0 flex items-center">
                                <div className="h-[3px] w-full rounded-full bg-sky-400" />
                              </div>
                            ) : null}

                            <div className="flex items-center gap-3">
                              <span
                              draggable
                              onDragStart={(event) => {
                                const payload: LineDragPayload = { mode: "line", lineId: line.id };
                                event.dataTransfer.setData(LINE_DRAG_MIME, JSON.stringify(payload));
                                event.dataTransfer.effectAllowed = "move";
                                const lineElement = event.currentTarget.closest("[data-line-id]") as HTMLElement | null;
                                if (lineElement) {
                                  event.dataTransfer.setDragImage(lineElement, 24, Math.max(16, lineElement.clientHeight / 2));
                                }
                                setDraggedElementOpacity(event.currentTarget);
                                setDraggingLineId(line.id);
                                setDraggingLineSourceAnchor({ actIndex, sceneIndex, lineIndex });
                              }}
                              onDragEnd={(event) => {
                                clearDraggedElementOpacity(event.currentTarget);
                                setLineDropTarget(null);
                                setDraggingLineId(null);
                                setDraggingLineTemplate(null);
                                setDraggingLineSourceAnchor(null);
                              }}
                                className="shrink-0 cursor-grab select-none text-lg leading-none text-zinc-600 active:cursor-grabbing"
                                aria-label={`Drag line ${line.lineNumber}`}
                                title="Drag line"
                              >
                                ☰
                              </span>

                              <div className="min-w-0 flex-1">
                                <ScriptLineCuePlanner
                                  line={{
                                    ...line,
                                    cues: line.cues.filter((cue) => !isSceneScopedCue(cue)),
                                  }}
                                  previewRole={previewRole}
                                  cueDragActive={cueDragActive}
                                  activeCueDragPayload={activeCueDragPayload}
                                  selectedCueId={selectedCueId}
                                  dropTarget={dropTarget}
                                  onCueSelect={(cue) => {
                                    setSelectedCue({ lineId: line.id, cueId: cue.id });
                                    setCueQuickDialog({
                                      open: true,
                                      lineId: line.id,
                                      cueId: cue.id,
                                      text: stripSceneCuePrefix(cue.text),
                                    });
                                  }}
                                  onDropTargetChange={setDropTarget}
                                  onCueDragStart={(payload) => {
                                    setCueDragActive(true);
                                    setActiveCueDragPayload(payload);
                                  }}
                                  onDragEnd={() => {
                                    setCueDragActive(false);
                                    setDropTarget(null);
                                    setActiveCueDragPayload(null);
                                  }}
                                  onDropCue={(gapIndex, payload) => {
                                    commitCueDropAtTarget(payload, { lineId: line.id, gapIndex });
                                  }}
                                />
                              </div>

                              <div className="relative shrink-0" onPointerDown={(event) => event.stopPropagation()}>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setLineMenuId((current) => (current === line.id ? null : line.id));
                                  }}
                                  className="cursor-pointer text-lg leading-none text-zinc-600 transition hover:text-zinc-300"
                                  aria-label={lineMenuId === line.id ? "Close line menu" : "Open line menu"}
                                  title="Line menu"
                                >
                                  <span className="inline-block rotate-90">⋯</span>
                                </button>

                                {lineMenuId === line.id ? (
                                  <div className="absolute right-0 top-full z-50 mt-2 w-36 rounded-lg border border-zinc-700 bg-zinc-950 p-1 shadow-2xl">
                                    <button
                                      type="button"
                                      onPointerDown={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setExpandedLineId(line.id);
                                        setLineMenuId(null);
                                      }}
                                      onClick={() => {
                                        setExpandedLineId(line.id);
                                        setLineMenuId(null);
                                      }}
                                      className="block w-full cursor-pointer rounded-md px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-900"
                                    >
                                      Edit line
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setLineMenuId(null);
                                        openConfirmDialog({
                                          title: "Delete line?",
                                          description: `This will remove "${(line.character || "Speaker").trim()}: ${line.text.trim() || "(empty line)"}" and all cues on it.`,
                                          onConfirm: () =>
                                            applyDraftUpdate((next) => {
                                              next.acts[actIndex].scenes[sceneIndex].lines.splice(lineIndex, 1);
                                              if (selectedCue?.lineId === line.id) {
                                                setSelectedCue(null);
                                              }
                                              if (expandedLineId === line.id) {
                                                setExpandedLineId(null);
                                              }
                                            }),
                                        });
                                      }}
                                      className="block w-full cursor-pointer rounded-md px-3 py-2 text-left text-sm text-rose-300 hover:bg-zinc-900"
                                    >
                                      Delete line
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </div>

                            {isLineDetailsOpen ? (
                              <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/60">
                                <div className="flex justify-end px-4 pt-3">
                                  <button
                                    type="button"
                                    onClick={() => setExpandedLineId(null)}
                                    className="cursor-pointer px-1 py-0.5 text-sm text-zinc-500 hover:text-zinc-300"
                                    aria-label="Close line editor"
                                    title="Close"
                                  >
                                    ×
                                  </button>
                                </div>
                                <div className="grid gap-3 px-4 pb-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                                <label className="flex flex-col gap-1 text-xs text-zinc-400">
                                  Character
                                  <input
                                    value={line.character}
                                    onChange={(event) =>
                                      applyDraftUpdate((next) => {
                                        next.acts[actIndex].scenes[sceneIndex].lines[lineIndex].character = event.target.value;
                                      })
                                    }
                                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
                                  />
                                </label>

                                <label className="flex flex-col gap-1 text-xs text-zinc-400">
                                  Line text
                                  <input
                                    value={line.text}
                                    onChange={(event) =>
                                      applyDraftUpdate((next) => {
                                        next.acts[actIndex].scenes[sceneIndex].lines[lineIndex].text = event.target.value;
                                      })
                                    }
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        setExpandedLineId(null);
                                      }
                                    }}
                                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
                                  />
                                </label>
                                </div>
                              </div>
                            ) : null}

                            {isSelectedLine && selectedCueData ? null : null}
                          </div>
                        );
                      })
                    ) : (
                      <div
                        onDragOver={(event) => {
                          const payload = resolveActiveLineTransferPayload(event.dataTransfer.getData(LINE_DRAG_MIME));
                          if (!payload) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = payload.mode === "line" ? "move" : "copy";
                        }}
                        onDrop={(event) => {
                          const payload = resolveActiveLineTransferPayload(event.dataTransfer.getData(LINE_DRAG_MIME));
                          setDraggingLineId(null);
                          setDraggingLineTemplate(null);
                          setDraggingLineSourceAnchor(null);
                          if (!payload) return;
                          event.preventDefault();
                          applyDraftUpdate((next) => {
                            const targetScene = next.acts[actIndex].scenes[sceneIndex];

                            if (payload.mode === "line_template") {
                              const createdLine = createEmptyLine();
                              targetScene.lines.push(createdLine);
                              setExpandedLineId(createdLine.id);
                              return;
                            }

                            const sourceLocation = findLineLocation(next.acts, payload.lineId);
                            if (!sourceLocation) return;
                            const sourceScene = next.acts[sourceLocation.actIndex].scenes[sourceLocation.sceneIndex];
                            const [movedLine] = sourceScene.lines.splice(sourceLocation.lineIndex, 1);
                            if (!movedLine) return;
                            targetScene.lines.push(movedLine);
                          });
                        }}
                        className="rounded-lg border border-dashed border-zinc-700 px-3 py-4 text-sm text-zinc-500"
                      >
                        Drag a dialogue line here.
                      </div>
                    )}
                  </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          </div>
        ))}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              applyDraftUpdate((next) => {
                next.acts.push({
                  actNumber: next.acts.length + 1,
                  scenes: [createEmptyScene(next.acts.length + 1, "Scene 1")],
                });
              })
            }
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-100"
          >
            Add act
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(createDefaultEditorData(draft.showId, draft.title, draft.sourceText));
              setSelectedCue(null);
              setActiveCueDragPayload(null);
              setCueDragActive(false);
              setDropTarget(null);
              setLineDropTarget(null);
              setDraggingLineId(null);
              setDraggingLineTemplate(null);
              setDraggingLineSourceAnchor(null);
              setExpandedLineId(null);
              setLineMenuId(null);
              setSaveMessage("Started a new empty editor layout.");
            }}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-100"
          >
            Clear structure
          </button>
        </div>
        <button
          type="button"
          onClick={() => setShowSourceText(true)}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300"
        >
          Source text
        </button>
      </div>

      {confirmDialog.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-950 p-4 shadow-2xl">
            <p className="text-lg font-semibold text-white">{confirmDialog.title}</p>
            <p className="mt-2 text-sm text-zinc-300">{confirmDialog.description}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelConfirmDialog}
                className="cursor-pointer rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDialogAction}
                className="cursor-pointer rounded-md border border-rose-700 bg-rose-950 px-3 py-2 text-sm font-semibold text-rose-200"
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {cueQuickDialog?.open ? (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 p-4">
        <div className="w-full max-w-md rounded-xl border border-sky-700/50 bg-zinc-950 p-4 shadow-2xl">
          <p className="text-lg font-semibold text-white">Add cue instruction</p>
          <p className="mt-2 text-sm text-zinc-300">Describe what this department should do at this prompt. Press Cmd/Ctrl + Enter to save.</p>
            <textarea
              ref={cueQuickInputRef}
              value={cueQuickDialog.text}
              onChange={(event) =>
                setCueQuickDialog((current) => (current ? { ...current, text: event.target.value } : current))
              }
              rows={4}
              className="mt-3 w-full resize-none overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
              placeholder="Type cue instruction..."
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() =>
                  setCueQuickDialog((current) => {
                    if (!current) return current;
                    removeCueById(current.cueId);
                    return null;
                  })
                }
                className="cursor-pointer rounded-md border border-rose-700 bg-rose-950 px-3 py-2 text-sm font-semibold text-rose-200"
              >
                Delete cue
              </button>
              <button
                type="button"
                onClick={() =>
                  setCueQuickDialog((current) => {
                    if (!current) return current;
                    if (!current.text.trim()) {
                      removeCueById(current.cueId);
                    }
                    return null;
                  })
                }
                className="cursor-pointer rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setCueQuickDialog((current) => {
                    if (!current) return current;
                    applyDraftUpdate((next) => {
                      const location = findCueLocation(next.acts, current.cueId);
                      if (!location) return;
                      const cue = next.acts[location.actIndex].scenes[location.sceneIndex].lines[location.lineIndex].cues[location.cueIndex];
                      cue.text = isSceneScopedCue(cue) ? withSceneCuePrefix(current.text) : current.text;
                    });
                    return null;
                  });
                }}
                className="cursor-pointer rounded-md border border-sky-700 bg-sky-900 px-3 py-2 text-sm font-semibold text-sky-100"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {sceneEditDialog?.open ? (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/65 p-4">
          <div className="w-full max-w-md rounded-xl border border-sky-700/50 bg-zinc-950 p-4 shadow-2xl">
            <p className="text-lg font-semibold text-white">{`Act ${sceneEditDialog.actIndex + 1} Scene ${sceneEditDialog.sceneIndex + 1}`}</p>
            <p className="mt-2 text-sm text-zinc-300">Edit scene title.</p>
            <input
              ref={sceneEditInputRef}
              value={sceneEditDialog.title}
              onChange={(event) =>
                setSceneEditDialog((current) => (current ? { ...current, title: event.target.value } : current))
              }
              className="mt-3 h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-white outline-none focus:border-sky-500"
              placeholder="Scene title"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSceneEditDialog(null)}
                className="cursor-pointer rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setSceneEditDialog((current) => {
                    if (!current) return current;
                    const nextTitle = current.title.trim();
                    if (!nextTitle) return current;
                    applyDraftUpdate((next) => {
                      next.acts[current.actIndex].scenes[current.sceneIndex].title = nextTitle;
                    });
                    return null;
                  });
                }}
                className="cursor-pointer rounded-md border border-sky-700 bg-sky-900 px-3 py-2 text-sm font-semibold text-sky-100"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showSourceText ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-4">
          <div className="w-full max-w-4xl rounded-xl border border-zinc-700 bg-zinc-950 p-4 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">Source text</p>
              <button
                type="button"
                onClick={() => setShowSourceText(false)}
                className="cursor-pointer rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
              >
                Close
              </button>
            </div>
            <textarea
              value={draft.sourceText}
              onChange={(event) =>
                applyDraftUpdate((next) => {
                  next.sourceText = event.target.value;
                })
              }
              rows={18}
              className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-white outline-none focus:border-sky-500"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
