export type DepartmentRole = "director" | "lighting" | "sound" | "stage_left" | "stage_right" | "stage_manager" | string;

export type ShowMembershipRole = DepartmentRole;

export type CueStatus = "standby" | "go";
export type LiveConnectionState = "connecting" | "connected" | "disconnected";
export type LineType = "dialogue" | "stage_direction";

export type LiveEventType =
  | "line.advance"
  | "line.set"
  | "cue.standby"
  | "cue.go"
  | "message.sent"
  | "presence.update"
  | "communications.config";

export interface ScriptLine {
  id: number;
  actNumber: number;
  lineNumber: number;
  character: string;
  text: string;
  lineType?: LineType;
  sceneSeparator?: string;
}

export interface Cue {
  id: string;
  lineId: number;
  anchorGapIndex: number;
  department: DepartmentRole;
  text: string;
  standbyOffsetMs: number;
  goOffsetMs: number;
  diagramUrl?: string;
  anchorWordStart?: number;
  anchorWordEnd?: number;
}

export interface LiveMessage {
  id: string;
  at: string;
  senderRole: DepartmentRole;
  targetRole: DepartmentRole | "all";
  content: string;
  isPreset: boolean;
}

export interface LiveState {
  showId: string;
  liveAccessCode: string;
  currentAct: number;
  currentLineId: number;
  currentWordIndex: number;
  mode: "auto" | "manual";
  showStartedAtMs: number;
  sceneStartedAtMs: number;
  currentSceneKey: string;
  sessionOwnerClientId: string;
}

export interface CommunicationsConfig {
  departments: string[];
  quickMessages: string[];
}

export interface LiveEvent<T = unknown> {
  id: string;
  showId: string;
  at: string;
  type: LiveEventType;
  sourceRole: DepartmentRole;
  targetRoles: Array<DepartmentRole | "all">;
  payload: T;
}

export interface PublishLiveEventInput {
  type: LiveEventType;
  sourceRole: DepartmentRole;
  targetRoles: Array<DepartmentRole | "all">;
  payload: unknown;
}

export interface EditorCue {
  id: string;
  department: DepartmentRole;
  anchorGapIndex: number;
  text: string;
  standbyOffsetMs: number;
  goOffsetMs: number;
  diagramUrl?: string;
}

export interface EditorLine {
  id: string;
  lineNumber: number;
  character: string;
  text: string;
  lineType: LineType;
  sortIndex: number;
  cues: EditorCue[];
}

export interface EditorScene {
  id: string;
  actNumber: number;
  title: string;
  sortIndex: number;
  lines: EditorLine[];
}

export interface EditorAct {
  actNumber: number;
  scenes: EditorScene[];
}

export interface ShowEditorData {
  showId: string;
  title: string;
  revision: string;
  sourceText: string;
  acts: EditorAct[];
}

export type ShowEditorDraft = ShowEditorData;
