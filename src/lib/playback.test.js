import test from 'node:test'
import assert from 'node:assert/strict'
import {
  findClipAtTime,
  findNextClipAfter,
  getClipPlaybackPosition,
  getClipTimelineEnd,
  getImagePlaybackTimelineTime,
  getPlaybackTarget,
  getTimelineContentEnd,
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
  assert.equal(findClipAtTime(4, clips), null)
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
  assert.equal(shouldStartNextClipFromGap({ timelineTime: 12, nextClip: null }), false)
  assert.equal(shouldLeaveClipPlayback({ sourceTime: 1.97, clip: currentClip }), false)
  assert.equal(shouldLeaveClipPlayback({ sourceTime: 1.99, clip: currentClip }), true)
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
