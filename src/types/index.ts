/**
 * Core type definitions for StoneCutter video editor
 */

export type MediaType = "video" | "audio" | "image";

export interface Media {
  id: string;
  name: string;
  path: string;
  originalPath?: string;
  mediaType: MediaType;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  src?: string;
  proxySrc?: string;
  proxyQuality?: string;
  previewProxies?: Record<string, { proxySrc: string; height: number }>;
  thumbnail?: string;
  audioTracks?: number;
  folderId?: string;
}

export interface MediaFolder {
  id: string;
  name: string;
  createdAt: number;
}

export interface Clip {
  id: string;
  videoId: string;
  trackId: string;
  name: string;
  startTime: number;
  inPoint: number;
  outPoint: number;
  positionX?: number;
  positionY?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  scaleLocked?: boolean;
  rotation?: number;
  opacity?: number;
  flipH?: boolean;
  flipV?: boolean;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  fadeIn?: number;
  fadeOut?: number;
  keyframes?: Record<string, KeyframeTrack>;
  linkedClipId?: string;
  linkGroupId?: string;
}

export interface KeyframeTrack {
  id: string;
  propertyKey: string;
  keyframes: Keyframe[];
}

export interface Keyframe {
  id: string;
  time: number;
  value: number | string | boolean;
  easing?: "linear" | "ease-in" | "ease-out" | "ease-in-out";
}

export interface Track {
  id: string;
  type: "video" | "audio";
  name: string;
  height: number;
  locked: boolean;
  muted: boolean;
  solo: boolean;
}

export interface Settings {
  imageDuration: number;
  previewQuality: "full" | "half" | "quarter" | "eighth";
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  modifiedAt: number;
  fps: number;
  aspectRatio: "16:9" | "9:16";
  tracks: Track[];
  clips: Clip[];
  media: Media[];
  folders: MediaFolder[];
  settings: Settings;
}

export interface Interaction {
  type: string;
  clipId?: string;
  startX?: number;
  startY?: number;
  startClientX?: number;
  startClientY?: number;
  moved?: boolean;
  snapshotBefore?: Clip[];
  tracksBefore?: Track[];
  historyBefore?: Project;
}

export interface HistorySnapshot {
  clips: Clip[];
  tracks: Track[];
  settings: Settings;
}

export interface TimelineVisualLayer {
  clip: Clip;
  media: Media;
}

export interface TimelineAudioLayer {
  clip: Clip;
  media: Media;
}

export * from "./engine-contract";
