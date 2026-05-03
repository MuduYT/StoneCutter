import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_TRACK_HEIGHT,
  applyTrackMovePlan,
  addTrack,
  createDefaultTracks,
  createAutoTrackForMove,
  getCollisionFreeTrackForClip,
  getCompatibleTrackMoveTarget,
  getTrackIdAtTimelineY,
  getTrackTypeIndex,
  insertTrackOrdered,
  planTrackMove,
  shiftTrackIdByType,
} from './trackStore.js'

test('adds video tracks before audio tracks and audio tracks at the end', () => {
  const tracks = createDefaultTracks()

  assert.deepEqual(addTrack(tracks, 'video').map((track) => track.type), ['video', 'video', 'audio'])
  assert.deepEqual(addTrack(tracks, 'audio').map((track) => track.type), ['video', 'audio', 'audio'])
  assert.deepEqual(
    insertTrackOrdered(tracks, { id: 'new-video', type: 'video', name: 'Video 2', height: DEFAULT_TRACK_HEIGHT }).map((track) => track.type),
    ['video', 'video', 'audio']
  )
})

test('maps timeline Y coordinates to tracks below the sticky ruler', () => {
  const tracks = [
    { id: 'track-v1', height: 80 },
    { id: 'track-a1', height: 80 },
  ]
  const base = { containerTop: 100, scrollTop: 0, rulerHeight: 30, tracks }

  assert.equal(getTrackIdAtTimelineY({ ...base, clientY: 125 }), null)
  assert.equal(getTrackIdAtTimelineY({ ...base, clientY: 130 }), 'track-v1')
  assert.equal(getTrackIdAtTimelineY({ ...base, clientY: 170 }), 'track-v1')
  assert.equal(getTrackIdAtTimelineY({ ...base, clientY: 230 }), 'track-a1')
  assert.equal(getTrackIdAtTimelineY({ ...base, clientY: 291 }), '__below__')
})

test('maps timeline Y coordinates correctly while vertically scrolled', () => {
  const tracks = [
    { id: 'track-v1', height: 80 },
    { id: 'track-a1', height: 80 },
    { id: 'track-a2', height: 80 },
  ]
  const base = { containerTop: 100, scrollTop: 40, rulerHeight: 30, tracks }

  assert.equal(getTrackIdAtTimelineY({ ...base, clientY: 100 }), 'track-v1')
  assert.equal(getTrackIdAtTimelineY({ ...base, clientY: 170 }), 'track-a1')
  assert.equal(getTrackIdAtTimelineY({ ...base, clientY: 250 }), 'track-a2')
  assert.equal(getTrackIdAtTimelineY({ ...base, clientY: 335 }), '__below__')
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

test('plans auto video and audio tracks at the requested type edge', () => {
  const tracks = createDefaultTracks()
  let idSeq = 0
  const nextId = (type, edge) => `new-${type}-${edge}-${++idSeq}`
  const videoClip = { id: 'clip-v', trackId: 'track-v1', trackMode: 'video' }
  const audioClip = { id: 'clip-a', trackId: 'track-a1', trackMode: 'audio' }

  const videoPlan = planTrackMove({
    tracks,
    clips: [videoClip],
    primaryClipId: 'clip-v',
    targetTrackId: '__below__',
    createTrackId: nextId,
  })
  assert.deepEqual(videoPlan.autoTrackSpecs, [{ type: 'video', edge: 'end' }])
  let applied = applyTrackMovePlan({ tracks, clips: [videoClip], plan: videoPlan })
  assert.deepEqual(applied.tracks.map((track) => track.type), ['video', 'video', 'audio'])
  assert.equal(applied.clips[0].trackId, 'new-video-end-1')

  const audioPlan = planTrackMove({
    tracks,
    clips: [audioClip],
    primaryClipId: 'clip-a',
    targetTrackId: 'track-v1',
    createTrackId: nextId,
  })
  assert.deepEqual(audioPlan.autoTrackSpecs, [{ type: 'audio', edge: 'start' }])
  applied = applyTrackMovePlan({ tracks, clips: [audioClip], plan: audioPlan })
  assert.deepEqual(applied.tracks.map((track) => track.id), ['track-v1', 'new-audio-start-2', 'track-a1'])
  assert.equal(applied.clips[0].trackId, 'new-audio-start-2')
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
