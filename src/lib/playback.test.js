import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_CLIP_DURATION,
} from './timeline.js'
import {
  findClipAtTime,
  findClipsAtTime,
  findNextClipAfter,
  getClipPlaybackPosition,
  getClipTimelineEnd,
  getImagePlaybackTimelineTime,
  getPlaybackTarget,
  getTimelineAudibleClips,
  getTimelineContentEnd,
  getTimelineVisualClips,
  getTopVisibleTimelineClip,
  getVirtualTimelinePlaybackTime,
  shouldLeaveClipPlayback,
  shouldStartNextClipFromGap,
} from './playback.js'

const clip = (id, startTime, inPoint, outPoint) => ({
  id,
  videoId: `${id}-video`,
  startTime,
  inPoint,
  outPoint,
})

test('finds clips at the playhead and ignores exact clip end', () => {
  const clips = [clip('a', 1, 3, 6)]

  assert.equal(findClipAtTime(1, clips)?.id, 'a')
  assert.equal(findClipAtTime(3.99, clips)?.id, 'a')
  assert.equal(findClipAtTime(3.999, clips)?.id, 'a')
  assert.equal(findClipAtTime(4, clips), null)
  assert.deepEqual(findClipsAtTime(1, clips).map((item) => item.id), ['a'])
})

test('prefers video clips over aligned audio-only clips for timeline playback targets', () => {
  const audio = { ...clip('audio', 0, 0, 2), trackMode: 'audio' }
  const video = { ...clip('video', 0, 0, 2), trackMode: 'av' }
  const laterAudio = { ...clip('later-audio', 5, 0, 2), trackMode: 'audio' }
  const laterVideo = { ...clip('later-video', 5, 0, 2), trackMode: 'av' }

  assert.equal(findClipAtTime(1, [audio, video])?.id, 'video')
  assert.equal(findNextClipAfter(2, [laterAudio, laterVideo])?.id, 'later-video')
})

test('returns stacked visual clips from lower tracks to upper tracks', () => {
  const tracks = [
    { id: 'track-v1', type: 'video' },
    { id: 'track-v2', type: 'video' },
    { id: 'track-a1', type: 'audio' },
  ]
  const videos = [
    { id: 'base-video', mediaType: 'video', src: 'base.mp4' },
    { id: 'overlay-image', mediaType: 'image', src: 'overlay.png' },
    { id: 'voice', mediaType: 'audio', src: 'voice.wav' },
  ]
  const clips = [
    { ...clip('base', 0, 0, 5), videoId: 'base-video', trackId: 'track-v1', trackMode: 'video' },
    { ...clip('png', 1, 0, 2), videoId: 'overlay-image', trackId: 'track-v2', trackMode: 'video' },
    { ...clip('audio', 1, 0, 2), videoId: 'voice', trackId: 'track-a1', trackMode: 'audio' },
  ]

  assert.deepEqual(
    getTimelineVisualClips({ time: 1.5, clips, tracks, videos }).map(({ clip }) => clip.id),
    ['png', 'base']
  )
  assert.equal(getTopVisibleTimelineClip({ time: 1.5, clips, tracks, videos })?.id, 'base')
})

test('returns audible clips while honoring audio mute and solo state', () => {
  const tracks = [
    { id: 'track-v1', type: 'video' },
    { id: 'track-a1', type: 'audio', muted: false, solo: false },
    { id: 'track-a2', type: 'audio', muted: true, solo: false },
    { id: 'track-a3', type: 'audio', muted: false, solo: true },
  ]
  const videos = [
    { id: 'music', mediaType: 'audio', src: 'music.wav' },
    { id: 'muted', mediaType: 'audio', src: 'muted.wav' },
    { id: 'solo', mediaType: 'audio', src: 'solo.wav' },
  ]
  const clips = [
    { ...clip('music', 0, 0, 5), videoId: 'music', trackId: 'track-a1', trackMode: 'audio' },
    { ...clip('muted', 0, 0, 5), videoId: 'muted', trackId: 'track-a2', trackMode: 'audio' },
    { ...clip('solo', 0, 0, 5), videoId: 'solo', trackId: 'track-a3', trackMode: 'audio' },
  ]

  assert.deepEqual(
    getTimelineAudibleClips({ time: 2, clips, tracks, videos }).map(({ clip }) => clip.id),
    ['solo']
  )
})


test('finds the next clip after gaps and can exclude the current clip', () => {
  const clips = [clip('a', 0, 0, 2), clip('b', 5, 0, 2), clip('c', 8, 0, 1)]

  assert.equal(findNextClipAfter(2.1, clips)?.id, 'b')
  assert.equal(findNextClipAfter(5, clips, 'b')?.id, 'c')
})

test('chooses playback target at playhead or next clip after the playhead', () => {
  const clips = [clip('a', 0, 0, 2), clip('b', 5, 0, 2)]

  assert.deepEqual(getPlaybackTarget(1, clips), {
    atHead: clips[0],
    target: clips[0],
    startAtTime: 1,
  })
  assert.deepEqual(getPlaybackTarget(3, clips), {
    atHead: null,
    target: clips[1],
    startAtTime: 5,
  })
  assert.deepEqual(getPlaybackTarget(2, clips), {
    atHead: null,
    target: clips[1],
    startAtTime: 5,
  })
})

test('computes source and timeline playback positions inside a clip', () => {
  const result = getClipPlaybackPosition(clip('a', 10, 3, 8), 12.5)

  assert.deepEqual(result, {
    duration: 5,
    offsetInClip: 2.5,
    sourceTime: 5.5,
    timelineTime: 12.5,
  })
})

test('computes clip and content end positions', () => {
  const clips = [clip('a', 0, 0, 2), clip('b', 5, 1, 4)]

  assert.equal(getClipTimelineEnd(clips[1]), 8)
  assert.equal(getTimelineContentEnd(clips), 8)
  assert.equal(getTimelineContentEnd([]), 0)
})

test('decides timeline transitions through gaps and clip ends', () => {
  const nextClip = clip('b', 5, 0, 2)
  const currentClip = clip('a', 0, 0, 2)

  assert.equal(shouldStartNextClipFromGap({ timelineTime: 4.97, nextClip }), false)
  assert.equal(shouldStartNextClipFromGap({ timelineTime: 4.99, nextClip }), true)
  assert.equal(shouldStartNextClipFromGap({ timelineTime: 5, nextClip }), true)
  assert.equal(shouldStartNextClipFromGap({ timelineTime: 12, nextClip: null }), false)
  assert.equal(shouldLeaveClipPlayback({ sourceTime: 1.97, clip: currentClip }), false)
  assert.equal(shouldLeaveClipPlayback({ sourceTime: 1.99, clip: currentClip }), true)
  assert.equal(shouldLeaveClipPlayback({ sourceTime: 2, clip: currentClip }), true)
})

test('computes virtual image playback progress and end state', () => {
  const imageClip = clip('image', 4, 0, 3)
  const initial = getImagePlaybackTimelineTime({
    clip: imageClip,
    imagePlayback: null,
    nowMs: 1000,
    fallbackTimelineTime: 4.5,
  })

  assert.deepEqual(initial, {
    timelineStart: 4.5,
    startedAtMs: 1000,
    timelineTime: 4.5,
    endTime: 7,
    ended: false,
  })

  const ended = getImagePlaybackTimelineTime({
    clip: imageClip,
    imagePlayback: { clipId: 'image', startedAtMs: 1000, timelineStart: 4.5 },
    nowMs: 3600,
    fallbackTimelineTime: 4.5,
  })

  assert.equal(ended.ended, true)
  assert.equal(ended.timelineTime, 7.1)
})

test('computes virtual timeline playback through empty space', () => {
  const result = getVirtualTimelinePlaybackTime({
    timelinePlayback: { startedAtMs: 1000, timelineStart: 12 },
    nowMs: 2500,
    fallbackTimelineTime: 0,
  })

  assert.deepEqual(result, {
    timelineStart: 12,
    startedAtMs: 1000,
    timelineTime: 13.5,
  })
})

test('keeps virtual timeline clocks anchored across repeated gap transitions', () => {
  let timelineStart = 0
  let startedAtMs = 1000
  for (let i = 0; i < 100; i++) {
    const state = getVirtualTimelinePlaybackTime({
      timelinePlayback: { startedAtMs, timelineStart },
      nowMs: startedAtMs + 10,
      fallbackTimelineTime: -1,
    })
    timelineStart = state.timelineTime
    startedAtMs += 10
  }

  assert.equal(timelineStart.toFixed(6), '1.000000')
})

test('plays tail gap without requesting a next clip transition', () => {
  const tailState = getVirtualTimelinePlaybackTime({
    timelinePlayback: { startedAtMs: 1000, timelineStart: 8 },
    nowMs: 3500,
    fallbackTimelineTime: 0,
  })

  assert.equal(tailState.timelineTime, 10.5)
  assert.equal(shouldStartNextClipFromGap({ timelineTime: tailState.timelineTime, nextClip: null }), false)
})

test('does not end a minimum-duration image clip before its exact end', () => {
  const imageClip = clip('image', 4, 0, MIN_CLIP_DURATION)
  const running = getImagePlaybackTimelineTime({
    clip: imageClip,
    imagePlayback: { clipId: 'image', startedAtMs: 1000, timelineStart: 4 },
    nowMs: 1030,
    fallbackTimelineTime: 4,
  })
  const ended = getImagePlaybackTimelineTime({
    clip: imageClip,
    imagePlayback: { clipId: 'image', startedAtMs: 1000, timelineStart: 4 },
    nowMs: 1050,
    fallbackTimelineTime: 4,
  })

  assert.equal(running.endTime, 4 + MIN_CLIP_DURATION)
  assert.equal(running.ended, false)
  assert.equal(ended.ended, true)
})
