/* eslint-disable react-hooks/refs */
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import logoUrl from "../media/Logo/StoneCutter-Logo.png";
import "./App.css";
import { InspectorPanel } from "./components/inspector/InspectorPanel.jsx";
import { Timeline } from "./components/Timeline.jsx";
import { MediaPanel } from "./components/MediaPanel.jsx";
import {
  SNAP_THRESHOLD_PX,
  MOVE_THRESHOLD_PX,
  MIN_CLIP_DURATION,
  AUDIO_EXTS,
  IMAGE_EXTS,
  VIDEO_EXTS,
  getMediaType,
  normalizeSourceSelection,
  constrainMoveStart,
  minStartForTrimLeft,
  maxEndForTrimRight,
  detectInsertPoint,
  applyRippleInsert,
  findGapAtTime,
  findTimelineSpaceAtTime,
  closeGap,
  rippleDeleteClips,
  resolveOverlaps,
  resolveOverlapsMulti,
  splitMediaIntoLinkedClips,
  expandWithLinkedPartners,
  applyGroupTrimLeft,
  applyGroupTrimRight,
  applyGroupSplit,
  unlinkClipGroup,
  nextLinkGroupId,
} from "./lib/timeline.js";
import {
  nextTrackId,
  createDefaultTracks,
  addTrack as addTrackToList,
  removeTrack as removeTrackFromList,
  updateTrack as updateTrackInList,
  insertTrackOrdered,
  getTrackIdAtTimelineY,
  createAutoTrackForMove,
  getCollisionFreeTrackForClip,
  planTrackMove,
  applyTrackMovePlan,
  DEFAULT_TRACK_HEIGHT,
} from "./lib/trackStore.js";
import { buildExportSegments } from "./lib/exportSegments.js";
import { filterAndSortMedia } from "./lib/mediaBin.js";
import {
  buildProjectDocument,
  createEmptyProjectState,
  hydrateProjectState,
  resolveProjectMediaPath,
  sanitizeProjectName,
} from "./lib/project.js";
import {
  buildTimelinePlaybackLookups,
  findClipAtTime,
  getTopVisibleTimelineClip,
  getTimelineAudibleClips,
  getTimelineContentEnd,
  getTimelineVisualClips,
  getVirtualTimelinePlaybackTime,
} from "./lib/playback.js";
import {
  FOCUS_SOURCE,
  FOCUS_TIMELINE,
  clampSourceRange,
  clampSourceTime,
  isSourceMonitorVisible,
  stepSourcePreviewTime,
  timeFromClientX,
} from "./lib/sourceMonitor.js";
import {
  buildThumbnailItems,
  buildWaveformBars,
  getVisibleTimelineRange,
  groupVisibleClipsByTrack,
} from "./lib/timelineRender.js";

const isTauri = "__TAURI_INTERNALS__" in window;
const isDevMode = import.meta.env.DEV;
const RECENT_PROJECTS_KEY = "stonecutter.recentProjects";
const PROJECT_FILTER = [
  { name: "StoneCutter Project", extensions: ["stonecutter"] },
];
const MEDIA_EXTS = [...VIDEO_EXTS, ...AUDIO_EXTS, ...IMAGE_EXTS];
const MEDIA_ACCEPT = "video/*,audio/*,image/*";
const TIMELINE_MEDIA_SEEK_GRACE_MS = 50;
const TIMELINE_MEDIA_SEEK_TIMEOUT_MS = 350;
const TIMELINE_STATE_FPS = 60;
const TIMELINE_LAYER_BOUNDARY_EPSILON = 0.015;
const TIMELINE_PLAYING_VIDEO_DRIFT_TOLERANCE = 0.22;
const TIMELINE_PLAYING_AUDIO_DRIFT_TOLERANCE = 0.05;
const TIMELINE_PAUSED_DRIFT_TOLERANCE = 0.02;

let _idCounter = 0;
const nextId = (prefix) => `${prefix}-${++_idCounter}`;

const getFileMediaType = (file) => {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  return getMediaType(file.name);
};

const isImportableMediaFile = (file) => {
  if (
    file.type.startsWith("video/") ||
    file.type.startsWith("audio/") ||
    file.type.startsWith("image/")
  )
    return true;
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  return MEDIA_EXTS.includes(ext);
};

async function openMediaDialog() {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  const selected = await open({
    multiple: true,
    filters: [
      { name: "Medien", extensions: MEDIA_EXTS },
      { name: "Videos", extensions: VIDEO_EXTS },
      { name: "Audio", extensions: AUDIO_EXTS },
      { name: "Bilder", extensions: IMAGE_EXTS },
      { name: "Alle Dateien", extensions: ["*"] },
    ],
  });
  if (!selected) return [];
  const paths = Array.isArray(selected) ? selected : [selected];
  return paths.map((p) => {
    const name = p.split(/[\\/]/).pop() || p;
    return {
      id: nextId("vid"),
      name,
      path: p,
      src: convertFileSrc(p),
      mediaType: getMediaType(name),
      importedAt: new Date().toISOString(),
    };
  });
}

function probeDuration(src, mediaType = "video", defaultImageDuration = 3) {
  if (mediaType === "image") return Promise.resolve(defaultImageDuration);
  return new Promise((resolve) => {
    const v = document.createElement(mediaType === "audio" ? "audio" : "video");
    v.preload = "metadata";
    v.muted = true;
    const cleanup = () => {
      v.onloadedmetadata = null;
      v.onerror = null;
      v.src = "";
    };
    v.onloadedmetadata = () => {
      const d = isFinite(v.duration) && v.duration > 0 ? v.duration : 5;
      cleanup();
      resolve(d);
    };
    v.onerror = () => {
      cleanup();
      resolve(5);
    };
    v.src = src;
  });
}

async function generateImageThumbnails(src, count = 12) {
  // For images: return the same src multiple times (rendered as a strip).
  return Array(count).fill(src);
}

async function generateThumbnails(src, count = 12) {
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.crossOrigin = "anonymous";
  v.playsInline = true;
  v.src = src;
  const ok = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 5000);
    v.onloadedmetadata = () => {
      clearTimeout(t);
      resolve(true);
    };
    v.onerror = () => {
      clearTimeout(t);
      resolve(false);
    };
  });
  if (!ok || !v.duration || !isFinite(v.duration)) {
    v.src = "";
    return [];
  }
  const dur = v.duration;
  const aspect =
    v.videoWidth && v.videoHeight ? v.videoHeight / v.videoWidth : 9 / 16;
  const tw = 120;
  const th = Math.max(40, Math.round(tw * aspect));
  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d");
  const thumbs = [];
  for (let i = 0; i < count; i++) {
    const targetT = ((i + 0.5) / count) * dur;
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        v.onseeked = null;
        resolve();
      }, 2000);
      v.onseeked = () => {
        clearTimeout(timer);
        v.onseeked = null;
        resolve();
      };
      try {
        v.currentTime = Math.min(dur - 0.05, Math.max(0, targetT));
      } catch {
        /* ignored */
      }
    });
    try {
      ctx.drawImage(v, 0, 0, tw, th);
      thumbs.push(canvas.toDataURL("image/jpeg", 0.55));
    } catch {
      thumbs.push(null);
    }
  }
  v.src = "";
  return thumbs;
}

async function generateWaveform(src, samples = 200) {
  try {
    const response = await fetch(src);
    const arrayBuffer = await response.arrayBuffer();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    const audioCtx = new AudioCtx();
    const audioBuffer = await audioCtx
      .decodeAudioData(arrayBuffer)
      .catch(() => null);
    if (!audioBuffer) {
      audioCtx.close();
      return null;
    }
    const channels = [];
    for (let ch = 0; ch < Math.min(audioBuffer.numberOfChannels, 2); ch++) {
      channels.push(audioBuffer.getChannelData(ch));
    }
    const length = channels[0].length;
    const blockSize = Math.max(1, Math.floor(length / samples));
    const peaks = [];
    for (let i = 0; i < samples; i++) {
      let max = 0;
      const start = i * blockSize;
      const end = Math.min(start + blockSize, length);
      for (let j = start; j < end; j++) {
        let v = 0;
        for (const c of channels) {
          const s = Math.abs(c[j] || 0);
          if (s > v) v = s;
        }
        if (v > max) max = v;
      }
      peaks.push(max);
    }
    audioCtx.close();
    return peaks;
  } catch {
    return null;
  }
}

function formatTC(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const tenths = Math.floor((s % 1) * 10);
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}.${tenths}`;
}

function formatTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// SVG Icons (no external deps)
const Icon = {
  Play: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  ),
  Pause: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  ),
  SkipStart: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M6 6h2v12H6zM9.5 12l8.5 6V6z" />
    </svg>
  ),
  SkipEnd: () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z" />
    </svg>
  ),
  StepBack: () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M15.5 6L7 12l8.5 6V6z" />
    </svg>
  ),
  StepFwd: () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M8.5 6L17 12l-8.5 6V6z" />
    </svg>
  ),
  Magnet: () => (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M5 3v8a7 7 0 0 0 14 0V3h-4v8a3 3 0 0 1-6 0V3zM5 3h4M15 3h4" />
    </svg>
  ),
  Volume: () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z" />
    </svg>
  ),
  Mute: () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M16.5 12A4.5 4.5 0 0 0 14 8v2.18l2.45 2.45c.03-.2.05-.41.05-.63zM3 9v6h4l5 5v-6.18L7.83 9H3zm15.6 9.27L19.73 19.4 12 11.67V20l-5-5H3V9h2.27L1.73 5.46l1.27-1.27L18.6 18.27z" />
    </svg>
  ),
  Plus: () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z" />
    </svg>
  ),
  Trash: () => (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
      <path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zm2.46-7.12l1.41-1.41L12 12.59l2.12-2.12 1.41 1.41L13.41 14l2.12 2.12-1.41 1.41L12 15.41l-2.12 2.12-1.41-1.41L10.59 14zM15.5 4l-1-1h-5l-1 1H5v2h14V4z" />
    </svg>
  ),
  Cut: () => (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  ),
  Undo: () => (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13" />
    </svg>
  ),
  Redo: () => (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M21 7v6h-6M3 17a9 9 0 0 1 15-6.7L21 13" />
    </svg>
  ),
  Settings: () => (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  Image: () => (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  ),
  Export: () => (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  Save: () => (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  ),
  FolderOpen: () => (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v2" />
      <path d="M3 9h18l-2 10H5z" />
    </svg>
  ),
  File: () => (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  VideoTrack: () => (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 5v14M17 5v14M3 10h18M3 14h18" />
    </svg>
  ),
  AudioTrack: () => (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M4 12v2M8 8v8M12 5v14M16 8v8M20 11v2" />
    </svg>
  ),
};

// ─── Nav-bar icon components for Screendesign layout ───────────────────────
const NavIcon = {
  Media: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
    </svg>
  ),
  Effects: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
    </svg>
  ),
  Transitions: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  ),
  Text: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  ),
  Audio: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
    </svg>
  ),
  ExportNav: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ),
  Elements: () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  ),
};

function App() {
  const videoRef = useRef(null);
  const timelineVisualRefs = useRef(new Map());
  const timelineAudioRefs = useRef(new Map());
  const fileRef = useRef(null);
  const tracksContentRef = useRef(null);
  const pendingSeekRef = useRef(null);
  const pendingPlayRef = useRef(false); // play after src change + metadata
  const historyRef = useRef({ past: [], future: [] });
  const inspectorEditTimerRef = useRef(0);
  const interactionRef = useRef(null);
  const playbackRef = useRef({
    clips: [],
    activeClipId: null,
    activeId: null,
    isPlaying: false,
    videos: [],
    timelineTime: 0,
  });
  const playbackModeRef = useRef(null); // "timeline" | "source" | null
  const playingClipIdRef = useRef(null); // tracks current clip for playback engine — never touches user selection
  const imagePlaybackRef = useRef(null); // virtual playback clock for still-image clips
  const timelinePlaybackRef = useRef(null); // virtual clock for empty sequence/gap playback
  const timelinePlaybackStartTokenRef = useRef(0);
  const timelineSeekGraceUntilRef = useRef(0);
  const timelineMediaSeekPromisesRef = useRef(new WeakMap());
  const timelineTimeRef = useRef(0);
  const timelinePlayheadRefs = useRef([]);
  const timelineLastStateUpdateRef = useRef(0);
  const activeTimelineLayersRef = useRef({
    key: "",
    visualLayers: [],
    audioLayers: [],
    nextBoundary: Number.MAX_SAFE_INTEGER,
  });
  const mediaAnalysisRef = useRef({
    waveformStarted: new Set(),
    thumbnailStarted: new Set(),
    cancelled: false,
  });
  const browserObjectUrlsRef = useRef(new Set());
  const clipboardRef = useRef([]); // copied clips (with relative startTimes)
  const volumeLineDragRef = useRef(null); // { clipId, startY, startVolume, trackHeight }
  const fadeDragRef = useRef(null); // { clipId, side:'in'|'out', startX, startFade, dur, pxPerSec }
  const [volTooltip, setVolTooltip] = useState(null); // { x, y, vol } — shown while dragging vol line

  const [isPlaying, setIsPlaying] = useState(false);
  const [videos, setVideos] = useState([]);
  const [mediaSearch, setMediaSearch] = useState("");
  const [mediaTypeFilter, setMediaTypeFilter] = useState("all");
  const [mediaSort, setMediaSort] = useState("importedAt");
  const [activeId, setActiveId] = useState(null);
  const [clips, setClips] = useState([]);
  const [activeClipId, setActiveClipId] = useState(null);
  const [timelineTime, setTimelineTime] = useState(0);
  const [visibleTimelineRange, setVisibleTimelineRange] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [dropIndicatorTime, setDropIndicatorTime] = useState(null);
  const [snapIndicatorTime, setSnapIndicatorTime] = useState(null);
  const [interaction, setInteraction] = useState(null);
  const [pxPerSec, setPxPerSec] = useState(40);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [historySizes, setHistorySizes] = useState({ past: 0, future: 0 });
  const [peaksMap, setPeaksMap] = useState({}); // videoId -> peaks[] (or null while loading)
  const [thumbsMap, setThumbsMap] = useState({}); // videoId -> dataURL[] (or null while loading)
  const [videoDurations, setVideoDurations] = useState({}); // videoId -> seconds (probed once after import)
  const [sourceRanges, setSourceRanges] = useState({}); // videoId -> { inPoint, outPoint } for source preview drags
  const [sourceMonitorId, setSourceMonitorId] = useState(null); // only set by explicit video clicks in the media library
  const [editorFocus, setEditorFocus] = useState(FOCUS_SOURCE);
  const [contextMenu, setContextMenu] = useState(null); // {x, y, clipId}
  const [scrubTooltip, setScrubTooltip] = useState(null); // {x, time} during seek drag
  const [selectedGap, setSelectedGap] = useState(null); // { start, end }
  const [selectedClipIds, setSelectedClipIds] = useState(() => new Set());
  const [marqueeBox, setMarqueeBox] = useState(null); // { x1, y1, x2, y2 } in tracks-content px
  const [importDragInfo, setImportDragInfo] = useState(null); // { videoId, name, dur, insertPoint, mode, simulatedLayout }
  const [trackMovePreview, setTrackMovePreview] = useState(null); // { targetTrackIds, autoTracks } during timeline clip moves
  const draggedVideoIdRef = useRef(null);
  const draggedTrackModeRef = useRef("av"); // "av" = video with audio, "audio" = audio-only
  const draggedUseSourceRangeRef = useRef(false);
  const sourceTrimDragRef = useRef(null);
  const sourceSeekDragRef = useRef(null);
  const [dragTooltip, setDragTooltip] = useState(null); // { x, y, label }
  const [tracks, setTracks] = useState(() => createDefaultTracks());
  const trackHeadersListRef = useRef(null);
  const [editingTrackId, setEditingTrackId] = useState(null);
  const [dropTargetTrackId, setDropTargetTrackId] = useState(null);
  const [dropZoneTrackMode, setDropZoneTrackMode] = useState("av");

  // --- Settings (persisted in localStorage) ---
  const loadSettings = useCallback(() => {
    try {
      const raw = localStorage.getItem("stonecutter.settings");
      if (raw) {
        try {
          return { imageDuration: 3, ...JSON.parse(raw) };
        } catch (e) {
          console.error("Error parsing settings:", e);
          return { imageDuration: 3 };
        }
      }
    } catch (e) {
      console.error("Error loading settings:", e);
    }
    return { imageDuration: 3 };
  }, []);

  const [settings, setSettings] = useState(loadSettings());
  const [showSettings, setShowSettings] = useState(false);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [showExport, setShowExport] = useState(false);
  const [exportQuality, setExportQuality] = useState("medium");
  const [exportStatus, setExportStatus] = useState(null); // null | 'running' | { ok, msg }
  const [exportProgress, setExportProgress] = useState({
    progress: 0,
    seconds: 0,
    phase: "idle",
  });
  const [previewTime, setPreviewTime] = useState(0);
  const [playbackMode, setPlaybackMode] = useState(null); // "timeline" | "source" | null
  const [currentProject, setCurrentProject] = useState(null); // { name, path, directory }
  const [showProjectStart, setShowProjectStart] = useState(true);
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState("Untitled Project");
  const [projectStatus, setProjectStatus] = useState(null);
  const [isProjectDirty, setIsProjectDirty] = useState(false);
  const [perfStats, setPerfStats] = useState(null);
  const [recentProjects, setRecentProjects] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_PROJECTS_KEY) || "[]");
    } catch {
      return [];
    }
  });
  const projectHydratingRef = useRef(false);

  // --- UI Redesign state ---
  const [inspectorTab, setInspectorTab] = useState("inspector"); // "inspector" | "effects" | "history"
  const [sidebarTab, setSidebarTab] = useState("media"); // "media" | "audio" | "text" | "effects" | "transitions" | "elements"
  const [editingProjectName, setEditingProjectName] = useState(false);

  const revokeBrowserObjectUrls = useCallback((items) => {
    for (const item of items || []) {
      if (typeof item?.src === "string" && item.src.startsWith("blob:")) {
        URL.revokeObjectURL(item.src);
        browserObjectUrlsRef.current.delete(item.src);
      }
    }
  }, []);

  useEffect(() => {
    const urls = browserObjectUrlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const persistRecentProjects = useCallback((items) => {
    setRecentProjects(items);
    try {
      localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(items));
    } catch {
      /* ignored */
    }
  }, []);

  const rememberProject = useCallback(
    (project) => {
      if (!project?.path) return;
      const entry = {
        name: project.name || "Untitled Project",
        path: project.path,
        directory: project.directory || "",
        openedAt: new Date().toISOString(),
      };
      const next = [
        entry,
        ...recentProjects.filter((item) => item.path !== entry.path),
      ].slice(0, 8);
      persistRecentProjects(next);
    },
    [persistRecentProjects, recentProjects],
  );

  const getProjectSnapshot = useCallback(
    (name = currentProject?.name || newProjectName) =>
      buildProjectDocument({
        name,
        videos,
        clips,
        sourceRanges,
        videoDurations,
        tracks,
        timelineTime,
        settings,
        aspectRatio,
        pxPerSec,
        snapEnabled,
        volume,
        muted,
      }),
    [
      aspectRatio,
      clips,
      currentProject?.name,
      muted,
      newProjectName,
      pxPerSec,
      settings,
      snapEnabled,
      sourceRanges,
      timelineTime,
      tracks,
      videoDurations,
      videos,
      volume,
    ],
  );

  const applyProjectState = useCallback(
    (state, projectInfo) => {
      projectHydratingRef.current = true;
      revokeBrowserObjectUrls(videos);
      setVideos(state.videos);
      setClips(state.clips);
      setSourceRanges(state.sourceRanges);
      setVideoDurations(state.videoDurations);
      setTracks(state.tracks);
      setPeaksMap({});
      setThumbsMap({});
      mediaAnalysisRef.current.waveformStarted = new Set();
      mediaAnalysisRef.current.thumbnailStarted = new Set();
      timelineTimeRef.current = state.timelineTime;
      setTimelineTime(state.timelineTime);
      setSettings((prev) => ({ ...prev, ...state.settings }));
      setAspectRatio(state.ui.aspectRatio);
      setPxPerSec(state.ui.pxPerSec);
      setSnapEnabled(state.ui.snapEnabled);
      setVolume(state.ui.volume);
      setMuted(state.ui.muted);
      setActiveId(state.videos[0]?.id || null);
      setSourceMonitorId(null);
      setEditorFocus(FOCUS_SOURCE);
      setActiveClipId(null);
      setSelectedClipIds(new Set());
      setSelectedGap(null);
      setShowProjectStart(false);
      setCurrentProject(projectInfo);
      setIsProjectDirty(false);
      historyRef.current = { past: [], future: [] };
      setHistorySizes({ past: 0, future: 0 });
      setTimeout(() => {
        projectHydratingRef.current = false;
      }, 0);
    },
    [revokeBrowserObjectUrls, setSettings, videos],
  );

  const handleCreateProject = useCallback(async () => {
    if (!isTauri) {
      const name = sanitizeProjectName(newProjectName);
      applyProjectState(createEmptyProjectState(name), {
        name,
        path: "",
        directory: "",
      });
      setShowNewProjectDialog(false);
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { invoke } = await import("@tauri-apps/api/core");
      const parentDir = await open({
        directory: true,
        multiple: false,
        title: "Projektordner-Speicherort waehlen",
      });
      if (!parentDir) return;
      const name = sanitizeProjectName(newProjectName);
      const document = JSON.stringify(
        buildProjectDocument(createEmptyProjectState(name)),
        null,
        2,
      );
      const info = await invoke("create_project_folder", {
        parentDir,
        projectName: name,
        document,
      });
      applyProjectState(createEmptyProjectState(info.name), info);
      rememberProject(info);
      setShowNewProjectDialog(false);
      setProjectStatus({ ok: true, msg: `Projekt angelegt: ${info.name}` });
    } catch (err) {
      setProjectStatus({ ok: false, msg: String(err) });
    }
  }, [applyProjectState, newProjectName, rememberProject]);

  const openProjectPath = useCallback(
    async (path) => {
      if (!isTauri || !path) return;
      try {
        const { invoke, convertFileSrc } = await import("@tauri-apps/api/core");
        const raw = await invoke("load_project_file", { projectPath: path });
        const directory = path.replace(/[\\/][^\\/]+$/, "");
        const state = hydrateProjectState(raw, {
          resolveMediaPath: (mediaPath) =>
            resolveProjectMediaPath(directory, mediaPath),
          convertFileSrc,
        });
        const projectInfo = { name: state.name, path, directory };
        applyProjectState(state, projectInfo);
        rememberProject(projectInfo);
        setProjectStatus({ ok: true, msg: `Projekt geoeffnet: ${state.name}` });
      } catch (err) {
        setProjectStatus({ ok: false, msg: String(err) });
      }
    },
    [applyProjectState, rememberProject],
  );

  const handleOpenProject = useCallback(async () => {
    if (!isTauri) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ multiple: false, filters: PROJECT_FILTER });
      if (selected) await openProjectPath(selected);
    } catch (err) {
      setProjectStatus({ ok: false, msg: String(err) });
    }
  }, [openProjectPath]);

  const saveCurrentProject = useCallback(async () => {
    if (!currentProject?.path || !isTauri) {
      setProjectStatus({ ok: false, msg: "Kein gespeichertes Projekt aktiv." });
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const document = JSON.stringify(
        getProjectSnapshot(currentProject.name),
        null,
        2,
      );
      await invoke("save_project_file", {
        projectPath: currentProject.path,
        document,
      });
      setIsProjectDirty(false);
      rememberProject(currentProject);
      setProjectStatus({ ok: true, msg: "Projekt gespeichert." });
    } catch (err) {
      setProjectStatus({ ok: false, msg: String(err) });
    }
  }, [currentProject, getProjectSnapshot, rememberProject]);

  useEffect(() => {
    if (!currentProject || projectHydratingRef.current) return;
    setIsProjectDirty(true);
  }, [
    aspectRatio,
    clips,
    currentProject,
    muted,
    pxPerSec,
    settings,
    snapEnabled,
    sourceRanges,
    tracks,
    videoDurations,
    videos,
    volume,
  ]);

  useEffect(() => {
    if (!isTauri) return undefined;
    let unlisten = null;
    let disposed = false;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("export-progress", (event) => {
          if (disposed || !event.payload) return;
          const payload = event.payload;
          setExportProgress({
            progress: Math.max(0, Math.min(1, Number(payload.progress) || 0)),
            seconds: Math.max(0, Number(payload.seconds) || 0),
            phase: String(payload.phase || "render"),
          });
        }),
      )
      .then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      })
      .catch((err) => console.error('Tauri event listener error:', err));
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    if (!isDevMode) return undefined;
    let raf = 0;
    let frames = 0;
    let last = performance.now();
    const tick = () => {
      frames += 1;
      const now = performance.now();
      if (now - last >= 1000) {
        const memory = performance.memory
          ? Math.round(performance.memory.usedJSHeapSize / 1024 / 1024)
          : null;
        setPerfStats({
          fps: Math.round((frames * 1000) / (now - last)),
          visualNodes: timelineVisualRefs.current.size,
          audioNodes: timelineAudioRefs.current.size,
          memory,
        });
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleExport = async () => {
    if (!isTauri) return;
    const exportPlan = buildExportSegments({ clips, videos, tracks });
    if (!exportPlan.ok) {
      setExportStatus({ ok: false, msg: exportPlan.error });
      return;
    }
    const { segments } = exportPlan;

    const qualityMap = {
      low: { crf: 28, preset: "veryfast" },
      medium: { crf: 23, preset: "fast" },
      high: { crf: 18, preset: "slow" },
    };
    const { crf, preset } = qualityMap[exportQuality];
    const [w, h] = aspectRatio === "9:16" ? [1080, 1920] : [1920, 1080];

    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const outputPath = await save({
        defaultPath: "export.mp4",
        filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
      });
      if (!outputPath) return;

      setExportProgress({ progress: 0, seconds: 0, phase: "render_audio_video" });
      setExportStatus("running");
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke("export_video_progress", {
        segments,
        outputPath,
        width: w,
        height: h,
        crf,
        preset,
      });

      const noAudio =
        typeof result === "string" && result.includes("|no_audio");
      setExportStatus({
        ok: true,
        msg: noAudio
          ? "Export erfolgreich (kein Audiotrack in den Quellen – stilles Video)."
          : "Export erfolgreich!",
      });
      setExportProgress({ progress: 1, seconds: totalEnd, phase: "done" });
    } catch (err) {
      setExportStatus({ ok: false, msg: String(err) });
    }
  };

  const handleCancelExport = async () => {
    if (!isTauri) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("cancel_export");
    } catch (err) {
      setExportStatus({ ok: false, msg: String(err) });
    }
  };
  useEffect(() => {
    try {
      localStorage.setItem("stonecutter.settings", JSON.stringify(settings));
    } catch {
      /* ignored */
    }
  }, [settings]);

  useEffect(() => {
    playbackModeRef.current = playbackMode;
  }, [playbackMode]);

  useEffect(() => {
    if (!projectStatus) return;
    const clearTimer = window.setTimeout(() => setProjectStatus(null), 1500);
    return () => {
      window.clearTimeout(clearTimer);
    };
  }, [projectStatus]);

  const activeVideo = videos.find((v) => v.id === activeId);
  const visibleVideos = useMemo(
    () =>
      filterAndSortMedia(videos, {
        query: mediaSearch,
        typeFilter: mediaTypeFilter,
        sortBy: mediaSort,
        durations: videoDurations,
      }),
    [videos, mediaSearch, mediaTypeFilter, mediaSort, videoDurations],
  );
  const videoSrc = activeVideo?.src || "";
  const activeClip = clips.find((c) => c.id === activeClipId);
  const activeTrack = tracks.find((t) => t.id === activeClip?.trackId);

  const getSourceSelection = useCallback(
    (mediaOrId) => {
      const media =
        typeof mediaOrId === "string"
          ? videos.find((v) => v.id === mediaOrId)
          : mediaOrId;
      return normalizeSourceSelection({
        media,
        probedDuration: media ? videoDurations[media.id] : null,
        savedRange: media ? sourceRanges[media.id] : null,
        defaultImageDuration: settings.imageDuration,
      });
    },
    [settings.imageDuration, sourceRanges, videoDurations, videos],
  );

  const getFullMediaSelection = useCallback(
    (mediaOrId) => {
      const media =
        typeof mediaOrId === "string"
          ? videos.find((v) => v.id === mediaOrId)
          : mediaOrId;
      const fallbackDuration =
        media?.mediaType === "image" ? settings.imageDuration : 5;
      const duration = Math.max(
        MIN_CLIP_DURATION,
        media ? videoDurations[media.id] || fallbackDuration : fallbackDuration,
      );
      return {
        inPoint: 0,
        outPoint: duration,
        duration,
        clipDuration: duration,
      };
    },
    [settings.imageDuration, videoDurations, videos],
  );

  const activeSourceSelection = activeVideo
    ? getSourceSelection(activeVideo)
    : null;
  const isSourceMonitorActive =
    isSourceMonitorVisible({ media: activeVideo, sourceMonitorId }) &&
    activeSourceSelection;
  const timelinePlaybackLookups = useMemo(
    () => buildTimelinePlaybackLookups({ tracks, videos }),
    [tracks, videos],
  );
  const timelineVisualLayers = useMemo(
    () =>
      getTimelineVisualClips({
        time: timelineTime,
        clips,
        lookups: timelinePlaybackLookups,
      }),
    [clips, timelinePlaybackLookups, timelineTime],
  );
  const timelineAudioLayers = useMemo(
    () =>
      getTimelineAudibleClips({
        time: timelineTime,
        clips,
        lookups: timelinePlaybackLookups,
      }),
    [clips, timelinePlaybackLookups, timelineTime],
  );
  const isTimelineMonitorActive =
    !isSourceMonitorActive &&
    (editorFocus === FOCUS_TIMELINE || playbackMode === "timeline");
  const topTimelineClip = useMemo(
    () =>
      getTopVisibleTimelineClip({
        time: timelineTime,
        clips,
        lookups: timelinePlaybackLookups,
      }),
    [clips, timelinePlaybackLookups, timelineTime],
  );

  const updateSourceRange = useCallback(
    (videoId, patch) => {
      const media = videos.find((v) => v.id === videoId);
      if (!media) return;
      const current = getSourceSelection(media);
      const { inPoint: nextIn, outPoint: nextOut } = clampSourceRange({
        duration: current.duration,
        currentRange: current,
        patch,
      });

      setSourceRanges((prev) => ({
        ...prev,
        [videoId]: { inPoint: nextIn, outPoint: nextOut },
      }));
      if (
        videoId === activeId &&
        videoRef.current &&
        media.mediaType === "video"
      ) {
        try {
          videoRef.current.currentTime =
            patch.outPoint != null ? nextOut : nextIn;
        } catch {
          /* ignored */
        }
        setPreviewTime(patch.outPoint != null ? nextOut : nextIn);
      }
    },
    [activeId, getSourceSelection, videos],
  );

  const sourceTimeFromClientX = useCallback((clientX) => {
    const drag = sourceTrimDragRef.current;
    if (!drag) return 0;
    return timeFromClientX({
      clientX,
      rect: drag.rect,
      duration: drag.selection.duration,
    });
  }, []);

  const sourceTimelineTimeFromClientX = useCallback((clientX) => {
    const drag = sourceSeekDragRef.current;
    if (!drag) return 0;
    return timeFromClientX({
      clientX,
      rect: drag.rect,
      duration: drag.duration,
    });
  }, []);

  const seekSourcePreviewTo = useCallback(
    (time) => {
      if (
        !activeVideo ||
        activeVideo.mediaType !== "video" ||
        !activeSourceSelection
      )
        return;
      setEditorFocus(FOCUS_SOURCE);
      const next = clampSourceTime(time, activeSourceSelection.duration);
      setPreviewTime(next);
      if (videoRef.current && activeId === activeVideo.id) {
        try {
          videoRef.current.currentTime = next;
        } catch {
          /* ignored */
        }
      } else {
        setActiveId(activeVideo.id);
        pendingSeekRef.current = next;
        pendingPlayRef.current = false;
      }
    },
    [activeId, activeSourceSelection, activeVideo],
  );

  const beginSourcePreviewSeek = useCallback(
    (e) => {
      if (
        !activeVideo ||
        activeVideo.mediaType !== "video" ||
        !activeSourceSelection
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      sourceSeekDragRef.current = {
        rect,
        duration: activeSourceSelection.duration,
      };
      seekSourcePreviewTo(
        timeFromClientX({
          clientX: e.clientX,
          rect,
          duration: activeSourceSelection.duration,
        }),
      );
    },
    [activeSourceSelection, activeVideo, seekSourcePreviewTo],
  );

  const beginSourceTimelineDrag = useCallback(
    (e, edge) => {
      if (
        !activeVideo ||
        !activeSourceSelection ||
        activeVideo.mediaType !== "video"
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      const timelineEl =
        e.currentTarget.closest(".source-preview-timeline") || e.currentTarget;
      const rect = timelineEl.getBoundingClientRect();
      const clickTime = timeFromClientX({
        clientX: e.clientX,
        rect,
        duration: activeSourceSelection.duration,
      });
      const inferredEdge =
        edge ||
        (Math.abs(clickTime - activeSourceSelection.inPoint) <=
        Math.abs(clickTime - activeSourceSelection.outPoint)
          ? "inPoint"
          : "outPoint");

      sourceTrimDragRef.current = {
        videoId: activeVideo.id,
        edge: inferredEdge,
        rect,
        selection: activeSourceSelection,
      };
      updateSourceRange(activeVideo.id, { [inferredEdge]: clickTime });
    },
    [activeSourceSelection, activeVideo, updateSourceRange],
  );

  const setSourcePointAtPreviewTime = useCallback(
    (edge) => {
      if (
        !activeVideo ||
        activeVideo.mediaType !== "video" ||
        !activeSourceSelection
      )
        return;
      const time = clampSourceTime(previewTime, activeSourceSelection.duration);
      updateSourceRange(activeVideo.id, { [edge]: time });
    },
    [activeSourceSelection, activeVideo, previewTime, updateSourceRange],
  );

  useEffect(() => {
    const onMove = (e) => {
      const drag = sourceTrimDragRef.current;
      if (drag) {
        updateSourceRange(drag.videoId, {
          [drag.edge]: sourceTimeFromClientX(e.clientX),
        });
      }
      if (sourceSeekDragRef.current) {
        seekSourcePreviewTo(sourceTimelineTimeFromClientX(e.clientX));
      }
    };
    const onUp = () => {
      sourceTrimDragRef.current = null;
      sourceSeekDragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [
    seekSourcePreviewTo,
    sourceTimeFromClientX,
    sourceTimelineTimeFromClientX,
    updateSourceRange,
  ]);

  // While the user is dragging from the sidebar, render the simulated layout instead of the real clips.
  const displayClips = useMemo(() => {
    const raw = importDragInfo?.simulatedLayout || clips;
    const defaultVideoTrackId = tracks.find((t) => t.type === "video")?.id;
    const defaultAudioTrackId = tracks.find((t) => t.type === "audio")?.id;
    // Migrate legacy clips without trackId based on trackMode
    return raw.map((c) => {
      if (c.trackId) return c;
      const targetTrackId =
        c.trackMode === "audio" ? defaultAudioTrackId : defaultVideoTrackId;
      return { ...c, trackId: targetTrackId };
    });
  }, [importDragInfo?.simulatedLayout, clips, tracks]);

  // Track which clips are currently being dragged → used for `.dragging` CSS class (z-index lift)
  const draggingIds = useMemo(() => {
    if (!interaction) return null;
    if (
      interaction.type !== "move" &&
      interaction.type !== "trim-left" &&
      interaction.type !== "trim-right"
    )
      return null;
    if (interaction.selectedSnaps)
      return new Set(interaction.selectedSnaps.map((s) => s.id));
    if (interaction.clipId) return new Set([interaction.clipId]);
    return null;
  }, [interaction]);
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const totalEnd = useMemo(
    () => getTimelineContentEnd(displayClips),
    [displayClips],
  );
  const forcedVisibleClipIds = useMemo(() => {
    const ids = new Set();
    if (activeClipId) ids.add(activeClipId);
    selectedClipIds.forEach((id) => ids.add(id));
    draggingIds?.forEach((id) => ids.add(id));
    return ids;
  }, [activeClipId, draggingIds, selectedClipIds]);
  const clipsByTrack = useMemo(
    () =>
      groupVisibleClipsByTrack({
        clips: displayClips,
        visibleRange: visibleTimelineRange,
        includeIds: forcedVisibleClipIds,
      }),
    [displayClips, forcedVisibleClipIds, visibleTimelineRange],
  );
  const totalWidth = Math.max(
    800,
    totalEnd * pxPerSec + 200,
    timelineTime * pxPerSec + 200,
  );
  const playheadX = timelineTime * pxPerSec;

  // --- history ---
  const syncHistorySizes = useCallback(() => {
    setHistorySizes({
      past: historyRef.current.past.length,
      future: historyRef.current.future.length,
    });
  }, []);

  const createHistorySnapshot = useCallback(
    (clipState = clips, trackState = tracks) => ({
      clips: clipState.map((c) => ({ ...c })),
      tracks: trackState.map((t) => ({ ...t })),
    }),
    [clips, tracks],
  );

  const normalizeHistorySnapshot = useCallback(
    (snapshot) =>
      Array.isArray(snapshot)
        ? { clips: snapshot.map((c) => ({ ...c })), tracks: null }
        : {
            clips: (snapshot?.clips || []).map((c) => ({ ...c })),
            tracks: snapshot?.tracks
              ? snapshot.tracks.map((t) => ({ ...t }))
              : null,
          },
    [],
  );

  const pushHistory = useCallback(
    (snapshot) => {
      historyRef.current.past.push(normalizeHistorySnapshot(snapshot));
      if (historyRef.current.past.length > 50) historyRef.current.past.shift();
      historyRef.current.future = [];
      syncHistorySizes();
    },
    [normalizeHistorySnapshot, syncHistorySizes],
  );

  const commitClips = useCallback(
    (newClips) => {
      pushHistory(createHistorySnapshot());
      setClips(newClips);
    },
    [createHistorySnapshot, pushHistory],
  );

  const scheduleInspectorHistoryCommit = useCallback(() => {
    if (!inspectorEditTimerRef.current) {
      pushHistory(createHistorySnapshot());
    }
    window.clearTimeout(inspectorEditTimerRef.current);
    inspectorEditTimerRef.current = window.setTimeout(() => {
      inspectorEditTimerRef.current = 0;
    }, 350);
  }, [createHistorySnapshot, pushHistory]);

  const undo = useCallback(() => {
    const past = historyRef.current.past;
    if (past.length === 0) return;
    const prev = normalizeHistorySnapshot(past.pop());
    historyRef.current.future.push(createHistorySnapshot());
    setClips(prev.clips);
    if (prev.tracks) setTracks(prev.tracks);
    syncHistorySizes();
    setActiveClipId((aid) =>
      aid && prev.clips.some((c) => c.id === aid) ? aid : null,
    );
  }, [createHistorySnapshot, normalizeHistorySnapshot, syncHistorySizes]);

  const redo = useCallback(() => {
    const fut = historyRef.current.future;
    if (fut.length === 0) return;
    const next = normalizeHistorySnapshot(fut.pop());
    historyRef.current.past.push(createHistorySnapshot());
    setClips(next.clips);
    if (next.tracks) setTracks(next.tracks);
    syncHistorySizes();
    setActiveClipId((aid) =>
      aid && next.clips.some((c) => c.id === aid) ? aid : null,
    );
  }, [createHistorySnapshot, normalizeHistorySnapshot, syncHistorySizes]);

  // --- track management ---
  const handleAddTrack = useCallback((type) => {
    setTracks((prev) => addTrackToList(prev, type));
  }, []);

  const handleRemoveTrack = useCallback((trackId) => {
    setTracks((prev) => removeTrackFromList(prev, trackId));
    setClips((prev) => {
      const clipsToRemove = prev.filter((c) => c.trackId === trackId);
      // Clean up linkGroupId for clips being removed to prevent orphaned groups
      const removedLinkGroupIds = new Set(clipsToRemove.map(c => c.linkGroupId).filter(Boolean));
      if (removedLinkGroupIds.size > 0) {
        // If any clips remain with these linkGroupIds, they should be unlinked
        return prev.map(c => {
          if (c.trackId !== trackId && c.linkGroupId && removedLinkGroupIds.has(c.linkGroupId)) {
            return { ...c, linkGroupId: null };
          }
          return c.trackId === trackId ? null : c;
        }).filter(Boolean);
      }
      return prev.filter((c) => c.trackId !== trackId);
    });
  }, []);

  const handleUpdateTrack = useCallback((trackId, changes) => {
    setTracks((prev) => updateTrackInList(prev, trackId, changes));
  }, []);

  // --- multi-track helpers ---
  const getTrackAtClientY = useCallback(
    (clientY) => {
      const tc = tracksContentRef.current;
      if (!tc) return null;
      const rect = tc.getBoundingClientRect();
      const rulerEl = tc.querySelector(".time-ruler");
      const rulerHeight = rulerEl ? rulerEl.getBoundingClientRect().height : 30;
      return getTrackIdAtTimelineY({
        clientY,
        containerTop: rect.top,
        scrollTop: tc.scrollTop,
        rulerHeight,
        tracks,
      });
    },
    [tracks],
  );

  const getMoveTrackPlan = useCallback(
    (selectedClips, primaryClipId, clientY, interactionState = null) => {
      const targetTrackId = getTrackAtClientY(clientY);
      let plan = planTrackMove({
        tracks,
        clips: selectedClips,
        primaryClipId,
        targetTrackId,
        autoTracks: interactionState?.pendingAutoTracks || [],
      });

      if (interactionState && plan.autoTrackSpecs.length > 0) {
        const pendingAutoTracks = [
          ...(interactionState.pendingAutoTracks || []),
        ];
        let changed = false;
        for (const spec of plan.autoTrackSpecs) {
          if (
            pendingAutoTracks.some(
              (track) => track.type === spec.type && track.edge === spec.edge,
            )
          )
            continue;
          pendingAutoTracks.push(
            createAutoTrackForMove(tracks, spec.type, spec.edge, {
              id: nextTrackId(),
            }),
          );
          changed = true;
        }
        if (changed) {
          interactionState.pendingAutoTracks = pendingAutoTracks;
          plan = planTrackMove({
            tracks,
            clips: selectedClips,
            primaryClipId,
            targetTrackId,
            autoTracks: pendingAutoTracks,
          });
        }
      }

      if (interactionState) interactionState.trackMovePlan = plan;
      return plan;
    },
    [getTrackAtClientY, tracks],
  );

  const updateTrackMovePreview = useCallback(
    (plan) => {
      const existingTrackIds = new Set(tracks.map((track) => track.id));
      const targetTrackIds = (plan?.targetTrackIds || []).filter((trackId) =>
        existingTrackIds.has(trackId),
      );
      setDropTargetTrackId(targetTrackIds[0] || null);
      setTrackMovePreview({
        targetTrackIds,
        autoTracks: plan?.autoTracks || [],
      });
    },
    [tracks],
  );

  const ensurePendingAutoTrack = useCallback(
    (interactionState, type, edge) => {
      const pendingAutoTracks = [...(interactionState.pendingAutoTracks || [])];
      let track = pendingAutoTracks.find(
        (item) => item.type === type && item.edge === edge,
      );
      if (!track) {
        track = createAutoTrackForMove(tracks, type, edge, {
          id: nextTrackId(),
        });
        pendingAutoTracks.push(track);
        interactionState.pendingAutoTracks = pendingAutoTracks;
      }
      return track;
    },
    [tracks],
  );

  const placeLinkedSyncClips = useCallback(
    (movedClips, trackMoveClipIds, interactionState) => {
      const explicitTrackMoveIds =
        trackMoveClipIds instanceof Set
          ? trackMoveClipIds
          : new Set(trackMoveClipIds || []);
      const movingIds = new Set(movedClips.map((clip) => clip.id));
      const originalClipById = new Map(
        (interactionState.snapshotBefore || []).map((clip) => [clip.id, clip]),
      );
      return movedClips.map((clip) => {
        if (explicitTrackMoveIds.has(clip.id)) return clip;
        const originalTrackId =
          originalClipById.get(clip.id)?.trackId || clip.trackId;
        const placement = getCollisionFreeTrackForClip({
          tracks,
          clips: interactionState.snapshotBefore,
          clip,
          startTime: clip.startTime,
          preferredTrackId: originalTrackId,
          ignoreClipIds: movingIds,
        });
        if (placement.trackId) return { ...clip, trackId: placement.trackId };
        if (placement.autoTrack) {
          const autoTrack = ensurePendingAutoTrack(
            interactionState,
            placement.autoTrack.type,
            placement.autoTrack.edge,
          );
          return { ...clip, trackId: autoTrack.id };
        }
        return clip;
      });
    },
    [ensurePendingAutoTrack, tracks],
  );

  const updateTrackMovePreviewFromClips = useCallback(
    (movedClips, plan, interactionState) => {
      const existingTrackIds = new Set(tracks.map((track) => track.id));
      const targetTrackIds = [
        ...(plan?.targetTrackIds || []),
        ...movedClips.map((clip) => clip.trackId),
      ].filter((trackId) => existingTrackIds.has(trackId));
      const uniqueTargetTrackIds = [...new Set(targetTrackIds)];
      setDropTargetTrackId(uniqueTargetTrackIds[0] || null);
      setTrackMovePreview({
        targetTrackIds: uniqueTargetTrackIds,
        autoTracks:
          interactionState?.pendingAutoTracks || plan?.autoTracks || [],
      });
    },
    [tracks],
  );

  const updateTimelinePlayheadPosition = useCallback(
    (time) => {
      const x = Math.max(0, time) * pxPerSec;
      timelinePlayheadRefs.current.forEach((node) => {
        if (node) node.style.setProperty("--playhead-x", `${x}px`);
      });
    },
    [pxPerSec],
  );

  const getNextTimelineLayerBoundary = useCallback((time, clipList = clips) => {
    let boundary = Number.MAX_SAFE_INTEGER;
    for (const clip of clipList) {
      const end = clip.startTime + (clip.outPoint - clip.inPoint);
      if (clip.startTime > time + TIMELINE_LAYER_BOUNDARY_EPSILON) {
        boundary = Math.min(boundary, clip.startTime);
      }
      if (end > time + TIMELINE_LAYER_BOUNDARY_EPSILON) {
        boundary = Math.min(boundary, end);
      }
    }
    return Number.isFinite(boundary) ? boundary : Number.MAX_SAFE_INTEGER;
  }, [clips]);

  const setTimelinePlayheadRef = useCallback(
    (index) => (node) => {
      timelinePlayheadRefs.current[index] = node;
      if (node) updateTimelinePlayheadPosition(timelineTimeRef.current);
    },
    [updateTimelinePlayheadPosition],
  );

  const updateVisibleTimelineRange = useCallback(() => {
    const tc = tracksContentRef.current;
    if (!tc) return;
    setVisibleTimelineRange(
      getVisibleTimelineRange({
        scrollLeft: tc.scrollLeft,
        clientWidth: tc.clientWidth,
        pxPerSec,
      }),
    );
  }, [pxPerSec]);

  const handleTracksScroll = useCallback((e) => {
    if (trackHeadersListRef.current) {
      trackHeadersListRef.current.scrollTop = e.target.scrollTop;
    }
    setVisibleTimelineRange(
      getVisibleTimelineRange({
        scrollLeft: e.target.scrollLeft,
        clientWidth: e.target.clientWidth,
        pxPerSec,
      }),
    );
  }, [pxPerSec]);

  const setTimelineVisualRef = useCallback(
    (clipId) => (node) => {
      if (node) timelineVisualRefs.current.set(clipId, node);
      else timelineVisualRefs.current.delete(clipId);
    },
    [],
  );

  const setTimelineAudioRef = useCallback(
    (clipId) => (node) => {
      if (node) timelineAudioRefs.current.set(clipId, node);
      else timelineAudioRefs.current.delete(clipId);
    },
    [],
  );

  const pauseTimelinePreviewMedia = useCallback(() => {
    timelineVisualRefs.current.forEach((node) => {
      if (node && !node.paused) node.pause();
    });
    timelineAudioRefs.current.forEach((node) => {
      if (node && !node.paused) node.pause();
    });
  }, []);

  const getTimelineClipSourceTime = useCallback((clip, time) => {
    const offset = Math.max(0, time - clip.startTime);
    return Math.max(
      clip.inPoint,
      Math.min(clip.outPoint, clip.inPoint + offset),
    );
  }, []);

  const waitForTimelineMediaSeek = useCallback((node, sourceTime) => {
    if (!node || !Number.isFinite(sourceTime)) return Promise.resolve();
    const currentTime = Number.isFinite(node.currentTime)
      ? node.currentTime
      : 0;
    if (Math.abs(currentTime - sourceTime) <= 0.01 && !node.seeking) {
      return Promise.resolve();
    }
    const existing = timelineMediaSeekPromisesRef.current.get(node);
    if (existing) return existing;
    timelineSeekGraceUntilRef.current = Math.max(
      timelineSeekGraceUntilRef.current,
      performance.now() + TIMELINE_MEDIA_SEEK_GRACE_MS,
    );
    let promise;
    promise = new Promise((resolve) => {
      let done = false;
      let timeoutId = 0;
      const finish = () => {
        if (done) return;
        done = true;
        window.clearTimeout(timeoutId);
        node.removeEventListener("seeked", finish);
        resolve();
      };
      node.addEventListener("seeked", finish, { once: true });
      timeoutId = window.setTimeout(finish, TIMELINE_MEDIA_SEEK_TIMEOUT_MS);
      try {
        node.currentTime = sourceTime;
      } catch {
        finish();
      }
      if (
        !node.seeking &&
        Math.abs((node.currentTime || 0) - sourceTime) <= 0.01
      ) {
        window.setTimeout(finish, 0);
      }
    }).finally(() => {
      if (timelineMediaSeekPromisesRef.current.get(node) === promise) {
        timelineMediaSeekPromisesRef.current.delete(node);
      }
    });
    timelineMediaSeekPromisesRef.current.set(node, promise);
    return promise;
  }, []);

  const primeTimelinePlayback = useCallback(
    async (time) => {
      const visualLayers = getTimelineVisualClips({
        time,
        clips,
        lookups: timelinePlaybackLookups,
      });
      const audioLayers = getTimelineAudibleClips({
        time,
        clips,
        lookups: timelinePlaybackLookups,
      });
      const seekPromises = [];

      for (const { clip } of visualLayers) {
        const node = timelineVisualRefs.current.get(clip.id);
        if (!node) continue;
        const sourceTime = getTimelineClipSourceTime(clip, time);
        node.muted = true;
        node.volume = 0;
        seekPromises.push(waitForTimelineMediaSeek(node, sourceTime));
      }

      for (const { clip } of audioLayers) {
        const node = timelineAudioRefs.current.get(clip.id);
        if (!node) continue;
        const sourceTime = getTimelineClipSourceTime(clip, time);
        const clipVolume = clip.volume ?? 1;
        const clipDurAudio = clip.outPoint - clip.inPoint;
        const fadeInAudio = clip.fadeIn ?? 0;
        const fadeOutAudio = clip.fadeOut ?? 0;
        const timeInClipAudio = Math.max(0, time - clip.startTime);
        let fadeGain = 1;
        if (fadeInAudio > 0 && timeInClipAudio < fadeInAudio) {
          fadeGain = timeInClipAudio / fadeInAudio;
        }
        const timeToEndAudio = clipDurAudio - timeInClipAudio;
        if (fadeOutAudio > 0 && timeToEndAudio < fadeOutAudio) {
          fadeGain = Math.min(fadeGain, timeToEndAudio / fadeOutAudio);
        }
        const effectiveVolume = Math.max(
          0,
          Math.min(2, volume * clipVolume * fadeGain),
        );
        node.volume = Math.min(1, effectiveVolume);
        node.muted = muted || effectiveVolume <= 0 || !!clip.clipMuted;
        seekPromises.push(waitForTimelineMediaSeek(node, sourceTime));
      }
      await Promise.all(seekPromises);
    },
    [
      clips,
      getTimelineClipSourceTime,
      muted,
      timelinePlaybackLookups,
      volume,
      waitForTimelineMediaSeek,
    ],
  );

  // --- player ---
  const startTimelinePlayback = useCallback(async (startAtTime, target = null) => {
    if (videoRef.current && !videoRef.current.paused) videoRef.current.pause();
    const startToken = timelinePlaybackStartTokenRef.current + 1;
    timelinePlaybackStartTokenRef.current = startToken;
    setPlaybackMode("timeline");
    setEditorFocus(FOCUS_TIMELINE);
    setSourceMonitorId(null);
    const timelineStart = Math.max(0, startAtTime);
    playingClipIdRef.current = target?.id || null;
    imagePlaybackRef.current = null;
    pendingSeekRef.current = null;
    pendingPlayRef.current = false;
    timelinePlaybackRef.current = null;
    if (target?.videoId) setActiveId(target.videoId);
    timelineTimeRef.current = timelineStart;
    updateTimelinePlayheadPosition(timelineStart);
    setTimelineTime(timelineStart);
    await primeTimelinePlayback(timelineStart);
    if (timelinePlaybackStartTokenRef.current !== startToken) return;
    timelineSeekGraceUntilRef.current = Math.max(
      timelineSeekGraceUntilRef.current,
      performance.now() + TIMELINE_MEDIA_SEEK_GRACE_MS,
    );
    timelinePlaybackRef.current = {
      startedAtMs: performance.now(),
      timelineStart,
    };
    setIsPlaying(true);
  }, [primeTimelinePlayback, updateTimelinePlayheadPosition]);

  const startClipPlayback = useCallback(
    (target, startAtTime) => {
      startTimelinePlayback(startAtTime, target);
    },
    [startTimelinePlayback],
  );

  const startTimelineGapPlayback = useCallback(
    (startAtTime) => {
      startTimelinePlayback(startAtTime, null);
    },
    [startTimelinePlayback],
  );

  const stopPlayback = useCallback(() => {
    timelinePlaybackStartTokenRef.current += 1;
    playbackModeRef.current = null;
    const videoEl = videoRef.current;
    if (videoEl && !videoEl.paused) videoEl.pause();
    pauseTimelinePreviewMedia();
    imagePlaybackRef.current = null;
    timelinePlaybackRef.current = null;
    pendingPlayRef.current = false;
    setTimelineTime(timelineTimeRef.current);
    setPlaybackMode(null);
    setIsPlaying(false);
  }, [pauseTimelinePreviewMedia]);

  const handleSourcePreviewPlay = useCallback(() => {
    const videoEl = videoRef.current;
    if (
      !activeVideo ||
      activeVideo.mediaType !== "video" ||
      !activeSourceSelection ||
      !videoEl
    )
      return;
    if (playbackMode === "source" && isPlaying) {
      stopPlayback();
      setSourceMonitorId(activeVideo.id);
      return;
    }

    const outsideRange =
      videoEl.currentTime < activeSourceSelection.inPoint - 0.02 ||
      videoEl.currentTime >= activeSourceSelection.outPoint - 0.02;
    if (outsideRange) {
      try {
        videoEl.currentTime = activeSourceSelection.inPoint;
      } catch {
        /* ignored */
      }
      setPreviewTime(activeSourceSelection.inPoint);
    }
    playingClipIdRef.current = null;
    imagePlaybackRef.current = null;
    timelinePlaybackRef.current = null;
    pendingPlayRef.current = false;
    pauseTimelinePreviewMedia();
    setPlaybackMode("source");
    setEditorFocus(FOCUS_SOURCE);
    videoEl.play().catch((err) => console.error('Source preview play error:', err));
  }, [
    activeSourceSelection,
    activeVideo,
    isPlaying,
    pauseTimelinePreviewMedia,
    playbackMode,
    stopPlayback,
  ]);

  const handleTimelinePlay = useCallback(() => {
    setEditorFocus(FOCUS_TIMELINE);
    if (
      playingClipIdRef.current &&
      !clips.some((clip) => clip.id === playingClipIdRef.current)
    ) {
      playingClipIdRef.current = null;
      imagePlaybackRef.current = null;
      pendingPlayRef.current = false;
    }
    if (playbackMode === "timeline" && isPlaying) {
      stopPlayback();
      return;
    }

    const target = topTimelineClip || findClipAtTime(timelineTime, clips);
    if (target) {
      startClipPlayback(target, timelineTime);
    } else {
      startTimelineGapPlayback(timelineTime);
    }
  }, [
    clips,
    isPlaying,
    playbackMode,
    startClipPlayback,
    startTimelineGapPlayback,
    stopPlayback,
    timelineTime,
    topTimelineClip,
  ]);

  const handlePlay = useCallback(() => {
    if (isSourceMonitorActive) {
      handleSourcePreviewPlay();
    } else {
      handleTimelinePlay();
    }
  }, [handleSourcePreviewPlay, handleTimelinePlay, isSourceMonitorActive]);

  const handlePreviewTimeUpdate = useCallback(
    (e) => {
      const nextTime = e.currentTarget.currentTime || 0;
      setPreviewTime(nextTime);
      if (
        playbackModeRef.current === "source" &&
        activeSourceSelection &&
        nextTime >= activeSourceSelection.outPoint - 0.02
      ) {
        e.currentTarget.pause();
        try {
          e.currentTarget.currentTime = activeSourceSelection.outPoint;
        } catch {
          /* ignored */
        }
        setPreviewTime(activeSourceSelection.outPoint);
        imagePlaybackRef.current = null;
        timelinePlaybackRef.current = null;
        setPlaybackMode(null);
        setIsPlaying(false);
      }
    },
    [activeSourceSelection],
  );

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = muted;
      if (pendingSeekRef.current != null) {
        try {
          videoRef.current.currentTime = pendingSeekRef.current;
        } catch {
          /* ignored */
        }
        pendingSeekRef.current = null;
      }
      if (pendingPlayRef.current) {
        pendingPlayRef.current = false;
        videoRef.current.play().catch((err) => console.error('Video play error:', err));
      }
    }
  };

  // sync volume/mute to video
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = muted;
    }
  }, [volume, muted]);

  useEffect(() => {
    if (!isTimelineMonitorActive) {
      pauseTimelinePreviewMedia();
      return;
    }

    const shouldPlay = playbackMode === "timeline" && isPlaying;
    const activeVisualIds = new Set(
      timelineVisualLayers.map(({ clip }) => clip.id),
    );
    const activeAudioIds = new Set(
      timelineAudioLayers.map(({ clip }) => clip.id),
    );

    timelineVisualRefs.current.forEach((node, clipId) => {
      if (!activeVisualIds.has(clipId)) {
        if (!node.paused) node.pause();
      }
    });
    timelineAudioRefs.current.forEach((node, clipId) => {
      if (!activeAudioIds.has(clipId)) {
        if (!node.paused) node.pause();
      }
    });

    for (const { clip } of timelineVisualLayers) {
      const node = timelineVisualRefs.current.get(clip.id);
      if (!node) continue;
      const sourceTime = getTimelineClipSourceTime(clip, timelineTime);
      const drift = Math.abs((node.currentTime || 0) - sourceTime);
      const driftTolerance = shouldPlay
        ? TIMELINE_PLAYING_VIDEO_DRIFT_TOLERANCE
        : TIMELINE_PAUSED_DRIFT_TOLERANCE;
      node.muted = true;
      node.volume = 0;
      if (drift > driftTolerance) {
        waitForTimelineMediaSeek(node, sourceTime).then(() => {
          if (playbackModeRef.current === "timeline" && playbackRef.current.isPlaying) {
            node.play().catch((err) => console.error('Timeline visual play error after seek:', err));
          }
        });
        continue;
      }
      if (
        shouldPlay &&
        !node.seeking &&
        performance.now() >= timelineSeekGraceUntilRef.current
      ) {
        node.play().catch((err) => console.error('Timeline visual play error:', err));
      } else if (!node.paused) {
        node.pause();
      }
    }

    for (const { clip } of timelineAudioLayers) {
      const node = timelineAudioRefs.current.get(clip.id);
      if (!node) continue;
      const sourceTime = getTimelineClipSourceTime(clip, timelineTime);
      const drift = Math.abs((node.currentTime || 0) - sourceTime);
      const driftTolerance = shouldPlay
        ? TIMELINE_PLAYING_AUDIO_DRIFT_TOLERANCE
        : TIMELINE_PAUSED_DRIFT_TOLERANCE;
      const clipVolume = clip.volume ?? 1;
      const clipDurAudio = clip.outPoint - clip.inPoint;
      const fadeInAudio = clip.fadeIn ?? 0;
      const fadeOutAudio = clip.fadeOut ?? 0;
      const timeInClipAudio = Math.max(0, timelineTime - clip.startTime);
      let fadeGain = 1;
      if (fadeInAudio > 0 && timeInClipAudio < fadeInAudio)
        fadeGain = timeInClipAudio / fadeInAudio;
      const timeToEndAudio = clipDurAudio - timeInClipAudio;
      if (fadeOutAudio > 0 && timeToEndAudio < fadeOutAudio)
        fadeGain = Math.min(fadeGain, timeToEndAudio / fadeOutAudio);
      const effectiveVolume = Math.max(
        0,
        Math.min(2, volume * clipVolume * fadeGain),
      );
      node.volume = Math.min(1, effectiveVolume);
      node.muted = muted || effectiveVolume <= 0 || !!clip.clipMuted;
      if (drift > driftTolerance) {
        waitForTimelineMediaSeek(node, sourceTime).then(() => {
          if (
            playbackModeRef.current === "timeline" &&
            playbackRef.current.isPlaying &&
            !node.muted
          ) {
            node.play().catch((err) => console.error('Timeline audio play error after seek:', err));
          }
        });
        continue;
      }
      if (
        shouldPlay &&
        !node.muted &&
        !node.seeking &&
        performance.now() >= timelineSeekGraceUntilRef.current
      ) {
        node.play().catch((err) => console.error('Timeline audio play error:', err));
      } else if (!node.paused) {
        node.pause();
      }
    }
  }, [
    getTimelineClipSourceTime,
    isPlaying,
    isTimelineMonitorActive,
    muted,
    pauseTimelinePreviewMedia,
    playbackMode,
    timelineAudioLayers,
    timelineTime,
    timelineVisualLayers,
    volume,
    waitForTimelineMediaSeek,
  ]);

  useEffect(() => {
    if (playbackModeRef.current === "timeline" && isPlaying) return;
    timelineTimeRef.current = timelineTime;
    updateTimelinePlayheadPosition(timelineTime);
  }, [isPlaying, timelineTime, updateTimelinePlayheadPosition]);

  useEffect(() => {
    activeTimelineLayersRef.current = {
      key: [
        ...timelineVisualLayers.map(({ clip }) => `v:${clip.id}`),
        ...timelineAudioLayers.map(({ clip }) => `a:${clip.id}`),
      ].join("|"),
      visualLayers: timelineVisualLayers,
      audioLayers: timelineAudioLayers,
      nextBoundary: getNextTimelineLayerBoundary(timelineTime),
    };
  }, [
    getNextTimelineLayerBoundary,
    timelineAudioLayers,
    timelineTime,
    timelineVisualLayers,
  ]);

  useEffect(() => {
    updateVisibleTimelineRange();
  }, [tracks, totalWidth, updateVisibleTimelineRange]);

  // Keep playbackRef synced (used inside rAF loop without re-binding)
  useEffect(() => {
    playbackRef.current = {
      clips,
      activeClipId,
      activeId,
      isPlaying,
      videos,
      timelineTime,
    };
  }, [clips, activeClipId, activeId, isPlaying, videos, timelineTime]);

  // ---- Smooth playhead via rAF; visible layers/audio clips sync themselves from timelineTime. ----
  useEffect(() => {
    if (!isPlaying || playbackMode !== "timeline") return;
    if (!timelinePlaybackRef.current) {
      timelinePlaybackRef.current = {
        startedAtMs: performance.now(),
        timelineStart: timelineTimeRef.current,
      };
    }
    let raf = 0;
    const tick = () => {
      const state = playbackRef.current;
      const nowMs = performance.now();
      if (interactionRef.current?.type === "seek") {
        raf = requestAnimationFrame(tick);
        return;
      }
      if (nowMs < timelineSeekGraceUntilRef.current) {
        if (timelinePlaybackRef.current) {
          timelinePlaybackRef.current = {
            startedAtMs: nowMs,
            timelineStart: timelineTimeRef.current,
          };
        }
        raf = requestAnimationFrame(tick);
        return;
      }
      const timelineState = getVirtualTimelinePlaybackTime({
        timelinePlayback: timelinePlaybackRef.current,
        nowMs,
        fallbackTimelineTime: timelineTimeRef.current,
      });
      const nextTime = timelineState.timelineTime;
      timelineTimeRef.current = nextTime;
      updateTimelinePlayheadPosition(nextTime);
      setTimelineTime(nextTime);
      const shouldSyncState =
        nowMs - timelineLastStateUpdateRef.current >= 1000 / TIMELINE_STATE_FPS;
      const shouldCheckLayers =
        shouldSyncState ||
        nextTime >=
          activeTimelineLayersRef.current.nextBoundary -
            TIMELINE_LAYER_BOUNDARY_EPSILON;
      if (!shouldCheckLayers) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const visualLayers = getTimelineVisualClips({
        time: nextTime,
        clips: state.clips,
        lookups: timelinePlaybackLookups,
      });
      const audioLayers = getTimelineAudibleClips({
        time: nextTime,
        clips: state.clips,
        lookups: timelinePlaybackLookups,
      });
      const layerKey = [
        ...visualLayers.map(({ clip }) => `v:${clip.id}`),
        ...audioLayers.map(({ clip }) => `a:${clip.id}`),
      ].join("|");
      const shouldSyncLayers = layerKey !== activeTimelineLayersRef.current.key;
      const activePlaybackClip =
        visualLayers.at(-1)?.clip || (audioLayers.length > 0 ? audioLayers[0]?.clip : null) || null;
      playingClipIdRef.current = activePlaybackClip?.id || null;
      if (shouldSyncState) {
        timelineLastStateUpdateRef.current = nowMs;
      }
      if (shouldSyncState || shouldSyncLayers) {
        activeTimelineLayersRef.current = {
          key: layerKey,
          visualLayers,
          audioLayers,
          nextBoundary: getNextTimelineLayerBoundary(nextTime, state.clips),
        };
        setTimelineTime(nextTime);
      } else {
        activeTimelineLayersRef.current = {
          ...activeTimelineLayersRef.current,
          nextBoundary: getNextTimelineLayerBoundary(nextTime, state.clips),
        };
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [
    getNextTimelineLayerBoundary,
    isPlaying,
    playbackMode,
    timelinePlaybackLookups,
    updateTimelinePlayheadPosition,
  ]);

  // --- import ---
  // Probe duration for newly imported videos so drag-from-sidebar can show a real-width preview.
  const probeAndCacheDurations = useCallback(
    (items) => {
      for (const item of items) {
        if (videoDurations[item.id] != null) continue;
        probeDuration(item.src, item.mediaType, settings.imageDuration).then(
          (dur) => {
            setVideoDurations((prev) =>
              prev[item.id] != null ? prev : { ...prev, [item.id]: dur },
            );
          },
        );
      }
    },
    [settings.imageDuration, videoDurations],
  );

  const handleImport = async () => {
    if (isTauri) {
      try {
        const items = await openMediaDialog();
        if (items && items.length > 0) {
          setVideos((prev) => [...prev, ...items]);
          probeAndCacheDurations(items);
        }
      } catch (err) {
        console.error("Import failed:", err);
        alert("Import fehlgeschlagen: " + err);
      }
    } else {
      fileRef.current?.click();
    }
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return [];
    const items = files.map((f) => {
      const src = URL.createObjectURL(f);
      browserObjectUrlsRef.current.add(src);
      return {
        id: nextId("vid"),
        name: f.name,
        path: f.name,
        src,
        mediaType: getFileMediaType(f),
        importedAt: new Date().toISOString(),
      };
    });
    setVideos((prev) => [...prev, ...items]);
    probeAndCacheDurations(items);
    if (e.target && "value" in e.target) e.target.value = "";
    return items;
  };

  const handleSelectMedia = (id) => {
    if (activeId === id) {
      setActiveId(null);
      setSourceMonitorId(null);
      return;
    }
    stopPlayback();
    setEditorFocus(FOCUS_SOURCE);
    setActiveId(id);
    setActiveClipId(null);
    playingClipIdRef.current = null;
    const media = videos.find((v) => v.id === id);
    setSourceMonitorId(media?.mediaType === "video" ? id : null);
    const selection = getSourceSelection(id);
    setPreviewTime(selection.inPoint);
    if (media?.mediaType === "video") {
      pendingSeekRef.current = selection.inPoint;
      pendingPlayRef.current = false;
      if (videoRef.current && activeId === id) {
        try {
          videoRef.current.currentTime = selection.inPoint;
        } catch {
          /* ignored */
        }
      }
    }
  };
  const handleDoubleClickMedia = (id) => {
    stopPlayback();
    setEditorFocus(FOCUS_SOURCE);
    setActiveId(id);
    setActiveClipId(null);
    playingClipIdRef.current = null;
    const media = videos.find((v) => v.id === id);
    setSourceMonitorId(media?.mediaType === "video" ? id : null);
    const selection = getSourceSelection(id);
    setPreviewTime(selection.inPoint);
    setIsPlaying(false);
    setTimeout(() => {
      if (videoRef.current) {
        setPlaybackMode("source");
        videoRef.current.currentTime = selection.inPoint;
        videoRef.current
          .play()
          .then(() => setIsPlaying(true))
          .catch((err) => console.error('Video play error:', err));
      }
    }, 50);
  };
  const handleRemoveMedia = (id, e) => {
    e.stopPropagation();
    const removedMedia = videos.find((v) => v.id === id);
    if (removedMedia) revokeBrowserObjectUrls([removedMedia]);
    const removedClipIds = new Set(
      clips.filter((clip) => clip.videoId === id).map((clip) => clip.id),
    );
    if (removedClipIds.size > 0) {
      commitClips(clips.filter((clip) => clip.videoId !== id));
      setSelectedClipIds((prev) => {
        const next = new Set(prev);
        removedClipIds.forEach((clipId) => next.delete(clipId));
        return next;
      });
      if (removedClipIds.has(activeClipId)) setActiveClipId(null);
    }
    setVideos((prev) => prev.filter((v) => v.id !== id));
    setVideoDurations((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSourceRanges((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setPeaksMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setThumbsMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (activeId === id) {
      setActiveId(null);
      setIsPlaying(false);
    }
    if (sourceMonitorId === id) setSourceMonitorId(null);
  };

  // --- drag from sidebar ---
  const handleDragStart = (
    e,
    video,
    trackMode = "av",
    useSourceRange = false,
  ) => {
    const effectiveTrackMode =
      video.mediaType === "audio" ? "audio" : trackMode;
    draggedVideoIdRef.current = video.id;
    draggedTrackModeRef.current = effectiveTrackMode;
    draggedUseSourceRangeRef.current = useSourceRange;
    setDropZoneTrackMode(effectiveTrackMode);
    // Probe lazily if not yet cached, so the very first preview is accurate too.
    if (videoDurations[video.id] == null) {
      probeDuration(video.src, video.mediaType, settings.imageDuration).then(
        (dur) => {
          setVideoDurations((prev) =>
            prev[video.id] != null ? prev : { ...prev, [video.id]: dur },
          );
        },
      );
    }
    const selection = useSourceRange
      ? getSourceSelection(video)
      : getFullMediaSelection(video);
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    const icon = document.createElement("span");
    icon.className = "drag-ghost-icon";
    icon.textContent = effectiveTrackMode === "audio" ? "A" : "V";
    const name = document.createElement("span");
    name.className = "drag-ghost-name";
    name.textContent = `${video.name} · ${formatTime(selection.clipDuration)}`;
    ghost.append(icon, name);
    Object.assign(ghost.style, {
      position: "absolute",
      top: "-1000px",
      left: "0px",
      pointerEvents: "none",
    });
    document.body.appendChild(ghost);
    try {
      e.dataTransfer.setDragImage(ghost, 14, 18);
    } catch {
      /* ignored */
    }
    setTimeout(() => {
      if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
    }, 0);
    e.dataTransfer.setData("text/plain", video.id);
    e.dataTransfer.setData("text", video.id);
    e.dataTransfer.setData(
      "application/x-stonecutter-track-mode",
      effectiveTrackMode,
    );
    e.dataTransfer.effectAllowed = "copy";
  };
  const handleDragEnd = () => {
    draggedVideoIdRef.current = null;
    draggedTrackModeRef.current = "av";
    draggedUseSourceRangeRef.current = false;
    setDropZoneTrackMode("av");
    setImportDragInfo(null);
    setDragTooltip(null);
  };

  const handleSourceDragStart = (e, trackMode) => {
    if (!activeVideo) return;
    handleDragStart(e, activeVideo, trackMode, true);
  };

  // --- timeline drop ---
  const dropTimeFromEvent = (e) => {
    if (!tracksContentRef.current) return totalEnd;
    const rect = tracksContentRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + tracksContentRef.current.scrollLeft;
    return Math.max(0, x / pxPerSec);
  };

  // Compute the simulated timeline layout that would result from dropping `videoId` at `dropTime`.
  // Returns { insertPoint, mode, simulatedLayout, dur }.
  // For Explorer files: videoId = '__explorer__', optional fileName.
  const computeImportPreview = useCallback(
    (
      videoId,
      dropTime,
      fileName = "",
      trackMode = "av",
      targetTrack = null,
      useSourceRange = false,
    ) => {
      const media = videos.find((v) => v.id === videoId);
      const selection = media
        ? useSourceRange
          ? getSourceSelection(media)
          : getFullMediaSelection(media)
        : {
            inPoint: 0,
            outPoint: videoDurations[videoId] || 5,
            duration: videoDurations[videoId] || 5,
            clipDuration: videoDurations[videoId] || 5,
          };
      const dur = selection.clipDuration;
      const targetTrackId = targetTrack?.id;
      const trackClips = clips.filter((c) => c.trackId === targetTrackId);
      if (snapEnabled) {
        const ins = detectInsertPoint(
          "__preview__",
          dropTime + dur / 2,
          dur,
          trackClips,
        );
        if (ins) {
          const rippledTrack = applyRippleInsert(
            trackClips,
            "__preview__",
            ins.insertPoint,
            dur,
          );
          return {
            insertPoint: ins.insertPoint,
            mode: "insert",
            simulatedLayout: clips.map((c) =>
              c.trackId === targetTrackId
                ? rippledTrack.find((x) => x.id === c.id) || c
                : c,
            ),
            dur,
          };
        }
        return {
          insertPoint: constrainMoveStart(dropTime, dur, trackClips),
          mode: "constrain",
          simulatedLayout: clips,
          dur,
        };
      }
      // Snap-off: simulate Filmora-style overwrite (cut existing clips that overlap)
      const start = Math.max(0, dropTime);
      const placeholder = {
        id: "__preview__",
        videoId,
        name: fileName,
        src: "",
        sourceDuration: selection.duration,
        inPoint: selection.inPoint,
        outPoint: selection.outPoint,
        startTime: start,
        trackMode,
        trackId: targetTrackId,
      };
      const cut = resolveOverlaps(
        [...trackClips, placeholder],
        "__preview__",
        () => `prev-${Math.random()}`,
      );
      const trackLayout = cut.filter((c) => c.id !== "__preview__");
      const simulatedLayout = clips
        .filter((c) => c.trackId !== targetTrackId)
        .concat(trackLayout);
      return { insertPoint: start, mode: "overwrite", simulatedLayout, dur };
    },
    [
      clips,
      getFullMediaSelection,
      getSourceSelection,
      snapEnabled,
      videoDurations,
      videos,
    ],
  );

  const handleTimelineDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };
  const handleTimelineDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    if (!dragOver) setDragOver(true);
    // Auto-scroll near edges during sidebar drag too
    const tcEl = tracksContentRef.current;
    if (tcEl) {
      const tcRect = tcEl.getBoundingClientRect();
      const edge = 50;
      if (e.clientX < tcRect.left + edge) tcEl.scrollLeft -= 12;
      else if (e.clientX > tcRect.right - edge) tcEl.scrollLeft += 12;
    }
    const dropTime = dropTimeFromEvent(e);
    setDropIndicatorTime(dropTime);

    // Detect target track
    const targetTrackId = getTrackAtClientY(e.clientY);
    setDropTargetTrackId(targetTrackId);

    // Check for files from Explorer
    const files = Array.from(e.dataTransfer.files).filter(
      isImportableMediaFile,
    );
    if (files.length > 0) {
      const file = files[0];
      const mediaType = getFileMediaType(file);
      draggedTrackModeRef.current = mediaType === "audio" ? "audio" : "av";
      setDropZoneTrackMode(mediaType === "audio" ? "audio" : "av");
      const targetTrack =
        targetTrackId && targetTrackId !== "__below__"
          ? tracks.find((t) => t.id === targetTrackId) || null
          : null;
      const preview = computeImportPreview(
        "__explorer__",
        dropTime,
        file.name,
        mediaType === "audio" ? "audio" : "av",
        targetTrack,
      );
      setImportDragInfo({
        videoId: "__explorer__",
        name: file.name,
        trackMode: mediaType === "audio" ? "audio" : "av",
        mediaType,
        ...preview,
      });
      const rect = tracksContentRef.current?.getBoundingClientRect();
      if (rect) {
        setDragTooltip({
          x:
            e.clientX - rect.left + (tracksContentRef.current?.scrollLeft || 0),
          y: e.clientY - rect.top + (tracksContentRef.current?.scrollTop || 0),
          label: `${file.name} · ${formatTime(preview.dur || 5)}`,
        });
      }
      return;
    }

    // Handle drag from sidebar
    const videoId = draggedVideoIdRef.current;
    if (videoId) {
      const video = videos.find((v) => v.id === videoId);
      const trackMode = draggedTrackModeRef.current || "av";
      const useSourceRange = draggedUseSourceRangeRef.current;
      const targetTrack =
        targetTrackId && targetTrackId !== "__below__"
          ? tracks.find((t) => t.id === targetTrackId) || null
          : null;
      const preview = computeImportPreview(
        videoId,
        dropTime,
        "",
        trackMode,
        targetTrack,
        useSourceRange,
      );
      setImportDragInfo({
        videoId,
        name: video?.name || "",
        trackMode,
        mediaType: video?.mediaType || "video",
        ...preview,
      });
      // Tooltip near cursor
      const rect = tracksContentRef.current?.getBoundingClientRect();
      if (rect) {
        setDragTooltip({
          x:
            e.clientX - rect.left + (tracksContentRef.current?.scrollLeft || 0),
          y: e.clientY - rect.top + (tracksContentRef.current?.scrollTop || 0),
          label: `${trackMode === "audio" ? "Nur Audio" : "Video + Audio"} · ${formatTime(preview.insertPoint)} · ${formatTime(preview.dur)}`,
        });
      }
    }
  };
  const handleTimelineDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragOver(false);
    setDropIndicatorTime(null);
    setImportDragInfo(null);
    setDragTooltip(null);
    setDropTargetTrackId(null);
    setDropZoneTrackMode("av");
    setTrackMovePreview(null);
  };
  const handleTimelineDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    setDropIndicatorTime(null);
    setImportDragInfo(null);
    setDragTooltip(null);
    setDropTargetTrackId(null);
    setDropZoneTrackMode("av");
    setTrackMovePreview(null);
    const droppedVideoId =
      e.dataTransfer.getData("text/plain") ||
      e.dataTransfer.getData("text") ||
      draggedVideoIdRef.current;
    const droppedTrackMode =
      e.dataTransfer.getData("application/x-stonecutter-track-mode") ||
      draggedTrackModeRef.current ||
      "av";
    const droppedUsesSourceRange = draggedUseSourceRangeRef.current;
    draggedVideoIdRef.current = null;
    draggedTrackModeRef.current = "av";
    draggedUseSourceRangeRef.current = false;

    // Determine target track
    const dropTargetId = getTrackAtClientY(e.clientY);
    let targetTrack =
      dropTargetId && dropTargetId !== "__below__"
        ? tracks.find((t) => t.id === dropTargetId) || null
        : null;

    // Check for dropped files from Explorer
    const files = Array.from(e.dataTransfer.files).filter(
      isImportableMediaFile,
    );
    if (files.length > 0) {
      // Handle file drop from Explorer
      const importedItems = await handleFileChange({ target: { files } });
      const dropTime = dropTimeFromEvent(e);
      const lastVideo = importedItems?.[0];
      if (lastVideo) {
        const isAudioFile = lastVideo.mediaType === "audio";
        const isVideoFile = lastVideo.mediaType === "video";
        const explorerTrackMode = isAudioFile ? "audio" : "av";
        const requiredTrackType = isAudioFile ? "audio" : "video";
        if (targetTrack && targetTrack.type !== requiredTrackType) {
          setProjectStatus({
            ok: false,
            msg: `${isAudioFile ? "Audio-Datei" : "Video-Datei"} passt nicht auf eine ${targetTrack.type === "audio" ? "Audio" : "Video"}-Spur.`,
          });
          return;
        }

        // If dropped below existing tracks, create a new track matching the media type.
        let tracksUpdateExplorer = null;
        if (dropTargetId === "__below__" || !targetTrack) {
          const newTrack = {
            id: nextTrackId(),
            type: requiredTrackType,
            name: `${requiredTrackType === "audio" ? "Audio" : "Video"} ${tracks.filter((t) => t.type === requiredTrackType).length + 1}`,
            locked: false,
            height: DEFAULT_TRACK_HEIGHT,
          };
          if (requiredTrackType === "audio") {
            newTrack.muted = false;
            newTrack.solo = false;
          }
          targetTrack = newTrack;
          tracksUpdateExplorer = insertTrackOrdered(tracks, newTrack);
        }
        // For video files, auto-pair with an audio track (Filmora/DaVinci-style)
        let audioTrackForExplorer = null;
        if (isVideoFile) {
          const candidateTracks = tracksUpdateExplorer || tracks;
          audioTrackForExplorer = candidateTracks.find(
            (t) => t.type === "audio" && !t.locked,
          );
          if (!audioTrackForExplorer) {
            audioTrackForExplorer = {
              id: nextTrackId(),
              type: "audio",
              name: `Audio ${candidateTracks.filter((t) => t.type === "audio").length + 1}`,
              locked: false,
              height: DEFAULT_TRACK_HEIGHT,
              muted: false,
              solo: false,
            };
            tracksUpdateExplorer = insertTrackOrdered(
              candidateTracks,
              audioTrackForExplorer,
            );
          }
        }
        if (tracksUpdateExplorer) setTracks(tracksUpdateExplorer);

        const targetTrackId = targetTrack.id;
        const cachedDuration = videoDurations[lastVideo.id];
        const duration =
          cachedDuration ??
          (await probeDuration(
            lastVideo.src,
            lastVideo.mediaType,
            settings.imageDuration,
          ));
        if (cachedDuration == null) {
          setVideoDurations((prev) =>
            prev[lastVideo.id] != null
              ? prev
              : { ...prev, [lastVideo.id]: duration },
          );
        }
        const videoClipIdE = nextId("clip");
        const audioClipIdE = isVideoFile || isAudioFile ? nextId("clip") : null;
        const placeholderDur = duration;
        const trackClips = clips.filter((c) => c.trackId === targetTrackId);
        let placeholderStart = dropTime;
        let baseTrackClips = trackClips;
        if (snapEnabled) {
          const ins = detectInsertPoint(
            videoClipIdE,
            dropTime,
            placeholderDur,
            trackClips,
          );
          if (ins) {
            placeholderStart = ins.insertPoint;
            baseTrackClips = applyRippleInsert(
              trackClips,
              videoClipIdE,
              ins.insertPoint,
              placeholderDur,
            );
          } else {
            placeholderStart = constrainMoveStart(
              dropTime,
              placeholderDur,
              trackClips,
            );
          }
        }
        const producedClips = splitMediaIntoLinkedClips({
          media: lastVideo,
          selection: { inPoint: 0, outPoint: duration, duration },
          startTime: placeholderStart,
          videoClipId: videoClipIdE,
          audioClipId: audioClipIdE,
          videoTrackId: isAudioFile ? null : targetTrackId,
          audioTrackId: isAudioFile
            ? targetTrackId
            : audioTrackForExplorer?.id || null,
          trackMode: explorerTrackMode,
          hasAudio: isVideoFile,
          linkGroupIdFactory: nextLinkGroupId,
        });
        // Per-track ripple for the audio partner
        let audioSiblingAfter = null;
        if (audioTrackForExplorer) {
          const audioSibling = clips.filter(
            (c) => c.trackId === audioTrackForExplorer.id,
          );
          if (snapEnabled) {
            const ins = detectInsertPoint(
              audioClipIdE,
              placeholderStart + placeholderDur / 2,
              placeholderDur,
              audioSibling,
            );
            audioSiblingAfter = ins
              ? applyRippleInsert(
                  audioSibling,
                  audioClipIdE,
                  placeholderStart,
                  placeholderDur,
                )
              : audioSibling;
          } else {
            audioSiblingAfter = audioSibling;
          }
        }
        const otherTrackClips = clips.filter(
          (c) =>
            c.trackId !== targetTrackId &&
            (!audioTrackForExplorer || c.trackId !== audioTrackForExplorer.id),
        );
        const primaryList = [
          ...baseTrackClips,
          ...producedClips.filter((c) => c.trackId === targetTrackId),
        ];
        const audioList = audioTrackForExplorer
          ? [
              ...(audioSiblingAfter || []),
              ...producedClips.filter(
                (c) => c.trackId === audioTrackForExplorer.id,
              ),
            ]
          : [];
        const initialList = [...otherTrackClips, ...primaryList, ...audioList];
        if (snapEnabled) {
          commitClips(initialList);
        } else {
          const resolvedPrimary = resolveOverlaps(
            primaryList,
            videoClipIdE,
            () => nextId("clip"),
          );
          const resolvedAudio =
            audioTrackForExplorer && audioClipIdE
              ? resolveOverlaps(audioList, audioClipIdE, () => nextId("clip"))
              : audioList;
          commitClips([
            ...otherTrackClips,
            ...resolvedPrimary,
            ...resolvedAudio,
          ]);
        }
      }
      return;
    }

    // Handle drag from sidebar
    const videoId = droppedVideoId;
    const video = videos.find((v) => v.id === videoId) || null;
    if (!video) return;
    const trackMode = droppedTrackMode;
    const selection = droppedUsesSourceRange
      ? getSourceSelection(video)
      : getFullMediaSelection(video);
    const hasExplicitSourceRange =
      droppedUsesSourceRange && !!sourceRanges[video.id];

    // Validate track type compatibility
    const requiredTrackType = trackMode === "audio" ? "audio" : "video";
    if (targetTrack && targetTrack.type !== requiredTrackType) {
      setProjectStatus({
        ok: false,
        msg: `${trackMode === "audio" ? "Audio-Clip" : "Video-Clip"} passt nicht auf eine ${targetTrack.type === "audio" ? "Audio" : "Video"}-Spur.`,
      });
      return;
    }

    // If dropped below existing tracks, create a new track of the required type
    let tracksUpdate = null;
    if (dropTargetId === "__below__" || !targetTrack) {
      const newTrack = {
        id: nextTrackId(),
        type: requiredTrackType,
        name: `${requiredTrackType === "audio" ? "Audio" : "Video"} ${tracks.filter((t) => t.type === requiredTrackType).length + 1}`,
        locked: false,
        height: DEFAULT_TRACK_HEIGHT,
      };
      if (requiredTrackType === "audio") {
        newTrack.muted = false;
        newTrack.solo = false;
      }
      targetTrack = newTrack;
      tracksUpdate = insertTrackOrdered(tracks, newTrack);
    }

    // --- AV linked drop: create a linked video + audio clip pair on separate tracks ---
    const isAvLinkedDrop = trackMode === "av" && video.mediaType === "video";
    let linkedAudioTrack = null;
    if (isAvLinkedDrop) {
      const candidateTracks = tracksUpdate || tracks;
      linkedAudioTrack = candidateTracks.find(
        (t) => t.type === "audio" && !t.locked,
      );
      if (!linkedAudioTrack) {
        linkedAudioTrack = {
          id: nextTrackId(),
          type: "audio",
          name: `Audio ${candidateTracks.filter((t) => t.type === "audio").length + 1}`,
          locked: false,
          height: DEFAULT_TRACK_HEIGHT,
          muted: false,
          solo: false,
        };
        tracksUpdate = insertTrackOrdered(candidateTracks, linkedAudioTrack);
      }
    }
    if (tracksUpdate) setTracks(tracksUpdate);

    const targetTrackId = targetTrack.id;
    const dropTime = dropTimeFromEvent(e);
    const videoClipId = nextId("clip");
    const audioClipId = isAvLinkedDrop ? nextId("clip") : null;
    const placeholderDur = selection.clipDuration;
    const trackClips = clips.filter((c) => c.trackId === targetTrackId);

    // Decide placement on the primary track (insert / constrain / free)
    let placeholderStart = dropTime;
    let baseTrackClips = trackClips;
    let insertPoint = null; // remembered for probe re-ripple
    if (snapEnabled) {
      const ins = detectInsertPoint(
        videoClipId,
        dropTime,
        placeholderDur,
        trackClips,
      );
      if (ins) {
        insertPoint = ins.insertPoint;
        placeholderStart = ins.insertPoint;
        baseTrackClips = applyRippleInsert(
          trackClips,
          videoClipId,
          ins.insertPoint,
          placeholderDur,
        );
      } else {
        placeholderStart = constrainMoveStart(
          dropTime,
          placeholderDur,
          trackClips,
        );
      }
    }

    // Build the clip(s). For AV, produce a linked video+audio pair with the SAME startTime.
    const pairSelection = {
      inPoint: selection.inPoint,
      outPoint: selection.outPoint,
      duration: selection.duration,
    };
    const producedClips = splitMediaIntoLinkedClips({
      media: video,
      selection: pairSelection,
      startTime: placeholderStart,
      videoClipId,
      audioClipId,
      videoTrackId: isAvLinkedDrop
        ? targetTrackId
        : trackMode === "audio"
          ? null
          : targetTrackId,
      audioTrackId: isAvLinkedDrop
        ? linkedAudioTrack.id
        : trackMode === "audio"
          ? targetTrackId
          : null,
      trackMode,
      hasAudio: true, // assume videos have audio; user can unlink/delete if not
      linkGroupIdFactory: nextLinkGroupId,
    });
    if (producedClips.length === 0) return;

    // If we also placed an audio clip on a secondary track, apply independent ripple on that track
    let audioTrackClipsAfter = null;
    if (isAvLinkedDrop && linkedAudioTrack) {
      const audioTrackId = linkedAudioTrack.id;
      const audioSibling = clips.filter((c) => c.trackId === audioTrackId);
      if (snapEnabled) {
        const ins = detectInsertPoint(
          audioClipId,
          placeholderStart + placeholderDur / 2,
          placeholderDur,
          audioSibling,
        );
        if (ins) {
          audioTrackClipsAfter = applyRippleInsert(
            audioSibling,
            audioClipId,
            placeholderStart,
            placeholderDur,
          );
        } else {
          // If target audio position overlaps, leave overlapping clips alone; resolveOverlaps will cut them.
          audioTrackClipsAfter = audioSibling;
        }
      } else {
        audioTrackClipsAfter = audioSibling;
      }
    }

    // Compose the new clip list track-by-track and commit
    const otherTrackClips = clips.filter(
      (c) =>
        c.trackId !== targetTrackId &&
        (!linkedAudioTrack || c.trackId !== linkedAudioTrack.id),
    );
    const primaryList = [
      ...baseTrackClips,
      ...producedClips.filter((c) => c.trackId === targetTrackId),
    ];
    const audioList = linkedAudioTrack
      ? [
          ...(audioTrackClipsAfter || []),
          ...producedClips.filter((c) => c.trackId === linkedAudioTrack.id),
        ]
      : [];
    const initialList = [...otherTrackClips, ...primaryList, ...audioList];

    if (snapEnabled) {
      commitClips(initialList);
    } else {
      // Overwrite: resolve overlaps per track independently
      const resolvedPrimary = resolveOverlaps(primaryList, videoClipId, () =>
        nextId("clip"),
      );
      const resolvedAudio =
        linkedAudioTrack && audioClipId
          ? resolveOverlaps(audioList, audioClipId, () => nextId("clip"))
          : audioList;
      commitClips([...otherTrackClips, ...resolvedPrimary, ...resolvedAudio]);
    }

    const cachedDuration = videoDurations[video.id];
    const duration =
      cachedDuration ??
      (await probeDuration(video.src, video.mediaType, settings.imageDuration));
    if (cachedDuration == null) {
      setVideoDurations((prev) =>
        prev[video.id] != null ? prev : { ...prev, [video.id]: duration },
      );
    }
    // The primary clip id we track for post-probe updates:
    const primaryClipId = videoClipId;
    const linkedIds = new Set([primaryClipId, audioClipId].filter(Boolean));
    setClips((prev) => {
      const placeholderClip = prev.find((c) => c.id === primaryClipId);
      if (!placeholderClip) return prev; // user removed it during probe
      const resolvedIn = hasExplicitSourceRange ? selection.inPoint : 0;
      const resolvedOut = hasExplicitSourceRange
        ? Math.min(selection.outPoint, duration)
        : duration;
      const clampedOut = Math.max(resolvedIn + MIN_CLIP_DURATION, resolvedOut);
      // Apply probed duration / range to ALL linked partners so video and audio stay in sync.
      let updated = prev.map((c) =>
        linkedIds.has(c.id)
          ? {
              ...c,
              sourceDuration: duration,
              inPoint: resolvedIn,
              outPoint: clampedOut,
            }
          : c,
      );
      // Track-aware overlap resolution for each linked partner
      const resolveTrackAware = (clipList) => {
        const byTrack = new Map();
        clipList.forEach((c) => {
          if (!byTrack.has(c.trackId)) byTrack.set(c.trackId, []);
          byTrack.get(c.trackId).push(c);
        });
        const resolved = [];
        byTrack.forEach((trackClipList) => {
          const modified = trackClipList.find((c) => linkedIds.has(c.id));
          if (modified) {
            resolved.push(
              ...resolveOverlaps(trackClipList, modified.id, () =>
                nextId("clip"),
              ),
            );
          } else {
            resolved.push(...trackClipList);
          }
        });
        return resolved;
      };
      if (!snapEnabled) {
        return resolveTrackAware(updated);
      }
      // Snap-on: adjust ripple by (actualDuration - placeholderDur) for clips behind the insert point
      if (insertPoint != null) {
        const extra = clampedOut - resolvedIn - placeholderDur;
        if (Math.abs(extra) > 1e-3) {
          const insertEnd = placeholderStart + placeholderDur; // boundary in current (already-rippled) timeline
          updated = updated.map((x) => {
            if (linkedIds.has(x.id)) return x;
            if (x.trackId === targetTrackId && x.startTime >= insertEnd - 1e-3)
              return { ...x, startTime: x.startTime + extra };
            return x;
          });
        }
        return updated;
      }
      // Gap mode: trim outPoint (and propagate to linked partner) if it now overlaps the right neighbor on the primary track
      const c = updated.find((x) => x.id === primaryClipId);
      if (!c) return updated;
      const others = updated.filter(
        (x) => !linkedIds.has(x.id) && x.trackId === targetTrackId,
      );
      const maxRight = maxEndForTrimRight(c.startTime, others);
      const cEnd = c.startTime + (c.outPoint - c.inPoint);
      if (cEnd > maxRight + 1e-3) {
        const newOutPoint = Math.max(
          c.inPoint + MIN_CLIP_DURATION,
          c.inPoint + (maxRight - c.startTime),
        );
        return updated.map((x) =>
          linkedIds.has(x.id) ? { ...x, outPoint: newOutPoint } : x,
        );
      }
      return updated;
    });
  };

  // --- seeking ---
  const seekToTime = useCallback(
    (t) => {
      t = Math.max(0, t);
      setSourceMonitorId(null);
      setEditorFocus(FOCUS_TIMELINE);
      timelineTimeRef.current = t;
      updateTimelinePlayheadPosition(t);
      setTimelineTime(t);
      const clip = getTopVisibleTimelineClip({
        time: t,
        clips,
        lookups: timelinePlaybackLookups,
      });
      if (clip) {
        playingClipIdRef.current = clip.id;
        setActiveClipId(clip.id);
        setActiveId(clip.videoId);
        imagePlaybackRef.current = null;
        pendingSeekRef.current = null;
        pendingPlayRef.current = false;
      } else {
        playingClipIdRef.current = null;
        imagePlaybackRef.current = null;
        pendingSeekRef.current = null;
        pendingPlayRef.current = false;
      }
      if (playbackModeRef.current === "timeline" && isPlaying) {
        timelinePlaybackRef.current = {
          startedAtMs: performance.now(),
          timelineStart: t,
        };
      } else {
        timelinePlaybackRef.current = null;
      }
    },
    [clips, isPlaying, timelinePlaybackLookups, updateTimelinePlayheadPosition],
  );

  const getXInTracks = (clientX) => {
    if (!tracksContentRef.current) return 0;
    const rect = tracksContentRef.current.getBoundingClientRect();
    return clientX - rect.left + tracksContentRef.current.scrollLeft;
  };

  // --- mouse interactions ---
  // Pause helper: pauses if playing and remembers state for resume on mouseup
  const beginScrub = () => {
    const v = videoRef.current;
    const wasPlaying = playbackModeRef.current === "timeline" && isPlaying;
    if (wasPlaying && v && !v.paused) v.pause();
    if (wasPlaying) pauseTimelinePreviewMedia();
    return wasPlaying;
  };

  const handleTracksMouseDown = (e) => {
    const clipUnderPointer = Array.from(
      tracksContentRef.current?.querySelectorAll(".clip") || [],
    ).some((node) => {
      const rect = node.getBoundingClientRect();
      return (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      );
    });
    if (
      e.target.closest(".clip") ||
      clipUnderPointer ||
      e.target.closest(".playhead-handle")
    )
      return;
    if (e.button !== 0) return;
    e.preventDefault();
    setEditorFocus(FOCUS_TIMELINE);
    setSourceMonitorId(null);
    if (playbackModeRef.current === "source") stopPlayback();
    const x = getXInTracks(e.clientX);
    const t = Math.max(0, x / pxPerSec);
    // Click on the time-ruler keeps classic seek/scrub behavior.
    if (e.target.closest(".time-ruler")) {
      const wasPlaying = beginScrub();
      seekToTime(t);
      const i = { type: "seek", wasPlaying };
      interactionRef.current = i;
      setInteraction(i);
      return;
    }
    // Click on track area: detect gap, otherwise prepare for marquee/deselect.
    const gap = findGapAtTime(t, clips);
    const rect = tracksContentRef.current?.getBoundingClientRect();
    const startY = rect
      ? e.clientY - rect.top + (tracksContentRef.current.scrollTop || 0)
      : 0;
    const i = {
      type: "select-pending",
      startX: x,
      startY,
      startClientX: e.clientX,
      startClientY: e.clientY,
      pendingGap: gap,
      additive: e.shiftKey || e.ctrlKey || e.metaKey,
      initialSelection: new Set(selectedClipIds),
    };
    interactionRef.current = i;
    setInteraction(i);
  };

  const handlePlayheadMouseDown = (e) => {
    e.stopPropagation();
    e.preventDefault();
    setEditorFocus(FOCUS_TIMELINE);
    setSourceMonitorId(null);
    if (playbackModeRef.current === "source") stopPlayback();
    const wasPlaying = beginScrub();
    const i = { type: "seek", wasPlaying };
    interactionRef.current = i;
    setInteraction(i);
  };

  const handleClipMouseDown = (e, clip) => {
    if (e.target.closest(".trim-handle") || e.target.closest(".clip-remove"))
      return;
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setEditorFocus(FOCUS_TIMELINE);
    setSourceMonitorId(null);
    if (playbackModeRef.current === "source") stopPlayback();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    setSelectedGap(null);

    // Alt-drag → duplicate the clip(s) and drag the copies (Premiere/Filmora-style)
    if (e.altKey) {
      const idsToClone =
        selectedClipIds.has(clip.id) && selectedClipIds.size > 1
          ? Array.from(selectedClipIds)
          : [clip.id];
      const idMap = new Map();
      const clones = [];
      for (const oldId of idsToClone) {
        const c = clips.find((x) => x.id === oldId);
        if (!c) continue;
        const newId = nextId("clip");
        idMap.set(oldId, newId);
        clones.push({ ...c, id: newId });
      }
      if (clones.length === 0) return;
      const preCloneSnapshot = clips.map((c) => ({ ...c }));
      const newClips = [...clips, ...clones];
      setClips(newClips);
      const newPrimaryId = idMap.get(clip.id);
      const newSelected = new Set(idMap.values());
      setSelectedClipIds(newSelected);
      setActiveClipId(newPrimaryId);
      setActiveId(clip.videoId);
      const x = getXInTracks(e.clientX);
      const i = {
        type: "move",
        clipId: newPrimaryId,
        startX: x,
        startClientY: e.clientY,
        originalClip: clones.find((c) => c.id === newPrimaryId),
        selectedSnaps: clones.length > 1 ? clones.map((c) => ({ ...c })) : null,
        trackMoveClipIds: Array.from(newSelected),
        snapshotBefore: newClips.map((c) => ({ ...c })),
        tracksBefore: tracks.map((track) => ({ ...track })),
        historyBefore: createHistorySnapshot(preCloneSnapshot, tracks), // undo restores to pre-clone state
        moved: true,
      };
      interactionRef.current = i;
      setInteraction(i);
      return;
    }

    let selectedIds;
    let explicitSelectedIds;
    if (additive) {
      const next = new Set(selectedClipIds);
      const wasSelected = next.has(clip.id);
      if (wasSelected) {
        next.delete(clip.id);
      } else {
        next.add(clip.id);
      }
      setSelectedClipIds(next);
      if (!wasSelected) {
        setActiveClipId(clip.id);
        setActiveId(clip.videoId);
      } else if (activeClipId === clip.id) {
        setActiveClipId(next.size > 0 ? next.values().next().value : null);
      }
      return;
    }
    if (selectedClipIds.has(clip.id) && selectedClipIds.size > 1) {
      explicitSelectedIds = new Set(selectedClipIds);
      selectedIds = expandWithLinkedPartners(clips, explicitSelectedIds);
    } else {
      explicitSelectedIds = new Set([clip.id]);
      selectedIds = expandWithLinkedPartners(clips, explicitSelectedIds);
      setSelectedClipIds(explicitSelectedIds);
    }
    setActiveClipId(clip.id);
    setActiveId(clip.videoId);

    const x = getXInTracks(e.clientX);
    const selectedSnaps = clips
      .filter((c) => selectedIds.has(c.id))
      .map((c) => ({ ...c }));
    const i = {
      type: "move",
      clipId: clip.id,
      startX: x,
      startClientY: e.clientY,
      originalClip: { ...clip },
      selectedSnaps,
      trackMoveClipIds: Array.from(explicitSelectedIds),
      snapshotBefore: clips.map((c) => ({ ...c })),
      tracksBefore: tracks.map((track) => ({ ...track })),
      moved: false,
    };
    interactionRef.current = i;
    setInteraction(i);
  };

  const handleTrimMouseDown = (e, clip, side) => {
    e.stopPropagation();
    e.preventDefault();
    setEditorFocus(FOCUS_TIMELINE);
    setSourceMonitorId(null);
    if (playbackModeRef.current === "source") stopPlayback();
    setActiveClipId(clip.id);
    setActiveId(clip.videoId);
    const media = videos.find((v) => v.id === clip.videoId) || null;
    const x = getXInTracks(e.clientX);
    const i = {
      type: side === "left" ? "trim-left" : "trim-right",
      clipId: clip.id,
      startX: x,
      originalClip: { ...clip, mediaType: media?.mediaType || "video" },
      snapshotBefore: clips.map((c) => ({ ...c })),
      moved: false,
    };
    interactionRef.current = i;
    setInteraction(i);
  };

  // snap helper (now returns {value, snapped}). Pass `sourceList` to use snapshot
  // edges instead of live (important during ripple-insert so snap targets stay stable).
  const snapValue = (value, excludeClipId, sourceList = clips) => {
    if (!snapEnabled) return { value, snapped: false };
    const points = [0, timelineTime];
    for (const c of sourceList) {
      if (c.id === excludeClipId) continue;
      points.push(c.startTime);
      points.push(c.startTime + (c.outPoint - c.inPoint));
    }
    let best = value;
    let bestDistPx = SNAP_THRESHOLD_PX;
    let didSnap = false;
    for (const p of points) {
      const dPx = Math.abs(p - value) * pxPerSec;
      if (dPx < bestDistPx) {
        bestDistPx = dPx;
        best = p;
        didSnap = true;
      }
    }
    return { value: best, snapped: didSnap, snappedTo: didSnap ? best : null };
  };

  // global mouse move/up
  useEffect(() => {
    if (!interaction) return;
    const onMove = (ev) => {
      const x = getXInTracks(ev.clientX);
      const it = interactionRef.current;
      if (!it) return;
      // Shift held → temporarily disable snap during this move (Premiere-style)
      const effSnap = snapEnabled && !ev.shiftKey;
      // Auto-scroll near viewport edges while dragging
      const tcEl = tracksContentRef.current;
      if (tcEl) {
        const tcRect = tcEl.getBoundingClientRect();
        const edge = 50;
        if (ev.clientX < tcRect.left + edge) tcEl.scrollLeft -= 12;
        else if (ev.clientX > tcRect.right - edge) tcEl.scrollLeft += 12;
      }

      if (it.type === "seek") {
        const t = Math.max(0, x / pxPerSec);
        seekToTime(t);
        setScrubTooltip({ x, time: t });
        return;
      }

      // Pending click on empty track area: become a marquee on enough drag
      if (it.type === "select-pending") {
        const dx = ev.clientX - it.startClientX;
        const dy = ev.clientY - it.startClientY;
        if (
          Math.abs(dx) < MOVE_THRESHOLD_PX &&
          Math.abs(dy) < MOVE_THRESHOLD_PX
        )
          return;
        it.type = "marquee";
      }
      if (it.type === "marquee") {
        const rect = tracksContentRef.current?.getBoundingClientRect();
        if (!rect) return;
        const curX =
          ev.clientX - rect.left + tracksContentRef.current.scrollLeft;
        const curY = ev.clientY - rect.top + tracksContentRef.current.scrollTop;
        const x1 = Math.min(it.startX, curX),
          x2 = Math.max(it.startX, curX);
        const y1 = Math.min(it.startY, curY),
          y2 = Math.max(it.startY, curY);
        setMarqueeBox({ x1, y1, x2, y2 });
        const tStart = x1 / pxPerSec,
          tEnd = x2 / pxPerSec;
        const hits = new Set(
          it.additive ? Array.from(it.initialSelection) : [],
        );
        for (const c of clips) {
          const cS = c.startTime,
            cE = c.startTime + (c.outPoint - c.inPoint);
          if (cE > tStart + 1e-3 && cS < tEnd - 1e-3) hits.add(c.id);
        }
        setSelectedClipIds(hits);
        return;
      }

      // movement threshold
      const movedX = Math.abs(x - it.startX);
      const movedY = Math.abs(ev.clientY - (it.startClientY ?? ev.clientY));
      if (!it.moved && movedX < MOVE_THRESHOLD_PX && movedY < MOVE_THRESHOLD_PX)
        return;
      const orig = it.originalClip;
      if (!orig) return;
      const deltaSec = (x - it.startX) / pxPerSec;

      // Multi-clip move: shift the whole group uniformly, with snap-on ripple-insert support
      if (
        it.type === "move" &&
        it.selectedSnaps &&
        it.selectedSnaps.length > 1
      ) {
        const snaps = it.selectedSnaps;
        const selectedIdsSet = new Set(snaps.map((s) => s.id));
        const trackMoveClipIds = new Set(
          it.trackMoveClipIds || snaps.map((s) => s.id),
        );
        const trackMoveSnaps = snaps.filter((s) => trackMoveClipIds.has(s.id));
        const nonSelected = it.snapshotBefore.filter(
          (c) => !selectedIdsSet.has(c.id),
        );
        const leftmostStart = Math.min(...snaps.map((s) => s.startTime));
        const rightmostEnd = Math.max(
          ...snaps.map((s) => s.startTime + (s.outPoint - s.inPoint)),
        );
        const groupDur = rightmostEnd - leftmostStart;
        const primarySnap = snaps.find((s) => s.id === it.clipId) || snaps[0];
        const movePlan = getMoveTrackPlan(
          trackMoveSnaps.length > 0 ? trackMoveSnaps : [primarySnap],
          it.clipId,
          ev.clientY,
          it,
        );
        const primaryTargetTrackId =
          movePlan.primaryTargetTrackId || primarySnap.trackId;
        const trackMovedSnaps = applyTrackMovePlan(trackMoveSnaps, movePlan);
        const trackMovedMap = new Map(trackMovedSnaps.map((s) => [s.id, s]));
        const remappedSnaps = snaps.map((s) => trackMovedMap.get(s.id) || s);
        updateTrackMovePreview(movePlan);

        // ── Snap-ON ripple-insert: if the group's projected center is over a non-selected clip
        // (or falls in a too-small gap), push everything aside and drop the entire group there.
        if (effSnap) {
          const proposedLeftmost = leftmostStart + deltaSec;
          const proposedCenter = proposedLeftmost + groupDur / 2;
          // Track-aware: only consider clips on the same track as the primary clip
          const trackNonSelected = nonSelected.filter(
            (c) => c.trackId === primaryTargetTrackId,
          );
          const ins = detectInsertPoint(
            "__group__",
            proposedCenter,
            groupDur,
            trackNonSelected,
          );
          if (ins) {
            const groupShift = ins.insertPoint - leftmostStart;
            const movedSnaps = placeLinkedSyncClips(
              remappedSnaps.map((snap) => ({
                ...snap,
                startTime: snap.startTime + groupShift,
              })),
              trackMoveClipIds,
              it,
            );
            const movedSnapMap = new Map(
              movedSnaps.map((snap) => [snap.id, snap]),
            );
            const moved = it.snapshotBefore.map((c) => {
              if (selectedIdsSet.has(c.id)) return movedSnapMap.get(c.id) || c;
              // Non-selected clips at-or-after the insert point get pushed right by the group span
              if (
                c.trackId === primaryTargetTrackId &&
                c.startTime >= ins.insertPoint - 1e-3
              )
                return { ...c, startTime: c.startTime + groupDur };
              return c;
            });
            updateTrackMovePreviewFromClips(movedSnaps, movePlan, it);
            setSnapIndicatorTime(ins.insertPoint);
            setClips(moved);
            it.moved = true;
            return;
          }
        }

        // ── Otherwise: clamped uniform shift (no insert)
        let delta = deltaSec;
        if (effSnap) {
          // Track-aware: only consider clips on the same track as the group
          const targetTrackSnaps = remappedSnaps.filter(
            (s) => s.trackId === primaryTargetTrackId,
          );
          const trackNonSelected = nonSelected.filter(
            (c) => c.trackId === primaryTargetTrackId,
          );
          let maxRightShift = Number.MAX_SAFE_INTEGER,
            maxLeftShift = Number.MAX_SAFE_INTEGER;
          for (const s of targetTrackSnaps) {
            const sE = s.startTime + (s.outPoint - s.inPoint);
            for (const n of trackNonSelected) {
              const nS = n.startTime,
                nE = n.startTime + (n.outPoint - n.inPoint);
              if (nS >= sE - 1e-3 && nS - sE < maxRightShift)
                maxRightShift = nS - sE;
              if (nE <= s.startTime + 1e-3 && s.startTime - nE < maxLeftShift)
                maxLeftShift = s.startTime - nE;
            }
          }
          delta = Math.max(-maxLeftShift, Math.min(maxRightShift, delta));
        }
        delta = Math.max(-leftmostStart, delta);
        const movedSnaps = placeLinkedSyncClips(
          remappedSnaps.map((snap) => ({
            ...snap,
            startTime: snap.startTime + delta,
          })),
          trackMoveClipIds,
          it,
        );
        const movedSnapMap = new Map(movedSnaps.map((snap) => [snap.id, snap]));
        const moved = it.snapshotBefore.map((c) => {
          const s = movedSnapMap.get(c.id);
          return s || c;
        });
        updateTrackMovePreviewFromClips(movedSnaps, movePlan, it);
        setSnapIndicatorTime(null);
        setClips(moved);
        it.moved = true;
        return;
      }

      if (it.type === "move") {
        const dur = orig.outPoint - orig.inPoint;
        let newStart = Math.max(0, orig.startTime + deltaSec);
        const movePlan = getMoveTrackPlan([orig], orig.id, ev.clientY, it);
        const movedOrig = applyTrackMovePlan([orig], movePlan)[0] || orig;
        const targetTrackIdForMove = movedOrig.trackId;
        updateTrackMovePreview(movePlan);
        // Track-aware: filter snapshot to only clips on the target track
        const trackSnapshot = it.snapshotBefore.filter(
          (c) => c.id !== orig.id && c.trackId === targetTrackIdForMove,
        );
        if (effSnap) {
          // Ripple-insert mode: when the dragged clip's center sits over another clip,
          // or in a gap too small for it, push the rest of the timeline aside (Filmora-style).
          const center = newStart + dur / 2;
          const ins = detectInsertPoint(orig.id, center, dur, trackSnapshot);
          if (ins) {
            const rippledTrack = applyRippleInsert(
              trackSnapshot,
              orig.id,
              ins.insertPoint,
              dur,
            );
            // Merge rippled track back with other tracks
            setClips(
              it.snapshotBefore
                .filter(
                  (c) => c.id !== orig.id && c.trackId !== targetTrackIdForMove,
                )
                .concat(rippledTrack, {
                  ...movedOrig,
                  startTime: ins.insertPoint,
                }),
            );
            setSnapIndicatorTime(ins.insertPoint);
            it.moved = true;
            return;
          }
          // Otherwise: edge-snap to snapshot positions, then constrain to non-overlap
          const sStart = snapValue(newStart, orig.id, trackSnapshot);
          const sEnd = snapValue(newStart + dur, orig.id, trackSnapshot);
          const distStart = Math.abs(sStart.value - newStart);
          const distEnd = Math.abs(sEnd.value - (newStart + dur));
          let snappedAt = null;
          if (
            sStart.snapped &&
            (!sEnd.snapped || distStart * pxPerSec <= distEnd * pxPerSec)
          ) {
            newStart = sStart.value;
            snappedAt = sStart.value;
          } else if (sEnd.snapped) {
            newStart = sEnd.value - dur;
            snappedAt = sEnd.value;
          }
          if (newStart < 0) {
            newStart = 0;
            snappedAt = 0;
          }
          const others = trackSnapshot.filter((c) => c.id !== orig.id);
          const constrained = constrainMoveStart(newStart, dur, others);
          if (Math.abs(constrained - newStart) > 1e-3) snappedAt = null;
          newStart = constrained;
          // Restore other clips to snapshot positions (in case a previous frame rippled them)
          setSnapIndicatorTime(snappedAt);
          setClips(
            it.snapshotBefore.map((c) =>
              c.id === orig.id ? { ...movedOrig, startTime: newStart } : c,
            ),
          );
          it.moved = true;
        } else {
          // Snap-off: free move; snap-off snap is no-op anyway
          if (newStart < 0) newStart = 0;
          setSnapIndicatorTime(null);
          setClips((prev) =>
            prev.map((c) =>
              c.id === orig.id ? { ...movedOrig, startTime: newStart } : c,
            ),
          );
          it.moved = true;
        }
      } else if (it.type === "trim-left") {
        const minNewIn = Math.max(0, orig.inPoint - orig.startTime);
        let newInPoint = Math.max(
          minNewIn,
          Math.min(orig.outPoint - MIN_CLIP_DURATION, orig.inPoint + deltaSec),
        );
        let finalStart = Math.max(
          0,
          orig.startTime + (newInPoint - orig.inPoint),
        );
        const s = snapValue(finalStart, orig.id);
        let snappedAt = null;
        if (s.snapped) {
          const adjustedIn = newInPoint + (s.value - finalStart);
          if (
            adjustedIn >= minNewIn &&
            adjustedIn < orig.outPoint - MIN_CLIP_DURATION
          ) {
            newInPoint = adjustedIn;
            finalStart = orig.startTime + (newInPoint - orig.inPoint);
            snappedAt = s.value;
          }
        }
        // Snap-on: prevent overlap with left neighbor
        if (effSnap) {
          const origTrackId = orig.trackId;
          const others = clips.filter(
            (c) => c.id !== orig.id && c.trackId === origTrackId,
          );
          const fixedRight = orig.startTime + (orig.outPoint - orig.inPoint);
          const minLeft = minStartForTrimLeft(fixedRight, others);
          if (finalStart < minLeft - 1e-3) {
            const delta = minLeft - finalStart;
            newInPoint = Math.min(
              orig.outPoint - MIN_CLIP_DURATION,
              newInPoint + delta,
            );
            finalStart = orig.startTime + (newInPoint - orig.inPoint);
            snappedAt = null;
          }
        }
        setSnapIndicatorTime(snappedAt);
        setClips((prev) =>
          applyGroupTrimLeft(prev, orig.id, {
            inPoint: newInPoint,
            startTime: finalStart,
          }),
        );
        it.moved = true;
      } else if (it.type === "trim-right") {
        const maxOutPoint =
          orig.mediaType === "image" ? Number.MAX_SAFE_INTEGER : (orig.sourceDuration || Number.MAX_SAFE_INTEGER);
        let newOutPoint = Math.max(
          orig.inPoint + MIN_CLIP_DURATION,
          Math.min(maxOutPoint, orig.outPoint + deltaSec),
        );
        let rightOnTimeline = orig.startTime + (newOutPoint - orig.inPoint);
        const s = snapValue(rightOnTimeline, orig.id);
        let snappedAt = null;
        if (s.snapped) {
          const adjustedOut = newOutPoint + (s.value - rightOnTimeline);
          if (
            adjustedOut > orig.inPoint + MIN_CLIP_DURATION &&
            adjustedOut <= maxOutPoint
          ) {
            newOutPoint = adjustedOut;
            rightOnTimeline = orig.startTime + (newOutPoint - orig.inPoint);
            snappedAt = s.value;
          }
        }
        // Snap-on: prevent overlap with right neighbor
        if (effSnap) {
          const origTrackId = orig.trackId;
          const others = clips.filter(
            (c) => c.id !== orig.id && c.trackId === origTrackId,
          );
          const maxRight = maxEndForTrimRight(orig.startTime, others);
          if (rightOnTimeline > maxRight + 1e-3) {
            const delta = rightOnTimeline - maxRight;
            newOutPoint = Math.max(
              orig.inPoint + MIN_CLIP_DURATION,
              newOutPoint - delta,
            );
            snappedAt = null;
          }
        }
        setSnapIndicatorTime(snappedAt);
        setClips((prev) =>
          applyGroupTrimRight(prev, orig.id, { outPoint: newOutPoint }),
        );
        it.moved = true;
      }
    };
    const onUp = () => {
      const it = interactionRef.current;
      if (it && it.type === "select-pending") {
        // Pure click: select gap, or deselect everything
        if (it.pendingGap) {
          setSelectedGap(it.pendingGap);
          if (!it.additive) setSelectedClipIds(new Set());
          setActiveClipId(null);
        } else if (!it.additive) {
          setSelectedClipIds(new Set());
          setSelectedGap(null);
          setActiveClipId(null);
        }
      } else if (it && it.type === "marquee") {
        // Selection already updated during drag; just clear the box
        setMarqueeBox(null);
      } else if (it && it.type === "move" && !it.moved) {
        // Click without drag: collapse multi-selection to just the clicked clip
        setSelectedClipIds(new Set([it.clipId]));
      } else if (it && it.moved && it.snapshotBefore) {
        // Alt-drag stores a separate pre-clone snapshot so undo restores to before duplication.
        pushHistory(
          it.historyBefore ||
            createHistorySnapshot(it.snapshotBefore, it.tracksBefore || tracks),
        );
        const pendingAutoTracks =
          it.pendingAutoTracks || it.trackMovePlan?.autoTracks || [];
        if (it.type === "move" && pendingAutoTracks.length > 0) {
          setTracks(
            (prev) =>
              applyTrackMovePlan({
                tracks: prev,
                clips: [],
                plan: { autoTracks: pendingAutoTracks },
              }).tracks,
          );
        }
        // Snap-off: cut overlapping neighbors (Filmora overwrite)
        if (!snapEnabled) {
          const isMultiMove =
            it.type === "move" &&
            it.selectedSnaps &&
            it.selectedSnaps.length > 1;
          if (isMultiMove) {
            const ids = new Set(it.selectedSnaps.map((s) => s.id));
            // Track-aware: resolve overlaps per track
            setClips((prev) => {
              const byTrack = new Map();
              prev.forEach((c) => {
                if (!byTrack.has(c.trackId)) byTrack.set(c.trackId, []);
                byTrack.get(c.trackId).push(c);
              });
              const resolved = [];
              byTrack.forEach((trackClipList) => {
                const modified = trackClipList.filter((c) => ids.has(c.id));
                if (modified.length > 0) {
                  const modifierIds = modified.map((c) => c.id);
                  resolved.push(
                    ...resolveOverlapsMulti(trackClipList, modifierIds, () =>
                      nextId("clip"),
                    ),
                  );
                } else {
                  resolved.push(...trackClipList);
                }
              });
              return resolved;
            });
          } else if (
            it.type === "move" ||
            it.type === "trim-left" ||
            it.type === "trim-right"
          ) {
            // Track-aware: resolve overlaps only within the clip's track
            setClips((prev) => {
              const orig = prev.find((c) => c.id === it.clipId);
              if (!orig) return prev;
              const trackId = orig.trackId;
              const trackClips = prev.filter((c) => c.trackId === trackId);
              const otherTracks = prev.filter((c) => c.trackId !== trackId);
              const resolvedTrack = resolveOverlaps(trackClips, it.clipId, () =>
                nextId("clip"),
              );
              return [...otherTracks, ...resolvedTrack];
            });
          }
        }
      }
      // Resume timeline playback at the scrubbed position, including empty gaps.
      if (it && it.type === "seek" && it.wasPlaying) {
        const resumeTime = timelineTimeRef.current;
        const resumeClip = getTopVisibleTimelineClip({
          time: resumeTime,
          clips: playbackRef.current.clips,
          lookups: timelinePlaybackLookups,
        });
        if (resumeClip) startClipPlayback(resumeClip, resumeTime);
        else startTimelineGapPlayback(resumeTime);
      }
      interactionRef.current = null;
      setInteraction(null);
      setSnapIndicatorTime(null);
      setScrubTooltip(null);
      setDropTargetTrackId(null);
      setTrackMovePreview(null);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interaction, clips, timelineTime, activeClipId, pxPerSec, snapEnabled]);

  // ---- Clip actions ----
  const duplicateClip = useCallback(
    (clipId) => {
      const clip = clips.find((c) => c.id === clipId);
      if (!clip) return;
      const dur = clip.outPoint - clip.inPoint;
      const newId = nextId("clip");
      let newStart = clip.startTime + dur;
      if (snapEnabled) newStart = constrainMoveStart(newStart, dur, clips);
      const newClip = { ...clip, id: newId, startTime: newStart };
      let next = [...clips, newClip];
      if (!snapEnabled)
        next = resolveOverlaps(next, newId, () => nextId("clip"));
      commitClips(next);
      setActiveClipId(newId);
    },
    [clips, commitClips, snapEnabled],
  );

  const restoreTrim = useCallback(
    (clipId) => {
      const clip = clips.find((c) => c.id === clipId);
      if (!clip) return;
      const others = clips.filter((c) => c.id !== clipId);
      const fullStart = clip.startTime - clip.inPoint;
      const proposedStart = Math.max(0, fullStart);
      const proposedEnd = fullStart + clip.sourceDuration;
      if (snapEnabled) {
        let leftLimit = 0;
        for (const o of others) {
          const oE = o.startTime + (o.outPoint - o.inPoint);
          if (oE <= clip.startTime + 1e-3 && oE > leftLimit) leftLimit = oE;
        }
        const oldRight = clip.startTime + (clip.outPoint - clip.inPoint);
        let rightLimit = Number.MAX_SAFE_INTEGER;
        for (const o of others) {
          if (o.startTime >= oldRight - 1e-3 && o.startTime < rightLimit)
            rightLimit = o.startTime;
        }
        const newStart = Math.max(proposedStart, leftLimit);
        const newEnd = Math.min(proposedEnd, rightLimit);
        if (newEnd - newStart < MIN_CLIP_DURATION) return;
        const newInPoint = newStart - fullStart;
        const newOutPoint = newEnd - fullStart;
        commitClips(
          clips.map((c) =>
            c.id === clipId
              ? {
                  ...c,
                  inPoint: newInPoint,
                  outPoint: newOutPoint,
                  startTime: newStart,
                }
              : c,
          ),
        );
      } else {
        const restored = clips.map((c) =>
          c.id === clipId
            ? {
                ...c,
                inPoint: 0,
                outPoint: c.sourceDuration,
                startTime: proposedStart,
              }
            : c,
        );
        commitClips(resolveOverlaps(restored, clipId, () => nextId("clip")));
      }
    },
    [clips, commitClips, snapEnabled],
  );

  const handleClipContextMenu = (e, clip) => {
    e.preventDefault();
    e.stopPropagation();
    setEditorFocus(FOCUS_TIMELINE);
    setSourceMonitorId(null);
    setActiveClipId(clip.id);
    setActiveId(clip.videoId);
    setContextMenu({ x: e.clientX, y: e.clientY, clipId: clip.id });
  };

  // --- split at playhead ---
  // Splits ALL selected clips at the playhead (respects linked groups).
  // If nothing is selected, falls back to the active/topmost clip.
  const splitAtPlayhead = useCallback(() => {
    const candidates = clips.filter((c) => {
      const dur = c.outPoint - c.inPoint;
      return (
        timelineTime > c.startTime + MIN_CLIP_DURATION &&
        timelineTime < c.startTime + dur - MIN_CLIP_DURATION
      );
    });
    if (candidates.length === 0) return;

    // Determine which candidates to split
    let splitTargets;
    if (selectedClipIds.size > 0) {
      splitTargets = candidates.filter((c) => selectedClipIds.has(c.id));
      // If none of the selected clips are under the playhead, fall back
      if (splitTargets.length === 0) {
        splitTargets = [
          candidates.find((c) => c.id === activeClipId) || candidates[0],
        ];
      }
    } else {
      splitTargets = [
        candidates.find((c) => c.id === activeClipId) ||
          candidates.find((c) => c.linkGroupId && selectedClipIds.has(c.id)) ||
          candidates[0],
      ];
    }

    // Apply splits iteratively; skip if the linked group was already split
    let newClips = clips;
    const doneGroups = new Set();
    const allNewRightIds = [];

    for (const target of splitTargets) {
      if (target.linkGroupId && doneGroups.has(target.linkGroupId)) continue;
      if (target.linkGroupId) doneGroups.add(target.linkGroupId);
      const before = newClips;
      newClips = applyGroupSplit(
        newClips,
        target.id,
        timelineTime,
        () => nextId("clip"),
        nextLinkGroupId,
      );
      if (newClips !== before) {
        const freshIds = newClips
          .filter((c) => !before.some((p) => p.id === c.id))
          .map((c) => c.id);
        allNewRightIds.push(...freshIds);
      }
    }

    if (newClips === clips) return;
    commitClips(newClips);

    if (allNewRightIds.length > 0) setActiveClipId(allNewRightIds[0]);
    const nextSel = new Set(selectedClipIds);
    if (nextSel.size > 0) {
      for (const id of allNewRightIds) nextSel.add(id);
      setSelectedClipIds(expandWithLinkedPartners(newClips, nextSel));
    }
  }, [clips, timelineTime, commitClips, selectedClipIds, activeClipId]);

  const handleClipRemove = (clipId, e) => {
    e.stopPropagation();
    // Delete the clip AND its linked partner(s) so linked V+A stays consistent.
    const toRemove = expandWithLinkedPartners(clips, [clipId]);
    commitClips(clips.filter((c) => !toRemove.has(c.id)));
    if (toRemove.has(activeClipId)) setActiveClipId(null);
    if ([...toRemove].some((id) => selectedClipIds.has(id))) {
      const next = new Set(selectedClipIds);
      toRemove.forEach((id) => next.delete(id));
      setSelectedClipIds(next);
    }
  };

  // Context menu handlers (to avoid ESLint ref access warnings)
  const handleContextMenuDuplicate = (clipId) => {
    duplicateClip(clipId);
    setContextMenu(null);
  };

  const handleContextMenuDelete = (clipId) => {
    const toRemove = expandWithLinkedPartners(clips, [clipId]);
    commitClips(clips.filter((c) => !toRemove.has(c.id)));
    setActiveClipId(null);
    setContextMenu(null);
  };

  const handleContextMenuUnlink = (clipId) => {
    commitClips(unlinkClipGroup(clips, clipId));
    setContextMenu(null);
    setProjectStatus({ ok: true, msg: "Link aufgehoben." });
  };

  const handleClipDoubleClick = (clip, e) => {
    e.stopPropagation();
    setEditorFocus(FOCUS_TIMELINE);
    setSourceMonitorId(null);
    setActiveClipId(clip.id);
    setActiveId(clip.videoId);
    timelineTimeRef.current = clip.startTime;
    updateTimelinePlayheadPosition(clip.startTime);
    setTimelineTime(clip.startTime);
    startClipPlayback(clip, clip.startTime);
  };

  // --- keyboard shortcuts ---
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveCurrentProject();
        return;
      }

      if (editorFocus === FOCUS_SOURCE && isSourceMonitorActive) {
        if (e.code === "Space" || e.code === "KeyK") {
          e.preventDefault();
          handleSourcePreviewPlay();
          return;
        }
        if (e.code === "ArrowLeft") {
          e.preventDefault();
          seekSourcePreviewTo(
            stepSourcePreviewTime({
              keyCode: e.code,
              currentTime: previewTime,
              inPoint: activeSourceSelection.inPoint,
              outPoint: activeSourceSelection.outPoint,
              shiftKey: e.shiftKey,
            }),
          );
          return;
        }
        if (e.code === "ArrowRight") {
          e.preventDefault();
          seekSourcePreviewTo(
            stepSourcePreviewTime({
              keyCode: e.code,
              currentTime: previewTime,
              inPoint: activeSourceSelection.inPoint,
              outPoint: activeSourceSelection.outPoint,
              shiftKey: e.shiftKey,
            }),
          );
          return;
        }
        if (e.code === "Comma") {
          e.preventDefault();
          seekSourcePreviewTo(
            stepSourcePreviewTime({
              keyCode: e.code,
              currentTime: previewTime,
              inPoint: activeSourceSelection.inPoint,
              outPoint: activeSourceSelection.outPoint,
            }),
          );
          return;
        }
        if (e.code === "Period") {
          e.preventDefault();
          seekSourcePreviewTo(
            stepSourcePreviewTime({
              keyCode: e.code,
              currentTime: previewTime,
              inPoint: activeSourceSelection.inPoint,
              outPoint: activeSourceSelection.outPoint,
            }),
          );
          return;
        }
        if (e.code === "Home") {
          e.preventDefault();
          seekSourcePreviewTo(
            stepSourcePreviewTime({
              keyCode: e.code,
              currentTime: previewTime,
              inPoint: activeSourceSelection.inPoint,
              outPoint: activeSourceSelection.outPoint,
            }),
          );
          return;
        }
        if (e.code === "End") {
          e.preventDefault();
          seekSourcePreviewTo(
            stepSourcePreviewTime({
              keyCode: e.code,
              currentTime: previewTime,
              inPoint: activeSourceSelection.inPoint,
              outPoint: activeSourceSelection.outPoint,
            }),
          );
          return;
        }
        if (e.code === "KeyJ") {
          e.preventDefault();
          seekSourcePreviewTo(
            stepSourcePreviewTime({
              keyCode: e.code,
              currentTime: previewTime,
              inPoint: activeSourceSelection.inPoint,
              outPoint: activeSourceSelection.outPoint,
            }),
          );
          return;
        }
        if (e.code === "KeyL") {
          e.preventDefault();
          if (playbackMode !== "source" || !isPlaying)
            handleSourcePreviewPlay();
          return;
        }
      }

      if (e.code === "Space") {
        e.preventDefault();
        handlePlay();
      } else if (e.code === "Delete" || e.code === "Backspace") {
        // Ctrl/Cmd+Delete = ripple-delete (also closes the gap left behind)
        const ripple = e.ctrlKey || e.metaKey;
        if (selectedGap) {
          e.preventDefault();
          commitClips(closeGap(clips, selectedGap));
          setSelectedGap(null);
          return;
        }
        const baseIds =
          selectedClipIds.size > 0
            ? selectedClipIds
            : activeClipId
              ? new Set([activeClipId])
              : null;
        // Always delete linked partners together so V+A stays consistent
        const ids =
          baseIds && baseIds.size > 0
            ? expandWithLinkedPartners(clips, baseIds)
            : null;
        if (ids && ids.size > 0) {
          e.preventDefault();
          if (ripple) {
            commitClips(rippleDeleteClips(clips, ids));
          } else {
            commitClips(clips.filter((c) => !ids.has(c.id)));
          }
          setSelectedClipIds(new Set());
          setActiveClipId(null);
        }
      } else if (e.code === "Escape") {
        setSelectedClipIds(new Set());
        setSelectedGap(null);
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "z" &&
        !e.shiftKey
      ) {
        e.preventDefault();
        undo();
      } else if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z")
      ) {
        e.preventDefault();
        redo();
      } else if (e.code === "KeyS" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        splitAtPlayhead();
      } else if (e.code === "KeyN" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setSnapEnabled((v) => !v);
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "l"
      ) {
        // Ctrl+Shift+L: unlink the current clip's link group
        e.preventDefault();
        const target =
          activeClipId ||
          (selectedClipIds.size > 0
            ? selectedClipIds.values().next().value
            : null);
        if (target) {
          commitClips(unlinkClipGroup(clips, target));
          setProjectStatus({ ok: true, msg: "Link aufgehoben." });
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (activeClipId) duplicateClip(activeClipId);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        // Copy selected clips to clipboard
        const ids =
          selectedClipIds.size > 0
            ? selectedClipIds
            : activeClipId
              ? new Set([activeClipId])
              : null;
        if (ids && ids.size > 0) {
          e.preventDefault();
          const sel = clips.filter((c) => ids.has(c.id));
          const minStart = Math.min(...sel.map((c) => c.startTime));
          clipboardRef.current = sel.map((c) => ({
            ...c,
            _relStart: c.startTime - minStart,
          }));
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") {
        const ids =
          selectedClipIds.size > 0
            ? selectedClipIds
            : activeClipId
              ? new Set([activeClipId])
              : null;
        if (ids && ids.size > 0) {
          e.preventDefault();
          const sel = clips.filter((c) => ids.has(c.id));
          const minStart = Math.min(...sel.map((c) => c.startTime));
          clipboardRef.current = sel.map((c) => ({
            ...c,
            _relStart: c.startTime - minStart,
          }));
          commitClips(clips.filter((c) => !ids.has(c.id)));
          setSelectedClipIds(new Set());
          setActiveClipId(null);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        if (clipboardRef.current && clipboardRef.current.length > 0) {
          e.preventDefault();
          const groupMinStart = Math.min(
            ...clipboardRef.current.map((c) => c._relStart || 0),
          );
          const pasteTime = timelineTime;
          const groupDur =
            Math.max(
              ...clipboardRef.current.map(
                (c) => c.outPoint - c.inPoint + (c._relStart || 0),
              ),
            ) - groupMinStart;
          let insertPoint = pasteTime;

          // Compute insert point like import drag does
          if (snapEnabled) {
            const ins = detectInsertPoint(
              "__paste__",
              pasteTime + groupDur / 2,
              groupDur,
              clips,
            );
            if (ins) insertPoint = ins.insertPoint;
          }

          const newIds = [];
          const newClips = clipboardRef.current.map((c) => {
            const newId = nextId("clip");
            newIds.push(newId);
            const { _relStart, ...rest } = c;
            return {
              ...rest,
              id: newId,
              startTime: insertPoint + ((_relStart || 0) - groupMinStart),
            };
          });

          let merged = [...clips, ...newClips];
          if (snapEnabled) {
            // Ripple insert: shift clips at/after insertPoint
            merged = applyRippleInsert(
              merged,
              "__paste__",
              insertPoint,
              groupDur,
            );
          } else {
            // Overwrite mode: cut conflicts
            for (const id of newIds)
              merged = resolveOverlaps(merged, id, () => nextId("clip"));
          }
          commitClips(merged);
          setSelectedClipIds(new Set(newIds));
          setActiveClipId(newIds.length > 0 ? newIds[0] : null);
        }
      } else if (
        e.code === "ArrowLeft" &&
        selectedClipIds.size > 0 &&
        !e.repeat
      ) {
        // Move selected clip(s) by 1 frame (or 1s with Shift). Only if a selection exists; otherwise seek.
        e.preventDefault();
        const step = e.shiftKey ? 1 : 1 / 30;
        commitClips(
          clips.map((c) =>
            selectedClipIds.has(c.id)
              ? { ...c, startTime: Math.max(0, c.startTime - step) }
              : c,
          ),
        );
      } else if (
        e.code === "ArrowRight" &&
        selectedClipIds.size > 0 &&
        !e.repeat
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 1 / 30;
        commitClips(
          clips.map((c) =>
            selectedClipIds.has(c.id)
              ? { ...c, startTime: c.startTime + step }
              : c,
          ),
        );
      } else if (e.code === "KeyJ") {
        e.preventDefault();
        if (videoRef.current) {
          videoRef.current.playbackRate = -1; // not supported in most browsers; fallback: just rewind
          videoRef.current.pause();
          seekToTime(Math.max(0, timelineTime - 0.5));
        }
      } else if (e.code === "KeyK") {
        e.preventDefault();
        handlePlay();
      } else if (e.code === "KeyL") {
        e.preventDefault();
        if (playbackMode !== "timeline" || !isPlaying) handlePlay();
      } else if (e.code === "Comma") {
        e.preventDefault();
        // frame back (~33ms = 30fps)
        seekToTime(Math.max(0, timelineTime - 0.033));
      } else if (e.code === "Period") {
        e.preventDefault();
        seekToTime(timelineTime + 0.033);
      } else if (e.code === "Home") {
        e.preventDefault();
        seekToTime(0);
      } else if (e.code === "End") {
        e.preventDefault();
        seekToTime(totalEnd);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        seekToTime(Math.max(0, timelineTime - (e.shiftKey ? 1 : 0.1)));
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        seekToTime(timelineTime + (e.shiftKey ? 1 : 0.1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    activeClipId,
    activeSourceSelection,
    clips,
    commitClips,
    duplicateClip,
    editorFocus,
    handlePlay,
    handleSourcePreviewPlay,
    isPlaying,
    isSourceMonitorActive,
    playbackMode,
    previewTime,
    redo,
    saveCurrentProject,
    seekSourcePreviewTo,
    seekToTime,
    selectedClipIds,
    selectedGap,
    snapEnabled,
    splitAtPlayhead,
    timelineTime,
    totalEnd,
    undo,
  ]);

  // Volume line drag (Filmora-style with live tooltip)
  useEffect(() => {
    const onVolLineMove = (e) => {
      const d = volumeLineDragRef.current;
      if (!d) return;
      const dy = e.clientY - d.startY;
      const trackHeight = d.trackHeight || 60;
      const newVol = Math.max(
        0,
        Math.min(2, d.startVolume - (dy / trackHeight) * 2),
      );
      if (!d.historyPushed) {
        pushHistory(d.historyBefore);
        d.historyPushed = true;
      }
      setClips((prev) =>
        prev.map((c) => (c.id === d.clipId ? { ...c, volume: newVol } : c)),
      );
      setVolTooltip({ x: e.clientX, y: e.clientY, vol: newVol });
    };
    const onVolLineUp = () => {
      volumeLineDragRef.current = null;
      setVolTooltip(null);
    };
    document.addEventListener("mousemove", onVolLineMove);
    document.addEventListener("mouseup", onVolLineUp);
    return () => {
      document.removeEventListener("mousemove", onVolLineMove);
      document.removeEventListener("mouseup", onVolLineUp);
    };
  }, [pushHistory]);

  // Fade handle drag (DaVinci Resolve style)
  useEffect(() => {
    const onFadeMove = (e) => {
      const d = fadeDragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const deltaSec = dx / d.pxPerSec;
      const maxFade = d.dur * 0.95;
      if (!d.historyPushed) {
        pushHistory(d.historyBefore);
        d.historyPushed = true;
      }
      if (d.side === "in") {
        const newFade = Math.max(0, Math.min(maxFade, d.startFade + deltaSec));
        setClips((prev) =>
          prev.map((c) => (c.id === d.clipId ? { ...c, fadeIn: newFade } : c)),
        );
      } else {
        const newFade = Math.max(0, Math.min(maxFade, d.startFade - deltaSec));
        setClips((prev) =>
          prev.map((c) => (c.id === d.clipId ? { ...c, fadeOut: newFade } : c)),
        );
      }
    };
    const onFadeUp = () => {
      fadeDragRef.current = null;
    };
    document.addEventListener("mousemove", onFadeMove);
    document.addEventListener("mouseup", onFadeUp);
    return () => {
      document.removeEventListener("mousemove", onFadeMove);
      document.removeEventListener("mouseup", onFadeUp);
    };
  }, [pushHistory]);

  // Generate waveforms for clips' source videos (cached per videoId)
  useEffect(() => {
    let cancelled = false;
    const videoById = new Map(videos.map((video) => [video.id, video]));
    const jobs = [...new Set(clips.map((clip) => clip.videoId))]
      .map((videoId) => videoById.get(videoId))
      .filter((video) => video && !mediaAnalysisRef.current.waveformStarted.has(video.id));
    if (jobs.length === 0) return undefined;
    jobs.forEach((video) => {
      mediaAnalysisRef.current.waveformStarted.add(video.id);
      setPeaksMap((prev) =>
        prev[video.id] != null ? prev : { ...prev, [video.id]: null },
      );
    });
    let cursor = 0;
    const runNext = async () => {
      if (cancelled) return;
      const video = jobs[cursor];
      cursor += 1;
      if (!video) return;
      const peaks = await generateWaveform(video.src);
      if (!cancelled) {
        setPeaksMap((prev) =>
          videoById.has(video.id) ? { ...prev, [video.id]: peaks || [] } : prev,
        );
      }
      await runNext();
    };
    const workers = Array.from({ length: Math.min(2, jobs.length) }, runNext);
    Promise.all(workers).catch((err) => console.error('Waveform generation error:', err));
    return () => {
      cancelled = true;
    };
  }, [clips, videos]);

  // Generate media thumbnails for the library and timeline (cached per videoId)
  useEffect(() => {
    let cancelled = false;
    const videoById = new Map(videos.map((video) => [video.id, video]));
    const jobs = videos.filter(
      (video) => !mediaAnalysisRef.current.thumbnailStarted.has(video.id),
    );
    if (jobs.length === 0) return undefined;
    jobs.forEach((video) => {
      mediaAnalysisRef.current.thumbnailStarted.add(video.id);
      setThumbsMap((prev) =>
        prev[video.id] != null ? prev : { ...prev, [video.id]: null },
      );
    });
    let cursor = 0;
    const runNext = async () => {
      if (cancelled) return;
      const video = jobs[cursor];
      cursor += 1;
      if (!video) return;
      const genFn =
        video.mediaType === "image"
          ? generateImageThumbnails
          : video.mediaType === "audio"
            ? async () => []
            : generateThumbnails;
      const thumbs = await genFn(video.src);
      if (!cancelled) {
        setThumbsMap((prev) =>
          videoById.has(video.id) ? { ...prev, [video.id]: thumbs || [] } : prev,
        );
      }
      await runNext();
    };
    const workers = Array.from({ length: Math.min(2, jobs.length) }, runNext);
    Promise.all(workers).catch((err) => console.error('Thumbnail generation error:', err));
    return () => {
      cancelled = true;
    };
  }, [videos]);

  // Close context menu on outside click / scroll
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("scroll", close, true);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  // Validate the selected gap on every render: only show if it still exists in the live clip layout.
  // Stale `selectedClipIds` IDs are harmless (`.has()` simply returns false for non-existent ids).
  const validSelectedGap = useMemo(() => {
    if (!selectedGap) return null;
    const sorted = [...clips].sort((a, b) => a.startTime - b.startTime);
    let prevEnd = 0;
    for (const c of sorted) {
      if (
        c.startTime > prevEnd + 1e-3 &&
        Math.abs(prevEnd - selectedGap.start) < 0.05 &&
        Math.abs(c.startTime - selectedGap.end) < 0.05
      ) {
        return selectedGap;
      }
      prevEnd = Math.max(prevEnd, c.startTime + (c.outPoint - c.inPoint));
    }
    return null;
  }, [selectedGap, clips]);

  const activePlaybackSpace = useMemo(() => {
    if (playbackMode !== "timeline" || !isPlaying) return null;
    if (findClipAtTime(timelineTime, displayClips)) return null;
    return findTimelineSpaceAtTime(timelineTime, displayClips);
  }, [displayClips, isPlaying, playbackMode, timelineTime]);

  const trackMoveTargetIds = useMemo(
    () => new Set(trackMovePreview?.targetTrackIds || []),
    [trackMovePreview],
  );

  const tracksHeight = useMemo(
    () =>
      tracks.reduce(
        (height, track) => height + (track.height || DEFAULT_TRACK_HEIGHT),
        0,
      ),
    [tracks],
  );

  const getAutoTrackZoneTop = useCallback(
    (type, edge) => {
      let top = 30;
      let firstTypeTop = null;
      let lastTypeBottom = null;
      let firstAudioTop = null;

      for (const track of tracks) {
        const height = track.height || DEFAULT_TRACK_HEIGHT;
        if (track.type === "audio" && firstAudioTop == null)
          firstAudioTop = top;
        if (track.type === type) {
          if (firstTypeTop == null) firstTypeTop = top;
          lastTypeBottom = top + height;
        }
        top += height;
      }

      if (edge === "start" && firstTypeTop != null) return firstTypeTop;
      if (edge === "end" && lastTypeBottom != null) return lastTypeBottom;
      if (type === "video") return firstAudioTop ?? top;
      return top;
    },
    [tracks],
  );

  // Auto-scroll only when needed
  useEffect(() => {
    const el = tracksContentRef.current;
    if (!el) return;
    const margin = 60;
    if (playheadX < el.scrollLeft + margin) {
      el.scrollLeft = Math.max(0, playheadX - margin);
    } else if (playheadX > el.scrollLeft + el.clientWidth - margin) {
      el.scrollLeft = playheadX - el.clientWidth + margin;
    }
  }, [playheadX]);

  const tracksById = useMemo(
    () => new Map(tracks.map((track) => [track.id, track])),
    [tracks],
  );
  const inspectorLinkedGroup = useMemo(() => {
    if (!activeClip) return [];
    return activeClip.linkGroupId
      ? clips.filter((clip) => clip.linkGroupId === activeClip.linkGroupId)
      : [activeClip];
  }, [activeClip, clips]);
  const inspectorVideoClip =
    inspectorLinkedGroup.find(
      (clip) => tracksById.get(clip.trackId)?.type === "video",
    ) ?? (activeTrack?.type === "video" ? activeClip : null);
  const inspectorAudioClip =
    inspectorLinkedGroup.find(
      (clip) => tracksById.get(clip.trackId)?.type === "audio",
    ) ?? (activeTrack?.type === "audio" ? activeClip : null);
  const inspectorIsLinked = inspectorLinkedGroup.length > 1;
  const inspectorDisplayName = inspectorIsLinked
    ? inspectorVideoClip?.name || inspectorAudioClip?.name
    : activeClip?.name;
  const updateInspectorClip = useCallback(
    (clipId, patch) => {
      scheduleInspectorHistoryCommit();
      setClips((prev) =>
        prev.map((clip) => (clip.id === clipId ? { ...clip, ...patch } : clip)),
      );
    },
    [scheduleInspectorHistoryCommit],
  );
  useEffect(() => {
    return () => window.clearTimeout(inspectorEditTimerRef.current);
  }, [pushHistory]);
  const vidClip = inspectorVideoClip;
  const audClip = inspectorAudioClip;
  const isLinked = inspectorIsLinked;
  const displayName = inspectorDisplayName;
  const updClip = updateInspectorClip;

  const stepBack = () => seekToTime(Math.max(0, timelineTime - 1));
  const stepFwd = () => seekToTime(timelineTime + 1);

  if (showProjectStart) {
    return (
      <div className="app project-start-app">
        <div className="project-start-shell">
          <img
            src={logoUrl}
            alt="StoneCutter"
            className="project-start-logo"
            draggable={false}
          />
          <h1>Willkommen zu StoneCutter</h1>
          <div className="project-start-actions">
            <button
              className="project-primary-action"
              onClick={() => setShowNewProjectDialog(true)}
            >
              <Icon.Plus /> Neues Projekt
            </button>
            <button
              className="project-secondary-action"
              onClick={handleOpenProject}
              disabled={!isTauri}
            >
              <Icon.FolderOpen /> Projekt oeffnen
            </button>
          </div>

          <section className="recent-projects-panel">
            <div className="recent-projects-header">
              <h2>Zuletzt benutzt</h2>
              {recentProjects.length > 0 && (
                <button
                  className="recent-clear-btn"
                  onClick={() => persistRecentProjects([])}
                >
                  Leeren
                </button>
              )}
            </div>
            {recentProjects.length === 0 ? (
              <div className="recent-empty">Noch keine Projekte geoeffnet.</div>
            ) : (
              <div className="recent-project-list">
                {recentProjects.map((project) => (
                  <button
                    key={project.path}
                    className="recent-project-item"
                    onClick={() => openProjectPath(project.path)}
                    title={project.path}
                  >
                    <span className="recent-project-icon">
                      <Icon.File />
                    </span>
                    <span className="recent-project-info">
                      <strong>{project.name}</strong>
                      <span>{project.path}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {projectStatus && (
            <div
              className={`project-status ${projectStatus.ok ? "ok" : "err"}`}
            >
              {projectStatus.msg}
            </div>
          )}
        </div>

        {showNewProjectDialog && (
          <div
            className="settings-overlay"
            onClick={() => setShowNewProjectDialog(false)}
          >
            <div
              className="settings-panel project-dialog"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="settings-header">
                <h3>
                  <Icon.Plus /> Neues Projekt
                </h3>
                <button
                  className="settings-close"
                  onClick={() => setShowNewProjectDialog(false)}
                >
                  x
                </button>
              </div>
              <div className="settings-body">
                <label className="project-name-field">
                  <span>Projektname</span>
                  <input
                    autoFocus
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateProject();
                    }}
                  />
                </label>
                <p className="settings-hint">
                  StoneCutter erstellt einen Projektordner mit einer
                  `.stonecutter`-Projektdatei.
                </p>
                <button
                  className="export-start-btn"
                  onClick={handleCreateProject}
                >
                  <Icon.FolderOpen /> Speicherort waehlen
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`app has-topbar has-sidebar-tabs${activeClipId ? " has-inspector" : ""}${editorFocus === FOCUS_TIMELINE && !activeClipId ? " has-inspector" : ""}`}>
      {/* ===== Top Navigation Bar ===== */}
      <nav className="topbar">
        <div className="topbar-brand">
          <img src={logoUrl} alt="StoneCutter" className="topbar-logo" draggable={false} />
          <span className="topbar-app-name">StoneCutter</span>
        </div>
        <div className="topbar-center">
          <div className="topbar-project-info">
            {editingProjectName ? (
              <input
                type="text"
                className="topbar-project-name-input"
                defaultValue={currentProject?.name || "Untitled Project"}
                autoFocus
                onBlur={(e) => {
                  const newName = e.target.value.trim();
                  if (newName && currentProject) {
                    setCurrentProject({ ...currentProject, name: newName });
                    setIsProjectDirty(true);
                  }
                  setEditingProjectName(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.target.blur();
                  } else if (e.key === "Escape") {
                    setEditingProjectName(false);
                  }
                }}
              />
            ) : (
              <button
                className="topbar-project-name"
                onClick={() => setEditingProjectName(true)}
                title="Projekt umbenennen"
              >
                {currentProject?.name || "Untitled Project"}
                {isProjectDirty && <span className="topbar-save-indicator" />}
              </button>
            )}
            {currentProject?.path && (
              <div className="topbar-project-path" title={currentProject.path}>
                {currentProject.path}
              </div>
            )}
          </div>
        </div>
        <div className="topbar-right">
          <button className="topbar-btn" onClick={undo} title="Rückgängig (Ctrl+Z)" disabled={historySizes.past === 0}>
            <Icon.Undo />
          </button>
          <button className="topbar-btn" onClick={redo} title="Wiederholen (Ctrl+Y)" disabled={historySizes.future === 0}>
            <Icon.Redo />
          </button>
          <div className="topbar-divider" />
          <button
            className="topbar-btn"
            onClick={() => setShowSettings(v => !v)}
            title="Einstellungen"
          >
            <Icon.Settings />
          </button>
          <div className="topbar-divider" />
          {isTauri && (
            <button
              className="topbar-btn"
              onClick={saveCurrentProject}
              title="Projekt speichern (Ctrl+S)"
              disabled={!currentProject?.path || !isProjectDirty}
            >
              <Icon.Save />
            </button>
          )}
          <button
            className="topbar-export-btn"
            onClick={() => { setExportStatus(null); setShowExport(true); }}
            title="Als MP4 exportieren"
            disabled={clips.length === 0}
          >
            <Icon.Export /> Export
          </button>
        </div>
      </nav>

      {/* Old logo-area preserved (hidden by has-topbar CSS) */}
      <div className="logo-area">
        <img src={logoUrl} alt="StoneCutter" className="app-logo" draggable={false} />
        <div className="project-toolbar">
          <button className="project-toolbar-btn" onClick={() => setShowProjectStart(true)} title="Startscreen anzeigen">
            <Icon.File /> {currentProject?.name || "Projekt"}
          </button>
          <button className="project-toolbar-btn" onClick={saveCurrentProject} title="Projekt speichern (Ctrl+S)" disabled={!currentProject?.path || !isProjectDirty}>
            <Icon.Save /> {isProjectDirty ? "Speichern" : "Gespeichert"}
          </button>
        </div>
        {isTauri && (
          <button className={`logo-export-btn ${exportStatus === "running" ? "exporting" : ""}`} onClick={() => { setExportStatus(null); setShowExport(true); }} title="Als MP4 exportieren" disabled={clips.length === 0}>
            <Icon.Export /> Exportieren
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={MEDIA_ACCEPT}
        multiple
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
      {projectStatus && (
        <div className={`project-toast ${projectStatus.ok ? "ok" : "err"}`}>
          {projectStatus.msg}
          <button onClick={() => setProjectStatus(null)}>x</button>
        </div>
      )}

      {/* ===== Sidebar Icon Tabs ===== */}
      <div className="sidebar-tabs-strip">
        {[
          { id: "media", label: "Media", icon: NavIcon.Media },
          { id: "audio", label: "Audio", icon: NavIcon.Audio },
          { id: "text", label: "Text", icon: NavIcon.Text },
          { id: "effects", label: "Effects", icon: NavIcon.Effects },
          { id: "transitions", label: "Trans.", icon: NavIcon.Transitions },
          { id: "elements", label: "Elements", icon: NavIcon.Elements },
        ].map(({ id, label, icon: TabIcon }) => (
          <button
            key={id}
            className={`sidebar-tab-btn ${sidebarTab === id ? "active" : ""}`}
            onClick={() => setSidebarTab(id)}
            title={label}
          >
            <TabIcon />
            {label}
          </button>
        ))}
      </div>

      {/* ===== Sidebar ===== */}
      <aside
        className={`sidebar ${editorFocus === FOCUS_SOURCE ? "focus-source" : ""}`}
      >
        {sidebarTab === "media" ? (
          <>
          <div className="sidebar-header">
          <h2 className="sidebar-title">Project Media</h2>
          <button
            className={`import-btn ${videos.length === 0 ? "pulse" : ""}`}
            onClick={handleImport}
            title="Videos importieren"
          >
            <Icon.Plus /> Import
          </button>
        </div>
        <div className="media-bin-controls">
          <input
            className="media-search-input"
            value={mediaSearch}
            onChange={(e) => setMediaSearch(e.target.value)}
            placeholder="Medien suchen..."
            aria-label="Medien suchen"
          />
          <div className="media-filter-row">
            <select
              value={mediaTypeFilter}
              onChange={(e) => setMediaTypeFilter(e.target.value)}
              aria-label="Medientyp filtern"
            >
              <option value="all">Alle Typen</option>
              <option value="video">Video</option>
              <option value="audio">Audio</option>
              <option value="image">Bild</option>
            </select>
            <select
              value={mediaSort}
              onChange={(e) => setMediaSort(e.target.value)}
              aria-label="Mediathek sortieren"
            >
              <option value="importedAt">Neueste</option>
              <option value="name">Name</option>
              <option value="duration">Dauer</option>
              <option value="type">Typ</option>
            </select>
          </div>
        </div>
        <div
          className="video-list"
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const files = Array.from(e.dataTransfer.files).filter(
              isImportableMediaFile,
            );
            if (files.length === 0) return;
            await handleFileChange({ target: { files } });
          }}
        >
          <MediaPanel
            videos={videos}
            visibleVideos={visibleVideos}
            activeId={activeId}
            thumbsMap={thumbsMap}
            videoDurations={videoDurations}
            handleDragStart={handleDragStart}
            handleDragEnd={handleDragEnd}
            handleSelectMedia={handleSelectMedia}
            handleDoubleClickMedia={handleDoubleClickMedia}
            handleRemoveMedia={handleRemoveMedia}
            handleFileChange={handleFileChange}
            isImportableMediaFile={isImportableMediaFile}
            Icon={Icon}
            formatTime={formatTime}
          />
        </div>
          </>
        ) : (
          <div className="sidebar-placeholder">
            <div className="sidebar-placeholder-icon">
              {sidebarTab === "effects" && "✨"}
              {sidebarTab === "transitions" && "↔"}
              {sidebarTab === "text" && "T"}
              {sidebarTab === "audio" && "♪"}
              {sidebarTab === "elements" && "⬡"}
            </div>
            <p className="sidebar-placeholder-title">
              {sidebarTab === "effects" && "Effects"}
              {sidebarTab === "transitions" && "Transitions"}
              {sidebarTab === "text" && "Text"}
              {sidebarTab === "audio" && "Audio"}
              {sidebarTab === "elements" && "Elements"}
            </p>
            <p className="sidebar-placeholder-hint">Hier wird diese Funktion verfügbar sein.</p>
          </div>
        )}
      </aside>

      {/* ===== Player ===== */}
      <main
        className={`main-content ${editorFocus === FOCUS_SOURCE ? "focus-source" : ""} ${activeClipId ? "has-inspector" : ""}`}
      >
        <div
          className={`player-wrapper ${aspectRatio === "9:16" ? "ar-portrait" : "ar-landscape"}`}
        >
          {/* Aspect Ratio Switcher */}
          <div className="ar-switcher">
            {["16:9", "9:16"].map((ar) => (
              <button
                key={ar}
                className={`ar-btn ${aspectRatio === ar ? "active" : ""}`}
                onClick={() => setAspectRatio(ar)}
                title={
                  ar === "16:9" ? "Querformat (16:9)" : "Hochformat (9:16)"
                }
              >
                <span className={`ar-icon ar-icon-${ar.replace(":", "-")}`} />
                {ar}
              </button>
            ))}
          </div>

          <div className="video-container">
            {isTimelineMonitorActive ? (
              <div className="timeline-composite-preview" onClick={handlePlay}>
                {timelineVisualLayers.length > 0 ? (
                  timelineVisualLayers.map(({ clip, media }, index) => {
                    const mediaType = media?.mediaType || "video";
                    const _clipDurV = clip.outPoint - clip.inPoint;
                    const _fadeInV = clip.fadeIn ?? 0;
                    const _fadeOutV = clip.fadeOut ?? 0;
                    const _timeInClipV = Math.max(
                      0,
                      timelineTime - clip.startTime,
                    );
                    let _fadeOpacity = 1;
                    if (_fadeInV > 0 && _timeInClipV < _fadeInV)
                      _fadeOpacity = _timeInClipV / _fadeInV;
                    const _timeToEndV = _clipDurV - _timeInClipV;
                    if (_fadeOutV > 0 && _timeToEndV < _fadeOutV)
                      _fadeOpacity = Math.min(
                        _fadeOpacity,
                        _timeToEndV / _fadeOutV,
                      );
                    const _opacityV =
                      _fadeOpacity * ((clip.opacity ?? 100) / 100);
                    const _scalePct = (clip.scale ?? 100) / 100;
                    const _sx = _scalePct * (clip.flipH ? -1 : 1);
                    const _sy = _scalePct * (clip.flipV ? -1 : 1);
                    const _bri = clip.brightness ?? 0;
                    const _con = clip.contrast ?? 0;
                    const _sat = clip.saturation ?? 0;
                    const _cssFilters = [
                      _bri !== 0
                        ? `brightness(${Math.max(0, 1 + _bri / 100).toFixed(2)})`
                        : "",
                      _con !== 0
                        ? `contrast(${Math.max(0, 1 + _con / 100).toFixed(2)})`
                        : "",
                      _sat !== 0
                        ? `saturate(${Math.max(0, 1 + _sat / 100).toFixed(2)})`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <div
                        key={clip.id}
                        className="timeline-preview-layer"
                        style={{
                          zIndex: index + 1,
                          opacity: _opacityV,
                          transform: `translate(${clip.positionX ?? 0}px, ${clip.positionY ?? 0}px) rotate(${clip.rotation ?? 0}deg) scale(${_sx}, ${_sy})`,
                          filter: _cssFilters || undefined,
                        }}
                      >
                        {mediaType === "image" ? (
                          <img
                            src={media?.src || clip.src}
                            className="timeline-preview-media"
                            alt={clip.name}
                            draggable={false}
                          />
                        ) : (
                          <video
                            ref={setTimelineVisualRef(clip.id)}
                            className="timeline-preview-media"
                            src={media?.src || clip.src}
                            muted
                            playsInline
                            preload="auto"
                            draggable={false}
                          />
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="empty-overlay timeline-empty-preview">
                    <p>Keine Videoebene am Playhead</p>
                  </div>
                )}
                <div className="timeline-audio-bus" aria-hidden="true">
                  {timelineAudioLayers.map(({ clip, media }) => (
                    <audio
                      key={clip.id}
                      ref={setTimelineAudioRef(clip.id)}
                      src={media?.src || clip.src}
                      preload="auto"
                    />
                  ))}
                </div>
              </div>
            ) : videoSrc && activeVideo?.mediaType === "image" ? (
              <img
                key={videoSrc}
                src={videoSrc}
                className="video player-image"
                alt={activeVideo?.name}
                onClick={handlePlay}
                draggable={false}
              />
            ) : videoSrc ? (
              <video
                ref={videoRef}
                key={videoSrc}
                className="video"
                onClick={handlePlay}
                onPlay={() => setIsPlaying(true)}
                onPause={() => {
                  if (
                    playbackModeRef.current === "timeline" &&
                    playingClipIdRef.current
                  )
                    return;
                  if (!imagePlaybackRef.current && !timelinePlaybackRef.current)
                    setIsPlaying(false);
                }}
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handlePreviewTimeUpdate}
                src={videoSrc}
              />
            ) : (
              <div className="empty-overlay">
                <p>Wähle ein Medium aus der Mediathek</p>
                <p className="hint">
                  Doppelklick zur Vorschau · Ziehen auf die Timeline
                </p>
              </div>
            )}
            {isSourceMonitorActive && (
              <div className="preview-player-bar">
                <button
                  className="preview-player-btn"
                  onClick={handlePlay}
                  title="Vorschau abspielen"
                >
                  {playbackMode === "source" && isPlaying ? (
                    <Icon.Pause />
                  ) : (
                    <Icon.Play />
                  )}
                </button>
                <span className="preview-player-time">
                  {formatTC(previewTime)}
                </span>
                <div className="preview-player-progress" aria-hidden="true">
                  <div
                    className="preview-player-progress-fill"
                    style={{
                      width: `${Math.min(100, Math.max(0, (previewTime / activeSourceSelection.duration) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {isTimelineMonitorActive ? (
            <div className="video-title-bar">
              <span className="title-name">
                Timeline-Komposition
                {topTimelineClip ? ` · ${topTimelineClip.name}` : ""}
              </span>
              <span className="media-type-badge">
                {timelineVisualLayers.length} Video ·{" "}
                {timelineAudioLayers.length} Audio
              </span>
            </div>
          ) : (
            activeVideo && (
              <div className="video-title-bar">
                <span className="title-name">{activeVideo.name}</span>
                {activeVideo.mediaType === "image" && (
                  <span className="media-type-badge">
                    Bild · {settings.imageDuration}s
                  </span>
                )}
                {activeVideo.mediaType === "audio" && (
                  <span className="media-type-badge">Audio</span>
                )}
              </div>
            )
          )}

          {isSourceMonitorActive && (
            <div className="source-trim-panel">
              <div className="source-trim-header">
                <span>Source In/Out</span>
                <strong>
                  {formatTC(activeSourceSelection.inPoint)} -{" "}
                  {formatTC(activeSourceSelection.outPoint)} (
                  {formatTime(activeSourceSelection.clipDuration)})
                </strong>
                <div className="source-point-actions">
                  <button
                    type="button"
                    onClick={() => setSourcePointAtPreviewTime("inPoint")}
                    title="In auf aktuelle Vorschauposition setzen"
                  >
                    In
                  </button>
                  <button
                    type="button"
                    onClick={() => setSourcePointAtPreviewTime("outPoint")}
                    title="Out auf aktuelle Vorschauposition setzen"
                  >
                    Out
                  </button>
                </div>
              </div>
              <div
                className="source-preview-timeline"
                onMouseDown={beginSourcePreviewSeek}
                title="Vorschauposition setzen; In/Out-Handles ziehen"
              >
                <div
                  className="source-preview-window"
                  style={{
                    left: `${(activeSourceSelection.inPoint / activeSourceSelection.duration) * 100}%`,
                    width: `${(activeSourceSelection.clipDuration / activeSourceSelection.duration) * 100}%`,
                  }}
                />
                <div
                  className="source-preview-playhead"
                  style={{
                    left: `${Math.min(100, Math.max(0, (previewTime / activeSourceSelection.duration) * 100))}%`,
                  }}
                />
                <button
                  type="button"
                  className="source-preview-handle in"
                  style={{
                    left: `${(activeSourceSelection.inPoint / activeSourceSelection.duration) * 100}%`,
                  }}
                  onMouseDown={(e) => beginSourceTimelineDrag(e, "inPoint")}
                  aria-label="Source In setzen"
                  title="In ziehen"
                />
                <button
                  type="button"
                  className="source-preview-handle out"
                  style={{
                    left: `${(activeSourceSelection.outPoint / activeSourceSelection.duration) * 100}%`,
                  }}
                  onMouseDown={(e) => beginSourceTimelineDrag(e, "outPoint")}
                  aria-label="Source Out setzen"
                  title="Out ziehen"
                />
              </div>
              <div className="source-drag-actions">
                <button
                  type="button"
                  className="source-drag-btn video-source"
                  draggable
                  onDragStart={(e) => handleSourceDragStart(e, "av")}
                  onDragEnd={handleDragEnd}
                  aria-label={
                    activeVideo.mediaType === "image"
                      ? "Bildauswahl in die Timeline ziehen"
                      : "Auswahl als Video mit Audio in die Timeline ziehen"
                  }
                  title={
                    activeVideo.mediaType === "image"
                      ? "Bildauswahl in die Timeline ziehen"
                      : "Auswahl als Video mit Audio in die Timeline ziehen"
                  }
                >
                  <Icon.VideoTrack />{" "}
                  {activeVideo.mediaType === "image" ? "Bild" : "Video + Audio"}
                </button>
                {activeVideo.mediaType === "video" && (
                  <button
                    type="button"
                    className="source-drag-btn audio-source"
                    draggable
                    onDragStart={(e) => handleSourceDragStart(e, "audio")}
                    onDragEnd={handleDragEnd}
                    aria-label="Nur Audio der Auswahl in die Timeline ziehen"
                    title="Nur Audio der Auswahl in die Timeline ziehen"
                  >
                    <Icon.AudioTrack /> Nur Audio
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ===== Timeline ===== */}
      <section
        className={`timeline ${dragOver ? "drag-over" : ""} ${editorFocus === FOCUS_TIMELINE ? "focus-timeline" : ""}`}
        onDragEnter={handleTimelineDragEnter}
        onDragOver={handleTimelineDragOver}
        onDragLeave={handleTimelineDragLeave}
        onDrop={handleTimelineDrop}
      >
        {/* Toolbar */}
        <div className="timeline-toolbar">
          <div className="tb-group">
            <button
              className="tb-btn"
              onClick={() => seekToTime(0)}
              title="Zum Anfang (Home)"
            >
              <Icon.SkipStart />
            </button>
            <button className="tb-btn" onClick={stepBack} title="1s zurück (←)">
              <Icon.StepBack />
            </button>
            <button
              className="tb-btn play"
              onClick={handleTimelinePlay}
              title="Play/Pause (Space)"
            >
              {playbackMode === "timeline" && isPlaying ? (
                <Icon.Pause />
              ) : (
                <Icon.Play />
              )}
            </button>
            <button className="tb-btn" onClick={stepFwd} title="1s vor (→)">
              <Icon.StepFwd />
            </button>
            <button
              className="tb-btn"
              onClick={() => seekToTime(totalEnd)}
              title="Zum Ende (End)"
            >
              <Icon.SkipEnd />
            </button>
          </div>

          <div className="tb-timecode">
            <span className="tc-current">{formatTC(timelineTime)}</span>
            <span className="tc-sep">/</span>
            <span className="tc-total">{formatTC(totalEnd)}</span>
          </div>

          <div className="tb-group">
            <button
              className="tb-btn"
              onClick={splitAtPlayhead}
              title="Am Playhead teilen (S)"
            >
              <Icon.Cut />
            </button>
            <button
              className="tb-btn"
              onClick={undo}
              title="Rückgängig (Ctrl+Z)"
              disabled={historySizes.past === 0}
            >
              <Icon.Undo />
            </button>
            <button
              className="tb-btn"
              onClick={redo}
              title="Wiederholen (Ctrl+Y)"
              disabled={historySizes.future === 0}
            >
              <Icon.Redo />
            </button>
          </div>

          <div className="tb-spacer" />

          <button
            className={`tb-btn toggle ${snapEnabled ? "on" : ""}`}
            onClick={() => setSnapEnabled((v) => !v)}
            title="Magnet-Snap (N)"
          >
            <Icon.Magnet />
          </button>

          <button
            className={`tb-btn ${showSettings ? "active" : ""}`}
            onClick={() => setShowSettings((v) => !v)}
            title="Einstellungen"
          >
            <Icon.Settings />
          </button>

          <div className="tb-group volume">
            <button
              className="tb-btn"
              onClick={() => setMuted((v) => !v)}
              title={muted ? "Stumm aufheben" : "Stummschalten"}
            >
              {muted || volume === 0 ? <Icon.Mute /> : <Icon.Volume />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={muted ? 0 : volume}
              onChange={(e) => {
                setVolume(parseFloat(e.target.value));
                if (parseFloat(e.target.value) > 0) setMuted(false);
              }}
              className="vol-slider"
              title="Lautstärke"
            />
          </div>

          <div className="tb-group zoom">
            <span className="tb-label">Zoom</span>
            <input
              type="range"
              min="10"
              max="120"
              step="2"
              value={pxPerSec}
              onChange={(e) => setPxPerSec(parseInt(e.target.value, 10))}
              className="zoom-slider"
              title="Zoom (px/s)"
            />
          </div>
        </div>

        <Timeline
          tracks={tracks}
          clips={clips}
          pxPerSec={pxPerSec}
          totalWidth={totalWidth}
          totalEnd={totalEnd}
          playheadX={playheadX}
          interaction={interaction}
          activeClipId={activeClipId}
          selectedClipIds={selectedClipIds}
          draggingIds={draggingIds}
          dropTargetTrackId={dropTargetTrackId}
          trackMoveTargetIds={trackMoveTargetIds}
          trackMovePreview={trackMovePreview}
          thumbsMap={thumbsMap}
          peaksMap={peaksMap}
          editingTrackId={editingTrackId}
          dragOver={dragOver}
          dropZoneTrackMode={dropZoneTrackMode}
          formatTime={formatTime}
          formatTC={formatTC}
          scrubTooltip={scrubTooltip}
          setTimelinePlayheadRef={setTimelinePlayheadRef}
          handleTracksMouseDown={handleTracksMouseDown}
          handleTracksScroll={handleTracksScroll}
          handlePlayheadMouseDown={handlePlayheadMouseDown}
          handleClipMouseDown={handleClipMouseDown}
          handleClipDoubleClick={handleClipDoubleClick}
          handleClipContextMenu={handleClipContextMenu}
          handleClipRemove={handleClipRemove}
          handleTrimMouseDown={handleTrimMouseDown}
          handleUpdateTrack={handleUpdateTrack}
          handleRemoveTrack={handleRemoveTrack}
          handleAddTrack={handleAddTrack}
          setEditingTrackId={setEditingTrackId}
          fadeDragRef={fadeDragRef}
          volumeLineDragRef={volumeLineDragRef}
          createHistorySnapshot={createHistorySnapshot}
          DEFAULT_TRACK_HEIGHT={DEFAULT_TRACK_HEIGHT}
          getAutoTrackZoneTop={getAutoTrackZoneTop}
          Icon={Icon}
        />

        {/* Status bar */}
        <div className="status-bar">
          <div className="status-left">
            <span className="status-item">
              <span className="status-label">Clips:</span> {clips.length}
            </span>
            <span className="status-item">
              <span className="status-label">Länge:</span> {formatTC(totalEnd)}
            </span>
            {activeClip && (
              <span className="status-item">
                <span className="status-label">Auswahl:</span> {activeClip.name}{" "}
                ({formatTime(activeClip.outPoint - activeClip.inPoint)})
              </span>
            )}
          </div>
          <div className="status-right">
            <span className="status-item">
              <span className="status-label">Snap:</span>{" "}
              {snapEnabled ? "Ein (N)" : "Aus (N)"}
            </span>
            <span className="status-item">
              <span className="status-label">Zoom:</span> {pxPerSec}px/s
            </span>
            <span className="status-item kbd-hints">
              <span className="kbd-group">
                <kbd>Space</kbd> Play
              </span>
              <span className="kbd-sep">|</span>
              <span className="kbd-group">
                <kbd>S</kbd> Split
              </span>
              <span className="kbd-sep">|</span>
              <span className="kbd-group">
                <kbd>N</kbd> Snap
              </span>
              <span className="kbd-sep">|</span>
              <span className="kbd-group">
                <kbd>Ctrl+C/X/V</kbd> Copy/Cut/Paste
              </span>
              <span className="kbd-sep">|</span>
              <span className="kbd-group">
                <kbd>Ctrl+D</kbd> Duplicate
              </span>
              <span className="kbd-sep">|</span>
              <span className="kbd-group">
                <kbd>Del</kbd> Löschen
              </span>
              <span className="kbd-sep">|</span>
              <span className="kbd-group">
                <kbd>Ctrl+Del</kbd> Ripple
              </span>
              <span className="kbd-sep">|</span>
              <span className="kbd-group">
                <kbd>←/→</kbd> Frame
              </span>
              <span className="kbd-sep">|</span>
              <span className="kbd-group">
                <kbd>Shift</kbd> Snap aus
              </span>
              <span className="kbd-sep">|</span>
              <span className="kbd-group">
                <kbd>Alt+Drag</kbd> Klon
              </span>
              <span className="kbd-sep">|</span>
              <span className="kbd-group">
                <kbd>Ctrl+Shift+L</kbd> Unlink V+A
              </span>
            </span>
          </div>
        </div>
      </section>

      {isDevMode && perfStats && (
        <div className="perf-overlay" aria-label="Performance monitor">
          <span>{perfStats.fps} FPS</span>
          <span>V {perfStats.visualNodes}</span>
          <span>A {perfStats.audioNodes}</span>
          {perfStats.memory != null && <span>{perfStats.memory} MB</span>}
        </div>
      )}

      {/* Export modal */}
      {showExport && (
        <div
          className="settings-overlay"
          onClick={() => {
            if (exportStatus !== "running") setShowExport(false);
          }}
        >
          <div
            className="settings-panel export-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="settings-header">
              <h3>
                <Icon.Export /> Video exportieren
              </h3>
              {exportStatus !== "running" && (
                <button
                  className="settings-close"
                  onClick={() => setShowExport(false)}
                >
                  ✕
                </button>
              )}
            </div>
            <div className="settings-body">
              {exportStatus === "running" ? (
                <div className="export-running">
                  <div className="export-spinner" />
                  <p>
                    FFmpeg läuft… Das kann bei langen Videos einige Minuten
                    dauern.
                  </p>
                  <div className="export-progress-shell" aria-label="Export-Fortschritt">
                    <div
                      className="export-progress-bar"
                      style={{ width: `${Math.round(exportProgress.progress * 100)}%` }}
                    />
                  </div>
                  <div className="export-progress-meta">
                    <span>{Math.round(exportProgress.progress * 100)}%</span>
                    <span>{formatTC(exportProgress.seconds)} / {formatTC(totalEnd)}</span>
                  </div>
                  <button
                    className="export-action-btn danger"
                    onClick={handleCancelExport}
                  >
                    Export abbrechen
                  </button>
                </div>
              ) : exportStatus?.ok != null ? (
                <div
                  className={`export-result ${exportStatus.ok ? "ok" : "err"}`}
                >
                  <p>{exportStatus.msg}</p>
                  <button
                    className="export-action-btn"
                    onClick={() => {
                      setExportStatus(null);
                      if (exportStatus.ok) setShowExport(false);
                    }}
                  >
                    {exportStatus.ok ? "Schließen" : "Erneut versuchen"}
                  </button>
                </div>
              ) : (
                <>
                  <div className="settings-section">
                    <h4>Format</h4>
                    <div className="export-info-row">
                      <span>Auflösung</span>
                      <strong>
                        {aspectRatio === "9:16"
                          ? "1080 × 1920 (9:16)"
                          : "1920 × 1080 (16:9)"}
                      </strong>
                    </div>
                    <div className="export-info-row">
                      <span>Container</span>
                      <strong>MP4 (H.264 + AAC)</strong>
                    </div>
                    <div className="export-info-row">
                      <span>Timeline-Dauer</span>
                      <strong>{formatTC(totalEnd)}</strong>
                    </div>
                  </div>

                  <div className="settings-section">
                    <h4>Qualität</h4>
                    <div className="export-quality-group">
                      {[
                        {
                          val: "low",
                          label: "Niedrig",
                          crf: 28,
                          preset: "veryfast",
                          hint: "~2–4 Mbit/s",
                          desc: "Kleinste Datei, sichtbare Artefakte",
                        },
                        {
                          val: "medium",
                          label: "Mittel",
                          crf: 23,
                          preset: "fast",
                          hint: "~6–10 Mbit/s",
                          desc: "Empfohlen – gute Qualität & Größe",
                        },
                        {
                          val: "high",
                          label: "Hoch",
                          crf: 18,
                          preset: "slow",
                          hint: "~15–30 Mbit/s",
                          desc: "Maximale Qualität, große Datei",
                        },
                      ].map(({ val, label, crf, preset, hint, desc }) => (
                        <label
                          key={val}
                          className={`export-quality-btn ${exportQuality === val ? "active" : ""}`}
                        >
                          <input
                            type="radio"
                            name="quality"
                            value={val}
                            checked={exportQuality === val}
                            onChange={() => setExportQuality(val)}
                          />
                          <span className="eq-label">{label}</span>
                          <span className="eq-hint">{hint}</span>
                          <span className="eq-desc">{desc}</span>
                          <span className="eq-tech">
                            CRF {crf} · {preset}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <button className="export-start-btn" onClick={handleExport}>
                    <Icon.Export /> Speicherort wählen & Exportieren
                  </button>
                  <p className="settings-hint">
                    Benötigt FFmpeg im System-PATH. Export rendert jetzt
                    Mehrspur-Video/Bild-Overlays, Audio-Mix, Clip-Volume,
                    Audio-/Video-Fades sowie Position, Scale, Rotation und
                    Opacity. Browser-Importe ohne echten Dateipfad bleiben nicht
                    exportierbar.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Settings panel */}
      {showSettings && (
        <div
          className="settings-overlay"
          onClick={() => setShowSettings(false)}
        >
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <div className="settings-header">
              <h3>
                <Icon.Settings /> Einstellungen
              </h3>
              <button
                className="settings-close"
                onClick={() => setShowSettings(false)}
              >
                ✕
              </button>
            </div>
            <div className="settings-body">
              <div className="settings-section">
                <h4>Bilder</h4>
                <label className="settings-row">
                  <span>Standard-Bildlänge</span>
                  <div className="settings-input-group">
                    <input
                      id="image-duration"
                      type="number"
                      min="0.1"
                      max="60"
                      step="0.1"
                      value={settings.imageDuration}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (v > 0)
                          setSettings((s) => ({ ...s, imageDuration: v }));
                      }}
                      className="settings-number"
                    />
                    <span className="settings-unit">s</span>
                  </div>
                </label>
                <p className="settings-hint">
                  Wird für neu importierte Bilder verwendet.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filmora-style volume drag tooltip (fixed in viewport) */}
      {volTooltip && (
        <div
          className="vol-drag-tooltip"
          style={{ left: volTooltip.x + 14, top: volTooltip.y - 28 }}
        >
          Volume: {Math.round(volTooltip.vol * 100)}%
        </div>
      )}

      {/* Inspector Panel – linked-clip-aware */}
      {/* Show "no selection" placeholder when timeline is focused but nothing is selected */}
      {/* Inspector Panel */}
      {editorFocus === FOCUS_TIMELINE && (
        <InspectorPanel
          activeClip={activeClip}
          activeClipId={activeClipId}
          activeTrack={activeTrack}
          audClip={audClip}
          displayName={displayName}
          formatTC={formatTC}
          inspectorTab={inspectorTab}
          isLinked={isLinked}
          onTabChange={setInspectorTab}
          onUpdateClip={updClip}
          tracksById={tracksById}
          vidClip={vidClip}
        />
      )}

      {/* Context menu */}
      {contextMenu &&
        (() => {
          const clip = clips.find((c) => c.id === contextMenu.clipId);
          if (!clip) return null;
          const isTrimmed =
            clip.inPoint > 0.01 ||
            Math.abs(clip.outPoint - clip.sourceDuration) > 0.01;
          return (
            <div
              className="context-menu"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                className="cm-item"
                onClick={() => {
                  splitAtPlayhead();
                  setContextMenu(null);
                }}
                disabled={
                  !(
                    timelineTime > clip.startTime &&
                    timelineTime <
                      clip.startTime + (clip.outPoint - clip.inPoint)
                  )
                }
              >
                <Icon.Cut /> Am Playhead teilen{" "}
                <span className="cm-shortcut">S</span>
              </button>
              <button
                className="cm-item"
                onClick={() => handleContextMenuDuplicate(clip.id)}
              >
                <Icon.Plus /> Duplizieren{" "}
                <span className="cm-shortcut">Ctrl+D</span>
              </button>
              <button
                className="cm-item"
                onClick={() => {
                  restoreTrim(clip.id);
                  setContextMenu(null);
                }}
                disabled={!isTrimmed}
              >
                <Icon.Undo /> Trim zurücksetzen
              </button>
              {clip.linkGroupId && (
                <button
                  className="cm-item"
                  onClick={() => handleContextMenuUnlink(clip.id)}
                >
                  Link aufheben{" "}
                  <span className="cm-shortcut">Ctrl+Shift+L</span>
                </button>
              )}
              <div className="cm-divider" />
              <button
                className="cm-item danger"
                onClick={() => handleContextMenuDelete(clip.id)}
              >
                <Icon.Trash /> Löschen <span className="cm-shortcut">Del</span>
              </button>
            </div>
          );
        })()}
    </div>
  );
}

export default App;
