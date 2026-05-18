import assert from 'node:assert/strict'
import {
  DEFAULT_TRACK_HEIGHT,
  TRACK_DROP_ABOVE,
  TRACK_DROP_BELOW,
  applyTrackMovePlan,
  addTrack,
  createDefaultTracks,
  createAutoTrackForMove,
  findPreferredVideoTrackForDrop,
  getCollisionFreeTrackForClip,
  getCompatibleTrackMoveTarget,
  getDropZoneModeFromRelativeY,
  getTrackIdAtTimelineY,
  getTrackTypeIndex,
  insertTrackOrdered,
  normalizeTrackInsertEdge,
  normalizeTrackOrder,
  planTrackMove,
  resolveTimelineDropTarget,
  shiftTrackIdByType,
} from './trackStore.js'
import { DIVIDER_HEIGHT, EDGE_ZONE_HEIGHT } from './timelineLayout.js'

test('normalizeTrackOrder moves all video tracks above audio tracks', () => {
  const mixed = [
    { id: 'a1', type: 'audio', name: 'Audio 1', height: DEFAULT_TRACK_HEIGHT },
    { id: 'v1', type: 'video', name: 'Video 1', height: DEFAULT_TRACK_HEIGHT },
    { id: 'a2', type: 'audio', name: 'Audio 2', height: DEFAULT_TRACK_HEIGHT },
  ]
  assert.deepEqual(
    normalizeTrackOrder(mixed).map((track) => track.id),
    ['v1', 'a1', 'a2'],
  )
})

test('resolveTimelineDropTarget enforces strict video/audio zones', () => {
  const tracks = createDefaultTracks()
  assert.equal(
    resolveTimelineDropTarget({
      tracks,
      dropTargetId: TRACK_DROP_ABOVE,
      requiredTrackType: 'video',
    }).valid,
    true,
  )
  assert.equal(
    resolveTimelineDropTarget({
      tracks,
      dropTargetId: TRACK_DROP_ABOVE,
      requiredTrackType: 'audio',
    }).valid,
    false,
  )
  assert.equal(
    resolveTimelineDropTarget({
      tracks,
      dropTargetId: 'track-a1',
      requiredTrackType: 'video',
    }).valid,
    false,
  )
  assert.equal(
    resolveTimelineDropTarget({
      tracks,
      dropTargetId: 'track-v1',
      requiredTrackType: 'audio',
    }).valid,
    false,
  )
})

test('getDropZoneModeFromRelativeY maps divider band to nearest zone', () => {
  const tracks = createDefaultTracks()
  assert.equal(getDropZoneModeFromRelativeY(tracks, 20), 'video')
  assert.equal(getDropZoneModeFromRelativeY(tracks, EDGE_ZONE_HEIGHT + 40), 'video')
  assert.equal(
    getDropZoneModeFromRelativeY(tracks, EDGE_ZONE_HEIGHT + 80 + DIVIDER_HEIGHT + 10),
    'audio',
  )
})

test('getTrackIdAtTimelineY resolves divider band to adjacent track', () => {
  const tracks = createDefaultTracks()
  const base = { containerTop: 100, scrollTop: 0, rulerHeight: 30, tracks }
  const dividerMidY = 100 + 30 + EDGE_ZONE_HEIGHT + 80 + DIVIDER_HEIGHT / 2
  assert.equal(getTrackIdAtTimelineY({ ...base, clientY: dividerMidY - 1 }), 'track-v1')
  assert.equal(getTrackIdAtTimelineY({ ...base, clientY: dividerMidY + 1 }), 'track-a1')
})

test('normalizeTrackInsertEdge pins video to top and audio to bottom', () => {
  assert.equal(normalizeTrackInsertEdge('video', 'end'), 'start')
  assert.equal(normalizeTrackInsertEdge('video', 'start'), 'start')
  assert.equal(normalizeTrackInsertEdge('audio', 'start'), 'end')
  assert.equal(normalizeTrackInsertEdge('audio', 'end'), 'end')
})

test('adds video tracks at the top and audio tracks at the bottom', () => {
  const tracks = createDefaultTracks()

  const withVideo = addTrack(tracks, 'video')
  assert.deepEqual(withVideo.map((track) => track.type), ['video', 'video', 'audio'])
  assert.equal(withVideo[0].name, 'Video 2')
  assert.equal(withVideo[1].id, 'track-v1')

  const withAudio = addTrack(tracks, 'audio')
  assert.deepEqual(withAudio.map((track) => track.type), ['video', 'audio', 'audio'])
  assert.equal(withAudio[withAudio.length - 1].type, 'audio')

  const inserted = insertTrackOrdered(tracks, {
    id: 'new-video',
    type: 'video',
    name: 'Video 2',
    height: DEFAULT_TRACK_HEIGHT,
  }, 'end')
  assert.equal(inserted[0].id, 'new-video')
  assert.deepEqual(inserted.map((track) => track.type), ['video', 'video', 'audio'])
})

test('maps timeline Y coordinates to tracks and auto-track drop zones', () => {
  // Layout: edge 0-44 | v1 44-124 | divider 124-132 | a1 132-212 | edge 212-256
  // relativeY = clientY - containerTop(100) + scrollTop(0) - rulerHeight(30) = clientY - 130
  const tracks = [
    { id: 'track-v1', type: 'video', height: 80 },
    { id: 'track-a1', type: 'audio', height: 80 },
  ]
  const base = { containerTop: 100, scrollTop: 0, rulerHeight: 30, tracks }

  assert.equal(getTrackIdAtTimelineY({ ...base, clientY: 125 }), '__above__')  // relativeY=-5
  assert.equal(getTrackIdAtTimelineY({ ...base, clientY: 150 }), '__above__')  // relativeY=20 in top edge
  assert.equal(getTrackIdAtTimelineY({ ...base, clientY: 214 }), 'track-v1')   // relativeY=84 in v1
  assert.equal(getTrackIdAtTimelineY({ ...base, clientY: 274 }), 'track-a1')   // relativeY=144 in a1
  assert.equal(getTrackIdAtTimelineY({ ...base, clientY: 343 }), '__below__')  // relativeY=213 in bottom edge
})

test('maps timeline Y coordinates correctly while vertically scrolled', () => {
  // Layout: edge 0-44 | v1 44-124 | divider 124-132 | a1 132-212 | a2 212-292 | edge 292-336
  // relativeY = clientY - containerTop(100) + scrollTop(40) - rulerHeight(30) = clientY - 90
  const tracks = [
    { id: 'track-v1', type: 'video', height: 80 },
    { id: 'track-a1', type: 'audio', height: 80 },
    { id: 'track-a2', type: 'audio', height: 80 },
  ]
  const base = { containerTop: 100, scrollTop: 40, rulerHeight: 30, tracks }

  assert.equal(getTrackIdAtTimelineY({ ...base, clientY: 120 }), '__above__')  // relativeY=30 in top edge
  assert.equal(getTrackIdAtTimelineY({ ...base, clientY: 154 }), 'track-v1')   // relativeY=64 in v1
  assert.equal(getTrackIdAtTimelineY({ ...base, clientY: 222 }), 'track-a1')   // relativeY=132 first of a1
  assert.equal(getTrackIdAtTimelineY({ ...base, clientY: 302 }), 'track-a2')   // relativeY=212 first of a2
  assert.equal(getTrackIdAtTimelineY({ ...base, clientY: 384 }), '__below__')  // relativeY=294 in bottom edge
})

test('shifts track ids only within the same track type', () => {
  const tracks = [
    { id: 'track-v1', type: 'video' },
    { id: 'track-v2', type: 'video' },
    { id: 'track-a1', type: 'audio' },
    { id: 'track-a2', type: 'audio' },
  ]

  assert.equal(getTrackTypeIndex(tracks, 'track-v1'), 0)
  assert.equal(getTrackTypeIndex(tracks, 'track-v2'), 1)
  assert.equal(getTrackTypeIndex(tracks, 'track-a1'), 0)
  assert.equal(getTrackTypeIndex(tracks, 'missing'), -1)
  assert.equal(shiftTrackIdByType(tracks, 'track-v1', 1), 'track-v2')
  assert.equal(shiftTrackIdByType(tracks, 'track-v2', 1), 'track-v2')
  assert.equal(shiftTrackIdByType(tracks, 'track-a2', -1), 'track-a1')
  assert.equal(shiftTrackIdByType(tracks, 'missing', 1), 'missing')
})

test('plans video and audio moves only onto compatible unlocked tracks', () => {
  const tracks = [
    { id: 'track-v1', type: 'video' },
    { id: 'track-v2', type: 'video' },
    { id: 'track-a1', type: 'audio' },
    { id: 'track-a2', type: 'audio' },
  ]
  const videoClip = { id: 'clip-v', trackId: 'track-v1', trackMode: 'video', startTime: 3 }
  const audioClip = { id: 'clip-a', trackId: 'track-a1', trackMode: 'audio', startTime: 5 }

  const videoPlan = planTrackMove({ tracks, clips: [videoClip], primaryClipId: 'clip-v', targetTrackId: 'track-v2' })
  assert.equal(videoPlan.primaryTargetTrackId, 'track-v2')
  assert.deepEqual(applyTrackMovePlan([videoClip], videoPlan), [{ ...videoClip, trackId: 'track-v2' }])

  const audioPlan = planTrackMove({ tracks, clips: [audioClip], primaryClipId: 'clip-a', targetTrackId: 'track-a2' })
  assert.equal(audioPlan.primaryTargetTrackId, 'track-a2')
  assert.deepEqual(applyTrackMovePlan([audioClip], audioPlan), [{ ...audioClip, trackId: 'track-a2' }])
})

test('ignores locked compatible tracks during move planning', () => {
  const tracks = [
    { id: 'track-v1', type: 'video' },
    { id: 'track-v2', type: 'video', locked: true },
    { id: 'track-a1', type: 'audio' },
  ]
  const clip = { id: 'clip-v', trackId: 'track-v1', trackMode: 'video' }

  const target = getCompatibleTrackMoveTarget({ tracks, clip, targetTrackId: 'track-v2' })
  assert.equal(target.targetTrackId, 'track-v1')
  assert.equal(target.reason, 'locked-target')

  const plan = planTrackMove({ tracks, clips: [clip], primaryClipId: 'clip-v', targetTrackId: 'track-v2' })
  assert.equal(plan.primaryTargetTrackId, 'track-v1')
})

test('moves linked video and audio partners by the same relative track delta', () => {
  const tracks = [
    { id: 'track-v1', type: 'video' },
    { id: 'track-v2', type: 'video' },
    { id: 'track-a1', type: 'audio' },
    { id: 'track-a2', type: 'audio' },
  ]
  const clips = [
    { id: 'clip-v', trackId: 'track-v1', trackMode: 'video', linkGroupId: 'lg-1', startTime: 1 },
    { id: 'clip-a', trackId: 'track-a1', trackMode: 'audio', linkGroupId: 'lg-1', startTime: 1 },
  ]

  const plan = planTrackMove({ tracks, clips, primaryClipId: 'clip-v', targetTrackId: 'track-v2' })
  assert.deepEqual(
    applyTrackMovePlan(clips, plan).map((clip) => [clip.id, clip.trackId, clip.startTime]),
    [
      ['clip-v', 'track-v2', 1],
      ['clip-a', 'track-a2', 1],
    ]
  )
})

test('skips locked tracks when applying relative linked deltas', () => {
  const tracks = [
    { id: 'track-v1', type: 'video' },
    { id: 'track-v2', type: 'video', locked: true },
    { id: 'track-v3', type: 'video' },
    { id: 'track-a1', type: 'audio' },
    { id: 'track-a2', type: 'audio', locked: true },
    { id: 'track-a3', type: 'audio' },
  ]
  const clips = [
    { id: 'clip-v', trackId: 'track-v1', trackMode: 'video', linkGroupId: 'lg-1' },
    { id: 'clip-a', trackId: 'track-a1', trackMode: 'audio', linkGroupId: 'lg-1' },
  ]

  const plan = planTrackMove({ tracks, clips, primaryClipId: 'clip-v', targetTrackId: 'track-v3' })
  assert.deepEqual(
    applyTrackMovePlan(clips, plan).map((clip) => [clip.id, clip.trackId]),
    [
      ['clip-v', 'track-v3'],
      ['clip-a', 'track-a3'],
    ]
  )
})

test('creates new tracks only at the matching type edge zones', () => {
  const tracks = createDefaultTracks()
  let idSeq = 0
  const nextId = (type, edge) => `new-${type}-${edge}-${++idSeq}`
  const videoClip = { id: 'clip-v', trackId: 'track-v1', trackMode: 'video' }
  const audioClip = { id: 'clip-a', trackId: 'track-a1', trackMode: 'audio' }

  const videoAbovePlan = planTrackMove({
    tracks,
    clips: [videoClip],
    primaryClipId: 'clip-v',
    targetTrackId: TRACK_DROP_ABOVE,
    createTrackId: nextId,
  })
  assert.deepEqual(videoAbovePlan.autoTrackSpecs, [{ type: 'video', edge: 'start' }])

  const videoBelowPlan = planTrackMove({
    tracks,
    clips: [videoClip],
    primaryClipId: 'clip-v',
    targetTrackId: TRACK_DROP_BELOW,
    createTrackId: nextId,
  })
  assert.equal(videoBelowPlan.autoTrackSpecs.length, 0)
  assert.equal(videoBelowPlan.primaryTargetTrackId, 'track-v1')

  const audioBelowPlan = planTrackMove({
    tracks,
    clips: [audioClip],
    primaryClipId: 'clip-a',
    targetTrackId: TRACK_DROP_BELOW,
    createTrackId: nextId,
  })
  assert.deepEqual(audioBelowPlan.autoTrackSpecs, [{ type: 'audio', edge: 'end' }])
  const newAudioId = audioBelowPlan.autoTracks[0]?.id
  let applied = applyTrackMovePlan({ tracks, clips: [audioClip], plan: audioBelowPlan })
  assert.deepEqual(applied.tracks.map((track) => track.id), ['track-v1', 'track-a1', newAudioId])
  assert.equal(applied.clips[0].trackId, newAudioId)

  const audioAbovePlan = planTrackMove({
    tracks,
    clips: [audioClip],
    primaryClipId: 'clip-a',
    targetTrackId: TRACK_DROP_ABOVE,
    createTrackId: nextId,
  })
  assert.equal(audioAbovePlan.autoTrackSpecs.length, 0)
  assert.equal(audioAbovePlan.primaryTargetTrackId, 'track-a1')

  const audioOnVideoPlan = planTrackMove({
    tracks,
    clips: [audioClip],
    primaryClipId: 'clip-a',
    targetTrackId: 'track-v1',
    createTrackId: nextId,
  })
  assert.equal(audioOnVideoPlan.autoTrackSpecs.length, 0)
  assert.equal(audioOnVideoPlan.primaryTargetTrackId, 'track-a1')
})

test('clamps cross-type drags to the nearest same-type track', () => {
  const tracks = [
    { id: 'track-v1', type: 'video' },
    { id: 'track-v2', type: 'video' },
    { id: 'track-a1', type: 'audio' },
  ]
  const videoClip = { id: 'clip-v', trackId: 'track-v1', trackMode: 'video' }
  const audioClip = { id: 'clip-a', trackId: 'track-a1', trackMode: 'audio' }

  const videoOnAudio = getCompatibleTrackMoveTarget({
    tracks,
    clip: videoClip,
    targetTrackId: 'track-a1',
  })
  assert.equal(videoOnAudio.targetTrackId, 'track-v2')
  assert.equal(videoOnAudio.reason, 'type-boundary')
  assert.equal(videoOnAudio.autoTrack, null)

  const audioOnVideo = getCompatibleTrackMoveTarget({
    tracks,
    clip: audioClip,
    targetTrackId: 'track-v1',
  })
  assert.equal(audioOnVideo.targetTrackId, 'track-a1')
  assert.equal(audioOnVideo.reason, 'type-boundary')
  assert.equal(audioOnVideo.autoTrack, null)
})

test('multi-selection preserves relative track offsets and start times', () => {
  const tracks = [
    { id: 'track-v1', type: 'video' },
    { id: 'track-v2', type: 'video' },
    { id: 'track-v3', type: 'video' },
    { id: 'track-a1', type: 'audio' },
  ]
  const clips = [
    { id: 'clip-1', trackId: 'track-v1', trackMode: 'video', startTime: 0 },
    { id: 'clip-2', trackId: 'track-v2', trackMode: 'video', startTime: 4 },
  ]

  const plan = planTrackMove({ tracks, clips, primaryClipId: 'clip-1', targetTrackId: 'track-v2' })
  assert.deepEqual(
    applyTrackMovePlan(clips, plan).map((clip) => [clip.id, clip.trackId, clip.startTime]),
    [
      ['clip-1', 'track-v2', 0],
      ['clip-2', 'track-v3', 4],
    ]
  )
})

test('creates standalone auto-track objects for move previews', () => {
  const track = createAutoTrackForMove(createDefaultTracks(), 'audio', 'end', { id: 'new-audio' })
  assert.deepEqual(track, {
    id: 'new-audio',
    type: 'audio',
    edge: 'end',
    name: 'Audio 2',
    locked: false,
    height: DEFAULT_TRACK_HEIGHT,
    muted: false,
    solo: false,
    gain: 1,
  })
})

test('keeps linked horizontal partners on their track when the target time is free', () => {
  const tracks = [
    { id: 'track-v1', type: 'video' },
    { id: 'track-a1', type: 'audio' },
    { id: 'track-a2', type: 'audio' },
  ]
  const clip = { id: 'clip-a', trackId: 'track-a1', trackMode: 'audio', inPoint: 0, outPoint: 4 }
  const placement = getCollisionFreeTrackForClip({
    tracks,
    clips: [{ id: 'other', trackId: 'track-a1', startTime: 8, inPoint: 0, outPoint: 2 }],
    clip,
    startTime: 2,
    preferredTrackId: 'track-a1',
    ignoreClipIds: ['clip-v', 'clip-a'],
  })

  assert.deepEqual(placement, { trackId: 'track-a1', autoTrack: null })
})

test('places a linked audio partner on a lower audio track when its current track is occupied', () => {
  const tracks = [
    { id: 'track-v1', type: 'video' },
    { id: 'track-a1', type: 'audio' },
    { id: 'track-a2', type: 'audio' },
  ]
  const clip = { id: 'clip-a', trackId: 'track-a1', trackMode: 'audio', inPoint: 0, outPoint: 4 }
  const placement = getCollisionFreeTrackForClip({
    tracks,
    clips: [{ id: 'music', trackId: 'track-a1', startTime: 2, inPoint: 0, outPoint: 4 }],
    clip,
    startTime: 3,
    preferredTrackId: 'track-a1',
    ignoreClipIds: ['clip-v', 'clip-a'],
  })

  assert.deepEqual(placement, { trackId: 'track-a2', autoTrack: null })
})

test('places a linked video partner on an upper video track when its current track is occupied', () => {
  const tracks = [
    { id: 'track-v1', type: 'video' },
    { id: 'track-v2', type: 'video' },
    { id: 'track-a1', type: 'audio' },
  ]
  const clip = { id: 'clip-v', trackId: 'track-v2', trackMode: 'video', inPoint: 0, outPoint: 4 }
  const placement = getCollisionFreeTrackForClip({
    tracks,
    clips: [{ id: 'overlay', trackId: 'track-v2', startTime: 2, inPoint: 0, outPoint: 4 }],
    clip,
    startTime: 3,
    preferredTrackId: 'track-v2',
    ignoreClipIds: ['clip-v', 'clip-a'],
  })

  assert.deepEqual(placement, { trackId: 'track-v1', autoTrack: null })
})

test('plans a new same-type track when every linked partner target track is occupied', () => {
  const tracks = [
    { id: 'track-v1', type: 'video' },
    { id: 'track-a1', type: 'audio' },
    { id: 'track-a2', type: 'audio', locked: true },
  ]
  const clip = { id: 'clip-a', trackId: 'track-a1', trackMode: 'audio', inPoint: 0, outPoint: 4 }
  const placement = getCollisionFreeTrackForClip({
    tracks,
    clips: [{ id: 'music', trackId: 'track-a1', startTime: 2, inPoint: 0, outPoint: 4 }],
    clip,
    startTime: 3,
    preferredTrackId: 'track-a1',
    ignoreClipIds: ['clip-v', 'clip-a'],
  })

  assert.deepEqual(placement, { trackId: null, autoTrack: { type: 'audio', edge: 'end' } })
})

test('findPreferredVideoTrackForDrop returns first unlocked video track for below/null targets', () => {
  const tracks = [
    { id: 'v1', type: 'video', locked: false },
    { id: 'v2', type: 'video', locked: false },
    { id: 'a1', type: 'audio', locked: false },
  ]
  assert.equal(findPreferredVideoTrackForDrop(tracks, null)?.id, 'v1')
  assert.equal(findPreferredVideoTrackForDrop(tracks, TRACK_DROP_BELOW)?.id, 'v1')
})

test('findPreferredVideoTrackForDrop returns null for TRACK_DROP_ABOVE', () => {
  const tracks = [
    { id: 'v1', type: 'video', locked: false },
  ]
  assert.equal(findPreferredVideoTrackForDrop(tracks, TRACK_DROP_ABOVE), null)
})

test('findPreferredVideoTrackForDrop skips locked tracks and returns null when none available', () => {
  const locked = [
    { id: 'v1', type: 'video', locked: true },
    { id: 'a1', type: 'audio', locked: false },
  ]
  assert.equal(findPreferredVideoTrackForDrop(locked, null), null)

  const mixed = [
    { id: 'v1', type: 'video', locked: true },
    { id: 'v2', type: 'video', locked: false },
  ]
  assert.equal(findPreferredVideoTrackForDrop(mixed, null)?.id, 'v2')
})
