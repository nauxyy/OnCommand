"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CommunicationsConfig,
  DepartmentRole,
  LiveConnectionState,
  LiveEvent,
  LiveState,
  PublishLiveEventInput,
} from "@/lib/types";

function makeClientId() {
  if (typeof globalThis !== "undefined" && globalThis.crypto && "randomUUID" in globalThis.crypto) {
    try {
      return globalThis.crypto.randomUUID();
    } catch {
      // fall through
    }
  }
  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useLiveChannel(showId: string, role: DepartmentRole) {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [state, setState] = useState<LiveState | null>(null);
  const [communications, setCommunications] = useState<CommunicationsConfig>({
    departments: ["director", "lighting", "sound", "stage_left", "stage_right", "stage_manager"],
    quickMessages: ["Stand by", "Go now", "Hold", "Repeat cue", "Need confirmation", "Reset to last mark"],
  });
  const [connectionState, setConnectionState] = useState<LiveConnectionState>("connecting");
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const clientId = makeClientId();
    const source = new EventSource(`/api/live/${showId}/events?clientId=${clientId}&role=${role}`);
    sourceRef.current = source;

    source.onopen = () => setConnectionState("connected");
    source.onerror = () => {
      const isClosed = source.readyState === EventSource.CLOSED;
      setConnectionState(isClosed ? "disconnected" : "connecting");
    };
    source.onmessage = (raw) => {
      const evt: LiveEvent = JSON.parse(raw.data);
      setEvents((prev) => [...prev.slice(-39), evt]);
      if (evt.type === "line.set" || evt.type === "line.advance") {
        const maybeState = evt.payload as Partial<LiveState>;
        setState((prev) => ({
          showId,
          liveAccessCode: typeof maybeState.liveAccessCode === "string" ? maybeState.liveAccessCode : prev?.liveAccessCode ?? "",
          currentAct: maybeState.currentAct ?? prev?.currentAct ?? 1,
          currentLineId: maybeState.currentLineId ?? prev?.currentLineId ?? 1,
          currentWordIndex: maybeState.currentWordIndex ?? prev?.currentWordIndex ?? 0,
          mode: maybeState.mode ?? prev?.mode ?? "manual",
          showStartedAtMs: maybeState.showStartedAtMs ?? prev?.showStartedAtMs ?? Date.now(),
          sceneStartedAtMs: maybeState.sceneStartedAtMs ?? prev?.sceneStartedAtMs ?? Date.now(),
          currentSceneKey: maybeState.currentSceneKey ?? prev?.currentSceneKey ?? "",
          sessionOwnerClientId: maybeState.sessionOwnerClientId ?? prev?.sessionOwnerClientId ?? "",
        }));
      }
      if (evt.type === "communications.config") {
        const payload = evt.payload as Partial<CommunicationsConfig>;
        setCommunications((prev) => ({
          departments: payload.departments ?? prev.departments,
          quickMessages: payload.quickMessages ?? prev.quickMessages,
        }));
      }
    };

    return () => {
      source.close();
      sourceRef.current = null;
      setConnectionState("disconnected");
    };
  }, [role, showId]);

  const publish = useCallback(
    async (payload: PublishLiveEventInput) => {
      await fetch(`/api/live/${showId}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    },
    [showId],
  );

  const cues = useMemo(() => events.filter((e) => e.type === "cue.standby" || e.type === "cue.go"), [events]);

  return {
    events,
    cues,
    communications,
    state,
    connectionState,
    isConnected: connectionState === "connected",
    publish,
  };
}
