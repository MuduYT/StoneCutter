import test from "node:test";
import assert from "node:assert/strict";
import {
  ANIMATABLE_VIDEO_PROPERTIES,
  PROJECT_FPS,
  addOrUpdateKeyframe,
  createGroupKeyframes,
  createKeyframeId,
  getKeyframeAt,
  getMergedKeyframeMarkers,
  hasKeyframeAt,
  moveKeyframe,
  removeKeyframe,
  resolveAnimatedClip,
  sampleClipProperty,
  sampleProperty,
  sanitizeKeyframeMap,
  snapTimeToFrame,
  toggleClipKeyframeAt,
} from "./keyframes.js";

const FRAME = 1 / PROJECT_FPS;

const buildKeyframe = (time, value, idSuffix = "") => ({
  id: `kf-${idSuffix || `${time}-${value}`}`,
  time,
  value,
  interpolation: "linear",
});

test("snapTimeToFrame snaps positive times to the project frame grid", () => {
  assert.equal(snapTimeToFrame(0), 0);
  assert.equal(snapTimeToFrame(0.0166), 0);
  assert.equal(snapTimeToFrame(0.0167), FRAME);
  assert.equal(snapTimeToFrame(1.5), 1.5);
  assert.equal(snapTimeToFrame(-2), 0);
  assert.equal(snapTimeToFrame(NaN), 0);
});

test("sampleProperty returns the fallback for empty tracks", () => {
  assert.equal(sampleProperty([], 0.5, 42), 42);
  assert.equal(sampleProperty(null, 0.5, 7), 7);
});

test("sampleProperty returns the only value for a single-keyframe track", () => {
  const track = [buildKeyframe(0.5, 73)];
  assert.equal(sampleProperty(track, 0, -1), 73);
  assert.equal(sampleProperty(track, 0.5, -1), 73);
  assert.equal(sampleProperty(track, 5, -1), 73);
});

test("sampleProperty clamps before first and after last keyframes", () => {
  const track = [buildKeyframe(1, 0), buildKeyframe(3, 100)];
  assert.equal(sampleProperty(track, 0, -1), 0);
  assert.equal(sampleProperty(track, 5, -1), 100);
});

test("sampleProperty linearly interpolates between bracketing keyframes", () => {
  const track = [buildKeyframe(1, 0), buildKeyframe(3, 100)];
  assert.equal(sampleProperty(track, 2, -1), 50);
  assert.equal(sampleProperty(track, 1.5, -1), 25);
  assert.equal(sampleProperty(track, 2.5, -1), 75);
});

test("addOrUpdateKeyframe inserts and replaces in-place at the same frame", () => {
  let track = addOrUpdateKeyframe([], { time: 1, value: 10 });
  track = addOrUpdateKeyframe(track, { time: 0, value: 0 });
  track = addOrUpdateKeyframe(track, { time: 1.001, value: 99 });
  assert.equal(track.length, 2);
  assert.deepEqual(
    track.map((kf) => kf.value),
    [0, 99],
  );
  assert.deepEqual(
    track.map((kf) => kf.time),
    [0, 1],
  );
});

test("removeKeyframe deletes by id without mutating input", () => {
  const original = [
    buildKeyframe(0, 1, "a"),
    buildKeyframe(1, 2, "b"),
    buildKeyframe(2, 3, "c"),
  ];
  const next = removeKeyframe(original, "kf-b");
  assert.equal(next.length, 2);
  assert.equal(original.length, 3);
  assert.deepEqual(
    next.map((kf) => kf.id),
    ["kf-a", "kf-c"],
  );
});

test("getKeyframeAt and hasKeyframeAt match within half a frame", () => {
  const track = [buildKeyframe(1, 5, "one"), buildKeyframe(2, 9, "two")];
  assert.equal(getKeyframeAt(track, 1)?.id, "kf-one");
  assert.equal(getKeyframeAt(track, 1 + FRAME * 0.4)?.id, "kf-one");
  assert.equal(getKeyframeAt(track, 1 + FRAME * 0.6), null);
  assert.equal(hasKeyframeAt(track, 2), true);
});

test("moveKeyframe snaps the target time and replaces existing keyframes there", () => {
  const track = [
    buildKeyframe(0, 1, "a"),
    buildKeyframe(1, 2, "b"),
    buildKeyframe(2, 3, "c"),
  ];
  const moved = moveKeyframe(track, "kf-a", 1.001);
  assert.equal(moved.length, 2);
  assert.deepEqual(
    moved.map((kf) => kf.id),
    ["kf-a", "kf-c"],
  );
  assert.equal(moved[0].time, 1);
});

test("resolveAnimatedClip swaps animated values in a shallow clone", () => {
  const clip = {
    id: "c1",
    positionX: 0,
    opacity: 100,
    keyframes: {
      positionX: [buildKeyframe(0, 0), buildKeyframe(1, 100)],
    },
  };
  const sampled = resolveAnimatedClip(clip, 0.5);
  assert.notEqual(sampled, clip);
  assert.equal(sampled.positionX, 50);
  assert.equal(sampled.opacity, 100);
});

test("resolveAnimatedClip is a no-op when the clip has no keyframes", () => {
  const clip = { id: "c1", positionX: 10 };
  assert.equal(resolveAnimatedClip(clip, 5), clip);
});

test("toggleClipKeyframeAt creates a keyframe with the current sampled value", () => {
  const clip = {
    id: "c1",
    positionX: 25,
  };
  const map = toggleClipKeyframeAt({
    clip,
    propertyKey: "positionX",
    time: 1,
  });
  assert.equal(map.positionX.length, 1);
  assert.equal(map.positionX[0].time, 1);
  assert.equal(map.positionX[0].value, 25);
});

test("toggleClipKeyframeAt removes an existing keyframe at the same frame", () => {
  const clip = {
    id: "c1",
    positionX: 25,
    keyframes: {
      positionX: [buildKeyframe(1, 50, "kf-1")],
    },
  };
  const map = toggleClipKeyframeAt({
    clip,
    propertyKey: "positionX",
    time: 1,
  });
  assert.equal(map.positionX, undefined);
});

test("createGroupKeyframes only writes properties that differ from default", () => {
  const clip = {
    id: "c1",
    positionX: 50,
    positionY: 0,
    scale: 100,
    rotation: 0,
    opacity: 80,
  };
  const map = createGroupKeyframes({ clip, groupId: "transform", time: 1 });
  const properties = Object.keys(map);
  assert.deepEqual(properties.sort(), ["opacity", "positionX"]);
  assert.equal(map.positionX[0].value, 50);
  assert.equal(map.opacity[0].value, 80);
});

test("createGroupKeyframes updates existing keyframes for already-modified properties", () => {
  const clip = {
    id: "c1",
    positionX: 50,
    keyframes: {
      positionX: [buildKeyframe(1, 999)],
    },
  };
  const map = createGroupKeyframes({ clip, groupId: "transform", time: 1 });
  assert.equal(map.positionX.length, 1);
  assert.equal(map.positionX[0].value, 50);
});

test("createGroupKeyframes still updates a property that already has a track even if currently at default", () => {
  const clip = {
    id: "c1",
    positionX: 0,
    keyframes: {
      positionX: [buildKeyframe(0, 100)],
    },
  };
  const map = createGroupKeyframes({ clip, groupId: "transform", time: 2 });
  assert.equal(map.positionX.length, 2);
  assert.equal(map.positionX[1].time, 2);
  assert.equal(map.positionX[1].value, 0);
});

test("getMergedKeyframeMarkers buckets keyframes by frame across properties", () => {
  const clip = {
    keyframes: {
      positionX: [buildKeyframe(0, 0, "x0"), buildKeyframe(2, 100, "x2")],
      opacity: [buildKeyframe(2, 100, "o2"), buildKeyframe(4, 0, "o4")],
    },
  };
  const markers = getMergedKeyframeMarkers(clip);
  assert.equal(markers.length, 3);
  assert.equal(markers[0].time, 0);
  assert.deepEqual(markers[1].properties.sort(), ["opacity", "positionX"]);
  assert.equal(markers[2].time, 4);
});

test("getMergedKeyframeMarkers deduplicates duplicate ids/properties per frame", () => {
  const clip = {
    keyframes: {
      positionX: [
        buildKeyframe(1, 10, "x1"),
        buildKeyframe(1.001, 20, "x1"),
      ],
      opacity: [buildKeyframe(1, 80, "o1")],
    },
  };
  const markers = getMergedKeyframeMarkers(clip);
  assert.equal(markers.length, 1);
  assert.deepEqual(markers[0].properties.sort(), ["opacity", "positionX"]);
  assert.equal(markers[0].ids.length, 2);
});

test("sanitizeKeyframeMap strips unknown keys, NaN values, and clamps to range", () => {
  const cleaned = sanitizeKeyframeMap({
    positionX: [
      { time: 1, value: 50, id: "ok", interpolation: "linear" },
      { time: 1, value: "bad" },
      { time: -2, value: 0, id: "negative" },
    ],
    opacity: [{ time: 0, value: 9999, id: "clamp" }],
    bogus: [{ time: 0, value: 0 }],
  });
  assert.equal(cleaned.bogus, undefined);
  assert.equal(cleaned.positionX.length, 2);
  assert.equal(cleaned.positionX[0].time, 0);
  assert.equal(cleaned.opacity[0].value, 100);
});

test("sanitizeKeyframeMap collapses duplicate keyframes in same frame", () => {
  const cleaned = sanitizeKeyframeMap({
    positionX: [
      { id: "a", time: 1, value: 10, interpolation: "linear" },
      { id: "b", time: 1.01, value: 20, interpolation: "linear" },
    ],
  });
  assert.equal(cleaned.positionX.length, 1);
  assert.equal(cleaned.positionX[0].value, 20);
});

test("createKeyframeId returns a unique non-empty string", () => {
  const a = createKeyframeId();
  const b = createKeyframeId();
  assert.notEqual(a, b);
  assert.ok(a.length > 0);
});

test("sampleClipProperty falls back to the property default when neither value nor track is set", () => {
  const property = ANIMATABLE_VIDEO_PROPERTIES.find((p) => p.key === "scale");
  const sampled = sampleClipProperty({ id: "c1" }, "scale", 0);
  assert.equal(sampled, property.default);
});
