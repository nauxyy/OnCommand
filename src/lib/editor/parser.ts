import { createDefaultEditorData, createEditorId, normalizeEditorDraft } from "@/lib/editor/document";
import type { EditorAct, EditorLine, EditorScene, LineType, ShowEditorData } from "@/lib/types";

function parseActNumber(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  const digit = Number.parseInt(trimmed, 10);
  if (Number.isFinite(digit)) return digit;

  const romanMap: Record<string, number> = {
    i: 1,
    ii: 2,
    iii: 3,
    iv: 4,
    v: 5,
    vi: 6,
    vii: 7,
    viii: 8,
    ix: 9,
    x: 10,
  };

  return romanMap[trimmed] ?? null;
}

function createParsedLine(character: string, text: string, lineType: LineType): EditorLine {
  return {
    id: createEditorId("line"),
    lineNumber: 1,
    character,
    text,
    lineType,
    sortIndex: 0,
    cues: [],
  };
}

function createParsedScene(actNumber: number, title: string): EditorScene {
  return {
    id: createEditorId("scene"),
    actNumber,
    title,
    sortIndex: 0,
    lines: [],
  };
}

function ensureScene(acts: EditorAct[], actNumber: number) {
  let act = acts.find((item) => item.actNumber === actNumber);
  if (!act) {
    act = { actNumber, scenes: [createParsedScene(actNumber, `Scene 1`)] };
    acts.push(act);
  }

  if (!act.scenes.length) {
    act.scenes.push(createParsedScene(actNumber, "Scene 1"));
  }

  return act.scenes[act.scenes.length - 1];
}

export function parseScriptToEditorData(showId: string, title: string, sourceText: string): ShowEditorData {
  const trimmedSource = sourceText.trim();
  if (!trimmedSource) {
    return createDefaultEditorData(showId, title, "");
  }

  const acts: EditorAct[] = [{ actNumber: 1, scenes: [createParsedScene(1, "Scene 1")] }];
  let currentActNumber = 1;
  let currentScene = acts[0].scenes[0];

  const rawLines = trimmedSource
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  rawLines.forEach((rawLine) => {
    const actMatch = rawLine.match(/^act\s+([a-z0-9ivx]+)(?:\s*[:.\-]\s*|\s+)?(.*)$/i);
    if (actMatch) {
      const parsedActNumber = parseActNumber(actMatch[1]) ?? acts.length + 1;
      currentActNumber = parsedActNumber;
      const existingAct = acts.find((item) => item.actNumber === parsedActNumber);
      if (!existingAct) {
        acts.push({ actNumber: parsedActNumber, scenes: [] });
      }
      currentScene = ensureScene(acts, currentActNumber);
      if (actMatch[2]?.trim()) {
        currentScene.title = actMatch[2].trim();
      }
      return;
    }

    const sceneMatch = rawLine.match(/^scene(?:\s+([a-z0-9ivx]+))?(?:\s*[:.\-]\s*|\s+)?(.*)$/i);
    if (sceneMatch) {
      const nextSceneTitle = sceneMatch[2]?.trim() || sceneMatch[1]?.trim() || `Scene ${ensureScene(acts, currentActNumber).sortIndex + 2}`;
      const act = acts.find((item) => item.actNumber === currentActNumber) ?? { actNumber: currentActNumber, scenes: [] };
      if (!acts.includes(act)) acts.push(act);
      currentScene = createParsedScene(currentActNumber, nextSceneTitle);
      act.scenes.push(currentScene);
      return;
    }

    const dialogueMatch = rawLine.match(/^([^:]{1,40}):\s+(.+)$/);
    if (dialogueMatch) {
      currentScene.lines.push(createParsedLine(dialogueMatch[1].trim(), dialogueMatch[2].trim(), "dialogue"));
      return;
    }

    currentScene.lines.push(createParsedLine("", rawLine, "dialogue"));
  });

  return normalizeEditorDraft({
    showId,
    title,
    revision: "empty",
    sourceText: trimmedSource,
    acts: acts
      .sort((a, b) => a.actNumber - b.actNumber)
      .map((act) => ({
        actNumber: act.actNumber,
        scenes: act.scenes.length ? act.scenes : [createParsedScene(act.actNumber, "Scene 1")],
      })),
  });
}
