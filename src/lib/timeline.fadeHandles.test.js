import assert from 'node:assert/strict'
import {
  applySingleClipSplit,
  clipFadesToVisibleSegment,
  clampFadeValues,
  getTimelineFadeHandleMetrics,
  isTimelineFadeHotspot,
  isTimelineTrimHotspot,
} from './timeline.js'

const clipRect = { left: 100, right: 300, top: 50, bottom: 100 }

test('isTimelineFadeHotspot targets top-left and top-right corners', () => {
  assert.equal(
    isTimelineFadeHotspot({ clientX: 104, clientY: 55, clipRect, side: 'left' }),
    true,
  )
  assert.equal(
    isTimelineFadeHotspot({ clientX: 295, clientY: 55, clipRect, side: 'right' }),
    true,
  )
  assert.equal(
    isTimelineFadeHotspot({ clientX: 104, clientY: 80, clipRect, side: 'left' }),
    false,
  )
  assert.equal(
    isTimelineFadeHotspot({ clientX: 104, clientY: 55, clipRect, side: 'right' }),
    false,
  )
})

test('fade and trim hotspots do not overlap on the same corner click', () => {
  assert.equal(
    isTimelineFadeHotspot({ clientX: 104, clientY: 55, clipRect, side: 'left' }),
    true,
  )
  assert.equal(
    isTimelineTrimHotspot({ clientX: 104, clientY: 55, clipRect, side: 'left' }),
    false,
  )
  assert.equal(
    isTimelineTrimHotspot({ clientX: 104, clientY: 80, clipRect, side: 'left' }),
    true,
  )
})

test('getTimelineFadeHandleMetrics shrinks handles on narrow clips', () => {
  const narrow = { left: 0, right: 24, top: 0, bottom: 40 }
  const metrics = getTimelineFadeHandleMetrics(narrow)
  assert.ok(metrics.width <= 10)
  assert.ok(metrics.width * 2 < 24)
})

test('clampFadeValues keeps fades within duration and combined limit', () => {
  assert.deepEqual(
    clampFadeValues({ duration: 4, fadeIn: 2, fadeOut: 3, side: 'in', nextValue: 3 }),
    { fadeIn: 1, fadeOut: 3 },
  )
  assert.deepEqual(
    clampFadeValues({ duration: 4, fadeIn: 0, fadeOut: 0, side: 'out', nextValue: -1 }),
    { fadeIn: 0, fadeOut: 0 },
  )
  assert.deepEqual(
    clampFadeValues({ duration: 4, fadeIn: 1, fadeOut: 1, side: 'in', nextValue: 10 }),
    { fadeIn: 3, fadeOut: 1 },
  )
})

test('clipFadesToVisibleSegment clips fade ranges to split segments', () => {
  const clip = {
    id: 'clip-1',
    startTime: 10,
    inPoint: 0,
    outPoint: 10,
    fadeIn: 4,
    fadeOut: 3,
  }

  assert.deepEqual(
    clipFadesToVisibleSegment(clip, { ...clip, outPoint: 2 }),
    { ...clip, outPoint: 2, fadeIn: 2, fadeOut: 0 },
  )
  assert.deepEqual(
    clipFadesToVisibleSegment(clip, {
      ...clip,
      id: 'clip-2',
      startTime: 12,
      inPoint: 2,
    }),
    {
      ...clip,
      id: 'clip-2',
      startTime: 12,
      inPoint: 2,
      fadeIn: 2,
      fadeOut: 3,
    },
  )
})

test('applySingleClipSplit does not copy full fades to both halves', () => {
  const clips = [
    {
      id: 'clip-1',
      startTime: 0,
      inPoint: 0,
      outPoint: 10,
      sourceDuration: 10,
      trackId: 'v1',
      fadeIn: 4,
      fadeOut: 3,
    },
  ]

  const result = applySingleClipSplit(clips, 'clip-1', 2, () => 'clip-2')
  assert.equal(result.length, 2)
  assert.equal(result[0].fadeIn, 2)
  assert.equal(result[0].fadeOut, 0)
  assert.equal(result[1].fadeIn, 2)
  assert.equal(result[1].fadeOut, 3)
})
