// Pure keyframe engine for StoneCutter.
// Time is expressed in timeline seconds (same axis as clip.startTime / outPoint).
// All exported helpers are immutable and free of side effects so they can be
// covered by node:test in src/lib/keyframes.test.js.

export const PROJECT_FPS = 30;
export const FRAME_EPSILON = 1e-6;

export const KEYFRAME_INTERPOLATIONS = ["linear"];

export const KEYFRAME_GROUPS = {
  transform: { id: "transform", label: "Transform" },
  color: { id: "color", label: "Color" },
  speed: { id: "speed", label: "Speed" },
  audio: { id: "audio", label: "Audio" },
};

// Single source of truth for which numeric clip properties can be animated and
// how the inspector / engine should treat them. Adding a new effect parameter
// later (the auto-expansion rule) is a one-line addition here plus an Inspector
// row referencing the same key.
export const ANIMATABLE_VIDEO_PROPERTIES = [
  { key: "positionX", group: "transform", default: 0, min: -10000, max: 10000 },
  { key: "positionY", group: "transform", default: 0, min: -10000, max: 10000 },
  { key: "scaleX", group: "transform", default: 100, min: 0, max: 400 },
  { key: "scaleY", group: "transform", default: 100, min: 0, max: 400 },
  { key: "scale", group: "transform", default: 100, min: 0, max: 400 },
  { key: "rotation", group: "transform", default: 0, min: -360, max: 360 },
  { key: "opacity", group: "transform", default: 100, min: 0, max: 100 },
  { key: "brightness", group: "color", default: 0, min: -100, max: 100 },
  { key: "contrast", group: "color", default: 0, min: -100, max: 100 },
  { key: "saturation", group: "color", default: 0, min: -100, max: 100 },
  { key: "temperature", group: "color", default: 0, min: -100, max: 100 },
  { key: "speed", group: "speed", default: 100, min: 10, max: 400 },
  // Audio properties (stored as raw clip values: volume 0–2, pan –100–100)
  { key: "volume", group: "audio", default: 1, min: 0, max: 2 },
  { key: "pan", group: "audio", default: 0, min: -100, max: 100 },
];

const ANIMATABLE_BY_KEY = new Map(
  ANIMATABLE_VIDEO_PROPERTIES.map((property) => [property.key, property]),
);

export const getAnimatableProperty = (key) => ANIMATABLE_BY_KEY.get(key) || null;

export const isAnimatableProperty = (key) => ANIMATABLE_BY_KEY.has(key);

export const getPropertiesForGroup = (groupId) =>
  ANIMATABLE_VIDEO_PROPERTIES.filter((property) => property.group === groupId);

const finiteOr = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const safeArray = (value) => (Array.isArray(value) ? value : []);

const safeMap = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : null;

let keyframeIdCounter = 0;
export const createKeyframeId = () => {
  keyframeIdCounter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `kf-${Date.now().toString(36)}-${keyframeIdCounter}-${random}`;
};

// Internal helpers ---------------------------------------------------------

const sortedTrack = (track) =>
  [...safeArray(track)].sort((a, b) => finiteOr(a?.time, 0) - finiteOr(b?.time, 0));

const isSameFrame = (timeA, timeB, fps = PROJECT_FPS) => {
  const frameDuration = 1 / Math.max(1, fps);
  return Math.abs(timeA - timeB) < frameDuration / 2;
};

// Snapping -----------------------------------------------------------------

export const snapTimeToFrame = (time, fps = PROJECT_FPS) => {
  const safeFps = Math.max(1, fps);
  const safeTime = Math.max(0, finiteOr(time, 0));
  return Math.round(safeTime * safeFps) / safeFps;
};

// Sampling -----------------------------------------------------------------

const lerp = (a, b, t) => a + (b - a) * t;

export const sampleProperty = (track, time, fallback) => {
  const sorted = sortedTrack(track);
  if (sorted.length === 0) return fallback;
  const t = finiteOr(time, 0);
  if (t <= sorted[0].time) return sorted[0].value;
  if (t >= sorted[sorted.length - 1].time) {
    return sorted[sorted.length - 1].value;
  }
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const left = sorted[i];
    const right = sorted[i + 1];
    if (t >= left.time && t <= right.time) {
      const span = right.time - left.time;
      if (span < FRAME_EPSILON) return right.value;
      const u = (t - left.time) / span;
      return lerp(left.value, right.value, u);
    }
  }
  return fallback;
};

export const getKeyframeAt = (track, time, fps = PROJECT_FPS) => {
  const sorted = sortedTrack(track);
  for (const kf of sorted) {
    if (isSameFrame(kf.time, time, fps)) return kf;
  }
  return null;
};

export const hasKeyframeAt = (track, time, fps = PROJECT_FPS) =>
  getKeyframeAt(track, time, fps) !== null;

// Whole-clip resolution ----------------------------------------------------

export const resolveAnimatedClip = (clip, timelineTime) => {
  const map = safeMap(clip?.keyframes);
  if (!map) return clip;
  const next = { ...clip };
  let touched = false;
  for (const property of ANIMATABLE_VIDEO_PROPERTIES) {
    const track = map[property.key];
    if (!Array.isArray(track) || track.length === 0) continue;
    const fallback = clip[property.key] ?? property.default;
    const sampled = sampleProperty(track, timelineTime, fallback);
    if (sampled !== fallback) {
      next[property.key] = sampled;
      touched = true;
    }
  }
  return touched ? next : clip;
};

// Mutators (immutable) -----------------------------------------------------

export const addOrUpdateKeyframe = (
  track,
  { time, value, interpolation = "linear", id },
  fps = PROJECT_FPS,
) => {
  const safeTime = snapTimeToFrame(finiteOr(time, 0), fps);
  const sorted = sortedTrack(track);
  const existingIndex = sorted.findIndex((kf) =>
    isSameFrame(kf.time, safeTime, fps),
  );
  const next = [...sorted];
  if (existingIndex >= 0) {
    next[existingIndex] = {
      ...next[existingIndex],
      time: safeTime,
      value,
      interpolation,
    };
    return next;
  }
  next.push({
    id: id || createKeyframeId(),
    time: safeTime,
    value,
    interpolation,
  });
  next.sort((a, b) => a.time - b.time);
  return next;
};

export const removeKeyframe = (track, id) =>
  sortedTrack(track).filter((kf) => kf.id !== id);

export const removeKeyframeAt = (track, time, fps = PROJECT_FPS) =>
  sortedTrack(track).filter((kf) => !isSameFrame(kf.time, time, fps));

export const moveKeyframe = (track, id, newTime, fps = PROJECT_FPS) => {
  const sorted = sortedTrack(track);
  const index = sorted.findIndex((kf) => kf.id === id);
  if (index < 0) return sorted;
  const safeTime = snapTimeToFrame(finiteOr(newTime, 0), fps);
  const conflict = sorted.findIndex(
    (kf, i) => i !== index && isSameFrame(kf.time, safeTime, fps),
  );
  const next = sorted.filter((_, i) => i !== index && i !== conflict);
  const moved = { ...sorted[index], time: safeTime };
  next.push(moved);
  next.sort((a, b) => a.time - b.time);
  return next;
};

// Per-clip helpers (operate on the keyframes map) --------------------------

export const getClipPropertyTrack = (clip, propertyKey) => {
  const map = safeMap(clip?.keyframes);
  if (!map) return [];
  const track = map[propertyKey];
  return Array.isArray(track) ? track : [];
};

export const setClipPropertyTrack = (clip, propertyKey, nextTrack) => {
  const map = safeMap(clip?.keyframes) || {};
  const next = { ...map };
  if (!nextTrack || nextTrack.length === 0) {
    delete next[propertyKey];
  } else {
    next[propertyKey] = nextTrack;
  }
  return next;
};

export const sampleClipProperty = (clip, propertyKey, time) => {
  const property = getAnimatableProperty(propertyKey);
  const fallback = clip?.[propertyKey] ?? property?.default ?? 0;
  const track = getClipPropertyTrack(clip, propertyKey);
  if (track.length === 0) return fallback;
  return sampleProperty(track, time, fallback);
};

// Toggle a per-property keyframe at the given time. If a keyframe already
// exists at that time, remove it. Otherwise create one with the clip's current
// (already-sampled) value at that time.
export const toggleClipKeyframeAt = ({
  clip,
  propertyKey,
  time,
  fps = PROJECT_FPS,
}) => {
  const property = getAnimatableProperty(propertyKey);
  if (!property) return clip?.keyframes || {};
  const track = getClipPropertyTrack(clip, propertyKey);
  if (hasKeyframeAt(track, time, fps)) {
    return setClipPropertyTrack(
      clip,
      propertyKey,
      removeKeyframeAt(track, time, fps),
    );
  }
  const value = sampleClipProperty(clip, propertyKey, time);
  return setClipPropertyTrack(
    clip,
    propertyKey,
    addOrUpdateKeyframe(track, { time, value }, fps),
  );
};

// Shift all keyframe times in a clip's keyframe map by `delta` seconds.
// Used when a clip is moved so keyframes stay anchored to their position
// within the clip rather than at their original absolute timeline positions.
export const shiftKeyframeMap = (keyframes, delta) => {
  const map = safeMap(keyframes);
  if (!map || delta === 0) return keyframes;
  const next = {};
  for (const [key, track] of Object.entries(map)) {
    if (!Array.isArray(track) || track.length === 0) continue;
    next[key] = track.map((kf) => ({
      ...kf,
      time: Math.max(0, finiteOr(kf.time, 0) + delta),
    }));
  }
  return Object.keys(next).length > 0 ? next : undefined;
};

// Group helper: for every animatable property in the group whose current clip
// value differs from its default, create or update a keyframe at `time`. No
// "phantom" keyframes are created on properties left at default.
export const createGroupKeyframes = ({
  clip,
  groupId,
  time,
  fps = PROJECT_FPS,
}) => {
  const properties = getPropertiesForGroup(groupId);
  let nextMap = safeMap(clip?.keyframes) ? { ...clip.keyframes } : {};
  for (const property of properties) {
    const current = clip?.[property.key];
    const existingTrack = nextMap[property.key];
    const hasExistingTrack = Array.isArray(existingTrack) && existingTrack.length > 0;
    const isAtDefault =
      current === undefined ||
      current === null ||
      (typeof current === "number" && current === property.default);
    if (isAtDefault && !hasExistingTrack) continue;
    const value = current === undefined || current === null
      ? property.default
      : current;
    const nextTrack = addOrUpdateKeyframe(
      existingTrack || [],
      { time, value },
      fps,
    );
    nextMap = { ...nextMap, [property.key]: nextTrack };
  }
  return nextMap;
};

// Visual sugar for the timeline overlay: returns a flat list of dot positions
// for a clip, deduplicated by frame. Each entry includes the property keys
// with a keyframe at that time so the overlay can show grouped indicators.
export const getMergedKeyframeMarkers = (clip, fps = PROJECT_FPS) => {
  const map = safeMap(clip?.keyframes);
  if (!map) return [];
  const buckets = new Map();
  for (const property of ANIMATABLE_VIDEO_PROPERTIES) {
    const track = map[property.key];
    if (!Array.isArray(track)) continue;
    for (const kf of track) {
      const time = snapTimeToFrame(finiteOr(kf.time, 0), fps);
      const bucket = buckets.get(time) || { time, properties: [], ids: [] };
      if (!bucket.properties.includes(property.key)) {
        bucket.properties.push(property.key);
      }
      if (!bucket.ids.some((entry) => entry.id === kf.id)) {
        bucket.ids.push({ propertyKey: property.key, id: kf.id });
      }
      buckets.set(time, bucket);
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
};

// Persistence sanitization. Drops unknown property keys, validates types and
// clamps values into the property range. Used by src/lib/project.js when
// (de)serializing clip.keyframes.
export const sanitizeKeyframeMap = (input) => {
  const map = safeMap(input);
  if (!map) return undefined;
  const out = {};
  for (const [key, rawTrack] of Object.entries(map)) {
    const property = getAnimatableProperty(key);
    if (!property) continue;
    const cleaned = [];
    for (const kf of safeArray(rawTrack)) {
      const time = finiteOr(kf?.time, NaN);
      const value = finiteOr(kf?.value, NaN);
      if (!Number.isFinite(time) || !Number.isFinite(value)) continue;
      const clamped = Math.max(property.min, Math.min(property.max, value));
      const interpolation = KEYFRAME_INTERPOLATIONS.includes(kf?.interpolation)
        ? kf.interpolation
        : "linear";
      cleaned.push({
        id: typeof kf?.id === "string" && kf.id ? kf.id : createKeyframeId(),
        time: Math.max(0, time),
        value: clamped,
        interpolation,
      });
    }
    if (cleaned.length === 0) continue;
    cleaned.sort((a, b) => a.time - b.time);
    const byFrame = new Map();
    for (const kf of cleaned) {
      const frameTime = snapTimeToFrame(kf.time);
      byFrame.set(frameTime, { ...kf, time: frameTime });
    }
    const deduped = [...byFrame.values()].sort((a, b) => a.time - b.time);
    out[key] = deduped;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};
