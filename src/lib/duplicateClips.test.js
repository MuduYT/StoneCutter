import assert from 'node:assert/strict'
import {
  duplicateClipsAfterSelection,
  getMiddlePanScroll,
  isTimelineTrimHotspot,
  getMarqueeSelectedClipIds,
  buildTrackLayoutRows,
  getTimelineClipVisualBounds,
} from './timeline.js'

const clip = (id, startTime, duration, extra = {}) => ({
  id,
  startTime,
  inPoint: 0,
  outPoint: duration,
  ...extra,
})

test('duplicateClipsAfterSelection places single clip immediately after itself', () => {
  const clips = [
    clip('a', 0, 3, { trackId: 'v1' }),
  ]
  const result = duplicateClipsAfterSelection({
    clips,
    clipIds: ['a'],
    makeId: () => 'a2',
  })
  assert.equal(result.duplicatedClips.length, 1)
  assert.equal(result.duplicatedClips[0].id, 'a2')
  assert.equal(result.duplicatedClips[0].startTime, 3)
  assert.equal(result.duplicatedClipIds[0], 'a2')
})

test('duplicateClipsAfterSelection preserves relative offsets for group', () => {
  const clips = [
    clip('a', 0, 2, { trackId: 'v1' }),
    clip('b', 5, 2, { trackId: 'v1' }),
  ]
  let counter = 0
  const result = duplicateClipsAfterSelection({
    clips,
    clipIds: ['a', 'b'],
    makeId: () => `d${++counter}`,
  })
  assert.equal(result.duplicatedClips.length, 2)
  assert.equal(result.duplicatedClips[0].startTime, result.duplicatedClips[0].startTime)
  assert.equal(result.duplicatedClips[1].startTime, result.duplicatedClips[0].startTime + 5)
})

test('duplicateClipsAfterSelection avoids overlapping existing clips', () => {
  const clips = [
    clip('a', 0, 3, { trackId: 'v1' }),
    clip('b', 2, 3, { trackId: 'v1' }),
    clip('c', 8, 2, { trackId: 'v1' }),
  ]
  const result = duplicateClipsAfterSelection({
    clips,
    clipIds: ['a', 'b'],
    makeId: () => 'dup',
  })
  assert.ok(result.delta >= 5)
  assert.equal(result.duplicatedClips[0].startTime, 0 + result.delta)
  assert.equal(result.duplicatedClips[1].startTime, 2 + result.delta)
})

test('duplicateClipsAfterSelection shifts keyframes by delta', () => {
  const clips = [
    {
      id: 'a',
      startTime: 1,
      inPoint: 0,
      outPoint: 2,
      trackId: 'v1',
      keyframes: { positionX: [{ time: 1.5, value: 10 }] },
    },
  ]
  const result = duplicateClipsAfterSelection({
    clips,
    clipIds: ['a'],
    makeId: () => 'a2',
  })
  const dup = result.duplicatedClips[0]
  assert.equal(dup.startTime, 3)
  assert.equal(dup.keyframes.positionX[0].time, 3.5)
})

test('getMiddlePanScroll computes clamped pan deltas', () => {
  const r = getMiddlePanScroll({
    startClientX: 100,
    startClientY: 50,
    scrollStartLeft: 30,
    scrollStartTop: 10,
    clientX: 140,
    clientY: 80,
    maxScrollLeft: 200,
    maxScrollTop: 100,
  })
  assert.equal(r.left, 0)
  assert.equal(r.top, 0)

  const r2 = getMiddlePanScroll({
    startClientX: 100,
    startClientY: 50,
    scrollStartLeft: 80,
    scrollStartTop: 60,
    clientX: 60,
    clientY: 30,
    maxScrollLeft: 200,
    maxScrollTop: 100,
  })
  assert.equal(r2.left, 120)
  assert.equal(r2.top, 80)
})

test('isTimelineTrimHotspot requires top-left/top-right corner position', () => {
  const clipRect = { left: 100, right: 300, top: 50, bottom: 100 }
  assert.equal(
    isTimelineTrimHotspot({ clientX: 104, clientY: 55, clipRect, side: 'left' }),
    true
  )
  assert.equal(
    isTimelineTrimHotspot({ clientX: 120, clientY: 55, clipRect, side: 'left' }),
    false
  )
  assert.equal(
    isTimelineTrimHotspot({ clientX: 104, clientY: 80, clipRect, side: 'left' }),
    false
  )
  assert.equal(
    isTimelineTrimHotspot({ clientX: 295, clientY: 55, clipRect, side: 'right' }),
    true
  )
  assert.equal(
    isTimelineTrimHotspot({ clientX: 104, clientY: 55, clipRect, side: 'right' }),
    false
  )
})

test('marquee selection uses visual bounds so it does not select hidden track clips', () => {
  const tracks = [
    { id: 'v1', type: 'video', height: 80 },
    { id: 'v2', type: 'video', height: 80, hidden: true },
  ]
  const clips = [
    clip('visible', 0, 2, { trackId: 'v1' }),
    clip('hidden-track', 0, 2, { trackId: 'v2' }),
  ]
  const selected = getMarqueeSelectedClipIds({
    clips,
    tracks,
    pxPerSec: 100,
    rect: { x1: 0, x2: 250, y1: 35, y2: 109 },
    trackTopOffset: 30,
  })
  assert.deepEqual([...selected], ['visible'])
})

test('buildTrackLayoutRows shares one source of truth for heights', () => {
  const tracks = [
    { id: 'v1', type: 'video', height: 100 },
    { id: 'a1', type: 'audio' },
  ]
  const rows = buildTrackLayoutRows(tracks, 80)
  assert.equal(rows[0].height, 100)
  assert.equal(rows[0].track.id, 'v1')
  assert.equal(rows[1].height, 80)
  assert.equal(rows[1].track.id, 'a1')
})

test('getTimelineClipVisualBounds respects insets', () => {
  const bounds = new Map([
    ['t1', { top: 30, bottom: 110, height: 80 }],
  ])
  const c = clip('a', 0, 2, { trackId: 't1' })
  const visual = getTimelineClipVisualBounds(bounds, c, 4)
  assert.equal(visual.top, 34)
  assert.equal(visual.bottom, 106)
})
