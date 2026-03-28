"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { DEPARTMENT_COLORS } from "@/lib/constants";
import { splitLineWords } from "@/lib/editor/document";
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

function useScrollFade<T extends HTMLElement>(axis: "x" | "y") {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const threshold = 1;
    const maxFadePx = 14;
    const update = () => {
      if (axis === "y") {
        const totalScrollable = el.scrollHeight - el.clientHeight;
        const canScrollY = totalScrollable > threshold;
        const topDistance = canScrollY ? Math.max(el.scrollTop, 0) : 0;
        const bottomDistance = canScrollY ? Math.max(totalScrollable - el.scrollTop, 0) : 0;
        const topFade = Math.min(topDistance, maxFadePx);
        const bottomFade = Math.min(bottomDistance, maxFadePx);
        el.style.setProperty("--scroll-fade-top-size", `${topFade}px`);
        el.style.setProperty("--scroll-fade-bottom-size", `${bottomFade}px`);
        return;
      }

      const totalScrollable = el.scrollWidth - el.clientWidth;
      const canScrollX = totalScrollable > threshold;
      const leftDistance = canScrollX ? Math.max(el.scrollLeft, 0) : 0;
      const rightDistance = canScrollX ? Math.max(totalScrollable - el.scrollLeft, 0) : 0;
      const leftFade = Math.min(leftDistance, maxFadePx);
      const rightFade = Math.min(rightDistance, maxFadePx);
      el.style.setProperty("--scroll-fade-left-size", `${leftFade}px`);
      el.style.setProperty("--scroll-fade-right-size", `${rightFade}px`);
    };

    update();
    const onScroll = () => update();
    el.addEventListener("scroll", onScroll, { passive: true });
    const resizeObserver = new ResizeObserver(() => update());
    resizeObserver.observe(el);
    const mutationObserver = new MutationObserver(() => {
      window.requestAnimationFrame(() => update());
    });
    mutationObserver.observe(el, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", update);

    return () => {
      el.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [axis]);

  return ref;
}

function useLockedViewport() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyHeight = body.style.height;

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.height = "100%";

    return () => {
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
      body.style.height = previousBodyHeight;
    };
  }, []);
}

function isSceneDirectionCue(cue: Cue) {
  if (cue.department === "stage_manager" || cue.department === "stage_left" || cue.department === "stage_right") return true;
  const text = cue.text.toLowerCase();
  return SCENE_DIRECTION_KEYWORDS.some((kw) => text.includes(kw));
}

function cueHoverDetails(cue: Cue) {
  const parts = [
    `${formatDepartmentLabel(cue.department)}`,
    cue.text.trim() || "No cue text.",
  ];
  if (cue.diagramUrl?.trim()) parts.push("Diagram linked");
  return parts.join(" · ");
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

function InlineCueMarker({
  cue,
  role,
}: {
  cue: Cue;
  role: DepartmentRole;
}) {
  const color = DEPARTMENT_COLORS[cue.department] ?? "#52525b";
  const isTechnician = role !== "director";
  const isRoleCue = cue.department === role;
  const showTechnicianDetails = isTechnician && isRoleCue;
  const label = formatDepartmentLabel(cue.department);
  const detailText = cueHoverDetails(cue);
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const tooltipTextColor = getReadableTextColor(color);

  useEffect(() => {
    if (!showTooltip) return;

    const updatePosition = () => {
      const marker = markerRef.current;
      const tooltip = tooltipRef.current;
      if (!marker || !tooltip) return;

      const markerRect = marker.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const viewportPadding = 12;
      const gap = 8;

      let left = markerRect.left + markerRect.width / 2 - tooltipRect.width / 2;
      left = Math.max(viewportPadding, Math.min(left, window.innerWidth - tooltipRect.width - viewportPadding));

      let top = markerRect.top - tooltipRect.height - gap;
      if (top < viewportPadding) {
        top = markerRect.bottom + gap;
      }
      top = Math.max(viewportPadding, Math.min(top, window.innerHeight - tooltipRect.height - viewportPadding));

      setTooltipPosition({ top, left });
    };

    updatePosition();
    const onWindowChange = () => updatePosition();
    window.addEventListener("resize", onWindowChange);
    window.addEventListener("scroll", onWindowChange, true);

    return () => {
      window.removeEventListener("resize", onWindowChange);
      window.removeEventListener("scroll", onWindowChange, true);
    };
  }, [showTooltip]);

  return (
    <span
      ref={markerRef}
      onMouseEnter={() => {
        if (showTechnicianDetails) return;
        setShowTooltip(true);
      }}
      onMouseLeave={() => setShowTooltip(false)}
      onFocus={() => {
        if (showTechnicianDetails) return;
        setShowTooltip(true);
      }}
      onBlur={() => setShowTooltip(false)}
      className={[
        "relative mx-0.5 inline-flex items-center rounded-lg border px-2.5 py-1 align-middle text-xs font-semibold leading-snug",
        showTechnicianDetails ? "text-black" : "text-zinc-100",
      ].join(" ")}
      style={{
        borderColor: color,
        backgroundColor: showTechnicianDetails ? `${color}aa` : `${color}44`,
      }}
      tabIndex={showTechnicianDetails ? -1 : 0}
    >
      {label}
      {!showTechnicianDetails && showTooltip
        ? createPortal(
            <span
              ref={tooltipRef}
              className="pointer-events-none fixed z-[9999] w-[min(24rem,calc(100vw-1.5rem))] rounded-lg border p-3 text-left text-xs font-medium leading-relaxed whitespace-pre-wrap break-words shadow-2xl"
              style={{
                top: tooltipPosition.top,
                left: tooltipPosition.left,
                borderColor: color,
                backgroundColor: color,
                color: tooltipTextColor,
              }}
            >
              {detailText}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
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
  const scriptFadeRef = useScrollFade<HTMLDivElement>("y");
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
    () => cues.filter((cue) => cue.department === role && cue.lineId > currentLineId).map((cue) => cue.lineId),
    [cues, currentLineId, role],
  );
  const upcomingRoleCueLineIds = useMemo(() => new Set(nextRoleCue), [nextRoleCue]);
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
        ref={(node) => {
          containerRef.current = node;
          scriptFadeRef.current = node;
        }}
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
        className="script-scroll scroll-fade-y scroll-fade-y-strong -mr-3 min-h-0 flex-1 overflow-y-scroll pr-3"
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
          const roleCuesForLine = cues
            .filter((cue) => cue.lineId === line.id && cue.department === role)
            .sort((a, b) => a.anchorGapIndex - b.anchorGapIndex);
          const isUpcomingCueLine = isTechnician && upcomingRoleCueLineIds.has(line.id) && !isCurrent;
          const isCurrentCueLine = isTechnician && line.id === currentLineId && roleCuesForLine.length > 0;
          const canSelectShowStart = Boolean(firstVisibleLine && onLineSelect);
          const words = splitLineWords(line.text);
          const inlineCues = isTechnician ? lineCues.filter((cue) => cue.department === role) : lineCues;
          const cuesByGap = new Map<number, Cue[]>();
          inlineCues
            .slice()
            .sort((a, b) => (a.anchorGapIndex !== b.anchorGapIndex ? a.anchorGapIndex - b.anchorGapIndex : a.department.localeCompare(b.department)))
            .forEach((cue) => {
              const clampedGap = Math.max(0, Math.min(cue.anchorGapIndex, words.length));
              const next = cuesByGap.get(clampedGap) ?? [];
              next.push(cue);
              cuesByGap.set(clampedGap, next);
            });

          return (
            <div key={line.id}>
              {firstVisibleLine && line.id === firstVisibleLine.id ? (
                <div
                  onClick={() => {
                    if (!firstVisibleLine || !onLineSelect) return;
                    if (onShowStartSelect) {
                      onShowStartSelect(firstVisibleLine);
                      return;
                    }
                    onLineSelect(firstVisibleLine);
                  }}
                  className={[
                    "mb-2 w-full rounded-md border px-3 py-3 text-sm font-medium transition-all duration-300",
                    canSelectShowStart ? "cursor-pointer" : "",
                    currentWordIndex === -1 && currentLineId === firstVisibleLine.id
                      ? "border-white bg-sky-900/35 text-white"
                      : canSelectShowStart
                        ? "border-sky-800 bg-sky-950/25 text-sky-300 hover:bg-sky-900/40"
                        : "border-sky-800 bg-sky-950/25 text-sky-300",
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
                      const sceneChangeCues = cues.filter((cue) => {
                        if (cue.lineId !== line.id || !isSceneDirectionCue(cue)) return false;
                        if (isTechnician) return cue.department === role;
                        return true;
                      });
                      if (!sceneChangeCues.length) return <span className="text-[11px] text-zinc-400">No scene-change cues</span>;
                      return sceneChangeCues.map((cue) => (
                        (() => {
                          const cueColor = DEPARTMENT_COLORS[cue.department] ?? "#71717a";
                          const isBright = isCurrent || !isPast;
                          return (
                        <span
                          key={`scene-${line.id}-${cue.id}`}
                          className="rounded-full px-2 py-1 text-[11px] font-medium text-white"
                          style={{ backgroundColor: isBright ? cueColor : `${cueColor}66` }}
                        >
                          {cue.department}: {cue.text}
                        </span>
                          );
                        })()
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
                  isCurrent && !isCurrentCueLine ? "border-white bg-zinc-800" : "border-transparent",
                  isCurrentCueLine ? "border-emerald-300 bg-emerald-950/80 ring-2 ring-emerald-400/70" : "",
                  isUpcomingCueLine ? "bg-rose-900/35" : "",
                  isPast ? "text-zinc-600" : isCurrent ? "text-white" : "text-zinc-300",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                      Act {line.actNumber} · L{line.lineNumber} · {line.character}
                    </p>
                    <p className={isCurrent ? "mt-1 text-2xl font-semibold leading-snug" : "mt-1 text-lg leading-snug"}>
                      {Array.from({ length: words.length + 1 }).map((_, gapIndex) => {
                        const gapCues = cuesByGap.get(gapIndex) ?? [];
                        return (
                          <span key={`line-${line.id}-gap-${gapIndex}`} className="contents">
                            {gapCues.length && gapIndex > 0 ? " " : null}
                            {gapCues.map((cue) => (
                              <InlineCueMarker key={cue.id} cue={cue} role={role} />
                            ))}
                            {gapCues.length && gapIndex < words.length ? " " : null}
                            {gapIndex < words.length ? `${words[gapIndex]} ` : null}
                          </span>
                        );
                      })}
                    </p>
                  </div>

                  {isTechnician && (isCurrentCueLine || isUpcomingCueLine) ? (
                    <div
                      className={[
                        "min-w-44 rounded-md border px-2.5 py-1.5 text-xs font-medium",
                        isCurrentCueLine ? "border-emerald-400 bg-emerald-200 text-emerald-950" : "border-rose-400 bg-rose-200 text-rose-950",
                      ].join(" ")}
                    >
                      <div className="space-y-1">
                        {roleCuesForLine.length ? (
                          roleCuesForLine.map((cue) => <p key={cue.id}>{cue.text || "No cue text."}</p>)
                        ) : (
                          <p>No cue text.</p>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>

              </div>
            </div>
          );
        })}
        {lastVisibleLine ? (
          <div
            onClick={() => {
              if (!onLineSelect) return;
              if (onShowEndSelect) {
                onShowEndSelect(lastVisibleLine);
                return;
              }
              onLineSelect(lastVisibleLine);
            }}
            className={[
              "mt-3 w-full rounded-md border px-3 py-3 text-sm font-medium transition-all duration-300",
              onLineSelect ? "cursor-pointer" : "",
              currentWordIndex === -2 && currentLineId === lastVisibleLine.id
                ? "border-white bg-rose-900/35 text-white"
                : onLineSelect
                  ? "border-rose-800 bg-rose-950/25 text-rose-300 hover:bg-rose-900/40"
                  : "border-rose-800 bg-rose-950/25 text-rose-300",
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

function connectionIndicatorColors(connectionState: LiveConnectionState) {
  if (connectionState === "connected") {
    return { from: "#6ee7b7", to: "#34d399", glow: "rgba(16,185,129,0.65)" };
  }
  if (connectionState === "connecting") {
    return { from: "#fde68a", to: "#f59e0b", glow: "rgba(245,158,11,0.6)" };
  }
  return { from: "#fda4af", to: "#f43f5e", glow: "rgba(244,63,94,0.6)" };
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

type RoleCueSnapshot = {
  cue: Cue;
  line: ScriptLine | undefined;
};

function CueDetailsPanel({
  role,
  currentLineId,
  cues,
  lines,
}: {
  role: DepartmentRole;
  currentLineId: number;
  cues: Cue[];
  lines: ScriptLine[];
}) {
  const lineById = useMemo(() => new Map(lines.map((line) => [line.id, line])), [lines]);
  const activeFadeRef = useScrollFade<HTMLDivElement>("y");
  const upcomingFadeRef = useScrollFade<HTMLDivElement>("y");
  const roleCues = useMemo(
    () =>
      cues
        .filter((cue) => cue.department === role)
        .sort((a, b) => (a.lineId !== b.lineId ? a.lineId - b.lineId : a.anchorGapIndex - b.anchorGapIndex)),
    [cues, role],
  );

  const activeNow = useMemo<RoleCueSnapshot[]>(
    () => roleCues.filter((cue) => cue.lineId === currentLineId).map((cue) => ({ cue, line: lineById.get(cue.lineId) })),
    [currentLineId, lineById, roleCues],
  );
  const lineIndexById = useMemo(() => {
    const mapping = new Map<number, number>();
    lines.forEach((line, index) => {
      mapping.set(line.id, index);
    });
    return mapping;
  }, [lines]);
  const upcoming = useMemo<RoleCueSnapshot[]>(
    () => roleCues.filter((cue) => cue.lineId > currentLineId).map((cue) => ({ cue, line: lineById.get(cue.lineId) })),
    [currentLineId, lineById, roleCues],
  );

  return (
    <div className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900 p-3 shadow-lg">
      <p className="text-[11px] uppercase tracking-wide text-zinc-400">Cue details</p>
      <div className="mt-2 grid min-h-0 flex-1 gap-2 md:grid-cols-2">
        <div className="flex min-h-0 flex-col rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
          <p className="text-xs font-semibold text-emerald-300">Active now</p>
          <div
            ref={activeFadeRef}
            className="script-scroll scroll-fade-y scroll-fade-y-strong mt-1.5 max-h-24 min-h-0 space-y-1.5 overflow-y-auto pr-1"
          >
            {activeNow.length ? (
              activeNow.map(({ cue, line }) => (
                <div key={cue.id} className="rounded border border-emerald-800/70 bg-emerald-950/25 px-2 py-1.5 text-xs text-zinc-100">
                  <p className="text-[11px] text-zinc-300">
                    {line ? `Act ${line.actNumber} · L${line.lineNumber}` : `Line ${cue.lineId}`}
                  </p>
                  <p>{cue.text || "No cue text."}</p>
                </div>
              ))
            ) : (
              <p className="text-xs text-zinc-500">No active cues on current line.</p>
            )}
          </div>
        </div>
        <div className="flex min-h-0 flex-col rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
          <p className="text-xs font-semibold text-rose-300">Upcoming</p>
          <div
            ref={upcomingFadeRef}
            className="script-scroll scroll-fade-y scroll-fade-y-strong mt-1.5 max-h-24 min-h-0 space-y-1.5 overflow-y-auto pr-1"
          >
            {upcoming.length ? (
              upcoming.map(({ cue, line }) => (
                <div key={cue.id} className="rounded border border-rose-800/70 bg-rose-950/25 px-2 py-1.5 text-xs text-zinc-100">
                  <p className="text-[11px] text-zinc-300">
                    {line ? `Act ${line.actNumber} · L${line.lineNumber}` : `Line ${cue.lineId}`}
                  </p>
                  <p className="text-[11px] text-rose-200">
                    {(() => {
                      const cueLineIndex = lineIndexById.get(cue.lineId);
                      const currentLineIndex = lineIndexById.get(currentLineId);
                      if (typeof cueLineIndex !== "number" || typeof currentLineIndex !== "number") return "Upcoming cue";
                      const linesUntil = Math.max(cueLineIndex - currentLineIndex, 0);
                      return `${linesUntil} line${linesUntil === 1 ? "" : "s"} until cue`;
                    })()}
                  </p>
                  <p>{cue.text || "No cue text."}</p>
                </div>
              ))
            ) : (
              <p className="text-xs text-zinc-500">No upcoming cues for this role.</p>
            )}
          </div>
        </div>
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
  const historyFadeRef = useScrollFade<HTMLDivElement>("y");
  const quickMessagesFadeRef = useScrollFade<HTMLDivElement>("x");
  const sendToFadeRef = useScrollFade<HTMLDivElement>("y");

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
          ref={(node) => {
            historyRef.current = node;
            historyFadeRef.current = node;
          }}
          onScroll={() => {
            const el = historyRef.current;
            if (!el) return;
            const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            shouldStickToBottomRef.current = distanceToBottom <= 12;
          }}
          className="scroll-fade-y mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1"
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

      <div className="comms-controls grid shrink-0 min-w-0 grid-rows-[auto_auto] gap-2 p-2 pt-3">
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

          <div
            ref={quickMessagesFadeRef}
            className="scroll-fade-x min-w-0 max-w-full overflow-x-auto overflow-y-hidden pb-1 pt-1 [scrollbar-gutter:stable]"
            style={{ touchAction: "pan-x" }}
          >
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
          <div ref={sendToFadeRef} className="scroll-fade-y overflow-x-hidden overflow-y-auto">
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
  liveAccessCode,
  role,
  connectionState,
  onActSelect,
}: {
  acts: number[];
  currentAct: number;
  showId: string;
  liveAccessCode?: string;
  role: string;
  connectionState: LiveConnectionState;
  onActSelect?: (act: number) => void;
}) {
  const lastPressAtRef = useRef(0);
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const roleMenuRootRef = useRef<HTMLDivElement | null>(null);
  const shareMenuRootRef = useRef<HTMLDivElement | null>(null);
  const roleMenuFadeRef = useScrollFade<HTMLDivElement>("y");
  const router = useRouter();
  const roleOptions: DepartmentRole[] =
    role === "director"
      ? ["director", "lighting", "sound", "stage_left", "stage_right", "stage_manager"]
      : ["lighting", "sound", "stage_left", "stage_right", "stage_manager"];

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

  useEffect(() => {
    if (!shareMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (shareMenuRootRef.current && target && shareMenuRootRef.current.contains(target)) return;
      setShareMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [shareMenuOpen]);

  const shareCode = liveAccessCode?.trim() || showId;
  const showLink = `/shows/${encodeURIComponent(showId)}`;
  const crewJoinLink = `/shows/${encodeURIComponent(shareCode)}/crew?role=lighting`;
  const indicatorColors = connectionIndicatorColors(connectionState);

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
              <div ref={roleMenuFadeRef} className="scroll-fade-y max-h-40 overflow-y-auto">
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
            <div ref={shareMenuRootRef} className="relative">
              {shareMenuOpen ? (
                <div className="absolute left-full top-1/2 z-50 ml-2 w-56 -translate-y-1/2 rounded-md border border-zinc-700 bg-zinc-900 p-2 shadow-xl">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-400">Connect to this show</p>
                  <p className="mt-1 break-all text-xs text-zinc-300">Code: {shareCode}</p>
                  <Link
                    href={showLink}
                    className="mt-2 block rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-700"
                  >
                    {showLink}
                  </Link>
                  <Link
                    href={crewJoinLink}
                    className="mt-1 block rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-700"
                  >
                    {crewJoinLink}
                  </Link>
                </div>
              ) : null}
              <button
                type="button"
                aria-label={`Connection status: ${connectionState}. Click to view show link.`}
                title={`Connection: ${connectionState}`}
                onClick={() => setShareMenuOpen((prev) => !prev)}
                className="relative inline-flex h-4 w-4 items-center justify-center"
              >
                <span
                  className="pointer-events-none absolute inset-0 rounded-full blur-[4px]"
                  style={{
                    background: `radial-gradient(circle, ${indicatorColors.glow} 0%, rgba(0,0,0,0) 70%)`,
                  }}
                />
                <span
                  className="relative block h-3 w-3 rounded-full border border-white/20 shadow-[0_0_10px_rgba(255,255,255,0.2)]"
                  style={{
                    background: `linear-gradient(135deg, ${indicatorColors.from} 0%, ${indicatorColors.to} 100%)`,
                  }}
                />
              </button>
            </div>
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
  useLockedViewport();
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
          liveAccessCode={state?.liveAccessCode}
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
  useLockedViewport();
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
          liveAccessCode={state?.liveAccessCode}
          role={role}
          connectionState={connectionState}
          onActSelect={(act) => {
            jumpToAct(act);
          }}
        />
        <section className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-2">
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
          <CueDetailsPanel
            role={role}
            currentLineId={currentLine}
            cues={cues}
            lines={lines}
          />
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
