import type { DepartmentRole, EditorAct, EditorCue, EditorLine, EditorScene, LineType, ShowEditorData, ShowEditorDraft } from "@/lib/types";

const DEFAULT_SCENE_TITLE = "Scene 1";

export const DEPARTMENT_ROLES: DepartmentRole[] = ["director", "lighting", "sound", "stage_left", "stage_right", "stage_manager"];

export function createEditorId(prefix: string) {
  if (typeof globalThis !== "undefined" && "crypto" in globalThis && globalThis.crypto && "randomUUID" in globalThis.crypto) {
    try {
      return `${prefix}-${globalThis.crypto.randomUUID()}`;
    } catch {
      // fall through
    }
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptyCue(department: DepartmentRole, anchorGapIndex = 0): EditorCue {
  return {
    id: createEditorId("cue"),
    department,
    anchorGapIndex,
    text: "",
    standbyOffsetMs: 5000,
    goOffsetMs: 0,
  };
}

export function createEmptyLine(): EditorLine {
  return {
    id: createEditorId("line"),
    lineNumber: 1,
    character: "",
    text: "",
    lineType: "dialogue",
    sortIndex: 0,
    cues: [],
  };
}

export function createEmptyScene(actNumber: number, title = DEFAULT_SCENE_TITLE): EditorScene {
  return {
    id: createEditorId("scene"),
    actNumber,
    title,
    sortIndex: 0,
    lines: [],
  };
}

export function createDefaultEditorData(showId: string, title: string, sourceText = ""): ShowEditorData {
  return normalizeEditorDraft({
    showId,
    title,
    revision: "empty",
    sourceText,
    acts: [{ actNumber: 1, scenes: [createEmptyScene(1)] }],
  });
}

export function splitLineWords(text: string) {
  return text
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

export function normalizeEditorDraft(draft: ShowEditorDraft): ShowEditorDraft {
  const normalizedActs: EditorAct[] = draft.acts.length
    ? draft.acts.map((act, actIndex) => {
        let nextLineNumber = 1;
        const normalizedScenes = act.scenes.length
          ? act.scenes.map((scene, sceneIndex) => {
              const normalizedLines = scene.lines.map((line, lineIndex) => {
                const words = splitLineWords(line.text);
                const maxGapIndex = words.length;
                const normalizedCues = [...line.cues]
                  .map((cue) => ({
                    ...cue,
                    anchorGapIndex: Math.max(0, Math.min(cue.anchorGapIndex, maxGapIndex)),
                  }))
                  .sort((a, b) => {
                    if (a.anchorGapIndex !== b.anchorGapIndex) return a.anchorGapIndex - b.anchorGapIndex;
                    return String(a.department).localeCompare(String(b.department));
                  });

                const normalizedLineType: LineType = "dialogue";
                const normalizedCharacter = line.character.trim();

                const normalizedLine: EditorLine = {
                  ...line,
                  lineNumber: nextLineNumber,
                  sortIndex: lineIndex,
                  lineType: normalizedLineType,
                  character: normalizedCharacter,
                  text: line.text,
                  cues: normalizedCues,
                };
                nextLineNumber += 1;
                return normalizedLine;
              });

              return {
                ...scene,
                actNumber: actIndex + 1,
                title: scene.title.trim() || `Scene ${sceneIndex + 1}`,
                sortIndex: sceneIndex,
                lines: normalizedLines,
              };
            })
          : [createEmptyScene(actIndex + 1, DEFAULT_SCENE_TITLE)];

        return {
          actNumber: actIndex + 1,
          scenes: normalizedScenes,
        };
      })
    : [{ actNumber: 1, scenes: [createEmptyScene(1)] }];

  return {
    ...draft,
    title: draft.title.trim(),
    sourceText: draft.sourceText,
    acts: normalizedActs,
  };
}

export function flattenEditorLines(acts: EditorAct[]) {
  return acts.flatMap((act) => act.scenes.flatMap((scene) => scene.lines));
}
