import assert from "node:assert/strict";
import {
  buildProjectDocument,
  createEmptyProjectState,
  getProjectFileName,
  hydrateProjectState,
  isAbsoluteMediaPath,
  resolveProjectMediaPath,
  sanitizeProjectName,
} from "./project.js";

test("sanitizes project names for Windows-safe project files", () => {
  assert.equal(sanitizeProjectName("  My:Cut*01.  "), "My-Cut-01");
  assert.equal(getProjectFileName("A/B"), "A-B.stonecutter");
  assert.equal(sanitizeProjectName(""), "Untitled Project");
  assert.equal(sanitizeProjectName("   "), "Untitled Project");
  assert.equal(sanitizeProjectName("---"), "Untitled Project");
});

test("builds and hydrates StoneCutter project documents", () => {
  const state = createEmptyProjectState("Demo");
  state.videos = [
    {
      id: "vid-1",
      name: "clip.mp4",
      path: "C:\\Media\\clip.mp4",
      src: "asset://clip",
      mediaType: "video",
    },
  ];
  state.clips = [
    {
      id: "clip-1",
      videoId: "vid-1",
      name: "clip.mp4",
      sourceDuration: 10,
      inPoint: 1,
      outPoint: 4,
      startTime: 2,
      trackMode: "audio",
    },
  ];
  state.sourceRanges = { "vid-1": { inPoint: 1, outPoint: 4 } };
  state.videoDurations = { "vid-1": 10 };
  state.timelineTime = 2.5;
  state.ui.pxPerSec = 60;

  const doc = buildProjectDocument(state);
  const hydrated = hydrateProjectState(doc, (path) => `asset://${path}`);

  assert.equal(doc.app, "StoneCutter");
  assert.equal(doc.schemaVersion, 3);
  assert.equal(doc.media[0].path, "C:\\Media\\clip.mp4");
  assert.equal(doc.tracks.length, 2);
  assert.equal(hydrated.videos[0].src, "asset://C:\\Media\\clip.mp4");
  assert.equal(hydrated.clips[0].trackMode, "audio");
  assert.equal(hydrated.clips[0].trackId, "track-a1");
  assert.equal(hydrated.clips[0].linkGroupId, null);
  assert.equal(hydrated.tracks[0].id, "track-v1");
  assert.equal(hydrated.ui.pxPerSec, 60);
});

test("text clips round-trip with normalized content while legacy clips become media", () => {
  const state = createEmptyProjectState("Text Clips");
  state.clips = [
    {
      id: "text-1",
      videoId: "",
      name: "Title",
      sourceDuration: 4,
      inPoint: 0,
      outPoint: 4,
      startTime: 1,
      trackMode: "video",
      kind: "text",
      content: {
        text: "Hello",
        style: {
          fontSize: "64",
          color: "#ffeeaa",
          outlineColor: "#222222",
          outlineWidth: "3",
          fontFamily: "Inter",
          fontWeight: "700",
          align: "center",
        },
      },
    },
    {
      id: "media-clip",
      videoId: "vid-1",
      name: "Legacy Media",
      sourceDuration: 3,
      inPoint: 0,
      outPoint: 3,
      startTime: 5,
      trackMode: "video",
      content: { text: "should be removed" },
    },
  ];

  const doc = buildProjectDocument(state);
  const hydrated = hydrateProjectState(doc);

  assert.equal(doc.timeline.clips[0].kind, "text");
  assert.deepEqual(doc.timeline.clips[0].content, {
    text: "Hello",
    style: {
      fontSize: 64,
      color: "#ffeeaa",
      outlineColor: "#222222",
      outlineWidth: 3,
      fontFamily: "Inter",
      fontWeight: "700",
      fontStyle: "normal",
      textDecoration: "none",
      align: "center",
    },
  });
  assert.equal(doc.timeline.clips[1].kind, "media");
  assert.equal("content" in doc.timeline.clips[1], false);
  assert.equal(hydrated.clips[0].kind, "text");
  assert.deepEqual(hydrated.clips[0].content, doc.timeline.clips[0].content);
  assert.equal(hydrated.clips[1].kind, "media");
  assert.equal("content" in hydrated.clips[1], false);
});

test("text clips preserve custom CSS font-family values", () => {
  const state = createEmptyProjectState("Custom Font");
  state.clips = [
    {
      id: "text-custom-font",
      name: "Title",
      inPoint: 0,
      outPoint: 4,
      startTime: 0,
      trackMode: "video",
      kind: "text",
      content: {
        text: "Hello",
        style: {
          fontSize: 48,
          color: "#ffffff",
          fontFamily: "Brand Font, Arial, sans-serif",
        },
      },
    },
  ];

  const doc = buildProjectDocument(state);
  const hydrated = hydrateProjectState(doc);

  assert.equal(doc.timeline.clips[0].content.style.fontFamily, "Brand Font, Arial, sans-serif");
  assert.equal(hydrated.clips[0].content.style.fontFamily, "Brand Font, Arial, sans-serif");
});

test("project documents serialize and hydrate back to the same document shape", () => {
  const state = createEmptyProjectState("Round Trip");
  state.videos = [
    {
      id: "vid-1",
      name: "clip.mp4",
      path: "C:\\Media\\clip.mp4",
      src: "asset://clip",
      mediaType: "video",
      importedAt: "2026-01-01T10:00:00.000Z",
    },
  ];
  state.clips = [
    {
      id: "clip-1",
      videoId: "vid-1",
      name: "clip.mp4",
      sourceDuration: 10,
      inPoint: 1,
      outPoint: 4,
      startTime: 2,
      trackMode: "video",
      linkGroupId: "lg-42",
    },
  ];
  state.sourceRanges = { "vid-1": { inPoint: 1, outPoint: 4 } };
  state.videoDurations = { "vid-1": 10 };
  state.timelineTime = 2.5;
  state.settings.imageDuration = 4;
  state.ui.volume = 0.5;

  const doc = buildProjectDocument(state);
  const hydrated = hydrateProjectState(doc);
  const docAgain = buildProjectDocument(hydrated);

  assert.deepEqual({ ...docAgain, savedAt: doc.savedAt }, doc);
  assert.equal(doc.media[0].importedAt, "2026-01-01T10:00:00.000Z");
  assert.equal(hydrated.videos[0].importedAt, "2026-01-01T10:00:00.000Z");
  assert.equal(hydrated.clips[0].linkGroupId, "lg-42");
});

test("clip keyframes round-trip through buildProjectDocument and hydrate", () => {
  const state = createEmptyProjectState("Animated");
  state.videos = [
    {
      id: "vid-1",
      name: "clip.mp4",
      path: "C:\\Media\\clip.mp4",
      mediaType: "video",
    },
  ];
  state.clips = [
    {
      id: "clip-1",
      videoId: "vid-1",
      name: "clip.mp4",
      sourceDuration: 10,
      inPoint: 0,
      outPoint: 5,
      startTime: 0,
      trackMode: "video",
      keyframes: {
        positionX: [
          { id: "kf-x0", time: 0, value: 0, interpolation: "linear" },
          { id: "kf-x1", time: 2, value: 100, interpolation: "linear" },
        ],
        opacity: [
          { id: "kf-o0", time: 1, value: 50, interpolation: "linear" },
        ],
      },
    },
  ];

  const doc = buildProjectDocument(state);
  const hydrated = hydrateProjectState(doc);
  assert.equal(doc.schemaVersion, 3);
  assert.deepEqual(doc.timeline.clips[0].keyframes.positionX.length, 2);
  assert.deepEqual(hydrated.clips[0].keyframes.positionX, [
    { id: "kf-x0", time: 0, value: 0, interpolation: "linear" },
    { id: "kf-x1", time: 2, value: 100, interpolation: "linear" },
  ]);
  assert.equal(hydrated.clips[0].keyframes.opacity[0].value, 50);
});

test("legacy v2 saves without keyframes hydrate without a keyframes field", () => {
  const legacyDoc = {
    app: "StoneCutter",
    schemaVersion: 2,
    project: { name: "Old" },
    media: [
      {
        id: "vid-1",
        name: "clip.mp4",
        path: "C:\\Media\\clip.mp4",
        mediaType: "video",
      },
    ],
    timeline: {
      clips: [
        {
          id: "clip-1",
          videoId: "vid-1",
          name: "clip.mp4",
          sourceDuration: 5,
          inPoint: 0,
          outPoint: 3,
          startTime: 0,
          trackMode: "video",
        },
      ],
      playhead: 0,
    },
  };

  const hydrated = hydrateProjectState(legacyDoc);
  assert.equal(hydrated.clips[0].keyframes, undefined);
});

test("resolves project-managed relative media paths from the project folder", () => {
  assert.equal(isAbsoluteMediaPath("C:\\Media\\clip.mp4"), true);
  assert.equal(isAbsoluteMediaPath("D:/Media/clip.mp4"), true);
  assert.equal(isAbsoluteMediaPath("\\\\nas\\share\\clip.mp4"), true);
  assert.equal(isAbsoluteMediaPath("/media/clip.mp4"), true);
  assert.equal(isAbsoluteMediaPath("asset://localhost/clip.mp4"), true);
  assert.equal(isAbsoluteMediaPath("Media/clip.mp4"), false);

  assert.equal(
    resolveProjectMediaPath("C:\\Projects\\Demo", "Media/clip.mp4"),
    "C:\\Projects\\Demo\\Media\\clip.mp4",
  );
  assert.equal(
    resolveProjectMediaPath("/projects/demo", "Media\\clip.mp4"),
    "/projects/demo/Media/clip.mp4",
  );
  assert.equal(
    resolveProjectMediaPath("C:\\Projects\\Demo", "D:\\Source\\clip.mp4"),
    "D:\\Source\\clip.mp4",
  );
});

test("hydrates relative managed media paths while preserving original source metadata", () => {
  const doc = {
    app: "StoneCutter",
    schemaVersion: 2,
    project: { name: "Managed Media" },
    media: [
      {
        id: "vid-1",
        name: "clip.mp4",
        path: "Media/vid-1-clip.mp4",
        originalPath: "D:\\Source\\clip.mp4",
        mediaType: "video",
      },
    ],
    timeline: { clips: [], playhead: 0 },
  };

  const hydrated = hydrateProjectState(doc, {
    resolveMediaPath: (mediaPath) =>
      resolveProjectMediaPath("C:\\Projects\\Managed Media", mediaPath),
    convertFileSrc: (mediaPath) => `asset://${mediaPath}`,
  });
  const media = hydrated.videos[0];

  assert.equal(
    media.path,
    "C:\\Projects\\Managed Media\\Media\\vid-1-clip.mp4",
  );
  assert.equal(media.originalPath, "D:\\Source\\clip.mp4");
  assert.equal(
    media.src,
    "asset://C:\\Projects\\Managed Media\\Media\\vid-1-clip.mp4",
  );
  assert.equal(
    buildProjectDocument(hydrated).media[0].originalPath,
    "D:\\Source\\clip.mp4",
  );
});

test('legacy v1 "av" clips are migrated into linked video+audio pairs on load', () => {
  const legacyDoc = {
    app: "StoneCutter",
    schemaVersion: 1,
    project: { name: "Legacy" },
    media: [
      {
        id: "vid-1",
        name: "clip.mp4",
        path: "C:\\Media\\clip.mp4",
        mediaType: "video",
      },
    ],
    timeline: {
      clips: [
        {
          id: "clip-1",
          videoId: "vid-1",
          name: "clip.mp4",
          sourceDuration: 10,
          inPoint: 0,
          outPoint: 5,
          startTime: 0,
          trackMode: "av",
          trackId: "track-v1",
        },
      ],
      playhead: 0,
    },
    tracks: [
      { id: "track-v1", type: "video", name: "Video 1" },
      { id: "track-a1", type: "audio", name: "Audio 1" },
    ],
  };

  const hydrated = hydrateProjectState(legacyDoc);
  assert.equal(hydrated.clips.length, 2);
  const videoClip = hydrated.clips.find((c) => c.trackMode === "video");
  const audioClip = hydrated.clips.find((c) => c.trackMode === "audio");
  assert.ok(videoClip, "video clip exists");
  assert.ok(audioClip, "audio clip exists");
  assert.equal(videoClip.trackId, "track-v1");
  assert.equal(audioClip.trackId, "track-a1");
  assert.equal(videoClip.inPoint, 0);
  assert.equal(videoClip.outPoint, 5);
  assert.equal(audioClip.inPoint, 0);
  assert.equal(audioClip.outPoint, 5);
  assert.equal(videoClip.startTime, 0);
  assert.equal(audioClip.startTime, 0);
  assert.equal(videoClip.linkGroupId, audioClip.linkGroupId);
  assert.ok(videoClip.linkGroupId, "linkGroupId is set");
});

test('legacy v1 "av" clips on image media migrate to video-only (no fake audio partner)', () => {
  const legacyDoc = {
    app: "StoneCutter",
    schemaVersion: 1,
    project: { name: "Legacy" },
    media: [
      {
        id: "img-1",
        name: "poster.png",
        path: "C:\\Media\\poster.png",
        mediaType: "image",
      },
    ],
    timeline: {
      clips: [
        {
          id: "clip-1",
          videoId: "img-1",
          name: "poster.png",
          sourceDuration: 3,
          inPoint: 0,
          outPoint: 3,
          startTime: 0,
          trackMode: "av",
          trackId: "track-v1",
        },
      ],
      playhead: 0,
    },
    tracks: [
      { id: "track-v1", type: "video", name: "Video 1" },
      { id: "track-a1", type: "audio", name: "Audio 1" },
    ],
  };

  const hydrated = hydrateProjectState(legacyDoc);
  assert.equal(hydrated.clips.length, 1);
  assert.equal(hydrated.clips[0].trackMode, "video");
  assert.equal(hydrated.clips[0].linkGroupId, null);
});

test("hydrates partial and corrupt project input with safe fallbacks", () => {
  const hydrated = hydrateProjectState(
    {
      app: "StoneCutter",
      schemaVersion: 1,
      project: { name: "---" },
      media: [
        null,
        { id: "vid-1", path: "C:\\Media\\clip.mp4", mediaType: 12 },
      ],
      timeline: {
        clips: [
          null,
          {
            id: "clip-2",
            videoId: "vid-1",
            sourceDuration: "bad",
            inPoint: "bad",
            outPoint: -5,
            startTime: "bad",
            trackMode: "",
          },
        ],
        playhead: "bad",
      },
      sourceRanges: "bad",
      videoDurations: { "vid-1": "12.5", broken: "nope" },
      settings: { imageDuration: -1 },
      tracks: [
        {
          id: "bad-video",
          type: "nonsense",
          name: "",
          locked: "bad",
          height: 999,
        },
        {
          id: "voice",
          type: "audio",
          name: "Voice",
          muted: true,
          solo: true,
          height: 60,
        },
      ],
      ui: {
        aspectRatio: "",
        pxPerSec: 0,
        snapEnabled: false,
        volume: 2,
        muted: "bad",
      },
    },
    (path) => `asset://${path}`,
  );

  assert.equal(hydrated.name, "Untitled Project");
  assert.equal(hydrated.videos[0].id, "media-1");
  assert.equal(hydrated.videos[1].name, "clip.mp4");
  assert.equal(hydrated.videos[1].src, "asset://C:\\Media\\clip.mp4");
  assert.deepEqual(hydrated.clips[0], {
    id: "clip-1",
    videoId: "",
    name: "Clip 1",
    sourceDuration: 0,
    inPoint: 0,
    outPoint: 0,
    startTime: 0,
    trackMode: "video",
    trackId: "bad-video",
    linkGroupId: null,
    kind: "media",
    scaleLocked: true,
  });
  assert.equal(hydrated.clips[1].outPoint, 0);
  assert.equal(hydrated.clips[1].trackId, "bad-video");
  assert.deepEqual(hydrated.tracks, [
    {
      id: "bad-video",
      type: "video",
      name: "Video 1",
      locked: false,
      height: 200,
    },
    {
      id: "voice",
      type: "audio",
      name: "Voice",
      locked: false,
      height: 60,
      muted: true,
      solo: true,
      gain: 1,
    },
  ]);
  assert.deepEqual(hydrated.sourceRanges, {});
  assert.deepEqual(hydrated.videoDurations, { "vid-1": 12.5 });
  assert.equal(hydrated.timelineTime, 0);
  assert.equal(hydrated.settings.imageDuration, 3);
  assert.deepEqual(hydrated.ui, {
    aspectRatio: "16:9",
    pxPerSec: 40,
    snapEnabled: false,
    volume: 1,
    muted: false,
  });
});
