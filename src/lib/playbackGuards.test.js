import assert from "node:assert/strict"
import {
  isTimelineTransportPlaying,
  shouldPlayTimelineMediaAfterSeek,
  shouldPlayTimelineMediaNow,
  shouldSkipTimelinePlayheadTick,
} from "./playbackGuards.js"

test("shouldPlayTimelineMediaAfterSeek rejects stale seek epoch after stop", () => {
  assert.equal(
    shouldPlayTimelineMediaAfterSeek({
      seekEpochAtStart: 1,
      currentSeekEpoch: 2,
      playbackMode: "timeline",
      isPlaybackRefPlaying: true,
      interactionType: null,
    }),
    false,
  )
})

test("shouldPlayTimelineMediaAfterSeek rejects play during playhead scrub", () => {
  assert.equal(
    shouldPlayTimelineMediaAfterSeek({
      seekEpochAtStart: 3,
      currentSeekEpoch: 3,
      playbackMode: "timeline",
      isPlaybackRefPlaying: true,
      interactionType: "seek",
    }),
    false,
  )
})

test("shouldPlayTimelineMediaAfterSeek allows play when epoch and mode match", () => {
  assert.equal(
    shouldPlayTimelineMediaAfterSeek({
      seekEpochAtStart: 5,
      currentSeekEpoch: 5,
      playbackMode: "timeline",
      isPlaybackRefPlaying: true,
      interactionType: "move",
    }),
    true,
  )
})

test("shouldPlayTimelineMediaNow blocks play during seek drag grace window", () => {
  assert.equal(
    shouldPlayTimelineMediaNow({
      shouldPlay: true,
      playbackMode: "timeline",
      isPlaybackRefPlaying: true,
      timelineSeekDragActive: true,
      isMediaSeeking: false,
      graceUntilMs: 0,
      nowMs: 1000,
    }),
    false,
  )
})

test("shouldPlayTimelineMediaNow blocks play before seek grace elapses", () => {
  assert.equal(
    shouldPlayTimelineMediaNow({
      shouldPlay: true,
      playbackMode: "timeline",
      isPlaybackRefPlaying: true,
      timelineSeekDragActive: false,
      isMediaSeeking: false,
      graceUntilMs: 2000,
      nowMs: 1000,
    }),
    false,
  )
})

test("shouldSkipTimelinePlayheadTick is true while interaction is seek", () => {
  assert.equal(shouldSkipTimelinePlayheadTick({ interactionType: "seek" }), true)
  assert.equal(shouldSkipTimelinePlayheadTick({ interactionType: "trim-left" }), false)
})

test("isTimelineTransportPlaying reflects timeline mode and clocks", () => {
  assert.equal(
    isTimelineTransportPlaying({
      playbackMode: "timeline",
      isPlaying: false,
      isPlaybackRefPlaying: true,
      hasTimelinePlaybackClock: false,
    }),
    true,
  )
  assert.equal(
    isTimelineTransportPlaying({
      playbackMode: "source",
      isPlaying: true,
      isPlaybackRefPlaying: true,
      hasTimelinePlaybackClock: true,
    }),
    false,
  )
})
