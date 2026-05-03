import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_CLIP_DURATION,
  applyGroupShift,
  applyGroupSplit,
  applyGroupTrimLeft,
  applyGroupTrimRight,
  applyRippleInsert,
  closeGap,
  constrainMoveStart,
  detectInsertPoint,
  expandWithLinkedPartners,
  findGapAtTime,
  findTimelineSpaceAtTime,
  getLinkedClipIds,
  getMediaType,
  isAudioOnlyMedia,
  maxEndForTrimRight,
  minStartForTrimLeft,
  normalizeSourceSelection,
  resolveOverlaps,
  resolveOverlapsMulti,
  rippleDeleteClips,
  splitMediaIntoLinkedClips,
  unlinkClipGroup,
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
  assert.equal(getMediaType('voice.WAV'), 'audio')
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

test('detects insert points exactly on clip edges', () => {
  const timeline = [clip('b', 2, 2), clip('a', 0, 2)]

  assert.deepEqual(detectInsertPoint('__new__', 2, 1, timeline), { insertPoint: 2 })
  assert.deepEqual(detectInsertPoint('__new__', 4, 1, timeline), { insertPoint: 4 })
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

test('constrains moves against unsorted clips and zero-length gaps', () => {
  const timeline = [clip('b', 2, 2), clip('a', 0, 2), clip('c', 4, 1)]

  assert.equal(constrainMoveStart(2, 1, timeline), 5)
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

test('ripple delete merges overlapping removed clips before shifting later clips', () => {
  const timeline = [clip('a', 0, 5), clip('b', 3, 4), clip('c', 8, 1)]
  const result = rippleDeleteClips(timeline, ['a', 'b'])

  assert.deepEqual(result.map((item) => [item.id, item.startTime]), [
    ['c', 1],
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

test('overwrite split keeps source offsets when the existing clip is already trimmed', () => {
  const source = clip('source', 5, 10, { inPoint: 10, outPoint: 20 })
  const moved = clip('moved', 8, 2)
  const result = resolveOverlaps([source, moved], 'moved', () => 'split-1')

  assert.deepEqual(result, [
    { ...source, outPoint: 13 },
    { ...source, id: 'split-1', inPoint: 15, startTime: 10 },
    moved,
  ])
})

test('multi-clip overwrite preserves protected moved clips while trimming neighbors', () => {
  const source = clip('source', 0, 7, { inPoint: 20, outPoint: 27 })
  const movedA = clip('moved-a', 2, 2)
  const movedB = clip('moved-b', 5, 2)
  const result = resolveOverlapsMulti([source, movedA, movedB], ['moved-a', 'moved-b'], () => 'split-1')

  assert.deepEqual(result, [
    { ...source, outPoint: 22 },
    { ...source, id: 'split-1', inPoint: 24, startTime: 4, outPoint: 25 },
    movedA,
    movedB,
  ])
})

// -------------------- Linked-Clip helpers --------------------

test('identifies audio-only media extensions', () => {
  assert.equal(isAudioOnlyMedia('voice.MP3'), true)
  assert.equal(isAudioOnlyMedia('song.wav'), true)
  assert.equal(isAudioOnlyMedia('clip.mp4'), false)
  assert.equal(isAudioOnlyMedia('poster.png'), false)
})

test('splitMediaIntoLinkedClips produces a linked video+audio pair for AV drops', () => {
  const media = { id: 'v1', name: 'A.mp4', src: 'asset://a', mediaType: 'video' }
  const selection = { inPoint: 0, outPoint: 5, duration: 5 }
  const result = splitMediaIntoLinkedClips({
    media,
    selection,
    startTime: 2,
    videoClipId: 'clip-v',
    audioClipId: 'clip-a',
    videoTrackId: 'track-v1',
    audioTrackId: 'track-a1',
    trackMode: 'av',
    hasAudio: true,
    linkGroupIdFactory: () => 'lg-1',
  })

  assert.equal(result.length, 2)
  assert.equal(result[0].trackMode, 'video')
  assert.equal(result[0].trackId, 'track-v1')
  assert.equal(result[0].linkGroupId, 'lg-1')
  assert.equal(result[1].trackMode, 'audio')
  assert.equal(result[1].trackId, 'track-a1')
  assert.equal(result[1].linkGroupId, 'lg-1')
  assert.equal(result[0].startTime, 2)
  assert.equal(result[1].startTime, 2)
  assert.equal(result[0].inPoint, 0)
  assert.equal(result[0].outPoint, 5)
  assert.equal(result[1].inPoint, 0)
  assert.equal(result[1].outPoint, 5)
})

test('splitMediaIntoLinkedClips falls back to video-only when source has no audio', () => {
  const media = { id: 'v1', name: 'A.mp4', mediaType: 'video' }
  const selection = { inPoint: 0, outPoint: 4, duration: 4 }
  const result = splitMediaIntoLinkedClips({
    media, selection, startTime: 0,
    videoClipId: 'v', audioClipId: 'a',
    videoTrackId: 'track-v1', audioTrackId: 'track-a1',
    trackMode: 'av', hasAudio: false,
  })

  assert.equal(result.length, 1)
  assert.equal(result[0].trackMode, 'video')
  assert.equal(result[0].linkGroupId, null)
})

test('splitMediaIntoLinkedClips produces a single audio clip for audio-only drops', () => {
  const media = { id: 'v1', name: 'A.mp4', mediaType: 'video' }
  const selection = { inPoint: 1, outPoint: 3, duration: 5 }
  const result = splitMediaIntoLinkedClips({
    media, selection, startTime: 0,
    videoClipId: 'v', audioClipId: 'a',
    videoTrackId: 'track-v1', audioTrackId: 'track-a1',
    trackMode: 'audio',
  })

  assert.equal(result.length, 1)
  assert.equal(result[0].trackMode, 'audio')
  assert.equal(result[0].trackId, 'track-a1')
  assert.equal(result[0].linkGroupId, null)
  assert.equal(result[0].id, 'a')
})

test('splitMediaIntoLinkedClips never produces an audio clip for image media', () => {
  const media = { id: 'i1', name: 'P.png', mediaType: 'image' }
  const selection = { inPoint: 0, outPoint: 3, duration: 3 }
  const result = splitMediaIntoLinkedClips({
    media, selection, startTime: 0,
    videoClipId: 'v', audioClipId: 'a',
    videoTrackId: 'track-v1', audioTrackId: 'track-a1',
    trackMode: 'av', hasAudio: true,
  })

  assert.equal(result.length, 1)
  assert.equal(result[0].trackMode, 'video')
  assert.equal(result[0].linkGroupId, null)
})

test('getLinkedClipIds returns all clips sharing a linkGroupId', () => {
  const clips = [
    { id: 'vA', linkGroupId: 'lg-1', startTime: 0, inPoint: 0, outPoint: 2 },
    { id: 'aA', linkGroupId: 'lg-1', startTime: 0, inPoint: 0, outPoint: 2 },
    { id: 'other', linkGroupId: null, startTime: 3, inPoint: 0, outPoint: 2 },
  ]
  assert.deepEqual([...getLinkedClipIds(clips, 'vA')].sort(), ['aA', 'vA'])
  assert.deepEqual([...getLinkedClipIds(clips, 'other')], ['other'])
})

test('expandWithLinkedPartners adds missing partners to an id set', () => {
  const clips = [
    { id: 'vA', linkGroupId: 'lg-1' },
    { id: 'aA', linkGroupId: 'lg-1' },
    { id: 'vB', linkGroupId: 'lg-2' },
    { id: 'aB', linkGroupId: 'lg-2' },
    { id: 'orphan', linkGroupId: null },
  ]
  const expanded = expandWithLinkedPartners(clips, ['vA', 'orphan'])
  assert.deepEqual([...expanded].sort(), ['aA', 'orphan', 'vA'])
})

test('applyGroupShift moves a linked pair by the same delta', () => {
  const clips = [
    { id: 'v', linkGroupId: 'lg', startTime: 2, inPoint: 0, outPoint: 3 },
    { id: 'a', linkGroupId: 'lg', startTime: 2, inPoint: 0, outPoint: 3 },
    { id: 'x', linkGroupId: null, startTime: 5, inPoint: 0, outPoint: 1 },
  ]
  const shifted = applyGroupShift(clips, 'v', 1.5)
  assert.equal(shifted.find((c) => c.id === 'v').startTime, 3.5)
  assert.equal(shifted.find((c) => c.id === 'a').startTime, 3.5)
  assert.equal(shifted.find((c) => c.id === 'x').startTime, 5)
})

test('applyGroupTrimLeft and applyGroupTrimRight sync linked partners', () => {
  const clips = [
    { id: 'v', linkGroupId: 'lg', startTime: 2, inPoint: 1, outPoint: 5, sourceDuration: 10 },
    { id: 'a', linkGroupId: 'lg', startTime: 2, inPoint: 1, outPoint: 5, sourceDuration: 10 },
  ]
  const trimmedLeft = applyGroupTrimLeft(clips, 'v', { inPoint: 2, startTime: 3 })
  assert.equal(trimmedLeft.find((c) => c.id === 'v').inPoint, 2)
  assert.equal(trimmedLeft.find((c) => c.id === 'v').startTime, 3)
  assert.equal(trimmedLeft.find((c) => c.id === 'a').inPoint, 2)
  assert.equal(trimmedLeft.find((c) => c.id === 'a').startTime, 3)

  const trimmedRight = applyGroupTrimRight(clips, 'v', { outPoint: 4 })
  assert.equal(trimmedRight.find((c) => c.id === 'v').outPoint, 4)
  assert.equal(trimmedRight.find((c) => c.id === 'a').outPoint, 4)
})

test('unlinkClipGroup removes linkGroupId from both linked clips', () => {
  const clips = [
    { id: 'v', linkGroupId: 'lg', startTime: 0, inPoint: 0, outPoint: 2 },
    { id: 'a', linkGroupId: 'lg', startTime: 0, inPoint: 0, outPoint: 2 },
    { id: 'x', linkGroupId: 'lg-other', startTime: 5, inPoint: 0, outPoint: 1 },
  ]
  const unlinked = unlinkClipGroup(clips, 'v')
  assert.equal(unlinked.find((c) => c.id === 'v').linkGroupId, null)
  assert.equal(unlinked.find((c) => c.id === 'a').linkGroupId, null)
  assert.equal(unlinked.find((c) => c.id === 'x').linkGroupId, 'lg-other')
})

test('applyGroupSplit splits every linked clip at the same timeline time', () => {
  let counter = 0
  const makeId = () => `split-${++counter}`
  let lgCounter = 100
  const linkGroupIdFactory = () => `lg-${++lgCounter}`
  const clips = [
    { id: 'v', linkGroupId: 'lg-1', startTime: 0, inPoint: 0, outPoint: 5, sourceDuration: 5, trackMode: 'video' },
    { id: 'a', linkGroupId: 'lg-1', startTime: 0, inPoint: 0, outPoint: 5, sourceDuration: 5, trackMode: 'audio' },
  ]

  const result = applyGroupSplit(clips, 'v', 2, makeId, linkGroupIdFactory)
  assert.equal(result.length, 4)
  const vLeft = result.find((c) => c.id === 'v')
  const aLeft = result.find((c) => c.id === 'a')
  const vRight = result.find((c) => c.id === 'split-1')
  const aRight = result.find((c) => c.id === 'split-2')
  assert.equal(vLeft.outPoint, 2)
  assert.equal(aLeft.outPoint, 2)
  assert.equal(vRight.inPoint, 2)
  assert.equal(aRight.inPoint, 2)
  assert.equal(vRight.startTime, 2)
  assert.equal(aRight.startTime, 2)
  // right halves share a new linkGroupId
  assert.equal(vRight.linkGroupId, aRight.linkGroupId)
  assert.notEqual(vRight.linkGroupId, 'lg-1')
})
