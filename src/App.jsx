import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import logoUrl from "../media/Logo/StoneCutter-Logo.png";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/timeline.css";
import "./styles/keyframes.css";
import "./styles/project-start.css";
import "./styles/sidebar.css";
import "./styles/topbar.css";
import "./styles/player.css";
import "./styles/source-monitor.css";
import "./styles/overlays.css";
import "./styles/inspector.css";
import "./App.css";
import { ProjectStartScreen } from "./components/app/ProjectStartScreen.jsx";
import { TopBar } from "./components/app/TopBar.jsx";
import { Sidebar } from "./components/app/Sidebar.jsx";
import { PlayerStage } from "./components/app/PlayerStage.jsx";
import { TimelineSection } from "./components/app/TimelineSection.jsx";
import { AppOverlays } from "./components/app/AppOverlays.jsx";
import {
  MIN_CLIP_DURATION,
  DEFAULT_TIMELINE_RULER_HEIGHT,
  normalizeSourceSelection,
  detectInsertPoint,
  applyRippleInsert,
  closeGap,
  rippleDeleteClips,
  resolveOverlaps,
  expandWithLinkedPartners,
  unlinkClipGroup,
  isClipTrackLocked,
} from "./lib/timeline.js";
import { buildSeparatedLayout } from "./lib/timelineLayout.js";
import {
  nextTrackId,
  createDefaultTracks,
  updateTrack as updateTrackInList,
  getTrackIdAtTimelineY,
  createAutoTrackForMove,
  getCollisionFreeTrackForClip,
  planTrackMove,
  applyTrackMovePlan,
  DEFAULT_TRACK_HEIGHT,
  MIN_TRACK_HEIGHT,
  MAX_TRACK_HEIGHT,
} from "./lib/trackStore.js";
import { filterAndSortMedia } from "./lib/mediaBin.js";
import {
  buildTimelinePlaybackLookups,
  getTopVisibleTimelineClip,
  getTimelineAudibleClips,
  getTimelineContentEnd,
  getTimelineVisualClips,
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
  getVisibleTimelineRange,
  groupVisibleClipsByTrack,
} from "./lib/timelineRender.js";
import {
  PROJECT_FPS,
  addOrUpdateKeyframe,
  createGroupKeyframes,
  getClipPropertyTrack,
  isAnimatableProperty,
  removeKeyframe,
  setClipPropertyTrack,
  snapTimeToFrame,
} from "./lib/keyframes.js";
import { MediaAssetService } from "./lib/services/MediaAssetService.js";
import {
  normalizePreviewQuality,
} from "./lib/proxyGenerator.js";
import { Icon, NavIcon } from "./components/ui/Icons.jsx";
import { nextId, formatTC, formatTime } from "./lib/utils.js";
import { useExport } from "./hooks/useExport.js";
import { useEngineBridge } from "./hooks/useEngineBridge.js";
import { useClipActions } from "./hooks/useClipActions.js";
import { useHistory } from "./hooks/useHistory.js";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts.js";
import { useKeyframeInteraction } from "./hooks/useKeyframeInteraction.js";
import { useMediaAnalysis } from "./hooks/useMediaAnalysis.js";
import { useMediaManagement } from "./hooks/useMediaManagement.js";
import { usePlaybackController } from "./hooks/usePlaybackController.js";
import { useProjectLifecycle } from "./hooks/useProjectLifecycle.js";
import { useTimelineDrop } from "./hooks/useTimelineDrop.js";
import { useTimelineMouseInteraction } from "./hooks/useTimelineMouseInteraction.js";
import { buildProjectSnapshot } from "./lib/projectHelpers.js";
import { useAudioLibrary } from "./hooks/useAudioLibrary.js";

const isTauri = "__TAURI_INTERNALS__" in window;
const isDevMode = import.meta.env.DEV;
const RECENT_PROJECTS_KEY = "stonecutter.recentProjects";

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return { r, g, b };
}
function rgbToHex(r, g, b) {
  return (
    "#" +
    [r, g, b]
      .map((v) => {
        const hex = Math.max(0, Math.min(255, Math.round(v))).toString(16);
        return hex.length === 1 ? "0" + hex : hex;
      })
      .join("")
  );
}
function lighten(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}
function darken(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}
function toRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return "rgba(" + r + ", " + g + ", " + b + ", " + alpha + ")";
}
function getContrastColor(bgColor) {
  const { r, g, b } = hexToRgb(bgColor);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#ffffff";
}

const PROJECT_FILTER = [
  { name: "StoneCutter Project", extensions: ["stonecutter"] },
];
const MEDIA_ACCEPT = MediaAssetService.mediaAccept;
const TIMELINE_MEDIA_SEEK_GRACE_MS = 50;
const TIMELINE_MEDIA_SEEK_TIMEOUT_MS = 350;
const TIMELINE_STATE_FPS = 60;
const TRANSPORT_TOGGLE_DEBOUNCE_MS = 140;
const SOURCE_PLAY_LOCK_MS = 260;
const TIMELINE_LAYER_BOUNDARY_EPSILON = 0.015;
const TIMELINE_PLAYING_VIDEO_DRIFT_TOLERANCE = 0.22;
const TIMELINE_PLAYING_AUDIO_DRIFT_TOLERANCE = 0.05;
const TIMELINE_PAUSED_DRIFT_TOLERANCE = 0.02;

function App() {
  const videoRef = useRef(null);
  const timelineVisualRefs = useRef(new Map());
  const timelineAudioRefs = useRef(new Map());
  const fileRef = useRef(null);
  const tracksContentRef = useRef(null);
  const timelinePreviewRef = useRef(null);
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
  /** Bumped only on timeline stop / end — not on play start. Invalidates seek→play callbacks without breaking in-flight audio seeks across start. */
  const timelineSeekPlayEpochRef = useRef(0);
  const transportToggleAtRef = useRef(0);
  const sourcePauseLockUntilRef = useRef(0);
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
    previewProxyStarted: new Set(),
    cancelled: false,
  });
  const browserObjectUrlsRef = useRef(new Set());
  const clipboardRef = useRef([]); // copied clips (with relative startTimes)
  const volumeLineDragRef = useRef(null); // { clipId, startY, startVolume, trackHeight }
  const fadeDragRef = useRef(null); // { clipId, side:'in'|'out', startX, startFade, dur, pxPerSec }
  const trackResizeDragRef = useRef(null); // { trackId, startY, startHeight }
  const [volTooltip, setVolTooltip] = useState(null); // { x, y, vol } — shown while dragging vol line

  const [isPlaying, setIsPlaying] = useState(false);
  const [videos, setVideos] = useState([]);
  const [folders, setFolders] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [mediaSearch, setMediaSearch] = useState("");
  const [mediaTypeFilter, setMediaTypeFilter] = useState("all");
  const [mediaSort, setMediaSort] = useState("importedAt");
  const [mediaSelectionId, setMediaSelectionId] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [clips, setClips] = useState([]);
  const [activeClipId, setActiveClipId] = useState(null);
  const [timelineTime, setTimelineTime] = useState(0);
  const [visibleTimelineRange, setVisibleTimelineRange] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [, setDropIndicatorTime] = useState(null);
  const [snapIndicatorTime, setSnapIndicatorTime] = useState(null);
  const [previewSnapGuides, setPreviewSnapGuides] = useState(null);
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
  // Currently selected keyframe on the timeline ({ clipId, propertyKey, kfId }).
  const [selectedKeyframe, setSelectedKeyframe] = useState(null);
  const keyframeDragRef = useRef(null);
  const [marqueeBox, setMarqueeBox] = useState(null); // { x1, y1, x2, y2 } in tracks-content px
  const [importDragInfo, setImportDragInfo] = useState(null); // { videoId, name, dur, insertPoint, mode, simulatedLayout }
  const [trackMovePreview, setTrackMovePreview] = useState(null); // { targetTrackIds, autoTracks } during timeline clip moves
  const draggedVideoIdRef = useRef(null);
  const draggedTrackModeRef = useRef("av"); // "av" = video with audio, "audio" = audio-only
  const draggedUseSourceRangeRef = useRef(false);
  const sourceTrimDragRef = useRef(null);
  const sourceSeekDragRef = useRef(null);
  const [, setDragTooltip] = useState(null); // { x, y, label }
  const [tracks, setTracks] = useState(() => createDefaultTracks());
  const trackHeadersListRef = useRef(null);
  const setTracksContentRef = useCallback((node) => {
    tracksContentRef.current = node;
  }, []);
  const setTrackHeadersListRef = useCallback((node) => {
    trackHeadersListRef.current = node;
  }, []);
  const [editingTrackId, setEditingTrackId] = useState(null);
  const [dropTargetTrackId, setDropTargetTrackId] = useState(null);
  const [dropZoneTrackMode, setDropZoneTrackMode] = useState("av");

  // --- Settings (persisted in localStorage) ---
  const loadSettings = useCallback(() => {
    try {
      const raw = localStorage.getItem("stonecutter.settings");
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          return {
            imageDuration: 3,
            primaryColor: "#8b5cf6",
            secondaryColor: "#06b6d4",
            tertiaryColor: "#f97316",
            bgBase: "#0d0a1a",
            bgPanel: "#15102a",
            bgElevated: "#1c1638",
            textColor: null, // Auto-adjusted for contrast
            textMuted: null, // Auto-adjusted for contrast
            dangerColor: "#ef4444",
            successColor: "#10b981",
            warnColor: "#f59e0b",
            ...parsed,
            previewQuality: normalizePreviewQuality(parsed?.previewQuality),
          };
        } catch (e) {
          console.error("Error parsing settings:", e);
          return { imageDuration: 3, previewQuality: "half", primaryColor: "#8b5cf6", secondaryColor: "#06b6d4" };
        }
      }
    } catch (e) {
      console.error("Error loading settings:", e);
    }
      return { imageDuration: 3, previewQuality: "half", primaryColor: "#8b5cf6", secondaryColor: "#06b6d4", tertiaryColor: "#f97316", bgBase: "#0d0a1a", bgPanel: "#15102a", bgElevated: "#1c1638", textColor: null, textMuted: null, dangerColor: "#ef4444", successColor: "#10b981", warnColor: "#f59e0b" };
  }, []);

  const [settings, setSettings] = useState(loadSettings());

  useEffect(() => {
    const root = document.documentElement.style;
    const primary = settings.primaryColor || "#8b5cf6";
    const secondary = settings.secondaryColor || "#06b6d4";
    root.setProperty("--accent", primary);
    root.setProperty("--accent-hover", lighten(primary, 0.22));
    root.setProperty("--accent-glow", toRgba(primary, 0.45));
    root.setProperty("--video-color", darken(primary, 0.12));
    root.setProperty("--audio-color", secondary);
    root.setProperty("--border", toRgba(primary, 0.18));
    root.setProperty("--border-strong", toRgba(primary, 0.4));
    const tertiary = settings.tertiaryColor || "#f97316";
    root.setProperty("--orange-accent", tertiary);
    root.setProperty("--orange-accent-hover", lighten(tertiary, 0.15));
    root.setProperty("--orange-glow", toRgba(tertiary, 0.45));
    root.setProperty("--orange-glow-strong", toRgba(tertiary, 0.7));
    root.setProperty("--orange-glow-max", toRgba(tertiary, 0.9));
    root.setProperty("--orange-bg", toRgba(tertiary, 0.15));
    root.setProperty("--orange-border", toRgba(tertiary, 0.6));
    root.setProperty("--playhead", tertiary);
    root.setProperty("--playhead-dark", darken(tertiary, 0.15));
    root.setProperty("--playhead-light", lighten(tertiary, 0.22));
    root.setProperty("--bg-base", settings.bgBase || "#0d0a1a");
    root.setProperty("--bg-panel", settings.bgPanel || "#15102a");
    root.setProperty("--bg-elevated", settings.bgElevated || "#1c1638");
    root.setProperty("--bg-hover", lighten(settings.bgPanel || "#15102a", 0.12));
    root.setProperty("--text", settings.textColor || "#e9e3f5");
    root.setProperty("--text-muted", settings.textMuted || "rgba(233,227,245,0.6)");
    root.setProperty("--text-faint", toRgba(settings.textColor || "#e9e3f5", 0.4));
    root.setProperty("--danger", settings.dangerColor || "#ef4444");
    root.setProperty("--danger-hover", lighten(settings.dangerColor || "#ef4444", 0.15));
    root.setProperty("--danger-glow", toRgba(settings.dangerColor || "#ef4444", 0.45));
    root.setProperty("--success", settings.successColor || "#10b981");
    root.setProperty("--success-glow", toRgba(settings.successColor || "#10b981", 0.85));
    root.setProperty("--warn", settings.warnColor || "#f59e0b");
    root.setProperty("--warn-glow", toRgba(settings.warnColor || "#f59e0b", 0.7));
    const danger = settings.dangerColor || "#ef4444";
    root.setProperty("--danger-18", toRgba(danger, 0.18));
    root.setProperty("--danger-25", toRgba(danger, 0.25));
    root.setProperty("--danger-30", toRgba(danger, 0.3));
    root.setProperty("--danger-32", toRgba(danger, 0.32));
    root.setProperty("--danger-45", toRgba(danger, 0.45));
    root.setProperty("--danger-55", toRgba(danger, 0.55));
    root.setProperty("--danger-85", toRgba(danger, 0.85));
    root.setProperty("--danger-90", toRgba(danger, 0.9));
    root.setProperty("--danger-95", toRgba(danger, 0.95));
    const success = settings.successColor || "#10b981";
    root.setProperty("--success-15", toRgba(success, 0.15));
    root.setProperty("--success-22", toRgba(success, 0.22));
    root.setProperty("--success-45", toRgba(success, 0.45));
    root.setProperty("--success-55", toRgba(success, 0.55));
    root.setProperty("--success-90", toRgba(success, 0.9));
    const warn = settings.warnColor || "#f59e0b";
    root.setProperty("--warn-15", toRgba(warn, 0.15));
    root.setProperty("--warn-18", toRgba(warn, 0.18));
    root.setProperty("--warn-45", toRgba(warn, 0.45));
    root.setProperty("--warn-60", toRgba(warn, 0.6));
    root.setProperty("--warn-70", toRgba(warn, 0.7));
    root.setProperty("--warn-95", toRgba(warn, 0.95));
    root.setProperty("--primary-05", toRgba(primary, 0.05));
    root.setProperty("--primary-06", toRgba(primary, 0.06));
    root.setProperty("--primary-08", toRgba(primary, 0.08));
    root.setProperty("--primary-12", toRgba(primary, 0.12));
    root.setProperty("--primary-14", toRgba(primary, 0.14));
    root.setProperty("--primary-15", toRgba(primary, 0.15));
    root.setProperty("--primary-18", toRgba(primary, 0.18));
    root.setProperty("--primary-20", toRgba(primary, 0.2));
    root.setProperty("--primary-25", toRgba(primary, 0.25));
    root.setProperty("--primary-28", toRgba(primary, 0.28));
    root.setProperty("--primary-30", toRgba(primary, 0.3));
    root.setProperty("--primary-35", toRgba(primary, 0.35));
    root.setProperty("--primary-40", toRgba(primary, 0.4));
    root.setProperty("--primary-45", toRgba(primary, 0.45));
    root.setProperty("--primary-50", toRgba(primary, 0.5));
    root.setProperty("--primary-55", toRgba(primary, 0.55));
    root.setProperty("--primary-60", toRgba(primary, 0.6));
    root.setProperty("--primary-65", toRgba(primary, 0.65));
    root.setProperty("--primary-70", toRgba(primary, 0.7));
    root.setProperty("--primary-75", toRgba(primary, 0.75));
    root.setProperty("--primary-85", toRgba(primary, 0.85));
    root.setProperty("--primary-95", toRgba(primary, 0.95));
    root.setProperty("--secondary-04", toRgba(secondary, 0.04));
    root.setProperty("--secondary-06", toRgba(secondary, 0.06));
    root.setProperty("--secondary-12", toRgba(secondary, 0.12));
    root.setProperty("--secondary-14", toRgba(secondary, 0.14));
    root.setProperty("--secondary-18", toRgba(secondary, 0.18));
    root.setProperty("--secondary-22", toRgba(secondary, 0.22));
    root.setProperty("--secondary-25", toRgba(secondary, 0.25));
    root.setProperty("--secondary-28", toRgba(secondary, 0.28));
    root.setProperty("--secondary-30", toRgba(secondary, 0.3));
    root.setProperty("--secondary-34", toRgba(secondary, 0.34));
    root.setProperty("--secondary-38", toRgba(secondary, 0.38));
    root.setProperty("--secondary-40", toRgba(secondary, 0.4));
    root.setProperty("--secondary-78", toRgba(secondary, 0.78));
    const bgBase = settings.bgBase || "#0d0a1a";
    // Auto-adjust text color for contrast if user hasn't explicitly set it
    if (!settings.textColor) {
      const autoText = getContrastColor(bgBase);
      root.setProperty("--text", autoText);
      root.setProperty("--text-muted", toRgba(autoText, 0.6));
      root.setProperty("--text-faint", toRgba(autoText, 0.4));
    }
  }, [settings.primaryColor, settings.secondaryColor, settings.tertiaryColor, settings.bgBase, settings.bgPanel, settings.bgElevated, settings.textColor, settings.textMuted, settings.dangerColor, settings.successColor, settings.warnColor]);

  const [showSettings, setShowSettings] = useState(false);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [previewTime, setPreviewTime] = useState(0);
  const [playbackMode, setPlaybackMode] = useState(null); // "timeline" | "source" | null
  const [currentProject, setCurrentProject] = useState(null); // { name, path, directory }
  const [showProjectStart, setShowProjectStart] = useState(true);
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState("Untitled Project");
  const [projectStatus, setProjectStatus] = useState(null);
  const [isProjectDirty, setIsProjectDirty] = useState(false);
  const [showSaveConfirmDialog, setShowSaveConfirmDialog] = useState(false);
  const [perfStats, setPerfStats] = useState(null);
  const [recentProjects, setRecentProjects] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_PROJECTS_KEY) || "[]");
    } catch {
      return [];
    }
  });
  const projectHydratingRef = useRef(false);

  const { dispatchEngineCommand } = useEngineBridge({
    clips,
    tracks,
    timelineTime,
    selectedClipIds,
    activeClipId,
    setClips,
    setTracks,
    setTimelineTime,
    setSelectedClipIds,
    setActiveClipId,
    timelineTimeRef,
  });

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
    () => {
      const filteredByFolder = selectedFolderId
        ? videos.filter((v) => v.folderId === selectedFolderId)
        : videos;
      return filterAndSortMedia(filteredByFolder, {
        query: mediaSearch,
        typeFilter: mediaTypeFilter,
        sortBy: mediaSort,
        durations: videoDurations,
      });
    },
    [videos, mediaSearch, mediaTypeFilter, mediaSort, videoDurations, selectedFolderId],
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
  const totalEnd = useMemo(
    () => getTimelineContentEnd(displayClips),
    [displayClips],
  );
  const forcedVisibleClipIds = useMemo(() => {
    const ids = new Set();
    if (activeClipId) ids.add(activeClipId);
    selectedClipIds.forEach((id) => ids.add(id));
    draggingIds?.forEach((id) => ids.add(id));
    if (selectedKeyframe?.clipId) ids.add(selectedKeyframe.clipId);
    return ids;
  }, [activeClipId, draggingIds, selectedClipIds, selectedKeyframe]);
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

  const {
    showExport,
    setShowExport,
    exportQuality,
    setExportQuality,
    exportStatus,
    setExportStatus,
    exportProgress,
    handleExport,
    handleCancelExport,
  } = useExport({ clips, videos, tracks, totalEnd, aspectRatio });

  // --- history ---
  const { createHistorySnapshot, pushHistory, undo, redo } = useHistory({
    clips,
    tracks,
    historyRef,
    setClips,
    setTracks,
    setActiveClipId,
    setHistorySizes,
  });

  const {
    persistRecentProjects,
    handleCreateProject,
    openProjectPath,
    handleOpenProject,
    saveCurrentProject,
    handleBackToProjects,
    handleConfirmBack,
    handleCancelBack,
  } = useProjectLifecycle({
    isTauri,
    projectFilter: PROJECT_FILTER,
    recentProjectsKey: RECENT_PROJECTS_KEY,
    focusSource: FOCUS_SOURCE,
    currentProject,
    newProjectName,
    isProjectDirty,
    settings,
    aspectRatio,
    pxPerSec,
    snapEnabled,
    volume,
    muted,
    timelineTime,
    videos,
    clips,
    sourceRanges,
    videoDurations,
    tracks,
    recentProjects,
    projectHydratingRef,
    mediaAnalysisRef,
    timelineTimeRef,
    historyRef,
    browserObjectUrlsRef,
    setRecentProjects,
    setSettings,
    setVideos,
    setClips,
    setSourceRanges,
    setVideoDurations,
    setTracks,
    setPeaksMap,
    setThumbsMap,
    setTimelineTime,
    setAspectRatio,
    setPxPerSec,
    setSnapEnabled,
    setVolume,
    setMuted,
    setMediaSelectionId,
    setActiveId,
    setSourceMonitorId,
    setEditorFocus,
    setActiveClipId,
    setSelectedClipIds,
    setSelectedGap,
    setShowProjectStart,
    setCurrentProject,
    setIsProjectDirty,
    setHistorySizes,
    setShowSaveConfirmDialog,
    setShowNewProjectDialog,
    setProjectStatus,
    revokeBrowserObjectUrls,
    buildProjectSnapshot,
  });

  useMediaAnalysis({
    videos,
    clips,
    mediaAnalysisRef,
    setPeaksMap,
    setThumbsMap,
  });

  const commitClips = useCallback(
    (newClips) => {
      pushHistory(createHistorySnapshot());
      setClips(newClips);
    },
    [createHistorySnapshot, pushHistory],
  );

  const dispatchClipUpdateProps = useCallback(
    (clipId, patch) => {
      dispatchEngineCommand({
        type: "clip.updateProps",
        payload: { clipId, patch },
      });
    },
    [dispatchEngineCommand],
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

  const handleUpdateTrack = useCallback((trackId, changes) => {
    setTracks((prev) => updateTrackInList(prev, trackId, changes));
  }, []);

  const handleTrackResizeMouseDown = useCallback((e, trackId, currentHeight) => {
    e.preventDefault();
    e.stopPropagation();
    trackResizeDragRef.current = { trackId, startY: e.clientY, startHeight: currentHeight };
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
        const original = originalClipById.get(clip.id);
        const originalTrackId = original?.trackId || clip.trackId;
        // Linked partners keep their prior track unless the clip itself is dragged;
        // only explicit movers get collision-based track reassignment.
        if (original?.linkGroupId) {
          return { ...clip, trackId: originalTrackId };
        }
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


  const handleSourceVideoPlay = useCallback((event) => {
    if (playbackModeRef.current === "timeline") return;
    const inLockWindow = performance.now() < sourcePauseLockUntilRef.current;
    const sourceShouldBeStopped = playbackModeRef.current !== "timeline";
    if (inLockWindow && sourceShouldBeStopped) {
      pendingPlayRef.current = false;
      const media = event?.currentTarget;
      if (media && !media.paused) {
        media.pause();
      }
      setIsPlaying(false);
      return;
    }
    setIsPlaying(true);
  }, []);


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


  // sync volume/mute to video
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = muted;
    }
  }, [volume, muted]);


  useEffect(() => {
    if (playbackModeRef.current === "timeline" && isPlaying) return;
    timelineTimeRef.current = timelineTime;
    updateTimelinePlayheadPosition(timelineTime);
  }, [isPlaying, timelineTime, updateTimelinePlayheadPosition]);


  useEffect(() => {
    updateVisibleTimelineRange();
  }, [tracks, totalWidth, updateVisibleTimelineRange]);

  const {
    handleTimelinePlay,
    handleLoadedMetadata,
    stopPlayback,
    startClipPlayback,
    startTimelineGapPlayback,
    pauseTimelinePreviewMedia,
  } = usePlaybackController({
    activeClipId,
    activeId,
    videos,
    clips,
    muted,
    volume,
    timelinePlaybackLookups,
    isPlaying,
    timelineTime,
    topTimelineClip,
    playbackMode,
    isTimelineMonitorActive,
    timelineVisualLayers,
    timelineAudioLayers,
    getNextTimelineLayerBoundary,
    updateTimelinePlayheadPosition,
    setPlaybackMode,
    setEditorFocus,
    setSourceMonitorId,
    setActiveId,
    dispatchEngineCommand,
    setIsPlaying,
    videoRef,
    timelineVisualRefs,
    timelineAudioRefs,
    pendingSeekRef,
    pendingPlayRef,
    playbackRef,
    playbackModeRef,
    playingClipIdRef,
    imagePlaybackRef,
    timelinePlaybackRef,
    timelinePlaybackStartTokenRef,
    timelineSeekPlayEpochRef,
    sourcePauseLockUntilRef,
    timelineSeekGraceUntilRef,
    timelineMediaSeekPromisesRef,
    timelineTimeRef,
    activeTimelineLayersRef,
    timelineLastStateUpdateRef,
    interactionRef,
    interaction,
    focusTimeline: FOCUS_TIMELINE,
    sourcePlayLockMs: SOURCE_PLAY_LOCK_MS,
    timelineMediaSeekGraceMs: TIMELINE_MEDIA_SEEK_GRACE_MS,
    timelineMediaSeekTimeoutMs: TIMELINE_MEDIA_SEEK_TIMEOUT_MS,
    timelinePlayingVideoDriftTolerance: TIMELINE_PLAYING_VIDEO_DRIFT_TOLERANCE,
    timelinePlayingAudioDriftTolerance: TIMELINE_PLAYING_AUDIO_DRIFT_TOLERANCE,
    timelinePausedDriftTolerance: TIMELINE_PAUSED_DRIFT_TOLERANCE,
    timelineStateFps: TIMELINE_STATE_FPS,
    timelineLayerBoundaryEpsilon: TIMELINE_LAYER_BOUNDARY_EPSILON,
  });

  const handlePlay = useCallback(() => {
    const nowMs = performance.now();
    if (nowMs - transportToggleAtRef.current < TRANSPORT_TOGGLE_DEBOUNCE_MS) {
      return;
    }
    transportToggleAtRef.current = nowMs;
    const sourceVideoPlaying =
      !!videoRef.current &&
      !videoRef.current.paused &&
      !videoRef.current.ended;
    const anyPlaybackActive =
      isPlaying ||
      playbackRef.current.isPlaying ||
      playbackModeRef.current === "timeline" ||
      !!timelinePlaybackRef.current ||
      sourceVideoPlaying;
    if (anyPlaybackActive) {
      stopPlayback();
      return;
    }
    handleTimelinePlay();
  }, [handleTimelinePlay, isPlaying, stopPlayback]);
const {
  handleImport,
  handleFileChange,
  handleSelectMedia,
  handleDoubleClickMedia,
  handleRemoveMedia,
  handleDragStart,
  handleDragEnd,
  handleSourceDragStart,
} = useMediaManagement({
  videos,
  setVideos,
  clips,
  setClips,
  activeClipId,
  setActiveClipId,
  activeId,
  setActiveId,
  mediaSelectionId,
  setMediaSelectionId,
  sourceMonitorId,
  setSourceMonitorId,
  setSelectedClipIds,
  setEditorFocus,
  setPreviewTime,
  setIsPlaying,
  setDropZoneTrackMode,
  setImportDragInfo,
  setDragTooltip,
  videoDurations,
  setVideoDurations,
  setPeaksMap,
  setThumbsMap,
  setSourceRanges,
  settings,
  mediaAnalysisRef,
  browserObjectUrlsRef,
  fileRef,
  draggedVideoIdRef,
  draggedTrackModeRef,
  draggedUseSourceRangeRef,
  playingClipIdRef,
  pendingSeekRef,
  pendingPlayRef,
  videoRef,
  revokeBrowserObjectUrls,
  getSourceSelection,
  getFullMediaSelection,
  commitClips,
  stopPlayback,
  isTauri,
});

  // --- Audio library (global, project-independent) ---
  const {
    audioItems,
    audioFolders,
    importAudioDialog,
    importAudioFromFiles,
    removeAudioItem,
    createAudioFolder,
    deleteAudioFolder,
    moveAudioToFolder,
  } = useAudioLibrary({ isTauri });

  const handleAudioLibraryDragStart = useCallback(
    (item, e) => {
      let mediaEntry = videos.find(
        (v) => v.path && v.path === item.path && v.path !== item.name,
      );
      if (!mediaEntry) {
        const id = nextId("vid");
        mediaEntry = {
          id,
          name: item.name,
          path: item.path,
          src: item.src,
          mediaType: "audio",
          importedAt: item.importedAt || new Date().toISOString(),
        };
        setVideos((prev) => [...prev, mediaEntry]);
      }
      handleDragStart(e, mediaEntry);
    },
    [videos, setVideos, handleDragStart],
  );

  // --- Folder management ---
  const handleCreateFolder = useCallback(() => {
    const name = prompt("Ordnername:");
    if (!name || !name.trim()) return;
    const newFolder = {
      id: nextId(),
      name: name.trim(),
      createdAt: Date.now(),
    };
    setFolders((prev) => [...prev, newFolder]);
  }, []);

  const handleDeleteFolder = useCallback((folderId) => {
    if (!confirm("Ordner wirklich löschen? Die Medien werden nicht gelöscht.")) return;
    setFolders((prev) => prev.filter((f) => f.id !== folderId));
    setVideos((prev) =>
      prev.map((v) => (v.folderId === folderId ? { ...v, folderId: undefined } : v)),
    );
    if (selectedFolderId === folderId) {
      setSelectedFolderId(null);
    }
  }, [selectedFolderId]);

  const handleMoveMediaToFolder = useCallback((mediaId, folderId) => {
    setVideos((prev) =>
      prev.map((v) =>
        v.id === mediaId ? { ...v, folderId: folderId ?? undefined } : v,
      ),
    );
  }, []);

    const {
    handleTimelineDragEnter,
    handleTimelineDragOver,
    handleTimelineDragLeave,
    handleTimelineDrop,
  } = useTimelineDrop({
    totalEnd,
    tracksContentRef,
    pxPerSec,
    videos,
    clips,
    tracks,
    snapEnabled,
    dragOver,
    videoDurations,
    sourceRanges,
    settings,
    getTrackAtClientY,
    getSourceSelection,
    getFullMediaSelection,
    handleFileChange,
    createHistorySnapshot,
    pushHistory,
    dispatchEngineCommand,
    nextId,
    formatTime,
    draggedVideoIdRef,
    draggedTrackModeRef,
    draggedUseSourceRangeRef,
    setClips,
    setVideoDurations,
    setProjectStatus,
    setSelectedClipIds,
    setActiveClipId,
    setActiveId,
    setEditorFocus,
    setSourceMonitorId,
    setDragOver,
    setDropIndicatorTime,
    setImportDragInfo,
    setDragTooltip,
    setDropTargetTrackId,
    setDropZoneTrackMode,
    setTrackMovePreview,
  });


  const {
    seekToTime,
    handleTracksMouseDown,
    handlePlayheadMouseDown,
    handleClipMouseDown,
    handleTrimMouseDown,
    handlePreviewClipMouseDown,
  } = useTimelineMouseInteraction({
    clips,
    setClips,
    tracks,
    setTracks,
    selectedClipIds,
    setSelectedClipIds,
    activeClipId,
    setActiveClipId,
    setActiveId,
    timelineTime,
    dispatchEngineCommand,
    isPlaying,
    interaction,
    setInteraction,
    pxPerSec,
    snapEnabled,
    videos,
    setEditorFocus,
    setSourceMonitorId,
    setScrubTooltip,
    setMarqueeBox,
    setSnapIndicatorTime,
    setPreviewSnapGuides,
    setSelectedGap,
    setDropTargetTrackId,
    setTrackMovePreview,
    setContextMenu,
    interactionRef,
    tracksContentRef,
    timelineTimeRef,
    videoRef,
    timelinePreviewRef,
    playingClipIdRef,
    imagePlaybackRef,
    pendingSeekRef,
    pendingPlayRef,
    playbackModeRef,
    timelinePlaybackRef,
    playbackRef,
    updateTimelinePlayheadPosition,
    stopPlayback,
    pauseTimelinePreviewMedia,
    pushHistory,
    createHistorySnapshot,
    getMoveTrackPlan,
    applyTrackMovePlan,
    updateTrackMovePreview,
    updateTrackMovePreviewFromClips,
    placeLinkedSyncClips,
    startClipPlayback,
    startTimelineGapPlayback,
    timelinePlaybackLookups,
  });

  const {
    duplicateClip,
    restoreTrim,
    splitAtPlayhead,
    handleContextMenuDuplicate,
    handleContextMenuDelete,
    handleContextMenuUnlink,
    handleContextMenuLink,
  } = useClipActions({
    clips,
    snapEnabled,
    timelineTime,
    selectedClipIds,
    activeClipId,
    commitClips,
    createHistorySnapshot,
    pushHistory,
    dispatchEngineCommand,
    setActiveClipId,
    setSelectedClipIds,
    setContextMenu,
    setProjectStatus,
  });

  const handleClipContextMenu = (e, clip) => {
    e.preventDefault();
    e.stopPropagation();
    setEditorFocus(FOCUS_TIMELINE);
    setSourceMonitorId(null);
    setActiveClipId(clip.id);
    setActiveId(clip.kind === "text" ? null : clip.videoId);
    setContextMenu({ x: e.clientX, y: e.clientY, clipId: clip.id });
  };

  useKeyboardShortcuts({
    activeClipId,
    activeSourceSelection,
    clips,
    commitClips,
    duplicateClip,
    editorFocus,
    handlePlay,
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
    selectedKeyframe,
    snapEnabled,
    splitAtPlayhead,
    timelineTime,
    totalEnd,
    undo,
    dispatchEngineCommand,
    createHistorySnapshot,
    pushHistory,
    setClips,
    setSelectedKeyframe,
    setSelectedGap,
    setSelectedClipIds,
    setActiveClipId,
    setSnapEnabled,
    setProjectStatus,
    clipboardRef,
    videoRef,
    focusSource: FOCUS_SOURCE,
    stepSourcePreviewTime,
    getClipPropertyTrack,
    removeKeyframe,
    setClipPropertyTrack,
    closeGap,
    expandWithLinkedPartners,
    rippleDeleteClips,
    unlinkClipGroup,
    detectInsertPoint,
    applyRippleInsert,
    resolveOverlaps,
    nextId,
  });

  // Volume line drag (Filmora-style with live tooltip)
  useEffect(() => {
    const onVolLineMove = (e) => {
      const d = volumeLineDragRef.current;
      if (!d) return;
      const dy = e.clientY - d.startY;
      const trackHeight = d.trackHeight || 60;
      const deltaVol = -(dy / trackHeight) * 2;
      const newVol = Math.max(0, Math.min(2, d.startVolume + deltaVol));
      if (!d.historyPushed) {
        pushHistory(d.historyBefore);
        d.historyPushed = true;
      }
      if (d.mode === "volume-segment" && d.segment) {
        const leftId = d.segment.leftId;
        const rightId = d.segment.rightId;
        const leftValue = Math.max(0, Math.min(2, (d.segment.leftValue ?? 1) + deltaVol));
        const rightValue = Math.max(0, Math.min(2, (d.segment.rightValue ?? 1) + deltaVol));
        setClips((prev) =>
          prev.map((clip) => {
            if (clip.id !== d.clipId) return clip;
            const track = getClipPropertyTrack(clip, "volume");
            if (!track.length) return clip;
            const nextTrack = track.map((kf) => {
              if (leftId && kf.id === leftId) return { ...kf, value: leftValue };
              if (rightId && kf.id === rightId) return { ...kf, value: rightValue };
              return kf;
            });
            return {
              ...clip,
              keyframes: setClipPropertyTrack(clip, "volume", nextTrack),
            };
          }),
        );
        const previewVol = Math.max(0, Math.min(2, (leftValue + rightValue) / 2));
        setVolTooltip({ x: e.clientX, y: e.clientY, vol: previewVol });
        return;
      }
      dispatchClipUpdateProps(d.clipId, { volume: newVol });
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
  }, [dispatchClipUpdateProps, pushHistory]);

  // Track height resize drag
  useEffect(() => {
    const onMove = (ev) => {
      const d = trackResizeDragRef.current;
      if (!d) return;
      document.body.style.cursor = "ns-resize";
      const dy = ev.clientY - d.startY;
      const next = Math.max(MIN_TRACK_HEIGHT, Math.min(MAX_TRACK_HEIGHT, d.startHeight + dy));
      setTracks((prev) => prev.map((t) => t.id === d.trackId ? { ...t, height: next } : t));
    };
    const onUp = () => { trackResizeDragRef.current = null; document.body.style.cursor = ""; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

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
        dispatchClipUpdateProps(d.clipId, { fadeIn: newFade });
      } else {
        const newFade = Math.max(0, Math.min(maxFade, d.startFade - deltaSec));
        dispatchClipUpdateProps(d.clipId, { fadeOut: newFade });
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
  }, [dispatchClipUpdateProps, pushHistory]);

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

  // Fallback: clear interaction state on window mouseup (catches missed events)
  useEffect(() => {
    const onWindowMouseUp = () => {
      if (interactionRef.current) {
        interactionRef.current = null;
        setInteraction(null);
        setSnapIndicatorTime(null);
        setScrubTooltip(null);
        setDropTargetTrackId(null);
        setTrackMovePreview(null);
      }
    };
    window.addEventListener("mouseup", onWindowMouseUp);
    return () => {
      window.removeEventListener("mouseup", onWindowMouseUp);
    };
  }, []);

  const trackMoveTargetIds = useMemo(
    () => new Set(trackMovePreview?.targetTrackIds || []),
    [trackMovePreview],
  );

  const getAutoTrackZoneTop = useCallback(
    (type, edge) => {
      const { videoTracksLayout, audioTracksLayout, dividerY, dividerHeight } =
        buildSeparatedLayout(tracks, DEFAULT_TRACK_HEIGHT);
      const trackList =
        type === "video" ? videoTracksLayout : audioTracksLayout;
      if (trackList.length === 0) {
        if (type === "video") return DEFAULT_TIMELINE_RULER_HEIGHT;
        return DEFAULT_TIMELINE_RULER_HEIGHT + dividerY + dividerHeight;
      }
      if (edge === "start") return DEFAULT_TIMELINE_RULER_HEIGHT + trackList[0].top;
      const last = trackList[trackList.length - 1];
      return DEFAULT_TIMELINE_RULER_HEIGHT + last.top + last.height;
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
    : activeClip?.kind === "text"
      ? activeClip.content?.text || activeClip.name
      : activeClip?.name;
  const updateInspectorClip = useCallback(
    (clipId, patch) => {
      const currentClip = clips.find((clip) => clip.id === clipId);
      if (!currentClip || isClipTrackLocked(currentClip, tracks)) return;
      scheduleInspectorHistoryCommit();
      const textStylePatch =
        currentClip.kind === "text" && patch.content?.style
          ? patch.content.style
          : null;
      const hasKeyframeCoupledUpdate =
        Object.prototype.hasOwnProperty.call(patch, "keyframes") ||
        Object.keys(patch).some((key) => {
          if (!isAnimatableProperty(key)) return false;
          return getClipPropertyTrack(currentClip, key).length > 0;
        }) ||
        (textStylePatch &&
          Object.keys(textStylePatch).some((key) => {
            if (!isAnimatableProperty(key)) return false;
            return getClipPropertyTrack(currentClip, key).length > 0;
          }));
      if (!hasKeyframeCoupledUpdate) {
        dispatchClipUpdateProps(clipId, patch);
        return;
      }
      const kfTime = snapTimeToFrame(timelineTimeRef.current ?? 0);
      setClips((prev) =>
        prev.map((clip) => {
          if (clip.id !== clipId) return clip;
          const next = { ...clip, ...patch };
          // Auto-keyframe: if a changed property already has a keyframe track,
          // insert/update a keyframe at the current playhead position with the new value.
          let kfMap = next.keyframes ? { ...next.keyframes } : null;
          const animatablePatch = { ...patch, ...(textStylePatch || {}) };
          for (const key of Object.keys(animatablePatch)) {
            if (!isAnimatableProperty(key)) continue;
            const track = getClipPropertyTrack(clip, key);
            if (track.length === 0) continue;
            const newTrack = addOrUpdateKeyframe(track, { time: kfTime, value: animatablePatch[key] });
            if (!kfMap) kfMap = {};
            kfMap = { ...kfMap, [key]: newTrack };
          }
          return kfMap !== (next.keyframes ?? null) ? { ...next, keyframes: kfMap } : next;
        }),
      );
    },
    [clips, dispatchClipUpdateProps, scheduleInspectorHistoryCommit, tracks],
  );
  useEffect(() => {
    return () => window.clearTimeout(inspectorEditTimerRef.current);
  }, [pushHistory]);
  const vidClip = inspectorVideoClip;
  const audClip = inspectorAudioClip;
  const isLinked = inspectorIsLinked;
  const displayName = inspectorDisplayName;
  const updClip = updateInspectorClip;
  const commitPreviewTextEdit = useCallback(
    (clipId, text) => {
      const clip = clips.find((item) => item.id === clipId);
      if (!clip || clip.kind !== "text") return;
      updateInspectorClip(clipId, {
        name: text || "Text",
        content: {
          ...(clip.content || {}),
          text: text || "Text",
          style: clip.content?.style || {},
        },
      });
    },
    [clips, updateInspectorClip],
  );
  const updateKeyframeInterpolation = useCallback(
    (clipId, propertyKey, keyframeId, interpolation) => {
      if (!clipId || !propertyKey || !keyframeId) return;
      scheduleInspectorHistoryCommit();
      setClips((prev) =>
        prev.map((clip) => {
          if (clip.id !== clipId) return clip;
          const track = getClipPropertyTrack(clip, propertyKey);
          const nextTrack = track.map((kf) =>
            kf.id === keyframeId ? { ...kf, interpolation } : kf,
          );
          return {
            ...clip,
            keyframes: setClipPropertyTrack(clip, propertyKey, nextTrack),
          };
        }),
      );
    },
    [scheduleInspectorHistoryCommit, setClips],
  );

  const {
    toggleKeyframeAtPlayhead,
    toggleGroupKeyframeAtPlayhead,
    selectKeyframeAndSeek,
    beginKeyframeDrag,
    beginVolumeKeyframeDrag,
    addVolumeKeyframeFromCurve,
  } = useKeyframeInteraction({
    clips,
    pxPerSec,
    timelineTimeRef,
    seekToTime,
    setClips,
    setActiveClipId,
    setSelectedKeyframe,
    keyframeDragRef,
    createHistorySnapshot,
    pushHistory,
    updateInspectorClip,
    scheduleInspectorHistoryCommit,
    dispatchEngineCommand,
    snapTimeToFrame,
    createGroupKeyframes,
    getClipPropertyTrack,
    addOrUpdateKeyframe,
    setClipPropertyTrack,
    projectFps: PROJECT_FPS,
  });

  // Stale `selectedKeyframe` entries (after a clip delete / undo / etc.) are
  // tolerated: ClipKeyframes only highlights ids it actually finds, and the
  // Delete keyboard handler is a no-op when the referenced track no longer
  // contains the id. Nothing to clean up explicitly.

  const stepBack = () => seekToTime(Math.max(0, timelineTime - 1));
  const stepFwd = () => seekToTime(timelineTime + 1);
  const sidebarItems = [
    { id: "media", label: "Media", icon: NavIcon.Media },
    { id: "audio", label: "Audio", icon: NavIcon.Audio },
    { id: "text", label: "Text", icon: NavIcon.Text },
    { id: "effects", label: "Effects", icon: NavIcon.Effects },
    { id: "transitions", label: "Trans.", icon: NavIcon.Transitions },
    { id: "elements", label: "Elements", icon: NavIcon.Elements },
  ];
  const mainContentClassName = `main-content ${editorFocus === FOCUS_SOURCE ? "focus-source" : ""} ${editorFocus === FOCUS_TIMELINE ? "has-inspector" : ""}`;

  if (showProjectStart) {
    return (
      <ProjectStartScreen
        logoUrl={logoUrl}
        Icon={Icon}
        recentProjects={recentProjects}
        projectStatus={projectStatus}
        showNewProjectDialog={showNewProjectDialog}
        newProjectName={newProjectName}
        onNewProjectNameChange={setNewProjectName}
        onCreateProject={handleCreateProject}
        onOpenProject={handleOpenProject}
        onOpenProjectPath={openProjectPath}
        onClearRecentProjects={() => persistRecentProjects([])}
        onShowNewProjectDialog={() => setShowNewProjectDialog(true)}
        onCloseNewProjectDialog={() => setShowNewProjectDialog(false)}
        isTauri={isTauri}
      />
    );
  }

  return (
    <div className={`app has-topbar has-sidebar-tabs${playbackMode === "timeline" && isPlaying ? " timeline-playing" : ""}${activeClipId ? " has-inspector" : ""}${editorFocus === FOCUS_TIMELINE && !activeClipId ? " has-inspector" : ""}`}>
      <TopBar
        logoUrl={logoUrl}
        Icon={Icon}
        currentProject={currentProject}
        editingProjectName={editingProjectName}
        isProjectDirty={isProjectDirty}
        historySizes={historySizes}
        isTauri={isTauri}
        clipsLength={clips.length}
        onStartRename={() => setEditingProjectName(true)}
        onCommitRename={(value) => {
          const newName = value.trim();
          if (newName && currentProject) {
            setCurrentProject({ ...currentProject, name: newName });
            setIsProjectDirty(true);
          }
          setEditingProjectName(false);
        }}
        onCancelRename={() => setEditingProjectName(false)}
        onUndo={undo}
        onRedo={redo}
        onToggleSettings={() => setShowSettings((v) => !v)}
        onSaveProject={saveCurrentProject}
        onExport={() => {
          setExportStatus(null);
          setShowExport(true);
        }}
        onBackToProjects={handleBackToProjects}
      />
      {/* Old logo-area preserved (hidden by has-topbar CSS) */}
      <div className="logo-area">
        <img src={logoUrl} alt="StoneCutter" className="app-logo" draggable={false} />
        <div className="project-toolbar">
          <button className="project-toolbar-btn" onClick={() => setShowProjectStart(true)} title="Startscreen anzeigen">
            <Icon.File /> {currentProject?.name || "Projekt"}
          </button>
          <button className="project-toolbar-btn" onClick={saveCurrentProject} title="Projekt speichern (Strg+S)" disabled={!currentProject?.path || !isProjectDirty}>
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
      <Sidebar
        sidebarTab={sidebarTab}
        sidebarItems={sidebarItems}
        editorFocus={editorFocus}
        focusSource={FOCUS_SOURCE}
        videos={videos}
        visibleVideos={visibleVideos}
        activeId={mediaSelectionId}
        thumbsMap={thumbsMap}
        videoDurations={videoDurations}
        mediaSearch={mediaSearch}
        mediaTypeFilter={mediaTypeFilter}
        mediaSort={mediaSort}
        handleImport={handleImport}
        handleDragStart={handleDragStart}
        handleDragEnd={handleDragEnd}
        handleSelectMedia={handleSelectMedia}
        handleDoubleClickMedia={handleDoubleClickMedia}
        handleRemoveMedia={handleRemoveMedia}
        handleFileChange={handleFileChange}
        isImportableMediaFile={MediaAssetService.isImportableMediaFile}
        onSidebarTabChange={setSidebarTab}
        onMediaSearchChange={setMediaSearch}
        onMediaTypeFilterChange={setMediaTypeFilter}
        onMediaSortChange={setMediaSort}
        Icon={Icon}
        formatTime={formatTime}
        folders={folders}
        selectedFolderId={selectedFolderId}
        setSelectedFolderId={setSelectedFolderId}
        handleCreateFolder={handleCreateFolder}
        handleDeleteFolder={handleDeleteFolder}
        handleMoveMediaToFolder={handleMoveMediaToFolder}
        audioItems={audioItems}
        audioFolders={audioFolders}
        isTauri={isTauri}
        importAudioDialog={importAudioDialog}
        importAudioFromFiles={importAudioFromFiles}
        removeAudioItem={removeAudioItem}
        createAudioFolder={createAudioFolder}
        deleteAudioFolder={deleteAudioFolder}
        moveAudioToFolder={moveAudioToFolder}
        onAudioDragStart={handleAudioLibraryDragStart}
      />
      <PlayerStage
        mainContentClassName={mainContentClassName}
        aspectRatio={aspectRatio}
        isTimelineMonitorActive={isTimelineMonitorActive}
        isSourceMonitorActive={isSourceMonitorActive}
        timelineVisualLayers={timelineVisualLayers}
        timelineAudioLayers={timelineAudioLayers}
        topTimelineClip={topTimelineClip}
        timelineTime={timelineTime}
        videoSrc={videoSrc}
        activeVideo={activeVideo}
        activeSourceSelection={activeSourceSelection}
        previewTime={previewTime}
        videoRef={videoRef}
        playbackModeRef={playbackModeRef}
        playingClipIdRef={playingClipIdRef}
        imagePlaybackRef={imagePlaybackRef}
        timelinePlaybackRef={timelinePlaybackRef}
        setAspectRatio={setAspectRatio}
        setIsPlaying={setIsPlaying}
        handleSourceVideoPlay={handleSourceVideoPlay}
        setTimelineVisualRef={setTimelineVisualRef}
        setTimelineAudioRef={setTimelineAudioRef}
        handleLoadedMetadata={handleLoadedMetadata}
        handlePreviewTimeUpdate={handlePreviewTimeUpdate}
        beginSourcePreviewSeek={beginSourcePreviewSeek}
        beginSourceTimelineDrag={beginSourceTimelineDrag}
        setSourcePointAtPreviewTime={setSourcePointAtPreviewTime}
        handleSourceDragStart={handleSourceDragStart}
        handleDragEnd={handleDragEnd}
        settings={settings}
        setSettings={setSettings}
        perfStats={perfStats}
        timelineVisualRefs={timelineVisualRefs}
        tracksById={tracksById}
        activeClipId={activeClipId}
        previewTargetClipId={vidClip?.id || activeClipId}
        onPreviewClipMouseDown={handlePreviewClipMouseDown}
        onPreviewTextEditCommit={commitPreviewTextEdit}
        interaction={interaction}
        previewSnapGuides={previewSnapGuides}
        timelinePreviewRef={timelinePreviewRef}
        formatTime={formatTime}
        formatTC={formatTC}
        Icon={Icon}
      />
      <TimelineSection
        className={`timeline ${dragOver ? "drag-over" : ""} ${editorFocus === FOCUS_TIMELINE ? "focus-timeline" : ""}`}
        totalEnd={totalEnd}
        timelineTime={timelineTime}
        isTimelinePlaying={playbackMode === "timeline" && isPlaying}
        showSettings={showSettings}
        historySizes={historySizes}
        snapEnabled={snapEnabled}
        muted={muted}
        volume={volume}
        pxPerSec={pxPerSec}
        clips={clips}
        clipsByTrack={clipsByTrack}
        activeClip={activeClip}
        tracks={tracks}
        totalWidth={totalWidth}
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
        scrubTooltip={scrubTooltip}
        selectedKeyframe={selectedKeyframe}
        onSelectKeyframe={selectKeyframeAndSeek}
        onBeginKeyframeDrag={beginKeyframeDrag}
        onBeginVolumeKeyframeDrag={beginVolumeKeyframeDrag}
        onAddVolumeKeyframe={addVolumeKeyframeFromCurve}
        fadeDragRef={fadeDragRef}
        volumeLineDragRef={volumeLineDragRef}
        createHistorySnapshot={createHistorySnapshot}
        getAutoTrackZoneTop={getAutoTrackZoneTop}
        DEFAULT_TRACK_HEIGHT={DEFAULT_TRACK_HEIGHT}
        setSnapEnabled={setSnapEnabled}
        setShowSettings={setShowSettings}
        setMuted={setMuted}
        setVolume={setVolume}
        setPxPerSec={setPxPerSec}
        setEditingTrackId={setEditingTrackId}
        seekToTime={seekToTime}
        handlePlay={handleTimelinePlay}
        stepBack={stepBack}
        stepFwd={stepFwd}
        splitAtPlayhead={splitAtPlayhead}
        undo={undo}
        redo={redo}
        handleTimelineDragEnter={handleTimelineDragEnter}
        handleTimelineDragOver={handleTimelineDragOver}
        handleTimelineDragLeave={handleTimelineDragLeave}
        handleTimelineDrop={handleTimelineDrop}
        setTimelinePlayheadRef={setTimelinePlayheadRef}
        setTracksContentRef={setTracksContentRef}
        setTrackHeadersListRef={setTrackHeadersListRef}
        handleTracksMouseDown={handleTracksMouseDown}
        handleTracksScroll={handleTracksScroll}
        handlePlayheadMouseDown={handlePlayheadMouseDown}
        handleClipMouseDown={handleClipMouseDown}
        handleClipContextMenu={handleClipContextMenu}
        handleTrimMouseDown={handleTrimMouseDown}
        handleUpdateTrack={handleUpdateTrack}
        handleTrackResizeMouseDown={handleTrackResizeMouseDown}
        marqueeBox={marqueeBox}
        snapIndicatorTime={snapIndicatorTime}
        formatTime={formatTime}
        formatTC={formatTC}
        Icon={Icon}
      />

      {showSaveConfirmDialog && (
        <div className="settings-overlay" onClick={() => setShowSaveConfirmDialog(false)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <div className="settings-header">
              <h3>Projekt schliessen</h3>
              <button className="settings-close" onClick={() => setShowSaveConfirmDialog(false)}>
                x
              </button>
            </div>
            <div className="settings-body">
              <p>Moechten Sie das Projekt vor dem Schliessen speichern?</p>
              <div className="settings-actions">
                <button className="export-action-btn" onClick={handleConfirmBack}>
                  Speichern und schliessen
                </button>
                <button className="export-action-btn" onClick={handleCancelBack}>
                  Nicht speichern und schliessen
                </button>
                <button className="export-action-btn" onClick={() => setShowSaveConfirmDialog(false)}>
                  Abbrechen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <AppOverlays
        showExport={showExport}
        exportStatus={exportStatus}
        exportProgress={exportProgress}
        totalEnd={totalEnd}
        aspectRatio={aspectRatio}
        exportQuality={exportQuality}
        showSettings={showSettings}
        settings={settings}
        volTooltip={volTooltip}
        editorFocus={editorFocus}
        focusTimeline={FOCUS_TIMELINE}
        activeClip={activeClip}
        activeClipId={activeClipId}
        activeTrack={activeTrack}
        audClip={audClip}
        displayName={displayName}
        formatTC={formatTC}
        inspectorTab={inspectorTab}
        isLinked={isLinked}
        tracksById={tracksById}
        vidClip={vidClip}
        contextMenu={contextMenu}
        clips={clips}
        timelineTime={timelineTime}
        selectedClipCount={selectedClipIds.size}
        selectedClipIds={selectedClipIds}
        setShowExport={setShowExport}
        setExportStatus={setExportStatus}
        setExportQuality={setExportQuality}
        handleCancelExport={handleCancelExport}
        handleExport={handleExport}
        setShowSettings={setShowSettings}
        setSettings={setSettings}
        onTabChange={setInspectorTab}
        onUpdateClip={updClip}
        onToggleKeyframe={toggleKeyframeAtPlayhead}
        onToggleGroupKeyframe={toggleGroupKeyframeAtPlayhead}
        onUpdateKeyframeInterpolation={updateKeyframeInterpolation}
        onJumpToKeyframeTime={seekToTime}
        selectedKeyframe={selectedKeyframe}
        splitAtPlayhead={splitAtPlayhead}
        handleContextMenuDuplicate={handleContextMenuDuplicate}
        restoreTrim={restoreTrim}
        handleContextMenuUnlink={handleContextMenuUnlink}
        handleContextMenuLink={handleContextMenuLink}
        handleContextMenuDelete={handleContextMenuDelete}
        setContextMenu={setContextMenu}
        Icon={Icon}
      />
    </div>
  );
}

export default App;
