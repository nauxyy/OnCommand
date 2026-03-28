# OnCommand AI Cue Wrapper Guide

Use this guide when building an AI wrapper that generates cues for the OnCommand editor/live system.

## 1) Target format (required)

Generated cues must match the editor draft format used in `.onscript` files:

- File extension: `.onscript`
- Header line: `ONCOMMAND_SCRIPT_V1`
- Payload: JSON `ShowEditorDraft`

Cue objects are stored at:

- `acts[].scenes[].lines[].cues[]`

Each cue must follow:

```ts
{
  id: string;                 // unique cue id
  department: string;         // from allowed set list
  anchorGapIndex: number;     // integer, between-word index
  text: string;               // instruction
  standbyOffsetMs: number;    // integer
  goOffsetMs: number;         // integer
  diagramUrl?: string;        // optional URL
}
```

## 2) Department set list (use only these)

Use only:

- `director`
- `lighting`
- `sound`
- `stage_left`
- `stage_right`
- `stage_manager`

Do not invent new departments.

## 3) Anchor rules (between-word precision)

`anchorGapIndex` is a gap position in a line:

- `0` = before first word
- `N` = after the Nth word
- max = word count of that line

Always clamp to `[0, words.length]`.

## 4) Wrapper behavior recommendation

Given:

- script lines (`act`, `scene`, `lineNumber`, `character`, `text`)
- cue policy / set list (what departments are active and cue style rules)

Generate:

1. candidate cues per line
2. department assignment from the set list
3. `anchorGapIndex` from exact word position
4. `text` as concise imperative instruction
5. timings (`standbyOffsetMs`, `goOffsetMs`) as integers

Recommended timing defaults if unspecified:

- `standbyOffsetMs = 5000`
- `goOffsetMs = 0`

## 5) Scene-change cues

For scene-level/scene-change operations, attach cues to the first line of the scene:

- `target line = scenes[i].lines[0]`
- usually `anchorGapIndex = 0`

## 6) Validation checklist before save/export

- Cue has all required fields.
- `department` is in allowed set.
- `anchorGapIndex` is integer and in range.
- `text` is non-empty and operational.
- Timing fields are integers.
- `diagramUrl` is either omitted or a valid URL.

## 7) Minimal example

```json
{
  "id": "cue-01",
  "department": "lighting",
  "anchorGapIndex": 3,
  "text": "Snap to cold wash center stage",
  "standbyOffsetMs": 4000,
  "goOffsetMs": 0
}
```

If exporting full drafts, prepend:

```text
ONCOMMAND_SCRIPT_V1
```

then the JSON body.
