import type { ScriptLine } from "@/lib/types";

export type DecoderToken = {
  text: string;
  conf: number;
};

export type AsrFrame = {
  tMs: number;
  isFinal: boolean;
  tokens: DecoderToken[];
};

export type DecoderCandidate = {
  lineId: number;
  wordIdx: number;
  confidence: number;
};

export type DecoderResult = {
  lineId: number;
  wordIdx: number;
  confidence: number;
  shouldAdvance: boolean;
  nextLineId: number | null;
  candidates: DecoderCandidate[];
};

type ScriptToken = {
  raw: string;
  norm: string;
  phon: string;
};

type ScriptLineModel = {
  lineId: number;
  actNumber: number;
  tokens: ScriptToken[];
};

type BeamState = {
  lineIdx: number;
  wordIdx: number;
  score: number;
  confidence: number;
  stableFrames: number;
};

export type DecoderOptions = {
  beamWidth?: number;
  lineJumpLimit?: number;
  lookaheadWindow?: number;
  maxSkipWords?: number;
  allowSkipOnPhonetic?: boolean;
  nextLineMinProgress?: number;
  baseContextBias?: number;
  skipPenaltyWeight?: number;
  advanceConfidence?: number;
  advanceFinalConfidence?: number;
  advanceStableFrames?: number;
  maxInterimAdvancePerFrame?: number;
  maxFinalAdvancePerFrame?: number;
  alpha?: number;
  beta?: number;
  gamma?: number;
  delta?: number;
  lambda?: number;
  mu?: number;
};

function normalizeWord(word: string) {
  return word.toLowerCase().replace(/[^a-z0-9']/g, "").trim();
}

function phoneticCode(word: string) {
  const norm = normalizeWord(word);
  if (!norm) return "";
  return norm
    .replace(/^kn/, "n")
    .replace(/^wr/, "r")
    .replace(/^wh/, "w")
    .replace(/ght/g, "t")
    .replace(/tion/g, "shn")
    .replace(/sion/g, "zhn")
    .replace(/ture/g, "chr")
    .replace(/ph/g, "f")
    .replace(/gh/g, "g")
    .replace(/qu/g, "kw")
    .replace(/q/g, "k")
    .replace(/x/g, "ks")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c/g, "k")
    .replace(/z/g, "s")
    .replace(/v/g, "f")
    .replace(/dg/g, "j")
    .replace(/y/g, "i")
    .replace(/[aeiou]/g, "")
    .replace(/(.)\1+/g, "$1")
    .slice(0, 6);
}

function clamp01(x: number) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function avgConfidence(tokens: DecoderToken[]) {
  if (!tokens.length) return 0;
  return clamp01(tokens.reduce((sum, token) => sum + token.conf, 0) / tokens.length);
}

function scoreLocalMatch(
  lineTokens: ScriptToken[],
  startWordIdx: number,
  spokenTokens: ScriptToken[],
  lookaheadWindow: number,
  maxSkipWords: number,
  allowSkipOnPhonetic: boolean,
) {
  if (!lineTokens.length || !spokenTokens.length) {
    return {
      matchedWords: 0,
      exactScore: 0,
      phonScore: 0,
      skipPenalty: 0,
      advancedWordIdx: startWordIdx,
    };
  }

  let linePointer = Math.max(startWordIdx + 1, 0);
  let matched = 0;
  let exactHits = 0;
  let phonHits = 0;
  let skippedWords = 0;

  for (const spoken of spokenTokens) {
    if (linePointer >= lineTokens.length) break;
    let bestIdx = -1;
    let bestKind: "exact" | "phon" | "edit" | null = null;

    for (let idx = linePointer; idx < Math.min(linePointer + lookaheadWindow, lineTokens.length); idx += 1) {
      const expected = lineTokens[idx];
      const editDistance = spoken.norm && expected.norm ? Math.abs(spoken.norm.length - expected.norm.length) : 99;
      const editNear =
        expected.norm.length >= 6 &&
        spoken.norm[0] === expected.norm[0] &&
        editDistance <= 1;
      const phonNear = spoken.phon && expected.phon && (spoken.phon === expected.phon || Math.abs(spoken.phon.length - expected.phon.length) <= 1);

      if (spoken.norm === expected.norm) {
        bestIdx = idx;
        bestKind = "exact";
        break;
      }

      if (!bestKind && phonNear) {
        bestIdx = idx;
        bestKind = "phon";
        continue;
      }

      if (!bestKind && editNear) {
        bestIdx = idx;
        bestKind = "edit";
      }
    }

    if (bestIdx === -1 || !bestKind) continue;

    const skipped = Math.max(bestIdx - linePointer, 0);
    if (skipped > maxSkipWords) continue;
    if (skipped > 0 && matched === 0) continue;
    if (skipped > 0 && bestKind === "edit") continue;
    if (skipped > 0 && bestKind === "phon" && !allowSkipOnPhonetic) continue;
    skippedWords += skipped;
    linePointer = bestIdx + 1;
    matched += 1;

    if (bestKind === "exact") {
      exactHits += 1;
      phonHits += 1;
      continue;
    }

    if (bestKind === "phon") {
      phonHits += 1;
      continue;
    }

    phonHits += 0.35;
  }

  const denom = Math.max(spokenTokens.length, 1);
  return {
    matchedWords: matched,
    exactScore: exactHits / denom,
    phonScore: phonHits / denom,
    skipPenalty: skippedWords / Math.max(lineTokens.length, 1),
    advancedWordIdx: Math.max(startWordIdx, linePointer - 1),
  };
}

function toScriptTokens(tokens: DecoderToken[]) {
  return tokens
    .map((token) => ({
      raw: token.text,
      norm: normalizeWord(token.text),
      phon: phoneticCode(token.text),
    }))
    .filter((token) => token.norm.length > 0);
}

export class ScriptAwareDecoder {
  private readonly lines: ScriptLineModel[];

  private readonly lineIdToIdx: Map<number, number>;

  private readonly beamWidth: number;

  private readonly lineJumpLimit: number;

  private readonly alpha: number;

  private readonly beta: number;

  private readonly gamma: number;

  private readonly delta: number;

  private readonly lambda: number;

  private readonly mu: number;

  private readonly lookaheadWindow: number;

  private readonly maxSkipWords: number;

  private readonly allowSkipOnPhonetic: boolean;

  private readonly nextLineMinProgress: number;

  private readonly baseContextBias: number;

  private readonly skipPenaltyWeight: number;

  private readonly advanceConfidence: number;

  private readonly advanceFinalConfidence: number;

  private readonly advanceStableFrames: number;
  private readonly maxInterimAdvancePerFrame: number;
  private readonly maxFinalAdvancePerFrame: number;

  private beam: BeamState[];

  constructor(scriptLines: ScriptLine[], options: DecoderOptions = {}) {
    this.lines = scriptLines.map((line) => ({
      lineId: line.id,
      actNumber: line.actNumber,
      tokens: line.text
        .split(/\s+/)
        .map((raw) => ({ raw, norm: normalizeWord(raw), phon: phoneticCode(raw) }))
        .filter((token) => token.norm.length > 0),
    }));

    this.lineIdToIdx = new Map(this.lines.map((line, idx) => [line.lineId, idx]));
    this.beamWidth = options.beamWidth ?? 12;
    this.lineJumpLimit = options.lineJumpLimit ?? 2;
    this.alpha = options.alpha ?? 0.45;
    this.beta = options.beta ?? 0.2;
    this.gamma = options.gamma ?? 0.15;
    this.delta = options.delta ?? 0.2;
    this.lambda = options.lambda ?? 0.25;
    this.mu = options.mu ?? 0.1;
    this.lookaheadWindow = options.lookaheadWindow ?? 3;
    this.maxSkipWords = options.maxSkipWords ?? 1;
    this.allowSkipOnPhonetic = options.allowSkipOnPhonetic ?? false;
    this.nextLineMinProgress = options.nextLineMinProgress ?? 0.85;
    this.baseContextBias = options.baseContextBias ?? 0.5;
    this.skipPenaltyWeight = options.skipPenaltyWeight ?? 0.75;
    this.advanceConfidence = options.advanceConfidence ?? 0.5;
    this.advanceFinalConfidence = options.advanceFinalConfidence ?? 0.42;
    this.advanceStableFrames = options.advanceStableFrames ?? 1;
    this.maxInterimAdvancePerFrame = options.maxInterimAdvancePerFrame ?? 1;
    this.maxFinalAdvancePerFrame = options.maxFinalAdvancePerFrame ?? 2;

    this.beam = this.lines.length
      ? [
          {
            lineIdx: 0,
            wordIdx: -1,
            score: 0,
            confidence: 0,
            stableFrames: 0,
          },
        ]
      : [];
  }

  resetToLine(lineId: number) {
    const idx = this.lineIdToIdx.get(lineId);
    if (idx === undefined) return;
    this.beam = [
      {
        lineIdx: idx,
        wordIdx: -1,
        score: 0,
        confidence: 0,
        stableFrames: 0,
      },
    ];
  }

  setPosition(lineId: number, wordIdx: number) {
    const idx = this.lineIdToIdx.get(lineId);
    if (idx === undefined) return;
    this.beam = [
      {
        lineIdx: idx,
        wordIdx,
        score: 0,
        confidence: 0,
        stableFrames: 0,
      },
    ];
  }

  ingest(frame: AsrFrame, preferredLineId?: number): DecoderResult | null {
    if (!this.lines.length) return null;

    const spoken = toScriptTokens(frame.tokens);
    if (!spoken.length) {
      const best = this.beam[0];
      const line = this.lines[best.lineIdx];
      return {
        lineId: line.lineId,
        wordIdx: best.wordIdx,
        confidence: best.confidence,
        shouldAdvance: false,
        nextLineId: null,
        candidates: [
          {
            lineId: line.lineId,
            wordIdx: best.wordIdx,
            confidence: best.confidence,
          },
        ],
      };
    }

    const preferredIdx = preferredLineId !== undefined ? this.lineIdToIdx.get(preferredLineId) : undefined;
    const confBase = avgConfidence(frame.tokens);

    const expanded: BeamState[] = [];

    for (const state of this.beam) {
      for (let jump = 0; jump <= this.lineJumpLimit; jump += 1) {
        const nextLineIdx = state.lineIdx + jump;
        if (nextLineIdx >= this.lines.length) break;
        if (jump > 1) continue;

        const line = this.lines[nextLineIdx];
        const sourceLine = this.lines[state.lineIdx];
        const sourceProgress = clamp01((state.wordIdx + 1) / Math.max(sourceLine.tokens.length, 1));
        if (jump === 1 && sourceProgress < this.nextLineMinProgress) continue;

        const local = scoreLocalMatch(
          line.tokens,
          jump === 0 ? state.wordIdx : -1,
          spoken,
          this.lookaheadWindow,
          this.maxSkipWords,
          this.allowSkipOnPhonetic,
        );

        const maxPerFrame = frame.isFinal ? this.maxFinalAdvancePerFrame : this.maxInterimAdvancePerFrame;
        const tokenBoundedAdvance =
          local.matchedWords <= 0 ? state.wordIdx : state.wordIdx + Math.max(1, Math.min(local.matchedWords, maxPerFrame));
        const boundedWordIdx = Math.min(local.advancedWordIdx, tokenBoundedAdvance);

        const jumpPenaltyBase = jump / Math.max(this.lineJumpLimit, 1);
        const jumpPenalty = jump === 1 ? jumpPenaltyBase * (sourceProgress >= 0.85 ? 0.15 : 0.35) : jumpPenaltyBase;
        const repeatPenalty = local.matchedWords === 0 ? 1 : 0;
        const contextBias =
          preferredIdx !== undefined
            ? clamp01(1 - Math.abs(nextLineIdx - preferredIdx) / (this.lineJumpLimit + 2))
            : this.baseContextBias;

        const score =
          state.score * 0.35 +
          this.alpha * local.exactScore +
          this.beta * local.phonScore +
          this.gamma * confBase +
          this.delta * contextBias -
          this.lambda * jumpPenalty -
          this.mu * repeatPenalty -
          this.skipPenaltyWeight * local.skipPenalty;

        const confidence = clamp01(
          0.46 * local.exactScore +
            0.23 * local.phonScore +
            0.15 * confBase +
            0.1 * contextBias +
            0.06 * clamp01((boundedWordIdx + 1) / Math.max(line.tokens.length, 1)),
        );

        const stableFrames =
          state.lineIdx === nextLineIdx && state.wordIdx <= boundedWordIdx ? state.stableFrames + 1 : 1;

        expanded.push({
          lineIdx: nextLineIdx,
          wordIdx: boundedWordIdx,
          score,
          confidence,
          stableFrames,
        });
      }
    }

    expanded.sort((a, b) => b.score - a.score);
    this.beam = expanded.slice(0, this.beamWidth);

    const best = this.beam[0];
    const bestLine = this.lines[best.lineIdx];
    const completion = clamp01((best.wordIdx + 1) / Math.max(bestLine.tokens.length, 1));
    const lineComplete = completion >= 0.95 || best.wordIdx >= bestLine.tokens.length - 1;
    const shouldAdvance =
      lineComplete &&
      ((best.confidence >= this.advanceConfidence && best.stableFrames >= this.advanceStableFrames) ||
        (frame.isFinal && best.confidence >= this.advanceFinalConfidence));
    const nextLineId = shouldAdvance && best.lineIdx + 1 < this.lines.length ? this.lines[best.lineIdx + 1].lineId : null;

    const candidates = this.beam.slice(0, 3).map((state) => ({
      lineId: this.lines[state.lineIdx].lineId,
      wordIdx: state.wordIdx,
      confidence: clamp01(state.confidence),
    }));

    return {
      lineId: bestLine.lineId,
      wordIdx: best.wordIdx,
      confidence: clamp01(best.confidence),
      shouldAdvance,
      nextLineId,
      candidates,
    };
  }
}

export function transcriptToFrame(transcript: string, isFinal: boolean): AsrFrame {
  const tokens = transcript
    .split(/\s+/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ text, conf: isFinal ? 0.85 : 0.65 }));

  return {
    tMs: Date.now(),
    isFinal,
    tokens,
  };
}
