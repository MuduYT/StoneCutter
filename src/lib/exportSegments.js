import { clipEnd } from "./timeline.js";

export const isAbsoluteSourcePath = (sourcePath) => {
  if (!sourcePath) return false;
  return (
    /^[A-Za-z]:[\\/]/.test(sourcePath) ||
    sourcePath.startsWith("/") ||
    sourcePath.startsWith("\\\\")
  );
};

const finiteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clampNumber = (value, fallback, min = -Infinity, max = Infinity) => {
  const number = finiteNumber(value, fallback);
  return Math.max(min, Math.min(max, number));
};

const clampSourceRange = (clip) => {
  const sourceDuration = finiteNumber(clip.sourceDuration, NaN);
  const hasSourceDuration =
    Number.isFinite(sourceDuration) && sourceDuration > 0;
  let inPoint = Math.max(0, finiteNumber(clip.inPoint, 0));
  let outPoint = Math.max(0, finiteNumber(clip.outPoint, inPoint));

  if (hasSourceDuration) {
    inPoint = Math.min(inPoint, sourceDuration);
    outPoint = Math.min(outPoint, sourceDuration);
  }
  if (outPoint < inPoint) outPoint = inPoint;

  return { inPoint, outPoint };
};

const getTrackType = (track, clip, media) => {
  if (track?.type) return track.type;
  if (clip?.trackMode === "audio" || media?.mediaType === "audio")
    return "audio";
  return "video";
};

const getTrackIndex = (trackOrder, trackId, type) => {
  const index = trackOrder.get(trackId);
  if (Number.isFinite(index)) return index;
  return type === "audio" ? Number.MAX_SAFE_INTEGER : 0;
};

const shouldExportAudioClip = ({ clip, track, media, hasSoloAudio }) => {
  if (!media?.src && !media?.path) return false;
  const mediaType = media.mediaType || "video";
  const trackType = getTrackType(track, clip, media);
  const hasPossibleAudio = mediaType !== "image";
  const isExplicitAudio =
    clip.trackMode === "audio" ||
    trackType === "audio" ||
    mediaType === "audio";
  const isLegacyAv = clip.trackMode === "av" && mediaType === "video";
  if (!hasPossibleAudio || (!isExplicitAudio && !isLegacyAv)) return false;
  if (clip.clipMuted) return false;
  if (trackType === "audio") {
    if (track?.muted) return false;
    if (hasSoloAudio && !track?.solo) return false;
  }
  return true;
};

const buildSegmentForClip = ({ clip, media, track, trackIndex, hasAudio }) => {
  const { inPoint, outPoint } = clampSourceRange(clip);
  const duration = Math.max(0, outPoint - inPoint);
  const mediaType = media?.mediaType || "video";
  const trackType = getTrackType(track, clip, media);
  const hasVideo =
    trackType === "video" &&
    clip.trackMode !== "audio" &&
    (mediaType === "video" || mediaType === "image");

  return {
    source_path: media.path || "",
    in_point: inPoint,
    out_point: outPoint,
    start_time: Math.max(0, finiteNumber(clip.startTime, 0)),
    duration,
    media_type: mediaType,
    track_mode: clip.trackMode || (trackType === "audio" ? "audio" : "video"),
    track_id: clip.trackId || "",
    track_index: trackIndex,
    has_video: hasVideo,
    has_audio: hasAudio,
    volume: clampNumber(clip.volume, 1, 0, 2),
    fade_in: clampNumber(clip.fadeIn, 0, 0, duration),
    fade_out: clampNumber(clip.fadeOut, 0, 0, duration),
    position_x: clampNumber(clip.positionX, 0, -10000, 10000),
    position_y: clampNumber(clip.positionY, 0, -10000, 10000),
    scale: clampNumber(clip.scale, 100, 0, 400),
    rotation: clampNumber(clip.rotation, 0, -360, 360),
    opacity: clampNumber(clip.opacity, 100, 0, 100),
    brightness: clampNumber(clip.brightness, 0, -100, 100),
    contrast: clampNumber(clip.contrast, 0, -100, 100),
    saturation: clampNumber(clip.saturation, 0, -100, 100),
    flip_h: Boolean(clip.flipH),
    flip_v: Boolean(clip.flipV),
    clip_id: clip.id || "",
    clip_name: clip.name || media.name || clip.id || "Clip",
  };
};

export const buildExportSegments = ({ clips, videos, tracks }) => {
  if (!clips || clips.length === 0) {
    return { ok: false, error: "Keine Clips auf der Timeline." };
  }

  const mediaById = new Map((videos || []).map((item) => [item.id, item]));
  const trackById = Array.isArray(tracks)
    ? new Map(tracks.map((track) => [track.id, track]))
    : new Map();
  const trackOrder = Array.isArray(tracks)
    ? new Map(tracks.map((track, index) => [track.id, index]))
    : new Map();
  const hasSoloAudio =
    Array.isArray(tracks) &&
    tracks.some((track) => track.type === "audio" && track.solo);

  const segments = [];
  for (const clip of clips) {
    const media = mediaById.get(clip.videoId);
    const track = trackById.get(clip.trackId);
    const mediaType = media?.mediaType || "video";
    const trackType = getTrackType(track, clip, media);
    const trackIndex = getTrackIndex(trackOrder, clip.trackId, trackType);
    const sourcePath = media?.path || "";
    const hasVideo =
      trackType === "video" &&
      clip.trackMode !== "audio" &&
      (mediaType === "video" || mediaType === "image");
    const hasAudio = shouldExportAudioClip({
      clip,
      track,
      media,
      hasSoloAudio,
    });

    if (!hasVideo && !hasAudio) continue;

    if (!isAbsoluteSourcePath(sourcePath)) {
      return {
        ok: false,
        error: `"${media?.name || clip.videoId}" wurde per Browser importiert – für den Export muss die Datei über den Tauri-Dateidialog geöffnet werden.`,
      };
    }

    const segment = buildSegmentForClip({
      clip,
      media,
      track,
      trackIndex,
      hasAudio,
    });
    if (segment.duration <= 0.005) continue;
    segments.push(segment);
  }

  if (segments.length === 0) {
    return {
      ok: false,
      error: "Keine sichtbaren oder hoerbaren Clips auf aktiven Spuren.",
    };
  }

  segments.sort((a, b) => {
    if (a.has_video !== b.has_video) return a.has_video ? -1 : 1;
    if (a.has_video && b.has_video) {
      return (
        b.track_index - a.track_index ||
        a.start_time - b.start_time ||
        String(a.clip_id).localeCompare(String(b.clip_id))
      );
    }
    return (
      a.start_time - b.start_time ||
      a.track_index - b.track_index ||
      String(a.clip_id).localeCompare(String(b.clip_id))
    );
  });

  return { ok: true, segments };
};

export const totalExportDuration = (segments) => {
  return segments.reduce((total, segment) => {
    const duration = Number.isFinite(segment.duration)
      ? segment.duration
      : Math.max(0, segment.out_point - segment.in_point);
    const end =
      Math.max(0, finiteNumber(segment.start_time, 0)) + Math.max(0, duration);
    return Math.max(total, end);
  }, 0);
};

export const totalTimelineDuration = (clips) => {
  return clips.reduce((total, clip) => Math.max(total, clipEnd(clip)), 0);
};
