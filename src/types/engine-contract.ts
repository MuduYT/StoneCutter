export type EngineId = string;

export type EngineTrackType = "video" | "audio";
export type EngineTrackMode = "video" | "audio" | "av";
export type EngineInterpolation = "linear";

export interface EngineTrack {
  id: EngineId;
  type: EngineTrackType;
  name: string;
  locked: boolean;
  height: number;
  muted?: boolean;
  solo?: boolean;
}

export interface EngineKeyframe {
  id: EngineId;
  time: number;
  value: number;
  interpolation?: EngineInterpolation;
}

export type EngineKeyframeMap = Record<string, EngineKeyframe[]>;

export interface EngineClip {
  id: EngineId;
  videoId: EngineId;
  trackId: EngineId;
  trackMode: EngineTrackMode;
  name: string;
  startTime: number;
  inPoint: number;
  outPoint: number;
  sourceDuration?: number;
  linkGroupId?: EngineId | null;
  keyframes?: EngineKeyframeMap;
  // Forward-compatible for future clip categories.
  kind?: "media" | "text" | "transition";
}

export interface EngineSelectionState {
  clipIds: EngineId[];
  primaryClipId?: EngineId | null;
}

export interface EngineHistoryState {
  past: unknown[];
  future: unknown[];
}

export interface EngineTimelineState {
  fps: number;
  playhead: number;
  tracks: EngineTrack[];
  clips: EngineClip[];
}

export interface EngineState {
  version: number;
  timeline: EngineTimelineState;
  selection: EngineSelectionState;
  history: EngineHistoryState;
}

export interface EngineCommandMeta {
  source?: string;
  timestamp?: number;
}

export interface EngineCommandBase<TType extends string, TPayload> {
  id: EngineId;
  type: TType;
  payload: TPayload;
  meta?: EngineCommandMeta;
}

export type SetPlayheadCommand = EngineCommandBase<
  "timeline.setPlayhead",
  { time: number }
>;

export type AddClipCommand = EngineCommandBase<
  "clip.add",
  { clips: EngineClip[]; ripple?: boolean; resolveOverlaps?: boolean }
>;

export type UpdateClipPropsCommand = EngineCommandBase<
  "clip.updateProps",
  { clipId: EngineId; props: Partial<EngineClip> }
>;

export type MoveClipCommand = EngineCommandBase<
  "clip.move",
  {
    clipIds: EngineId[];
    deltaTime?: number;
    targetTrackId?: EngineId;
    ripple?: boolean;
    resolveOverlaps?: boolean;
    expandLinked?: boolean;
  }
>;

export type TrimLeftCommand = EngineCommandBase<
  "clip.trimLeft",
  {
    clipId: EngineId;
    newStartTime: number;
    newInPoint: number;
    ripple?: boolean;
    expandLinked?: boolean;
  }
>;

export type TrimRightCommand = EngineCommandBase<
  "clip.trimRight",
  {
    clipId: EngineId;
    newOutPoint: number;
    ripple?: boolean;
    expandLinked?: boolean;
  }
>;

export type SplitClipCommand = EngineCommandBase<
  "clip.split",
  { clipId: EngineId; timelineTime: number; linked?: boolean; expandLinked?: boolean }
>;

export type DeleteClipsCommand = EngineCommandBase<
  "clip.delete",
  { clipIds: EngineId[]; ripple?: boolean; expandLinked?: boolean }
>;

export type SetSelectionCommand = EngineCommandBase<
  "selection.set",
  { clipIds: EngineId[]; primaryClipId?: EngineId | null }
>;

export type UndoCommand = EngineCommandBase<"history.undo", Record<string, never>>;
export type RedoCommand = EngineCommandBase<"history.redo", Record<string, never>>;

export type ToggleKeyframeCommand = EngineCommandBase<
  "keyframe.toggle",
  { clipId: EngineId; propertyKey: string; time: number }
>;

export type SetKeyframeCommand = EngineCommandBase<
  "keyframe.set",
  { clipId: EngineId; propertyKey: string; keyframe: EngineKeyframe }
>;

export type RemoveKeyframeCommand = EngineCommandBase<
  "keyframe.remove",
  { clipId: EngineId; propertyKey: string; keyframeId?: EngineId; time?: number }
>;

export type MoveKeyframeCommand = EngineCommandBase<
  "keyframe.move",
  {
    clipId: EngineId;
    propertyKey: string;
    keyframeId: EngineId;
    newTime: number;
  }
>;

export type GroupSetKeyframeCommand = EngineCommandBase<
  "keyframe.groupSet",
  {
    clipId: EngineId;
    groupId: "transform" | "color" | "speed" | "audio";
    time: number;
  }
>;

export type EngineCommand =
  | SetPlayheadCommand
  | AddClipCommand
  | UpdateClipPropsCommand
  | MoveClipCommand
  | TrimLeftCommand
  | TrimRightCommand
  | SplitClipCommand
  | DeleteClipsCommand
  | SetSelectionCommand
  | UndoCommand
  | RedoCommand
  | ToggleKeyframeCommand
  | SetKeyframeCommand
  | RemoveKeyframeCommand
  | MoveKeyframeCommand
  | GroupSetKeyframeCommand;

export interface EnginePatchOperation {
  op: "add" | "remove" | "replace";
  path: string;
  value?: unknown;
}

export interface StateChangedEvent {
  type: "state.changed";
  payload: {
    patch?: EnginePatchOperation[];
    changedClipIds?: EngineId[];
    changedTrackIds?: EngineId[];
  };
}

export interface HistoryChangedEvent {
  type: "history.changed";
  payload: { past: number; future: number };
}

export interface ValidationErrorEvent {
  type: "validation.error";
  payload: { commandId: EngineId; reason: string };
}

export interface WarningEvent {
  type: "warning";
  payload: { commandId: EngineId; message: string };
}

export type EngineEvent =
  | StateChangedEvent
  | HistoryChangedEvent
  | ValidationErrorEvent
  | WarningEvent;

export interface EngineApplyResult {
  state: EngineState;
  events: EngineEvent[];
  commandId?: string;
}

