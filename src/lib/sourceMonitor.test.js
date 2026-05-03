import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clampSourceRange,
  clampSourceTime,
  isSourceMonitorVisible,
  stepSourcePreviewTime,
  timeFromClientX,
} from './sourceMonitor.js'
import { MIN_CLIP_DURATION } from './timeline.js'

test('shows source monitor only for the explicitly selected video media item', () => {
  assert.equal(isSourceMonitorVisible({ media: { id: 'v1', mediaType: 'video' }, sourceMonitorId: 'v1' }), true)
  assert.equal(isSourceMonitorVisible({ media: { id: 'v1', mediaType: 'image' }, sourceMonitorId: 'v1' }), false)
  assert.equal(isSourceMonitorVisible({ media: { id: 'v1', mediaType: 'video' }, sourceMonitorId: 'v2' }), false)
})

test('clamps source time and range to duration and minimum clip length', () => {
  assert.equal(clampSourceTime(-1, 10), 0)
  assert.equal(clampSourceTime(12, 10), 10)

  const nearEnd = clampSourceRange({
    duration: 10,
    currentRange: { inPoint: 2, outPoint: 7 },
    patch: { inPoint: 9.99 },
  })
  assert.equal(nearEnd.outPoint, 7)
  assert.equal(nearEnd.inPoint, 7 - MIN_CLIP_DURATION)

  const nearStart = clampSourceRange({
    duration: 10,
    currentRange: { inPoint: 2, outPoint: 7 },
    patch: { outPoint: 2.01 },
  })
  assert.equal(nearStart.inPoint, 2)
  assert.equal(nearStart.outPoint, 2 + MIN_CLIP_DURATION)

  const fallback = clampSourceRange({ duration: MIN_CLIP_DURATION, currentRange: null, patch: null })
  assert.equal(fallback.inPoint, 0)
  assert.equal(fallback.outPoint, MIN_CLIP_DURATION)
  assert.ok(fallback.inPoint < fallback.outPoint)

  const corrupt = clampSourceRange({
    duration: 10,
    currentRange: { inPoint: 'bad', outPoint: 'also bad' },
    patch: {},
  })
  assert.equal(corrupt.inPoint, 0)
  assert.equal(corrupt.outPoint, 10)
  assert.ok(corrupt.inPoint < corrupt.outPoint)
})

test('maps source preview timeline pointer position to source time', () => {
  assert.equal(timeFromClientX({ clientX: 150, rect: { left: 50, width: 200 }, duration: 20 }), 10)
  assert.equal(timeFromClientX({ clientX: 10, rect: { left: 50, width: 200 }, duration: 20 }), 0)
  assert.equal(timeFromClientX({ clientX: 300, rect: { left: 50, width: 200 }, duration: 20 }), 20)
  assert.equal(timeFromClientX({ clientX: 150, rect: { left: 50, width: 0 }, duration: 20 }), 0)
  assert.equal(Number.isFinite(timeFromClientX({ clientX: undefined, rect: { left: 50, width: 200 }, duration: 20 })), true)
})

test('steps source preview keyboard commands independently of the timeline', () => {
  assert.equal(stepSourcePreviewTime({ keyCode: 'ArrowRight', currentTime: 1, inPoint: 0, outPoint: 4 }).toFixed(3), '1.033')
  assert.equal(stepSourcePreviewTime({ keyCode: 'ArrowLeft', currentTime: 1, inPoint: 0, outPoint: 4, shiftKey: true }), 0)
  assert.equal(stepSourcePreviewTime({ keyCode: 'Home', currentTime: 2, inPoint: 0.5, outPoint: 4 }), 0.5)
  assert.equal(stepSourcePreviewTime({ keyCode: 'End', currentTime: 2, inPoint: 0.5, outPoint: 4 }), 4)
})
