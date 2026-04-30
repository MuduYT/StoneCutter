import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_CLIP_DURATION,
  applyRippleInsert,
  closeGap,
  constrainMoveStart,
  detectInsertPoint,
  findGapAtTime,
  findTimelineSpaceAtTime,
  getMediaType,
  maxEndForTrimRight,
  minStartForTrimLeft,
  normalizeSourceSelection,
  resolveOverlaps,
  rippleDeleteClips,
} from './timeline.js'

const clip = (id, startTime, duration, extra = {}) => ({
  id,
  startTime,
  inPoint: 0,
  outPoint: duration,
  ...extra,
})

const assertAlmostEqual = (actual, expected) => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`)
}

test('detects media type from supported image extensions', () => {
  assert.equal(getMediaType('poster.WEBP'), 'image')
  assert.equal(getMediaType('clip.mp4'), 'video')
  assert.equal(getMediaType('unknown.bin'), 'video')
})

test('normalizes source selection to probed duration and minimum clip length', () => {
  const media = { id: 'v1', mediaType: 'video' }
  const selection = normalizeSourceSelection({
    media,
    probedDuration: 10,
    savedRange: { inPoint: 12, outPoint: 1 },
  })

  assert.equal(selection.inPoint, 10 - MIN_CLIP_DURATION)
  assert.equal(selection.outPoint, 10)
  assertAlmostEqual(selection.clipDuration, MIN_CLIP_DURATION)
})

test('normalizes image selections with configured default duration', () => {
  const selection = normalizeSourceSelection({
    media: { id: 'img1', mediaType: 'image' },
    defaultImageDuration: 7,
  })

  assert.deepEqual(selection, {
    inPoint: 0,
    outPoint: 7,
    duration: 7,
    clipDuration: 7,
  })
})

test('detects ripple insert points over clips and undersized gaps', () => {
  const timeline = [clip('a', 0, 2), clip('b', 3, 2)]

  assert.deepEqual(detectInsertPoint('__new__', 4.4, 1, timeline), { insertPoint: 5 })
  assert.deepEqual(detectInsertPoint('__new__', 2.4, 2, timeline), { insertPoint: 2 })
  assert.equal(detectInsertPoint('__new__', 2.4, 0.5, timeline), null)
})

test('applies ripple insert by shifting clips at and after insert point', () => {
  const timeline = [clip('a', 0, 2), clip('b', 2, 2), clip('c', 6, 1)]
  const result = applyRippleInsert(timeline, '__new__', 2, 3)

  assert.deepEqual(result.map((item) => [item.id, item.startTime]), [
    ['a', 0],
    ['b', 5],
    ['c', 9],
  ])
})

test('constrains moves and trim bounds to available timeline gaps', () => {
  const timeline = [clip('a', 0, 3), clip('b', 5, 2)]

  assert.equal(constrainMoveStart(4, 1.5, timeline), 3.5)
  assert.equal(minStartForTrimLeft(5, timeline), 3)
  assert.equal(maxEndForTrimRight(3, timeline), 5)
})

test('finds and closes interior gaps', () => {
  const timeline = [clip('a', 0, 2), clip('b', 5, 2)]
  const gap = findGapAtTime(3, timeline)

  assert.deepEqual(gap, { start: 2, end: 5 })
  assert.equal(findGapAtTime(1, timeline), null)
  assert.deepEqual(closeGap(timeline, gap).map((item) => [item.id, item.startTime]), [
    ['a', 0],
    ['b', 2],
  ])
})

test('finds playable empty timeline space including the tail after the last clip', () => {
  const timeline = [clip('a', 1, 2), clip('b', 5, 2)]

  assert.deepEqual(findTimelineSpaceAtTime(0.5, timeline), { start: 0, end: 1, type: 'gap' })
  assert.deepEqual(findTimelineSpaceAtTime(3.5, timeline), { start: 3, end: 5, type: 'gap' })
  assert.equal(findTimelineSpaceAtTime(2, timeline), null)
  assert.deepEqual(findTimelineSpaceAtTime(7.5, timeline), { start: 7, end: 9.5, type: 'tail' })
  assert.deepEqual(findTimelineSpaceAtTime(0, []), { start: 0, end: 2, type: 'tail' })
})

test('ripple delete removes selected clips and shifts later clips by removed duration', () => {
  const timeline = [clip('a', 0, 2), clip('b', 3, 2), clip('c', 6, 1)]
  const result = rippleDeleteClips(timeline, ['b'])

  assert.deepEqual(result.map((item) => [item.id, item.startTime]), [
    ['a', 0],
    ['c', 4],
  ])
})

test('overwrite resolves overlap by splitting an existing clip around the moved clip', () => {
  const source = clip('source', 0, 10)
  const moved = clip('moved', 3, 2)
  const result = resolveOverlaps([source, moved], 'moved', () => 'split-1')

  assert.deepEqual(result, [
    { ...source, outPoint: 3 },
    { ...source, id: 'split-1', inPoint: 5, startTime: 5 },
    moved,
  ])
})
