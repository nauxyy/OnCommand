import { CommunicationsConfig, DepartmentRole, LiveEvent, LiveState } from "@/lib/types";

type Subscriber = {
  role: DepartmentRole | "all";
  controller: ReadableStreamDefaultController<Uint8Array>;
};

const enc = new TextEncoder();
const subscribersByShow = new Map<string, Map<string, Subscriber>>();
const liveStateByShow = new Map<string, LiveState>();
const communicationsConfigByShow = new Map<string, CommunicationsConfig>();
const sessionOwnerByShow = new Map<string, string>();

function ensureSessionOwner(showId: string, clientId: string) {
  const existing = sessionOwnerByShow.get(showId);
  if (existing) return existing;
  sessionOwnerByShow.set(showId, clientId);
  return clientId;
}

function createDefaultLiveState(showId: string, ownerClientId: string): LiveState {
  const now = Date.now();
  return {
    showId,
    currentAct: 1,
    currentLineId: 1,
    currentWordIndex: 0,
    mode: "manual",
    showStartedAtMs: now,
    sceneStartedAtMs: now,
    currentSceneKey: "",
    sessionOwnerClientId: ownerClientId,
  };
}

const DEFAULT_DEPARTMENTS = ["director", "lighting", "sound", "stage_left", "stage_right", "stage_crew"];
const DEFAULT_QUICK_MESSAGES = ["Stand by", "Go now", "Hold", "Repeat cue", "Need confirmation", "Reset to last mark"];

function writeSse(controller: ReadableStreamDefaultController<Uint8Array>, event: LiveEvent) {
  controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
}

export function createEventStream(showId: string, clientId: string, role: DepartmentRole | "all") {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const byClient = subscribersByShow.get(showId) ?? new Map<string, Subscriber>();
      byClient.set(clientId, { role, controller });
      subscribersByShow.set(showId, byClient);

      const ownerClientId = ensureSessionOwner(showId, clientId);
      const current = liveStateByShow.get(showId) ?? createDefaultLiveState(showId, ownerClientId);
      liveStateByShow.set(showId, current);
      writeSse(controller, {
        id: crypto.randomUUID(),
        showId,
        at: new Date().toISOString(),
        type: "line.set",
        sourceRole: "director",
        targetRoles: ["all"],
        payload: current,
      });

      const comms = getCommunicationsConfig(showId);
      writeSse(controller, {
        id: crypto.randomUUID(),
        showId,
        at: new Date().toISOString(),
        type: "communications.config",
        sourceRole: "director",
        targetRoles: ["all"],
        payload: comms,
      });
    },
    cancel() {
      const byClient = subscribersByShow.get(showId);
      if (!byClient) return;
      byClient.delete(clientId);
      if (!byClient.size) subscribersByShow.delete(showId);
    },
  });
}

export function publishEvent(event: LiveEvent) {
  const byClient = subscribersByShow.get(event.showId);
  if (!byClient) return;

  byClient.forEach(({ role, controller }) => {
    const shouldReceive =
      event.targetRoles.includes("all") ||
      role === "all" ||
      event.targetRoles.includes(role);

    if (!shouldReceive) return;

    try {
      writeSse(controller, event);
    } catch {
      // stale connection, remove from map
    }
  });
}

export function upsertLiveState(showId: string, patch: Partial<LiveState>) {
  const ownerClientId = ensureSessionOwner(showId, patch.sessionOwnerClientId ?? `owner-${showId}`);
  const current = liveStateByShow.get(showId) ?? createDefaultLiveState(showId, ownerClientId);
  const sceneKeyChanged =
    typeof patch.currentSceneKey === "string" &&
    patch.currentSceneKey.length > 0 &&
    patch.currentSceneKey !== current.currentSceneKey;
  const next = {
    ...current,
    ...patch,
    sessionOwnerClientId: current.sessionOwnerClientId || ownerClientId,
    sceneStartedAtMs: sceneKeyChanged ? Date.now() : current.sceneStartedAtMs,
  };
  liveStateByShow.set(showId, next);
  return next;
}

export function getCommunicationsConfig(showId: string): CommunicationsConfig {
  const existing = communicationsConfigByShow.get(showId);
  if (existing) return existing;
  const initial: CommunicationsConfig = {
    departments: [...DEFAULT_DEPARTMENTS],
    quickMessages: [...DEFAULT_QUICK_MESSAGES],
  };
  communicationsConfigByShow.set(showId, initial);
  return initial;
}

export function upsertCommunicationsConfig(
  showId: string,
  patch: Partial<CommunicationsConfig>,
): CommunicationsConfig {
  const current = getCommunicationsConfig(showId);
  const departments = Array.from(new Set((patch.departments ?? current.departments).map((x) => x.trim()).filter(Boolean)));
  const quickMessages = Array.from(new Set((patch.quickMessages ?? current.quickMessages).map((x) => x.trim()).filter(Boolean)));
  const next: CommunicationsConfig = { departments, quickMessages };
  communicationsConfigByShow.set(showId, next);
  return next;
}
