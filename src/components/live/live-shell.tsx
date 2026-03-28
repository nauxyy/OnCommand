"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DEPARTMENT_COLORS } from "@/lib/constants";
import type { Cue, DepartmentRole, LiveConnectionState, ScriptLine } from "@/lib/types";
import { useLiveChannel } from "@/hooks/useLiveChannel";

const SCENE_ANCHOR_OFFSET = 1000;
const encodeSceneAnchor = (sceneNumber: number) => -(SCENE_ANCHOR_OFFSET + sceneNumber);
const decodeSceneAnchor = (wordIndex: number) => (wordIndex <= -SCENE_ANCHOR_OFFSET ? -wordIndex - SCENE_ANCHOR_OFFSET : null);
const SCENE_DIRECTION_KEYWORDS = [
  "set",
  "shift",
  "move",
  "roll",
  "rotate",
  "track",
  "fly",
  "wagon",
  "prop",
  "preset",
  "lock",
  "unlock",
  "clear",
  "transition",
  "tableau",
];

function isSceneDirectionCue(cue: Cue) {
  if (cue.department === "stage_crew" || cue.department === "stage_left" || cue.department === "stage_right") return true;
  const text = cue.text.toLowerCase();
  return SCENE_DIRECTION_KEYWORDS.some((kw) => text.includes(kw));
}

function ScriptPanel({
  lines,
  cues,
  currentLineId,
  currentWordIndex = 0,
  role,
  onLineSelect,
  onShowStartSelect,
  onShowEndSelect,
  onSceneSelect,
  instantScrollNonce = 0,
  followRequestNonce = 0,
  scrollTarget,
  onViewActChange,
}: {
  lines: ScriptLine[];
  cues: Cue[];
  currentLineId: number;
  currentWordIndex?: number;
  role: DepartmentRole;
  onLineSelect?: (line: ScriptLine) => void;
  onShowStartSelect?: (line: ScriptLine) => void;
  onShowEndSelect?: (line: ScriptLine) => void;
  onSceneSelect?: (line: ScriptLine, sceneNumber: number) => void;
  instantScrollNonce?: number;
  followRequestNonce?: number;
  scrollTarget?: { lineId: number; wordIndex?: number; nonce: number };
  onViewActChange?: (act: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const sceneRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const lastInstantNonceRef = useRef(instantScrollNonce);
  const lastFollowRequestNonceRef = useRef(followRequestNonce);
  const lastScrollTargetNonceRef = useRef(scrollTarget?.nonce ?? 0);
  const lastViewActRef = useRef<number | null>(null);
  const viewActRafRef = useRef<number | null>(null);
  const scrollAnimRef = useRef<number | null>(null);
  const isProgrammaticScrollRef = useRef(false);
  const wheelActiveUntilRef = useRef(0);
  const userDirectScrollRef = useRef(false);
  const isTechnician = role !== "director";

  useEffect(() => {
    const endDirectScroll = () => {
      userDirectScrollRef.current = false;
    };
    window.addEventListener("pointerup", endDirectScroll);
    window.addEventListener("touchend", endDirectScroll);
    window.addEventListener("touchcancel", endDirectScroll);
    return () => {
      window.removeEventListener("pointerup", endDirectScroll);
      window.removeEventListener("touchend", endDirectScroll);
      window.removeEventListener("touchcancel", endDirectScroll);
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const hasFreshScrollTarget = Boolean(scrollTarget && scrollTarget.nonce !== lastScrollTargetNonceRef.current);
    const effectiveLineId = hasFreshScrollTarget && scrollTarget ? scrollTarget.lineId : currentLineId;
    const effectiveWordIndex = hasFreshScrollTarget && scrollTarget ? (scrollTarget.wordIndex ?? 0) : currentWordIndex;
    const activeSceneNumber = decodeSceneAnchor(effectiveWordIndex);
    const currentEl =
      activeSceneNumber !== null
        ? sceneRefs.current[effectiveLineId] ?? lineRefs.current[effectiveLineId]
        : lineRefs.current[effectiveLineId];
    if (!container || !currentEl) return;

    const top = currentEl.offsetTop - container.clientHeight / 2 + currentEl.clientHeight / 2;
    const forceFollow = followRequestNonce !== lastFollowRequestNonceRef.current;
    const forceScrollTarget = hasFreshScrollTarget;
    const isActivelyInteracting = userDirectScrollRef.current || Date.now() < wheelActiveUntilRef.current;
    if (!forceFollow && !forceScrollTarget && isActivelyInteracting) return;

    const targetTop = Math.max(top, 0);
    const isFastJump = instantScrollNonce !== lastInstantNonceRef.current || forceScrollTarget;
    const durationMs = isFastJump ? 150 : 220;
    const startTop = container.scrollTop;
    const delta = targetTop - startTop;
    const startedAt = performance.now();
    if (scrollAnimRef.current) cancelAnimationFrame(scrollAnimRef.current);
    const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
    isProgrammaticScrollRef.current = true;
    const tick = (now: number) => {
      const t = Math.min((now - startedAt) / durationMs, 1);
      container.scrollTop = startTop + delta * easeOutCubic(t);
      if (t < 1) {
        scrollAnimRef.current = requestAnimationFrame(tick);
      } else {
        scrollAnimRef.current = null;
        isProgrammaticScrollRef.current = false;
      }
    };
    scrollAnimRef.current = requestAnimationFrame(tick);
    lastInstantNonceRef.current = instantScrollNonce;
    lastFollowRequestNonceRef.current = followRequestNonce;
    if (hasFreshScrollTarget && scrollTarget) {
      lastScrollTargetNonceRef.current = scrollTarget.nonce;
    }
    return () => {
      if (scrollAnimRef.current) cancelAnimationFrame(scrollAnimRef.current);
      scrollAnimRef.current = null;
      isProgrammaticScrollRef.current = false;
    };
  }, [currentLineId, currentWordIndex, instantScrollNonce, followRequestNonce, scrollTarget]);

  const nextRoleCue = useMemo(
    () =>
      cues
        .filter((cue) => cue.department === role && cue.lineId >= currentLineId)
        .sort((a, b) => a.lineId - b.lineId)[0],
    [cues, currentLineId, role],
  );
  const visibleLines = lines;
  const firstVisibleLine = visibleLines[0];
  const lastVisibleLine = visibleLines[visibleLines.length - 1];
  const sceneNumberByLineId = useMemo(() => {
    const mapping = new Map<number, number>();
    let sceneCounter = 0;
    for (const line of visibleLines) {
      if (!line.sceneSeparator) continue;
      sceneCounter += 1;
      mapping.set(line.id, sceneCounter);
    }
    return mapping;
  }, [visibleLines]);

  const updateViewedAct = useCallback(() => {
    if (!onViewActChange || !visibleLines.length) return;
    const container = containerRef.current;
    if (!container) return;

    const centerY = container.scrollTop + container.clientHeight / 2;
    let viewedAct = visibleLines[0].actNumber;
    for (const line of visibleLines) {
      const sceneTop = sceneRefs.current[line.id]?.offsetTop;
      const lineTop = lineRefs.current[line.id]?.offsetTop;
      const anchorTop = sceneTop ?? lineTop;
      if (typeof anchorTop !== "number") continue;
      if (anchorTop <= centerY) viewedAct = line.actNumber;
      else break;
    }

    if (lastViewActRef.current === viewedAct) return;
    lastViewActRef.current = viewedAct;
    onViewActChange(viewedAct);
  }, [onViewActChange, visibleLines]);

  const scheduleViewedActUpdate = useCallback(() => {
    if (viewActRafRef.current !== null) return;
    viewActRafRef.current = requestAnimationFrame(() => {
      viewActRafRef.current = null;
      updateViewedAct();
    });
  }, [updateViewedAct]);

  useEffect(() => {
    scheduleViewedActUpdate();
    return () => {
      if (viewActRafRef.current !== null) {
        cancelAnimationFrame(viewActRafRef.current);
        viewActRafRef.current = null;
      }
    };
  }, [scheduleViewedActUpdate]);

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-zinc-800 bg-zinc-900 p-3">
      <div
        ref={containerRef}
        onWheel={() => {
          wheelActiveUntilRef.current = Date.now() + 140;
        }}
        onTouchStart={() => {
          userDirectScrollRef.current = true;
        }}
        onTouchEnd={() => {
          userDirectScrollRef.current = false;
        }}
        onTouchCancel={() => {
          userDirectScrollRef.current = false;
        }}
        onPointerDown={() => {
          userDirectScrollRef.current = true;
        }}
        onPointerUp={() => {
          userDirectScrollRef.current = false;
        }}
        onPointerCancel={() => {
          userDirectScrollRef.current = false;
        }}
        onScroll={scheduleViewedActUpdate}
        className="script-scroll -mr-3 min-h-0 flex-1 overflow-y-scroll pr-3"
      >
        <div className="space-y-2">
        {visibleLines.map((line, index) => {
          const prevLine = index > 0 ? visibleLines[index - 1] : null;
          const isActStart = !prevLine || prevLine.actNumber !== line.actNumber;
          const isPast = line.id < currentLineId;
          const isStartAnchorActive = Boolean(firstVisibleLine && currentWordIndex === -1 && currentLineId === firstVisibleLine.id);
          const isEndAnchorActive = Boolean(lastVisibleLine && currentWordIndex === -2 && currentLineId === lastVisibleLine.id);
          const sceneNumber = sceneNumberByLineId.get(line.id) ?? null;
          const activeSceneNumber = decodeSceneAnchor(currentWordIndex);
          const isSceneAnchorActive = Boolean(sceneNumber && activeSceneNumber === sceneNumber && currentLineId === line.id);
          const isCurrent =
            line.id === currentLineId &&
            !((firstVisibleLine && line.id === firstVisibleLine.id && isStartAnchorActive) ||
              (lastVisibleLine && line.id === lastVisibleLine.id && isEndAnchorActive) ||
              isSceneAnchorActive);
          const lineCues = cues.filter((c) => c.lineId === line.id && !(line.sceneSeparator && isSceneDirectionCue(c)));
          const roleCueForLine = lineCues.find((cue) => cue.department === role);
          const isUpcomingCueLine = isTechnician && nextRoleCue && line.id === nextRoleCue.lineId && !isCurrent;
          const isCurrentCueLine = isTechnician && isCurrent && Boolean(roleCueForLine);

          return (
            <div key={line.id}>
              {firstVisibleLine && onLineSelect && line.id === firstVisibleLine.id ? (
                <div
                  onClick={() => (onShowStartSelect ? onShowStartSelect(firstVisibleLine) : onLineSelect(firstVisibleLine))}
                  className={[
                    "mb-2 w-full cursor-pointer rounded-md border px-3 py-3 text-sm font-medium transition-all duration-300",
                    currentWordIndex === -1 && currentLineId === firstVisibleLine.id
                      ? "border-white bg-sky-900/35 text-white"
                      : "border-sky-800 bg-sky-950/25 text-sky-300 hover:bg-sky-900/40",
                  ].join(" ")}
                >
                  Show starts
                </div>
              ) : null}
              {isActStart ? (
                <div className="mb-2 mt-4 rounded-md border border-zinc-700 bg-zinc-950/70 px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-300">{`Act ${line.actNumber}`}</p>
                </div>
              ) : null}
              {line.sceneSeparator && sceneNumber ? (
                <div
                  ref={(node) => {
                    sceneRefs.current[line.id] = node;
                  }}
                  onClick={() => onSceneSelect?.(line, sceneNumber)}
                  className={[
                    "mb-2 ml-4 w-[calc(100%-1rem)] rounded-md border px-3 py-3 text-sm font-medium transition-all duration-300",
                    onSceneSelect ? "cursor-pointer" : "",
                    isSceneAnchorActive
                      ? "border-white bg-indigo-900/35 text-white"
                      : "border-indigo-800 bg-indigo-950/25 text-indigo-300 hover:bg-indigo-900/40",
                  ].join(" ")}
                >
                  <p>{`Scene ${sceneNumber}. ${line.sceneSeparator}`}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(() => {
                      const sceneChangeCues = cues.filter((cue) => cue.lineId === line.id && isSceneDirectionCue(cue));
                      if (!sceneChangeCues.length) return <span className="text-[11px] text-zinc-400">No scene-change cues</span>;
                      return sceneChangeCues.map((cue) => (
                        <span
                          key={`scene-${line.id}-${cue.id}`}
                          className="rounded-full px-2 py-1 text-[11px] font-medium text-black"
                          style={{ backgroundColor: `${DEPARTMENT_COLORS[cue.department]}66` }}
                        >
                          {cue.department}: {cue.text}
                        </span>
                      ));
                    })()}
                  </div>
                </div>
              ) : null}
              <div
                ref={(node) => {
                  lineRefs.current[line.id] = node;
                }}
                onClick={() => onLineSelect?.(line)}
                className={[
                  "ml-8 w-[calc(100%-2rem)] rounded-md border px-3 py-3 transition-all duration-300",
                  onLineSelect ? "cursor-pointer hover:bg-zinc-800/90" : "",
                  isCurrent ? "border-white bg-zinc-800" : "border-transparent",
                  isCurrentCueLine ? "bg-emerald-900/35" : "",
                  isUpcomingCueLine ? "bg-amber-900/35" : "",
                  isPast ? "text-zinc-600" : isCurrent ? "text-white" : "text-zinc-300",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                      Act {line.actNumber} · L{line.lineNumber} · {line.character}
                    </p>
                    <p className={isCurrent ? "mt-1 text-2xl font-semibold leading-snug" : "mt-1 text-lg leading-snug"}>{line.text}</p>
                  </div>

                  {isTechnician && (isCurrentCueLine || isUpcomingCueLine) ? (
                    <div
                      className={[
                        "min-w-44 rounded-md border px-2.5 py-1.5 text-xs font-medium",
                        isCurrentCueLine ? "border-emerald-400 bg-emerald-200 text-emerald-950" : "border-amber-400 bg-amber-200 text-amber-950",
                      ].join(" ")}
                    >
                      {roleCueForLine?.text ?? nextRoleCue?.text}
                    </div>
                  ) : null}
                </div>

                {lineCues.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {lineCues.map((cue) => (
                      <span
                        key={cue.id}
                        className="rounded-full px-2 py-1 text-[11px] font-medium text-black"
                        style={{ backgroundColor: `${DEPARTMENT_COLORS[cue.department]}66` }}
                      >
                        {cue.department}: {cue.text}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
        {lastVisibleLine && onLineSelect ? (
          <div
            onClick={() => (onShowEndSelect ? onShowEndSelect(lastVisibleLine) : onLineSelect(lastVisibleLine))}
            className={[
              "mt-3 w-full cursor-pointer rounded-md border px-3 py-3 text-sm font-medium transition-all duration-300",
              currentWordIndex === -2 && currentLineId === lastVisibleLine.id
                ? "border-white bg-rose-900/35 text-white"
                : "border-rose-800 bg-rose-950/25 text-rose-300 hover:bg-rose-900/40",
            ].join(" ")}
          >
            Show ends
          </div>
        ) : null}
        </div>
      </div>
    </div>
  );
}

function roleChipColor(role: string) {
  return DEPARTMENT_COLORS[role as DepartmentRole] ?? "#6b7280";
}

function connectionColor(connectionState: LiveConnectionState) {
  if (connectionState === "connected") return "bg-emerald-400";
  if (connectionState === "connecting") return "bg-amber-400";
  return "bg-rose-500";
}

function formatDepartmentLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

type UnifiedHistoryItem = {
  id: string;
  at: string;
  kind: "message" | "alert";
  text: string;
  sourceRole: string;
  targetRoles: string[];
  clientNonce?: string;
};

function makeClientNonce(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function extractPayloadText(evt: { type: string; payload: unknown }) {
  if (typeof evt.payload === "object" && evt.payload !== null && "text" in evt.payload) {
    const maybeText = (evt.payload as { text?: unknown }).text;
    if (typeof maybeText === "string") return maybeText;
  }
  if (evt.type === "cue.go") return "Go cue";
  if (evt.type === "cue.standby") return "Standby cue";
  return "Message";
}

function extractPayloadClientNonce(payload: unknown) {
  if (typeof payload !== "object" || payload === null || !("clientNonce" in payload)) return undefined;
  const nonce = (payload as { clientNonce?: unknown }).clientNonce;
  return typeof nonce === "string" ? nonce : undefined;
}

function ShowStatusPanel({
  showName,
  nowTs,
  showElapsedMs,
  sceneElapsedMs,
  currentActLabel,
  onJumpToCurrent,
}: {
  showName: string;
  nowTs: number;
  showElapsedMs: number;
  sceneElapsedMs: number;
  currentActLabel: string;
  onJumpToCurrent?: () => void;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 shadow-lg">
      <div className="grid h-full min-h-0 grid-cols-2 grid-rows-[auto_auto_1fr] gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">Show</p>
          <p className="mt-1 truncate text-[22px] font-semibold leading-tight text-white">{showName}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">Show timer</p>
          <p className="mt-1 text-[22px] font-semibold leading-tight text-white">{formatMs(showElapsedMs)}</p>
        </div>

        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">Now</p>
          <p suppressHydrationWarning className="mt-1 text-[22px] font-semibold leading-tight text-white">
            {nowTs ? new Date(nowTs).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—"}
          </p>
          <p suppressHydrationWarning className="text-sm text-zinc-400">
            {nowTs ? new Date(nowTs).toLocaleTimeString() : "—"}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">Scene timer</p>
          <p className="mt-1 text-[22px] font-semibold leading-tight text-white">{formatMs(sceneElapsedMs)}</p>
        </div>

        <button
          type="button"
          onClick={() => onJumpToCurrent?.()}
          className="col-span-2 grid min-h-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded px-1 py-1 text-left hover:bg-zinc-800/70"
        >
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">Current act</p>
          <p className="min-w-0 truncate whitespace-nowrap text-left text-sm text-zinc-300">{currentActLabel}</p>
        </button>
      </div>
    </div>
  );
}

function CommunicationsPanel({
  role,
  history,
  departments,
  quickMessages,
  onSend,
}: {
  role: string;
  history: UnifiedHistoryItem[];
  departments: string[];
  quickMessages: string[];
  onSend: (content: string, isPreset: boolean, target: string) => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState<string>("all");
  const [composerOpen, setComposerOpen] = useState(false);
  const targetableDepartments = departments;
  const historyRef = useRef<HTMLDivElement | null>(null);
  const composerRootRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const historyInitRef = useRef(false);
  const seenHistoryIdsRef = useRef<Set<string>>(new Set());
  const [enteringIds, setEnteringIds] = useState<string[]>([]);

  useEffect(() => {
    const el = historyRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldStickToBottomRef.current = distanceToBottom <= 12;
  }, []);

  useEffect(() => {
    const el = historyRef.current;
    if (!el) return;
    if (!shouldStickToBottomRef.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [history.length]);

  useEffect(() => {
    if (!historyInitRef.current) {
      history.forEach((item) => seenHistoryIdsRef.current.add(item.id));
      historyInitRef.current = true;
      return;
    }

    const addedIds = history.filter((item) => !seenHistoryIdsRef.current.has(item.id)).map((item) => item.id);
    if (!addedIds.length) return;

    addedIds.forEach((id) => seenHistoryIdsRef.current.add(id));
    setEnteringIds((prev) => Array.from(new Set([...prev, ...addedIds])));

    const timer = window.setTimeout(() => {
      setEnteringIds((prev) => prev.filter((id) => !addedIds.includes(id)));
    }, 260);

    return () => window.clearTimeout(timer);
  }, [history]);

  useEffect(() => {
    if (!composerOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (composerRootRef.current && target && composerRootRef.current.contains(target)) return;
      setComposerOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [composerOpen]);

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full max-w-full flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-b border-zinc-700/60 p-2">
        <p className="text-base font-semibold text-zinc-100">Communications</p>
        <div
          ref={historyRef}
          onScroll={() => {
            const el = historyRef.current;
            if (!el) return;
            const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            shouldStickToBottomRef.current = distanceToBottom <= 12;
          }}
          className="mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1"
        >
          {history.length ? (
            history.map((item) => {
              const targetedToRole = item.targetRoles.includes("all") || item.targetRoles.includes(role) || item.sourceRole === role;
              const deliveredToViewer = item.targetRoles.includes("all") || item.targetRoles.includes(role);
              if (role !== "director" && !targetedToRole) return null;
              const isGreyed = role === "director" && !targetedToRole;
              return (
                <div
                  key={item.id}
                  onClick={() => setTarget(item.sourceRole)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setTarget(item.sourceRole);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  title={`Send to ${formatDepartmentLabel(item.sourceRole)}`}
                  className={[
                    "cursor-pointer rounded-lg border px-2 py-1.5 text-xs",
                    enteringIds.includes(item.id) ? "comms-pop-in" : "",
                    isGreyed ? "border-zinc-700 bg-zinc-900 text-zinc-500" : "border-zinc-700 bg-zinc-900 text-zinc-100",
                  ].join(" ")}
                >
                  <div className="mb-0.5 flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-zinc-300">
                      {formatDepartmentLabel(item.sourceRole)}
                    </span>
                    <span className="text-[11px] text-zinc-500">→</span>
                    <div className="flex min-w-0 flex-wrap gap-1">
                      {item.targetRoles.map((targetRole) => {
                        const isViewerTarget = targetRole === "all" || targetRole === role;
                        return (
                          <span
                            key={`${item.id}-${targetRole}`}
                            className={[
                              "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                              deliveredToViewer && isViewerTarget && !isGreyed
                                ? "bg-sky-300 text-black"
                                : "bg-zinc-800 text-zinc-300",
                            ].join(" ")}
                          >
                            {formatDepartmentLabel(targetRole)}
                          </span>
                        );
                      })}
                    </div>
                    <span className="ml-auto text-[11px] text-zinc-400">{new Date(item.at).toLocaleTimeString()}</span>
                  </div>
                  <p className="leading-snug">{item.text}</p>
                </div>
              );
            })
          ) : (
            <p className="text-xs text-zinc-500">No communications yet.</p>
          )}
        </div>
      </div>

      <div className="comms-controls grid shrink-0 min-w-0 grid-rows-[auto_auto] gap-2 p-2 pb-1 pt-3">
        <div ref={composerRootRef} className="relative min-w-0">
          {composerOpen ? (
            <div className="pointer-events-auto absolute bottom-full left-0 right-0 z-50 mb-2">
              <div className="flex w-full max-w-full items-center gap-1 rounded-2xl border border-zinc-700 bg-zinc-900 p-1 shadow-xl">
                <input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="h-10 min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-0"
                  placeholder={`Type message to ${target}`}
                />
                <button
                  onClick={() => {
                    const content = message.trim();
                    if (!content) return;
                    setComposerOpen(false);
                    setMessage("");
                    void onSend(content, false, target);
                  }}
                  className="h-10 w-9 shrink-0 rounded-xl border border-zinc-600 bg-zinc-700 text-base font-bold text-zinc-100"
                >
                  ↗
                </button>
              </div>
            </div>
          ) : null}

          <div className="min-w-0 max-w-full overflow-x-auto overflow-y-hidden pb-1 pt-1 [scrollbar-gutter:stable]" style={{ touchAction: "pan-x" }}>
            <div className="comms-quick-grid grid w-max min-w-full content-start grid-flow-col auto-cols-max grid-rows-2 gap-x-1.5 gap-y-1.5 pr-1">
              <button
                onClick={() => setComposerOpen((prev) => !prev)}
                aria-label={`Custom message from ${role}`}
                title={`Custom message from ${role}`}
                className="comms-quick-btn h-9 whitespace-nowrap rounded-lg border border-zinc-600 bg-zinc-700 px-3 py-1.5 text-[12px] font-semibold text-white"
              >
                Custom msg
              </button>
              {quickMessages.map((preset) => (
                <button
                  key={preset}
                  onClick={() => void onSend(preset, true, target)}
                  className="comms-quick-btn h-9 whitespace-nowrap rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-[12px] font-semibold text-zinc-100"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex min-w-0 max-w-full flex-col p-0">
          <p className="mb-0.5 text-sm font-semibold text-zinc-200">Send to:</p>
          <div className="overflow-x-hidden overflow-y-auto">
            <div className="comms-send-grid grid w-full grid-cols-2 gap-1">
            <button
              onClick={() => setTarget("all")}
              className={[
                "col-span-2 h-8 w-full min-w-0 truncate rounded-md border px-2 py-1 text-left text-sm leading-tight font-semibold",
                target === "all" ? "border-white bg-zinc-700 text-white" : "border-zinc-700 bg-zinc-800 text-zinc-100",
              ].join(" ")}
            >
              All Departments
            </button>
            {targetableDepartments.map((d) => (
              <button
                key={d}
                onClick={() => setTarget(d)}
                className={[
                  "h-8 w-full min-w-0 truncate rounded-md border px-2 py-1 text-left text-sm leading-tight font-semibold",
                  target === d ? "text-white" : "text-zinc-100",
                ].join(" ")}
                style={{
                  borderColor: target === d ? roleChipColor(d) : "#3f3f46",
                  backgroundColor: target === d ? `${roleChipColor(d)}33` : "#1f2937",
                }}
              >
                {formatDepartmentLabel(d)}
              </button>
            ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActSidebar({
  acts,
  currentAct,
  showId,
  role,
  connectionState,
  onActSelect,
}: {
  acts: number[];
  currentAct: number;
  showId: string;
  role: string;
  connectionState: LiveConnectionState;
  onActSelect?: (act: number) => void;
}) {
  const lastPressAtRef = useRef(0);
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const roleMenuRootRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const roleOptions: DepartmentRole[] = ["director", "lighting", "sound", "stage_left", "stage_right", "stage_crew"];

  const goToRole = (nextRole: DepartmentRole) => {
    setRoleMenuOpen(false);
    if (nextRole === "director") {
      router.push(`/shows/${encodeURIComponent(showId)}/live?role=director`);
      return;
    }
    router.push(`/shows/${encodeURIComponent(showId)}/crew?role=${encodeURIComponent(nextRole)}`);
  };

  useEffect(() => {
    if (!roleMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (roleMenuRootRef.current && target && roleMenuRootRef.current.contains(target)) return;
      setRoleMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [roleMenuOpen]);

  return (
    <aside className="box-border grid h-full w-full min-w-0 grid-rows-[minmax(0,1fr)_auto] rounded-xl border border-zinc-800 bg-zinc-900 p-[7px] shadow-lg">
      <div className="min-w-0">
        <p className="mb-2 text-center text-[11px] uppercase tracking-wide text-zinc-400">Acts</p>
        <div className="w-full min-w-0 space-y-2">
          {acts.map((act) => {
            const active = currentAct === act;
            const isClickable = Boolean(onActSelect);
            return (
              <button
                key={act}
                type="button"
                onPointerUp={(event) => {
                  if (!onActSelect) return;
                  if (event.pointerType === "touch" || event.pointerType === "pen") {
                    event.preventDefault();
                    lastPressAtRef.current = Date.now();
                    onActSelect(act);
                  }
                }}
                onClick={() => {
                  if (Date.now() - lastPressAtRef.current < 400) return;
                  onActSelect?.(act);
                }}
                style={{ touchAction: "manipulation" }}
                className={[
                  "box-border min-h-11 w-full min-w-0 rounded py-2 text-center text-xs",
                  active ? "bg-sky-600 text-white" : "bg-zinc-800 text-zinc-200",
                  isClickable ? "cursor-pointer" : "cursor-default",
                ].join(" ")}
              >
                {act}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-2 border-t border-zinc-800 pt-2">
        <div ref={roleMenuRootRef} className="relative flex w-full min-w-0 flex-col items-stretch gap-2">
          {roleMenuOpen ? (
            <div className="absolute bottom-full left-0 z-40 mb-2 w-[11rem] rounded-md border border-zinc-700 bg-zinc-900 p-1 shadow-xl">
              <div className="max-h-40 overflow-y-auto">
                {roleOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => goToRole(option)}
                    className={[
                      "w-full rounded px-2 py-1.5 text-left text-sm leading-tight break-words",
                      option === role ? "bg-sky-600 text-white" : "text-zinc-200 hover:bg-zinc-800",
                    ].join(" ")}
                  >
                    {formatDepartmentLabel(option)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setRoleMenuOpen((prev) => !prev)}
            className="w-full min-w-0 text-center text-[11px] font-medium text-zinc-400 hover:text-zinc-200"
            title="Change role"
          >
            {formatDepartmentLabel(role)}
          </button>
          <div className="flex w-full items-center justify-center">
            <span
              aria-label={`Connection status: ${connectionState}`}
              title={`Connection: ${connectionState}`}
              className={`block h-3 w-3 rounded-full ${connectionColor(connectionState)}`}
            />
          </div>
          <Link
            href="/"
            aria-label="Home"
            title="Home"
            className="box-border flex h-9 w-full min-w-0 items-center justify-center rounded bg-zinc-800 text-base text-zinc-100 hover:bg-zinc-700"
          >
            ⌂
          </Link>
        </div>
      </div>
    </aside>
  );
}

function formatMs(ms: number) {
  const totalSeconds = Math.max(Math.floor(ms / 1000), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function DirectorLiveShell({
  showId,
  showName,
  lines,
  cues,
}: {
  showId: string;
  showName: string;
  lines: ScriptLine[];
  cues: Cue[];
}) {
  const { state, events, communications, publish, connectionState } = useLiveChannel(showId, "director");
  const [optimisticPosition, setOptimisticPosition] = useState<{ lineId: number; wordIndex: number } | null>(null);
  const [pendingMessages, setPendingMessages] = useState<UnifiedHistoryItem[]>([]);
  const effectiveOptimisticPosition =
    optimisticPosition && state && state.currentLineId === optimisticPosition.lineId && state.currentWordIndex === optimisticPosition.wordIndex
      ? null
      : optimisticPosition;
  const currentLine = effectiveOptimisticPosition?.lineId ?? state?.currentLineId ?? 1;
  const currentWordIndex = effectiveOptimisticPosition?.wordIndex ?? state?.currentWordIndex ?? 0;
  const acts = useMemo(() => Array.from(new Set(lines.map((x) => x.actNumber))), [lines]);
  const currentAct = lines.find((line) => line.id === currentLine)?.actNumber ?? acts[0] ?? 1;
  const [viewAct, setViewAct] = useState(currentAct);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [instantScrollNonce, setInstantScrollNonce] = useState(0);
  const [followRequestNonce, setFollowRequestNonce] = useState(0);
  const [scrollTarget, setScrollTarget] = useState<{ lineId: number; wordIndex?: number; nonce: number } | null>(null);
  const scrollTargetNonceRef = useRef(0);

  const currentSceneName = useMemo(() => {
    const currentIndex = lines.findIndex((line) => line.id === currentLine);
    if (currentIndex < 0) return `Act ${currentAct}`;
    for (let i = currentIndex; i >= 0; i -= 1) {
      if (lines[i].sceneSeparator) return lines[i].sceneSeparator as string;
    }
    return `Act ${currentAct}`;
  }, [currentAct, currentLine, lines]);
  const currentSceneNumberInAct = useMemo(() => {
    const currentIndex = lines.findIndex((line) => line.id === currentLine);
    if (currentIndex < 0) return 1;
    let sceneCounter = 0;
    for (let i = 0; i <= currentIndex; i += 1) {
      if (lines[i].actNumber === currentAct && lines[i].sceneSeparator) sceneCounter += 1;
    }
    return Math.max(sceneCounter, 1);
  }, [currentAct, currentLine, lines]);
  const currentActLabel = `${currentAct}.${currentSceneNumberInAct} ${currentSceneName}`;
  const sceneKeyByLineId = useMemo(() => {
    const mapping = new Map<number, string>();
    let currentSceneKey = "";
    for (const line of lines) {
      if (line.sceneSeparator) currentSceneKey = `${line.actNumber}:${line.sceneSeparator}`;
      mapping.set(line.id, currentSceneKey || `${line.actNumber}:Act`);
    }
    return mapping;
  }, [lines]);
  const showElapsedMs = state?.showStartedAtMs ? Math.max(nowTs - state.showStartedAtMs, 0) : 0;
  const sceneElapsedMs = state?.sceneStartedAtMs ? Math.max(nowTs - state.sceneStartedAtMs, 0) : 0;
  const setLine = useCallback(
    (lineId: number, mode: "auto" | "manual" = "manual", wordIndex = 0) => {
      setOptimisticPosition({ lineId, wordIndex });
      return publish({
        type: "line.set",
        sourceRole: "director",
        targetRoles: ["all"],
        payload: {
          currentLineId: lineId,
          currentAct: lines.find((x) => x.id === lineId)?.actNumber ?? 1,
          currentWordIndex: wordIndex,
          mode,
          currentSceneKey: sceneKeyByLineId.get(lineId) ?? "",
        },
      }).catch(() => {
        setOptimisticPosition(null);
      });
    },
    [lines, publish, sceneKeyByLineId],
  );

  const navigationSteps = useMemo(() => {
    const steps: Array<{ lineId: number; wordIndex: number }> = [];
    const firstLine = lines[0];
    const lastLine = lines[lines.length - 1];
    let sceneCounter = 0;

    if (firstLine) {
      steps.push({ lineId: firstLine.id, wordIndex: -1 }); // Show starts
    }

    for (const line of lines) {
      if (line.sceneSeparator) {
        sceneCounter += 1;
        steps.push({ lineId: line.id, wordIndex: encodeSceneAnchor(sceneCounter) }); // Scene anchor
      }
      steps.push({ lineId: line.id, wordIndex: 0 }); // Script line
    }

    if (lastLine) {
      steps.push({ lineId: lastLine.id, wordIndex: -2 }); // Show ends
    }

    return steps;
  }, [lines]);

  const currentNavWordIndex = useMemo(() => {
    if (currentWordIndex === -1 || currentWordIndex === -2) return currentWordIndex;
    if (decodeSceneAnchor(currentWordIndex) !== null) return currentWordIndex;
    return 0;
  }, [currentWordIndex]);

  const advanceLine = useCallback(() => {
    if (!navigationSteps.length) return;
    const idx = navigationSteps.findIndex((step) => step.lineId === currentLine && step.wordIndex === currentNavWordIndex);
    const currentIdx = idx >= 0 ? idx : navigationSteps.findIndex((step) => step.lineId === currentLine && step.wordIndex === 0);
    const nextIdx = Math.min((currentIdx >= 0 ? currentIdx : 0) + 1, navigationSteps.length - 1);
    const step = navigationSteps[nextIdx];
    void setLine(step.lineId, "manual", step.wordIndex);
  }, [currentLine, currentNavWordIndex, navigationSteps, setLine]);

  const retreatLine = useCallback(() => {
    if (!navigationSteps.length) return;
    const idx = navigationSteps.findIndex((step) => step.lineId === currentLine && step.wordIndex === currentNavWordIndex);
    const currentIdx = idx >= 0 ? idx : navigationSteps.findIndex((step) => step.lineId === currentLine && step.wordIndex === 0);
    const prevIdx = Math.max((currentIdx >= 0 ? currentIdx : 0) - 1, 0);
    const step = navigationSteps[prevIdx];
    void setLine(step.lineId, "manual", step.wordIndex);
  }, [currentLine, currentNavWordIndex, navigationSteps, setLine]);
  const jumpToAct = useCallback(
    (act: number) => {
      const firstLine = lines.find((line) => line.actNumber === act);
      if (!firstLine) return;
      setInstantScrollNonce((prev) => prev + 1);
      const firstSceneLine = lines.find((line) => line.actNumber === act && Boolean(line.sceneSeparator));
      if (firstSceneLine) {
        const sceneNumber =
          lines.reduce((count, line) => {
            if (line.id > firstSceneLine.id) return count;
            return line.sceneSeparator ? count + 1 : count;
          }, 0) || 1;
        scrollTargetNonceRef.current += 1;
        setScrollTarget({ lineId: firstSceneLine.id, wordIndex: encodeSceneAnchor(sceneNumber), nonce: scrollTargetNonceRef.current });
        setViewAct(act);
        return;
      }
      scrollTargetNonceRef.current += 1;
      setScrollTarget({ lineId: firstLine.id, wordIndex: 0, nonce: scrollTargetNonceRef.current });
      setViewAct(act);
    },
    [lines],
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setNowTs(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const sendMessage = async (content: string, isPreset: boolean, target: string) => {
    const clientNonce = makeClientNonce("msg");
    setPendingMessages((prev) => [
      ...prev.slice(-49),
      {
        id: `pending-${clientNonce}`,
        at: new Date().toISOString(),
        kind: "message",
        text: content,
        sourceRole: "director",
        targetRoles: [target],
        clientNonce,
      },
    ]);
    await publish({
      type: "message.sent",
      sourceRole: "director",
      targetRoles: [target],
      payload: {
        text: content,
        isPreset,
        role: "director",
        clientNonce,
      },
    });
  };

  const history = useMemo<UnifiedHistoryItem[]>(() => {
    const serverItems: UnifiedHistoryItem[] = events
      .filter((evt) => evt.type === "message.sent" || evt.type === "cue.standby" || evt.type === "cue.go")
      .map((evt): UnifiedHistoryItem => {
        const text = extractPayloadText(evt);
        return {
          id: evt.id,
          at: evt.at,
          kind: evt.type === "message.sent" ? "message" : "alert",
          text: evt.type === "cue.go" ? `GO: ${text}` : evt.type === "cue.standby" ? `READY: ${text}` : text,
          sourceRole: evt.sourceRole,
          targetRoles: evt.targetRoles,
          clientNonce: extractPayloadClientNonce(evt.payload),
        };
      });

    const ackedNonces = new Set(serverItems.map((item) => item.clientNonce).filter((nonce): nonce is string => Boolean(nonce)));
    const optimisticItems = pendingMessages.filter((item) => !item.clientNonce || !ackedNonces.has(item.clientNonce));
    return [...serverItems, ...optimisticItems].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [events, pendingMessages]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isEditable = Boolean(target?.isContentEditable) || tag === "input" || tag === "textarea" || tag === "select";
      if (isEditable) return;
      if (event.code === "Space" || event.code === "ArrowDown") {
        event.preventDefault();
        void advanceLine();
        return;
      }
      if (event.code === "ArrowUp") {
        event.preventDefault();
        void retreatLine();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [advanceLine, retreatLine]);

  return (
    <main className="h-screen overflow-x-hidden overflow-y-hidden bg-slate-950 p-3 text-white">
      <div className="grid h-full min-w-0 grid-cols-[minmax(0,56px)_minmax(0,1fr)_minmax(170px,22vw)] md:grid-cols-[minmax(0,60px)_minmax(0,1fr)_minmax(220px,28vw)] xl:grid-cols-[minmax(0,56px)_minmax(0,1fr)_minmax(170px,22vw)] gap-2">
        <ActSidebar
          acts={acts}
          currentAct={viewAct}
          showId={showId}
          role="director"
          connectionState={connectionState}
          onActSelect={(act) => {
            void jumpToAct(act);
          }}
        />

        <section className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_80px] gap-2">
          <ScriptPanel
            lines={lines}
            cues={cues}
            currentLineId={currentLine}
            currentWordIndex={currentWordIndex}
            role="director"
            onLineSelect={(line) => {
              void setLine(line.id, "manual", 0);
            }}
            onShowStartSelect={(line) => {
              void setLine(line.id, "manual", -1);
            }}
            onShowEndSelect={(line) => {
              void setLine(line.id, "manual", -2);
            }}
            onSceneSelect={(line, sceneNumber) => {
              void setLine(line.id, "manual", encodeSceneAnchor(sceneNumber));
            }}
            instantScrollNonce={instantScrollNonce}
            followRequestNonce={followRequestNonce}
            scrollTarget={scrollTarget ?? undefined}
            onViewActChange={setViewAct}
          />
          <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-2.5 shadow-lg">
            <button
              className="rounded-md bg-sky-600 px-3 py-2 text-xs font-medium text-white"
              onClick={() => {
                void advanceLine();
              }}
            >
              Advance line
            </button>
            <button
              className="rounded-md border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs text-zinc-100"
              onClick={() =>
                publish({
                  type: "cue.standby",
                  sourceRole: "director",
                  targetRoles: ["lighting", "sound", "stage_left", "stage_right", "stage_crew"],
                  payload: { text: "Standby next cue" },
                })
              }
            >
              Send standby
            </button>
            <button
              className="rounded-md bg-emerald-300 px-3 py-2 text-xs font-semibold text-black"
              onClick={() =>
                publish({
                  type: "cue.go",
                  sourceRole: "director",
                  targetRoles: ["lighting", "sound", "stage_left", "stage_right", "stage_crew"],
                  payload: { text: "Go cue" },
                })
              }
            >
              Send go
            </button>
          </div>
        </section>

        <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-2 overflow-hidden">
          <ShowStatusPanel
            showName={showName}
            nowTs={nowTs}
            showElapsedMs={showElapsedMs}
            sceneElapsedMs={sceneElapsedMs}
            currentActLabel={currentActLabel}
            onJumpToCurrent={() => setFollowRequestNonce((prev) => prev + 1)}
          />
          <CommunicationsPanel
            role="director"
            history={history}
            departments={communications.departments}
            quickMessages={communications.quickMessages}
            onSend={sendMessage}
          />
        </section>
      </div>
    </main>
  );
}

export function CrewLiveShell({
  showId,
  showName,
  role,
  lines,
  cues,
}: {
  showId: string;
  showName: string;
  role: DepartmentRole;
  lines: ScriptLine[];
  cues: Cue[];
}) {
  const { state, events, communications, publish, connectionState } = useLiveChannel(showId, role);
  const currentLine = state?.currentLineId ?? 1;
  const currentWordIndex = state?.currentWordIndex ?? 0;
  const [pendingMessages, setPendingMessages] = useState<UnifiedHistoryItem[]>([]);
  const acts = useMemo(() => Array.from(new Set(lines.map((x) => x.actNumber))), [lines]);
  const currentAct = lines.find((line) => line.id === currentLine)?.actNumber ?? acts[0] ?? 1;
  const [viewAct, setViewAct] = useState(currentAct);

  const sendMessage = async (content: string, isPreset: boolean, target: string) => {
    const clientNonce = makeClientNonce("msg");
    setPendingMessages((prev) => [
      ...prev.slice(-49),
      {
        id: `pending-${clientNonce}`,
        at: new Date().toISOString(),
        kind: "message",
        text: content,
        sourceRole: role,
        targetRoles: [target],
        clientNonce,
      },
    ]);
    await publish({
      type: "message.sent",
      sourceRole: role,
      targetRoles: [target],
      payload: {
        text: content,
        isPreset,
        role,
        clientNonce,
      },
    });
  };

  const [nowTs, setNowTs] = useState(() => Date.now());
  const [instantScrollNonce, setInstantScrollNonce] = useState(0);
  const [followRequestNonce, setFollowRequestNonce] = useState(0);
  const [scrollTarget, setScrollTarget] = useState<{ lineId: number; wordIndex?: number; nonce: number } | null>(null);
  const scrollTargetNonceRef = useRef(0);
  const currentSceneName = useMemo(() => {
    const currentIndex = lines.findIndex((line) => line.id === currentLine);
    if (currentIndex < 0) return `Act ${currentAct}`;
    for (let i = currentIndex; i >= 0; i -= 1) {
      if (lines[i].sceneSeparator) return lines[i].sceneSeparator as string;
    }
    return `Act ${currentAct}`;
  }, [currentAct, currentLine, lines]);
  const currentSceneNumberInAct = useMemo(() => {
    const currentIndex = lines.findIndex((line) => line.id === currentLine);
    if (currentIndex < 0) return 1;
    let sceneCounter = 0;
    for (let i = 0; i <= currentIndex; i += 1) {
      if (lines[i].actNumber === currentAct && lines[i].sceneSeparator) sceneCounter += 1;
    }
    return Math.max(sceneCounter, 1);
  }, [currentAct, currentLine, lines]);
  const currentActLabel = `${currentAct}.${currentSceneNumberInAct} ${currentSceneName}`;
  const showElapsedMs = state?.showStartedAtMs ? Math.max(nowTs - state.showStartedAtMs, 0) : 0;
  const sceneElapsedMs = state?.sceneStartedAtMs ? Math.max(nowTs - state.sceneStartedAtMs, 0) : 0;

  const jumpToAct = useCallback(
    (act: number) => {
      const firstLine = lines.find((line) => line.actNumber === act);
      if (!firstLine) return;
      const firstSceneLine = lines.find((line) => line.actNumber === act && Boolean(line.sceneSeparator));
      let wordIndex = 0;
      let lineId = firstLine.id;
      if (firstSceneLine) {
        lineId = firstSceneLine.id;
        const sceneNumber =
          lines.reduce((count, line) => {
            if (line.id > firstSceneLine.id) return count;
            return line.sceneSeparator ? count + 1 : count;
          }, 0) || 1;
        wordIndex = encodeSceneAnchor(sceneNumber);
      }
      scrollTargetNonceRef.current += 1;
      setScrollTarget({ lineId, wordIndex, nonce: scrollTargetNonceRef.current });
      setInstantScrollNonce((prev) => prev + 1);
      setViewAct(act);
    },
    [lines],
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setNowTs(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const history = useMemo<UnifiedHistoryItem[]>(() => {
    const serverItems: UnifiedHistoryItem[] = events
      .filter((evt) => evt.type === "message.sent" || evt.type === "cue.standby" || evt.type === "cue.go")
      .map((evt): UnifiedHistoryItem => {
        const text = extractPayloadText(evt);
        return {
          id: evt.id,
          at: evt.at,
          kind: evt.type === "message.sent" ? "message" : "alert",
          text: evt.type === "cue.go" ? `GO: ${text}` : evt.type === "cue.standby" ? `READY: ${text}` : text,
          sourceRole: evt.sourceRole,
          targetRoles: evt.targetRoles,
          clientNonce: extractPayloadClientNonce(evt.payload),
        };
      });

    const ackedNonces = new Set(serverItems.map((item) => item.clientNonce).filter((nonce): nonce is string => Boolean(nonce)));
    const optimisticItems = pendingMessages.filter((item) => !item.clientNonce || !ackedNonces.has(item.clientNonce));
    return [...serverItems, ...optimisticItems].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [events, pendingMessages]);

  return (
    <main className="h-screen overflow-x-hidden overflow-y-hidden bg-slate-950 p-3 text-white">
      <div className="grid h-full min-w-0 grid-cols-[minmax(0,56px)_minmax(0,1fr)_minmax(170px,22vw)] md:grid-cols-[minmax(0,60px)_minmax(0,1fr)_minmax(220px,28vw)] xl:grid-cols-[minmax(0,56px)_minmax(0,1fr)_minmax(170px,22vw)] gap-2">
        <ActSidebar
          acts={acts}
          currentAct={viewAct}
          showId={showId}
          role={role}
          connectionState={connectionState}
          onActSelect={(act) => {
            jumpToAct(act);
          }}
        />
        <ScriptPanel
          lines={lines}
          cues={cues}
          currentLineId={currentLine}
          currentWordIndex={currentWordIndex}
          role={role}
          instantScrollNonce={instantScrollNonce}
          followRequestNonce={followRequestNonce}
          scrollTarget={scrollTarget ?? undefined}
          onViewActChange={setViewAct}
        />

        <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-2 overflow-hidden">
          <ShowStatusPanel
            showName={showName}
            nowTs={nowTs}
            showElapsedMs={showElapsedMs}
            sceneElapsedMs={sceneElapsedMs}
            currentActLabel={currentActLabel}
            onJumpToCurrent={() => setFollowRequestNonce((prev) => prev + 1)}
          />
          <CommunicationsPanel
            role={role}
            history={history}
            departments={communications.departments}
            quickMessages={communications.quickMessages}
            onSend={sendMessage}
          />
        </section>
      </div>
    </main>
  );
}
