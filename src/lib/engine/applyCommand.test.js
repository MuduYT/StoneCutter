import test from "node:test"
import assert from "node:assert/strict"
import { applyCommand, createInitialEngineState } from "./applyCommand.js"

const baseClip = {
  id: "clip-1",
  videoId: "media-1",
  trackId: "track-v1",
  trackMode: "video",
  name: "Clip",
  startTime: 0,
  inPoint: 0,
  outPoint: 5,
}

test("clip.add treats missing kind as media and strips media content", () => {
  const result = applyCommand(createInitialEngineState(), {
    id: "cmd-1",
    type: "clip.add",
    payload: {
      clips: [{ ...baseClip, content: { text: "legacy" } }],
    },
  })

  assert.equal(result.events[0].type, "state.changed")
  assert.equal(result.state.timeline.clips[0].kind, "media")
  assert.equal("content" in result.state.timeline.clips[0], false)
})

test("clip.add normalizes text clip content", () => {
  const result = applyCommand(createInitialEngineState(), {
    id: "cmd-1",
    type: "clip.add",
    payload: {
      clips: [
        {
          ...baseClip,
          kind: "text",
          content: {
            text: "Title",
            style: {
              fontSize: "72",
              color: "#ffcc00",
              fontFamily: "Inter",
              fontWeight: "700",
              align: "center",
            },
          },
        },
      ],
    },
  })

  assert.deepEqual(result.state.timeline.clips[0].content, {
    text: "Title",
    style: {
      fontSize: 72,
      color: "#ffcc00",
      fontFamily: "Inter",
      fontWeight: "700",
      align: "center",
    },
  })
})

test("clip.addText creates the default text clip at the requested timeline time", () => {
  const result = applyCommand(
    createInitialEngineState({
      tracks: [
        { id: "track-a1", type: "audio", name: "Audio", locked: false, height: 80 },
        { id: "track-v2", type: "video", name: "Video", locked: false, height: 120 },
      ],
    }),
    {
      id: "cmd-text",
      type: "clip.addText",
      payload: { timelineTime: 12.25 },
    }
  )

  const clip = result.state.timeline.clips[0]
  assert.equal(result.events[0].type, "state.changed")
  assert.equal(result.events[0].payload.changedClipIds[0], clip.id)
  assert.equal(clip.kind, "text")
  assert.equal(clip.name, "Text")
  assert.equal(Object.prototype.hasOwnProperty.call(clip, "videoId"), false)
  assert.equal(clip.trackId, "track-v2")
  assert.equal(clip.trackMode, "video")
  assert.equal(clip.startTime, 12.25)
  assert.equal(clip.inPoint, 0)
  assert.equal(clip.outPoint, 5)
  assert.equal(Object.prototype.hasOwnProperty.call(clip, "sourceDuration"), false)
  assert.deepEqual(clip.content, {
    text: "Text",
    style: {
      fontSize: 48,
      color: "#ffffff",
      fontFamily: "Inter",
      fontWeight: "600",
      align: "center",
    },
  })
})

test("clip.addText falls back to playhead, explicit track and non-negative start", () => {
  const result = applyCommand(
    createInitialEngineState({
      playhead: 3.5,
      tracks: [{ id: "track-v1", type: "video", name: "Video", locked: false, height: 120 }],
    }),
    {
      id: "cmd-text",
      type: "clip.addText",
      payload: { trackId: "custom-track" },
    }
  )

  assert.equal(result.state.timeline.clips[0].startTime, 3.5)
  assert.equal(result.state.timeline.clips[0].trackId, "custom-track")

  const clamped = applyCommand(createInitialEngineState(), {
    id: "cmd-text-negative",
    type: "clip.addText",
    payload: { timelineTime: -10 },
  })
  assert.equal(clamped.state.timeline.clips[0].startTime, 0)
  assert.equal(clamped.state.timeline.clips[0].trackId, "track-v1")
})

test("text clips can be moved, trimmed, split and deleted through existing commands", () => {
  const added = applyCommand(createInitialEngineState(), {
    id: "cmd-add",
    type: "clip.addText",
    payload: { timelineTime: 1 },
  })
  const clipId = added.state.timeline.clips[0].id

  const moved = applyCommand(added.state, {
    id: "cmd-move",
    type: "clip.move",
    payload: { clipIds: [clipId], deltaTime: 2 },
  })
  assert.equal(moved.state.timeline.clips[0].startTime, 3)

  const trimmed = applyCommand(moved.state, {
    id: "cmd-trim",
    type: "clip.trimRight",
    payload: { clipId, newOutPoint: 4 },
  })
  assert.equal(trimmed.state.timeline.clips[0].outPoint, 4)

  const split = applyCommand(trimmed.state, {
    id: "cmd-split",
    type: "clip.split",
    payload: { clipId, timelineTime: 4 },
  })
  assert.equal(split.state.timeline.clips.length, 2)
  assert.equal(split.state.timeline.clips.every((clip) => clip.kind === "text"), true)
  assert.equal(split.state.timeline.clips.every((clip) => clip.content?.text === "Text"), true)

  const deleted = applyCommand(split.state, {
    id: "cmd-delete",
    type: "clip.delete",
    payload: { clipIds: split.state.timeline.clips.map((clip) => clip.id) },
  })
  assert.equal(deleted.state.timeline.clips.length, 0)
})

test("clip.updateProps switches text clips back to media safely", () => {
  const initial = createInitialEngineState({
    clips: [
      {
        ...baseClip,
        kind: "text",
        content: { text: "Title", style: { fontSize: 48, color: "#fff" } },
      },
    ],
  })

  const result = applyCommand(initial, {
    id: "cmd-2",
    type: "clip.updateProps",
    payload: {
      clipId: "clip-1",
      props: { kind: "media" },
    },
  })

  assert.equal(result.state.timeline.clips[0].kind, "media")
  assert.equal("content" in result.state.timeline.clips[0], false)
})
