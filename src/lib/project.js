import {
  DEFAULT_TRACK_HEIGHT,
  MAX_TRACK_HEIGHT,
  MIN_TRACK_HEIGHT,
  createDefaultTracks,
} from "./trackStore.js";
import { nextLinkGroupId } from "./timeline.js";

export const PROJECT_FILE_EXTENSION = "stonecutter";
export const PROJECT_SCHEMA_VERSION = 2;
// Schema versions we accept without error (for forward-compat on older saves)
const ACCEPTED_SCHEMA_VERSIONS = new Set([1, 2]);

const safeObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const safeString = (value, fallback = "") =>
  typeof value === "string" ? value : fallback;

const URI_SCHEME_RE = /^[a-z][a-z\d+.-]*:/i;
const WINDOWS_ABSOLUTE_RE = /^[a-z]:[\\/]/i;
const UNC_ABSOLUTE_RE = /^(\\\\|\/\/)/;

export function isAbsoluteMediaPath(path) {
  const value = safeString(path);
  return Boolean(
    value &&
    (value.startsWith("/") ||
      WINDOWS_ABSOLUTE_RE.test(value) ||
      UNC_ABSOLUTE_RE.test(value) ||
      URI_SCHEME_RE.test(value)),
  );
}

export function resolveProjectMediaPath(projectDirectory, mediaPath) {
  const path = safeString(mediaPath);
  if (!path || isAbsoluteMediaPath(path)) return path;
  const directory = safeString(projectDirectory).replace(/[\\/]+$/g, "");
  if (!directory) return path;
  const separator = directory.includes("\\") ? "\\" : "/";
  const relative = path.replace(/^\.[\\/]+/, "").replace(/[\\/]+/g, separator);
  return `${directory}${separator}${relative}`;
}

const finiteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const positiveNumber = (value, fallback) => {
  const number = finiteNumber(value, fallback);
  return number > 0 ? number : fallback;
};

const clamp01 = (value, fallback) => {
  const number = finiteNumber(value, fallback);
  return Math.max(0, Math.min(1, number));
};

const clampNumber = (value, fallback, min = -Infinity, max = Infinity) => {
  const number = finiteNumber(value, fallback);
  return Math.max(min, Math.min(max, number));
};

const safeBoolean = (value, fallback) =>
  typeof value === "boolean" ? value : fallback;

const optionalNumber = (
  source,
  key,
  fallback,
  min = -Infinity,
  max = Infinity,
) => {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return undefined;
  return clampNumber(source[key], fallback, min, max);
};

const optionalBoolean = (source, key) => {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return undefined;
  return safeBoolean(source[key], false);
};

const normalizeClipInspectorProperties = (clip) => {
  const safeClip = safeObject(clip);
  const out = {};
  const numericProps = [
    ["volume", 1, 0, 2],
    ["fadeIn", 0, 0, Infinity],
    ["fadeOut", 0, 0, Infinity],
    ["positionX", 0, -10000, 10000],
    ["positionY", 0, -10000, 10000],
    ["scale", 100, 0, 400],
    ["rotation", 0, -360, 360],
    ["opacity", 100, 0, 100],
    ["brightness", 0, -100, 100],
    ["contrast", 0, -100, 100],
    ["saturation", 0, -100, 100],
    ["temperature", 0, -100, 100],
    ["speed", 100, 10, 400],
    ["pan", 0, -100, 100],
  ];
  for (const [key, fallback, min, max] of numericProps) {
    const value = optionalNumber(safeClip, key, fallback, min, max);
    if (value !== undefined) out[key] = value;
  }
  for (const key of ["flipH", "flipV", "clipMuted"]) {
    const value = optionalBoolean(safeClip, key);
    if (value !== undefined) out[key] = value;
  }
  return out;
};

const hydrateSourceRanges = (ranges) => {
  const safeRanges = safeObject(ranges);
  return Object.fromEntries(
    Object.entries(safeRanges).map(([id, range]) => {
      const safeRange = safeObject(range);
      return [
        id,
        {
          inPoint: Math.max(0, finiteNumber(safeRange.inPoint, 0)),
          outPoint: Math.max(0, finiteNumber(safeRange.outPoint, 0)),
        },
      ];
    }),
  );
};

const hydrateVideoDurations = (durations) => {
  const safeDurations = safeObject(durations);
  return Object.fromEntries(
    Object.entries(safeDurations)
      .map(([id, duration]) => [id, finiteNumber(duration, NaN)])
      .filter(([, duration]) => Number.isFinite(duration) && duration > 0),
  );
};

const sanitizeTrackType = (type) => (type === "audio" ? "audio" : "video");

const sanitizeTrackHeight = (height) => {
  const number = finiteNumber(height, DEFAULT_TRACK_HEIGHT);
  return Math.max(MIN_TRACK_HEIGHT, Math.min(MAX_TRACK_HEIGHT, number));
};

const normalizeTrack = (track, index) => {
  const safeTrack = safeObject(track);
  const type = sanitizeTrackType(safeTrack.type);
  const normalized = {
    id: safeString(safeTrack.id, `track-${index + 1}`),
    type,
    name:
      safeString(
        safeTrack.name,
        type === "audio" ? `Audio ${index + 1}` : `Video ${index + 1}`,
      ) || (type === "audio" ? `Audio ${index + 1}` : `Video ${index + 1}`),
    locked: safeBoolean(safeTrack.locked, false),
    height: sanitizeTrackHeight(safeTrack.height),
  };
  if (type === "audio") {
    normalized.muted = safeBoolean(safeTrack.muted, false);
    normalized.solo = safeBoolean(safeTrack.solo, false);
  }
  return normalized;
};

const hydrateTracks = (tracks) => {
  const sourceTracks =
    Array.isArray(tracks) && tracks.length > 0 ? tracks : createDefaultTracks();
  const hydrated = sourceTracks.map(normalizeTrack);
  const hasVideo = hydrated.some((track) => track.type === "video");
  const hasAudio = hydrated.some((track) => track.type === "audio");
  const defaults = createDefaultTracks();
  if (!hasVideo) hydrated.unshift(defaults[0]);
  if (!hasAudio) hydrated.push(defaults[1]);
  return hydrated;
};

export function sanitizeProjectName(name) {
  const cleaned = String(name || "")
    .trim()
    .split("")
    .map((ch) => (/[<>:"/\\|?*]/.test(ch) || ch.charCodeAt(0) < 32 ? "-" : ch))
    .join("")
    .replace(/\s+/g, " ")
    .replace(/[.\s-]+$/g, "");
  return cleaned || "Untitled Project";
}

export function getProjectFileName(name) {
  return `${sanitizeProjectName(name)}.${PROJECT_FILE_EXTENSION}`;
}

export function createEmptyProjectState(name = "Untitled Project") {
  return {
    name: sanitizeProjectName(name),
    videos: [],
    clips: [],
    sourceRanges: {},
    videoDurations: {},
    tracks: createDefaultTracks(),
    timelineTime: 0,
    settings: { imageDuration: 3 },
    ui: {
      aspectRatio: "16:9",
      pxPerSec: 40,
      snapEnabled: true,
      volume: 1,
      muted: false,
    },
  };
}

export function buildProjectDocument(state) {
  const now = new Date().toISOString();
  const tracks = (state.tracks || createDefaultTracks()).map((track, index) =>
    normalizeTrack(track, index),
  );
  const defaultVideoTrackId =
    tracks.find((track) => track.type === "video")?.id || "track-v1";
  const defaultAudioTrackId =
    tracks.find((track) => track.type === "audio")?.id || "track-a1";
  return {
    app: "StoneCutter",
    schemaVersion: PROJECT_SCHEMA_VERSION,
    savedAt: now,
    project: {
      name: sanitizeProjectName(state.name),
    },
    media: (state.videos || []).map((item) => {
      const mediaItem = {
        id: item.id,
        name: item.name,
        path: item.path || "",
        mediaType: item.mediaType || "video",
      };
      if (item.importedAt) mediaItem.importedAt = item.importedAt;
      if (item.originalPath) mediaItem.originalPath = item.originalPath;
      return mediaItem;
    }),
    timeline: {
      clips: (state.clips || []).map((clip) => ({
        id: clip.id,
        videoId: clip.videoId,
        name: clip.name,
        sourceDuration: clip.sourceDuration,
        inPoint: clip.inPoint,
        outPoint: clip.outPoint,
        startTime: clip.startTime,
        trackMode: clip.trackMode || "video",
        trackId:
          clip.trackId ||
          (clip.trackMode === "audio"
            ? defaultAudioTrackId
            : defaultVideoTrackId),
        linkGroupId: clip.linkGroupId || null,
        ...normalizeClipInspectorProperties(clip),
      })),
      playhead: Number.isFinite(state.timelineTime) ? state.timelineTime : 0,
    },
    tracks,
    sourceRanges: state.sourceRanges || {},
    videoDurations: state.videoDurations || {},
    settings: {
      imageDuration: state.settings?.imageDuration ?? 3,
    },
    ui: {
      aspectRatio: state.aspectRatio || state.ui?.aspectRatio || "16:9",
      pxPerSec: state.pxPerSec ?? state.ui?.pxPerSec ?? 40,
      snapEnabled: state.snapEnabled ?? state.ui?.snapEnabled ?? true,
      volume: state.volume ?? state.ui?.volume ?? 1,
      muted: state.muted ?? state.ui?.muted ?? false,
    },
  };
}

export function parseProjectDocument(raw) {
  const doc = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!doc || doc.app !== "StoneCutter") {
    throw new Error("Keine gueltige StoneCutter-Projektdatei.");
  }
  if (!ACCEPTED_SCHEMA_VERSIONS.has(doc.schemaVersion)) {
    throw new Error(`Nicht unterstuetzte Projektversion: ${doc.schemaVersion}`);
  }
  return doc;
}

export function hydrateProjectState(doc, hydrateOptions = (path) => path) {
  const parsed = parseProjectDocument(doc);
  const options =
    typeof hydrateOptions === "function"
      ? { convertFileSrc: hydrateOptions }
      : safeObject(hydrateOptions);
  const convertFileSrc = options.convertFileSrc || ((path) => path);
  const resolveMediaPath = options.resolveMediaPath || ((path) => path);
  const media = Array.isArray(parsed.media) ? parsed.media : [];
  const clips = Array.isArray(parsed.timeline?.clips)
    ? parsed.timeline.clips
    : [];
  const tracks = hydrateTracks(parsed.tracks);
  const defaultVideoTrackId =
    tracks.find((track) => track.type === "video")?.id || "track-v1";
  const defaultAudioTrackId =
    tracks.find((track) => track.type === "audio")?.id || "track-a1";
  const ui = safeObject(parsed.ui);
  const settings = safeObject(parsed.settings);
  const mediaById = new Map(
    media.map((item) => [safeObject(item).id, safeObject(item)]),
  );
  const isLegacyV1 = parsed.schemaVersion === 1;

  const hydratedClips = [];
  clips.forEach((clip, index) => {
    const safeClip = safeObject(clip);
    const inPoint = Math.max(0, finiteNumber(safeClip.inPoint, 0));
    const outPoint = Math.max(
      inPoint,
      finiteNumber(safeClip.outPoint, inPoint),
    );
    const baseClip = {
      id: safeString(safeClip.id, `clip-${index + 1}`),
      videoId: safeString(safeClip.videoId),
      name: safeString(safeClip.name, `Clip ${index + 1}`),
      sourceDuration: Math.max(
        outPoint,
        finiteNumber(safeClip.sourceDuration, outPoint),
      ),
      inPoint,
      outPoint,
      startTime: Math.max(0, finiteNumber(safeClip.startTime, 0)),
      trackMode: safeString(safeClip.trackMode, "video") || "video",
      trackId:
        safeString(
          safeClip.trackId,
          safeClip.trackMode === "audio"
            ? defaultAudioTrackId
            : defaultVideoTrackId,
        ) ||
        (safeClip.trackMode === "audio"
          ? defaultAudioTrackId
          : defaultVideoTrackId),
      linkGroupId: safeString(safeClip.linkGroupId, "") || null,
      ...normalizeClipInspectorProperties(safeClip),
    };

    // Legacy v1 migration: split 'av' clips into two linked clips (video + audio) on separate tracks.
    // Only when the referenced media is a video (images never had audio).
    const sourceMedia = mediaById.get(baseClip.videoId);
    const mediaType = safeString(sourceMedia?.mediaType, "video");
    if (isLegacyV1 && baseClip.trackMode === "av" && mediaType === "video") {
      const linkGroupId = nextLinkGroupId();
      hydratedClips.push({
        ...baseClip,
        trackMode: "video",
        trackId: baseClip.trackId || defaultVideoTrackId,
        linkGroupId,
      });
      hydratedClips.push({
        ...baseClip,
        id: `${baseClip.id}-a`,
        trackMode: "audio",
        trackId: defaultAudioTrackId,
        linkGroupId,
      });
      return;
    }

    // Legacy 'av' on a non-video source: collapse to 'video' trackMode.
    if (baseClip.trackMode === "av") {
      hydratedClips.push({ ...baseClip, trackMode: "video" });
      return;
    }

    hydratedClips.push(baseClip);
  });

  return {
    name: sanitizeProjectName(parsed.project?.name),
    videos: media.map((item, index) => {
      const safeItem = safeObject(item);
      const path = safeString(safeItem.path);
      const resolvedPath = path ? resolveMediaPath(path) : "";
      return {
        id: safeString(safeItem.id, `media-${index + 1}`),
        name: safeString(
          safeItem.name,
          path.split(/[\\/]/).pop() || `Media ${index + 1}`,
        ),
        path: resolvedPath,
        originalPath: safeString(safeItem.originalPath),
        importedAt: safeString(safeItem.importedAt),
        src: resolvedPath ? convertFileSrc(resolvedPath) : "",
        mediaType: safeString(safeItem.mediaType, "video") || "video",
      };
    }),
    clips: hydratedClips,
    sourceRanges: hydrateSourceRanges(parsed.sourceRanges),
    videoDurations: hydrateVideoDurations(parsed.videoDurations),
    tracks,
    timelineTime: Math.max(0, finiteNumber(parsed.timeline?.playhead, 0)),
    settings: {
      imageDuration: positiveNumber(settings.imageDuration, 3),
    },
    ui: {
      aspectRatio: safeString(ui.aspectRatio, "16:9") || "16:9",
      pxPerSec: positiveNumber(ui.pxPerSec, 40),
      snapEnabled: safeBoolean(ui.snapEnabled, true),
      volume: clamp01(ui.volume, 1),
      muted: safeBoolean(ui.muted, false),
    },
  };
}
