import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExportSegments,
  isAbsoluteSourcePath,
  totalExportDuration,
  totalTimelineDuration,
} from "./exportSegments.js";

const media = [
  {
    id: "v1",
    name: "A.mp4",
    path: "C:\\media\\A.mp4",
    src: "asset://A.mp4",
    mediaType: "video",
  },
  {
    id: "v2",
    name: "B.png",
    path: "/media/B.png",
    src: "asset://B.png",
    mediaType: "image",
  },
  {
    id: "a1",
    name: "Voice.wav",
    path: "C:\\media\\Voice.wav",
    src: "asset://Voice.wav",
    mediaType: "audio",
  },
];

const clip = (
  id,
  videoId,
  startTime,
  inPoint,
  outPoint,
  trackMode = "video",
  extra = {},
) => ({
  id,
  videoId,
  name: id,
  startTime,
  inPoint,
  outPoint,
  sourceDuration: outPoint,
  trackMode,
  ...extra,
});

const tracks = [
  { id: "track-v1", type: "video", name: "Video 1" },
  { id: "track-v2", type: "video", name: "Video 2" },
  { id: "track-a1", type: "audio", name: "Audio 1", muted: false, solo: false },
];

test("recognizes Windows, UNC and POSIX absolute export paths", () => {
  assert.equal(isAbsoluteSourcePath("C:\\media\\clip.mp4"), true);
  assert.equal(isAbsoluteSourcePath("D:/media/clip.mp4"), true);
  assert.equal(isAbsoluteSourcePath("\\\\server\\share\\clip.mp4"), true);
  assert.equal(isAbsoluteSourcePath("/media/clip.mp4"), true);
  assert.equal(isAbsoluteSourcePath("clip.mp4"), false);
});

test("rejects empty timelines before export", () => {
  const result = buildExportSegments({ clips: [], videos: media });

  assert.equal(result.ok, false);
  assert.equal(result.error, "Keine Clips auf der Timeline.");
});

test("builds timeline-aware video, image and audio composition segments", () => {
  const clips = [
    clip("base", "v1", 1, 2, 5, "video", { trackId: "track-v1" }),
    clip("png", "v2", 2, 0, 2, "video", { trackId: "track-v2" }),
    clip("voice", "a1", 4, 1, 3, "audio", { trackId: "track-a1" }),
  ];
  const result = buildExportSegments({ clips, videos: media, tracks });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.segments.map((segment) => [
      segment.clip_id,
      segment.start_time,
      segment.duration,
      segment.has_video,
      segment.has_audio,
    ]),
    [
      ["png", 2, 2, true, false],
      ["base", 1, 3, true, false],
      ["voice", 4, 2, false, true],
    ],
  );
  assert.equal(totalExportDuration(result.segments), 6);
  assert.equal(totalTimelineDuration(clips), 6);
});

test("rejects browser-imported files because ffmpeg needs absolute paths", () => {
  const result = buildExportSegments({
    clips: [clip("bad", "browser", 0, 0, 2)],
    videos: [
      {
        id: "browser",
        name: "Browser Clip.mp4",
        path: "Browser Clip.mp4",
        src: "blob://clip",
        mediaType: "video",
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /Browser Clip\.mp4/);
  assert.match(result.error, /Tauri-Dateidialog/);
});

test("allows overlapping video/image layers instead of rejecting multi-track export", () => {
  const result = buildExportSegments({
    clips: [
      clip("base", "v1", 0, 0, 5, "video", { trackId: "track-v1" }),
      clip("overlay", "v2", 2, 0, 2, "video", { trackId: "track-v2" }),
    ],
    videos: media,
    tracks,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.segments.map((segment) => segment.clip_id),
    ["overlay", "base"],
  );
  assert.equal(totalExportDuration(result.segments), 5);
});

test("clamps clip out points to source duration before export", () => {
  const sourceLimited = clip("limited", "v1", 0, 2, 12);
  sourceLimited.sourceDuration = 6;
  const result = buildExportSegments({ clips: [sourceLimited], videos: media });

  assert.equal(result.ok, true);
  assert.equal(result.segments[0].in_point, 2);
  assert.equal(result.segments[0].out_point, 6);
  assert.equal(result.segments[0].duration, 4);
});

test("passes audio-only clips without requiring a source video track", () => {
  const result = buildExportSegments({
    clips: [clip("voice", "a1", 0, 1, 3, "audio", { trackId: "track-a1" })],
    videos: media,
    tracks,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.segments.map((segment) => [
      segment.source_path,
      segment.has_video,
      segment.has_audio,
    ]),
    [["C:\\media\\Voice.wav", false, true]],
  );
});

test("filters muted and non-solo audio tracks before export while keeping video layers", () => {
  const soloTracks = [
    { id: "track-v1", type: "video", name: "Video 1" },
    {
      id: "track-a1",
      type: "audio",
      name: "Audio 1",
      muted: true,
      solo: false,
    },
    {
      id: "track-a2",
      type: "audio",
      name: "Audio 2",
      muted: false,
      solo: true,
    },
  ];
  const clips = [
    clip("video", "v1", 0, 0, 2, "video", { trackId: "track-v1" }),
    clip("muted", "a1", 0, 0, 2, "audio", { trackId: "track-a1" }),
    clip("solo", "a1", 1, 0, 2, "audio", { trackId: "track-a2" }),
  ];
  const result = buildExportSegments({
    clips,
    videos: media,
    tracks: soloTracks,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.segments.map((segment) => segment.clip_id),
    ["video", "solo"],
  );
});

test("exports linked V+A pairs as separate visual and audio layers", () => {
  const result = buildExportSegments({
    clips: [
      clip("video", "v1", 0, 0, 4, "video", {
        trackId: "track-v1",
        linkGroupId: "lg-1",
      }),
      clip("audio", "v1", 0, 0, 4, "audio", {
        trackId: "track-a1",
        linkGroupId: "lg-1",
      }),
    ],
    videos: media,
    tracks,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.segments.map((segment) => [
      segment.clip_id,
      segment.has_video,
      segment.has_audio,
    ]),
    [
      ["video", true, false],
      ["audio", false, true],
    ],
  );
});

test("muted audio track of a linked V+A pair still keeps the video clip exporting", () => {
  const mutedTracks = [
    { id: "track-v1", type: "video", name: "Video 1" },
    {
      id: "track-a1",
      type: "audio",
      name: "Audio 1",
      muted: true,
      solo: false,
    },
  ];
  const result = buildExportSegments({
    clips: [
      clip("video", "v1", 0, 0, 4, "video", {
        trackId: "track-v1",
        linkGroupId: "lg-1",
      }),
      clip("audio", "v1", 0, 0, 4, "audio", {
        trackId: "track-a1",
        linkGroupId: "lg-1",
      }),
    ],
    videos: media,
    tracks: mutedTracks,
  });

  assert.equal(result.ok, true);
  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].clip_id, "video");
});

test("carries clip transform, opacity, volume and fade properties into export segments", () => {
  const result = buildExportSegments({
    clips: [
      clip("styled", "v1", 0, 0, 4, "av", {
        trackId: "track-v1",
        volume: 1.5,
        fadeIn: 0.5,
        fadeOut: 1,
        positionX: 100,
        positionY: -50,
        scale: 80,
        rotation: 15,
        opacity: 70,
        brightness: 20,
        contrast: -10,
        saturation: 30,
        flipH: true,
      }),
    ],
    videos: media,
    tracks,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    {
      hasVideo: result.segments[0].has_video,
      hasAudio: result.segments[0].has_audio,
      volume: result.segments[0].volume,
      fadeIn: result.segments[0].fade_in,
      fadeOut: result.segments[0].fade_out,
      positionX: result.segments[0].position_x,
      positionY: result.segments[0].position_y,
      scale: result.segments[0].scale,
      rotation: result.segments[0].rotation,
      opacity: result.segments[0].opacity,
      brightness: result.segments[0].brightness,
      contrast: result.segments[0].contrast,
      saturation: result.segments[0].saturation,
      flipH: result.segments[0].flip_h,
    },
    {
      hasVideo: true,
      hasAudio: true,
      volume: 1.5,
      fadeIn: 0.5,
      fadeOut: 1,
      positionX: 100,
      positionY: -50,
      scale: 80,
      rotation: 15,
      opacity: 70,
      brightness: 20,
      contrast: -10,
      saturation: 30,
      flipH: true,
    },
  );
});
