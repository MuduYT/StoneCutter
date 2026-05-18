import { buildSeparatedLayout } from './timelineLayout.js'
import {
  assertTrackTypeCompatibility,
  assertValidTrackPlacement,
  getClipExpectedTrackType,
  warnTimelineIntegrity,
} from './timelineIntegrity.js'

let _seq = 0
export const nextTrackId = () => `track-${++_seq}`

export const DEFAULT_TRACK_HEIGHT = 80
export const MIN_TRACK_HEIGHT = 40
export const MAX_TRACK_HEIGHT = 200
export const TRACK_DROP_ABOVE = '__above__'
export const TRACK_DROP_BELOW = '__below__'

/** Video tracks are only inserted at the top; audio tracks only at the bottom. */
export function normalizeTrackInsertEdge(type, edge = 'end') {
  if (type === 'video') return 'start'
  if (type === 'audio') return 'end'
  return edge
}

/** Ensure all video tracks sit above the divider and all audio tracks below it. */
export function normalizeTrackOrder(tracks) {
  const list = tracks || []
  const videos = list.filter((track) => track.type === 'video')
  const audios = list.filter((track) => track.type === 'audio')
  const unknown = list.filter((track) => track.type !== 'video' && track.type !== 'audio')
  if (unknown.length > 0) {
    warnTimelineIntegrity('Unknown track types normalized to video', unknown.map((t) => t.id))
  }
  const reordered = [
    ...videos,
    ...audios,
    ...unknown.map((track) => ({ ...track, type: 'video' })),
  ]
  if (reordered.length === list.length) {
    const changed = reordered.some((track, index) => track.id !== list[index]?.id)
    if (changed) assertValidTrackPlacement(reordered)
  }
  return reordered
}

export function createDefaultTracks() {
  return [
    { id: 'track-v1', type: 'video', name: 'Video 1', locked: false, height: DEFAULT_TRACK_HEIGHT },
    { id: 'track-a1', type: 'audio', name: 'Audio 1', muted: false, solo: false, locked: false, height: DEFAULT_TRACK_HEIGHT, gain: 1 },
  ]
}

export function addTrack(tracks, type) {
  const count = tracks.filter((t) => t.type === type).length + 1
  const name = type === 'video' ? `Video ${count}` : `Audio ${count}`
  const base = { id: nextTrackId(), type, name, locked: false, height: DEFAULT_TRACK_HEIGHT }
  if (type === 'audio') { base.muted = false; base.solo = false; base.gain = 1 }
  if (type === 'video') {
    const firstVideoIdx = tracks.findIndex((t) => t.type === 'video')
    const insertAt = firstVideoIdx >= 0 ? firstVideoIdx : 0
    return normalizeTrackOrder([...tracks.slice(0, insertAt), base, ...tracks.slice(insertAt)])
  }
  return normalizeTrackOrder([...tracks, base])
}

/** Insert a track at the correct position (video before audio, audio at end). */
export function insertTrackOrdered(tracks, track, edge = 'end') {
  return insertTrackAtTypeEdge(tracks, track, edge)
}

export function removeTrack(tracks, trackId) {
  return tracks.filter((t) => t.id !== trackId)
}

export function updateTrack(tracks, trackId, changes) {
  return tracks.map((t) => (t.id === trackId ? { ...t, ...changes } : t))
}

export function getTrackTypeIndex(tracks, trackId) {
  const track = tracks.find((t) => t.id === trackId)
  if (!track?.type) return -1
  return tracks.filter((t) => t.type === track.type).findIndex((t) => t.id === trackId)
}

export function shiftTrackIdByType(tracks, trackId, delta) {
  const track = tracks.find((t) => t.id === trackId)
  if (!track?.type) return trackId
  const sameTypeTracks = tracks.filter((t) => t.type === track.type)
  const index = sameTypeTracks.findIndex((t) => t.id === trackId)
  if (index < 0) return trackId
  const nextIndex = Math.max(0, Math.min(sameTypeTracks.length - 1, index + delta))
  return sameTypeTracks[nextIndex]?.id || trackId
}

const trackTypeLabel = (type) => (type === 'audio' ? 'Audio' : 'Video')

function getClipMoveTrackType(tracks, clip) {
  const track = tracks.find((item) => item.id === clip?.trackId)
  return track?.type || (clip?.trackMode === 'audio' ? 'audio' : 'video')
}

function getTypeEdgeInsertIndex(tracks, type, edge) {
  edge = normalizeTrackInsertEdge(type, edge)
  if (type === 'video') {
    if (edge === 'start') {
      const firstVideoIdx = tracks.findIndex((track) => track.type === 'video')
      if (firstVideoIdx >= 0) return firstVideoIdx
      const firstAudioIdx = tracks.findIndex((track) => track.type === 'audio')
      return firstAudioIdx >= 0 ? firstAudioIdx : tracks.length
    }
    const lastVideoIdx = tracks.reduce((acc, track, index) => (track.type === 'video' ? index : acc), -1)
    if (lastVideoIdx >= 0) return lastVideoIdx + 1
    const firstAudioIdx = tracks.findIndex((track) => track.type === 'audio')
    return firstAudioIdx >= 0 ? firstAudioIdx : tracks.length
  }

  if (edge === 'start') {
    const firstAudioIdx = tracks.findIndex((track) => track.type === 'audio')
    return firstAudioIdx >= 0 ? firstAudioIdx : tracks.length
  }
  return tracks.length
}

function insertTrackAtTypeEdge(tracks, track, edge = 'end') {
  if (!track?.type) return tracks
  if (tracks.some((item) => item.id === track.id)) return tracks
  const normalizedEdge = normalizeTrackInsertEdge(track.type, edge)
  const insertAt = getTypeEdgeInsertIndex(tracks, track.type, normalizedEdge)
  return normalizeTrackOrder([
    ...tracks.slice(0, insertAt),
    { ...track, edge: normalizedEdge },
    ...tracks.slice(insertAt),
  ])
}

function getTrackTypeIndexes(tracks, type) {
  const indexes = []
  tracks.forEach((track, index) => {
    if (track.type === type) indexes.push(index)
  })
  return indexes
}

function getAutoTrackKey(type, edge) {
  return `${type}:${edge}`
}

function resolveExistingTrackByTypeIndex(tracks, type, desiredIndex, direction, fallbackTrackId) {
  const sameTypeTracks = tracks.filter((track) => track.type === type)
  if (desiredIndex < 0 || desiredIndex >= sameTypeTracks.length) return null
  const direct = sameTypeTracks[desiredIndex]
  if (direct && !direct.locked) return direct.id

  const step = direction < 0 ? -1 : 1
  for (let index = desiredIndex + step; index >= 0 && index < sameTypeTracks.length; index += step) {
    if (!sameTypeTracks[index].locked) return sameTypeTracks[index].id
  }

  return fallbackTrackId
}

function getClipMoveDuration(clip) {
  return Math.max(0, (clip?.outPoint || 0) - (clip?.inPoint || 0))
}

function clipOverlapsAt(clip, startTime, other) {
  const start = Number.isFinite(startTime) ? startTime : 0
  const end = start + getClipMoveDuration(clip)
  const otherStart = other.startTime || 0
  const otherEnd = otherStart + getClipMoveDuration(other)
  return end > otherStart + 1e-3 && start < otherEnd - 1e-3
}

function orderedTracksForCollisionSearch(tracks, type, preferredTrackId, direction) {
  const sameTypeTracks = tracks.filter((track) => track.type === type && !track.locked)
  const preferredIndex = sameTypeTracks.findIndex((track) => track.id === preferredTrackId)
  if (preferredIndex < 0) return sameTypeTracks

  const before = sameTypeTracks.slice(0, preferredIndex).reverse()
  const after = sameTypeTracks.slice(preferredIndex + 1)
  if (direction === 'start') return [sameTypeTracks[preferredIndex], ...before, ...after]
  return [sameTypeTracks[preferredIndex], ...after, ...before]
}

export function createAutoTrackForMove(tracks, type, edge = 'end', options = {}) {
  const normalizedEdge = normalizeTrackInsertEdge(type, edge)
  const count = tracks.filter((track) => track.type === type).length + 1
  const track = {
    id: options.id || options.idFactory?.() || nextTrackId(),
    type,
    edge: normalizedEdge,
    name: options.name || `${trackTypeLabel(type)} ${count}`,
    locked: false,
    height: DEFAULT_TRACK_HEIGHT,
  }
  if (type === 'audio') {
    track.muted = false
    track.solo = false
    track.gain = 1
  }
  return track
}

export function getCollisionFreeTrackForClip({
  tracks,
  clips,
  clip,
  startTime,
  preferredTrackId = clip?.trackId,
  ignoreClipIds = [],
  direction = null,
}) {
  const type = getClipMoveTrackType(tracks, clip)
  const ignore = ignoreClipIds instanceof Set ? ignoreClipIds : new Set(ignoreClipIds)
  const edge = normalizeTrackInsertEdge(type, direction)
  const candidates = orderedTracksForCollisionSearch(tracks, type, preferredTrackId, edge)

  for (const track of candidates) {
    const blocked = (clips || []).some((other) => (
      other.trackId === track.id &&
      other.id !== clip?.id &&
      !ignore.has(other.id) &&
      clipOverlapsAt(clip, startTime, other)
    ))
    if (!blocked) {
      return { trackId: track.id, autoTrack: null }
    }
  }

  return {
    trackId: null,
    autoTrack: { type, edge },
  }
}

export function getCompatibleTrackMoveTarget({ tracks, clip, targetTrackId }) {
  const trackType = getClipMoveTrackType(tracks, clip)
  const sourceTrack = tracks.find((track) => track.id === clip?.trackId)
  const fallback = {
    trackType,
    targetTrackId: clip?.trackId || null,
    targetTrack: sourceTrack || null,
    autoTrack: null,
    reason: 'source',
  }

  if (!trackType || !clip?.trackId) return fallback

  const unlockedSameType = tracks.filter((track) => track.type === trackType && !track.locked)
  const clampToBoundary = (edge) => {
    if (unlockedSameType.length === 0) return fallback
    const boundary = edge === 'start' ? unlockedSameType[0] : unlockedSameType[unlockedSameType.length - 1]
    return {
      trackType,
      targetTrackId: boundary.id,
      targetTrack: boundary,
      autoTrack: null,
      reason: 'type-boundary',
    }
  }

  const autoTarget = (edge) => {
    const normalizedEdge = normalizeTrackInsertEdge(trackType, edge)
    if (normalizedEdge === 'start' && trackType !== 'video') return clampToBoundary('start')
    if (normalizedEdge === 'end' && trackType !== 'audio') return clampToBoundary('end')
    return {
      trackType,
      targetTrackId: null,
      targetTrack: null,
      autoTrack: { type: trackType, edge: normalizedEdge },
      reason: `auto-${normalizedEdge}`,
    }
  }

  if (targetTrackId === TRACK_DROP_BELOW) {
    return trackType === 'audio' ? autoTarget('end') : clampToBoundary('end')
  }
  if (targetTrackId === TRACK_DROP_ABOVE) {
    return trackType === 'video' ? autoTarget('start') : clampToBoundary('start')
  }
  if (targetTrackId == null) return fallback

  const targetTrack = tracks.find((track) => track.id === targetTrackId)
  if (!targetTrack) return { ...fallback, reason: 'missing-target' }

  if (targetTrack.type === trackType) {
    if (targetTrack.locked) return { ...fallback, reason: 'locked-target' }
    return {
      trackType,
      targetTrackId: targetTrack.id,
      targetTrack,
      autoTrack: null,
      reason: 'track',
    }
  }

  const targetIndex = tracks.findIndex((track) => track.id === targetTrackId)
  const compatibleIndexes = getTrackTypeIndexes(tracks, trackType)
  if (compatibleIndexes.length === 0) {
    return targetIndex <= 0 ? clampToBoundary('start') : clampToBoundary('end')
  }
  if (targetIndex < compatibleIndexes[0]) return clampToBoundary('start')
  if (targetIndex > compatibleIndexes[compatibleIndexes.length - 1]) return clampToBoundary('end')

  return { ...fallback, reason: 'incompatible-target' }
}

export function planTrackMove({
  tracks,
  clips,
  primaryClipId,
  targetTrackId,
  autoTracks = [],
  createTrackId = null,
}) {
  const selectedClips = clips || []
  const primaryClip = selectedClips.find((clip) => clip.id === primaryClipId) || selectedClips[0]
  if (!primaryClip) {
    return {
      delta: 0,
      primaryTargetTrackId: null,
      targetTrackIds: [],
      autoTrackSpecs: [],
      autoTracks: [],
      clipTrackIds: {},
      clips: [],
    }
  }

  const target = getCompatibleTrackMoveTarget({ tracks, clip: primaryClip, targetTrackId })
  const primaryTypeTracks = tracks.filter((track) => track.type === target.trackType)
  const primarySourceIndex = primaryTypeTracks.findIndex((track) => track.id === primaryClip.trackId)
  let delta = 0

  if (primarySourceIndex >= 0) {
    if (target.autoTrack?.edge === 'start') {
      delta = -primarySourceIndex - 1
    } else if (target.autoTrack?.edge === 'end') {
      delta = primaryTypeTracks.length - primarySourceIndex
    } else if (target.targetTrackId) {
      const targetIndex = primaryTypeTracks.findIndex((track) => track.id === target.targetTrackId)
      delta = targetIndex >= 0 ? targetIndex - primarySourceIndex : 0
    }
  }

  const providedAutoTracks = new Map(
    autoTracks
      .filter((track) => track?.type && track?.edge)
      .map((track) => [getAutoTrackKey(track.type, track.edge), track])
  )
  const autoTrackSpecsByKey = new Map()
  const plannedAutoTracksByKey = new Map()

  const ensureAutoTrack = (type, edge) => {
    const normalizedEdge = normalizeTrackInsertEdge(type, edge)
    const key = getAutoTrackKey(type, normalizedEdge)
    if (!autoTrackSpecsByKey.has(key)) {
      autoTrackSpecsByKey.set(key, { type, edge: normalizedEdge })
    }
    if (plannedAutoTracksByKey.has(key)) return plannedAutoTracksByKey.get(key)
    const provided = providedAutoTracks.get(key)
    if (provided) {
      plannedAutoTracksByKey.set(key, provided)
      return provided
    }
    if (createTrackId) {
      const created = createAutoTrackForMove(tracks, type, edge, { id: createTrackId(type, edge) })
      plannedAutoTracksByKey.set(key, created)
      return created
    }
    return null
  }

  if (target.autoTrack) ensureAutoTrack(target.autoTrack.type, target.autoTrack.edge)

  for (const clip of selectedClips) {
    const sourceType = getClipMoveTrackType(tracks, clip)
    const sameTypeTracks = tracks.filter((track) => track.type === sourceType)
    const sourceIndex = sameTypeTracks.findIndex((track) => track.id === clip.trackId)
    if (sourceIndex < 0) continue
    const desiredIndex = sourceIndex + delta
    if (desiredIndex < 0) ensureAutoTrack(sourceType, 'start')
    if (desiredIndex >= sameTypeTracks.length) ensureAutoTrack(sourceType, 'end')
  }

  const clipTrackIds = {}
  for (const clip of selectedClips) {
    const sourceType = getClipMoveTrackType(tracks, clip)
    const sourceTrack = tracks.find((track) => track.id === clip.trackId)
    if (!sourceTrack || sourceTrack.locked) {
      clipTrackIds[clip.id] = clip.trackId
      continue
    }
    const sameTypeTracks = tracks.filter((track) => track.type === sourceType)
    const sourceIndex = sameTypeTracks.findIndex((track) => track.id === clip.trackId)
    if (sourceIndex < 0) {
      clipTrackIds[clip.id] = clip.trackId
      continue
    }
    const desiredIndex = sourceIndex + delta
    const direction = delta < 0 ? -1 : 1
    const nextClipTrackId = desiredIndex < 0
      ? ensureAutoTrack(sourceType, 'start')?.id || clip.trackId
      : desiredIndex >= sameTypeTracks.length
        ? ensureAutoTrack(sourceType, 'end')?.id || clip.trackId
        : resolveExistingTrackByTypeIndex(tracks, sourceType, desiredIndex, direction, clip.trackId)
    clipTrackIds[clip.id] = nextClipTrackId
  }

  const plannedAutoTracks = [...plannedAutoTracksByKey.values()]
  const targetTrackIds = [...new Set(Object.values(clipTrackIds).filter(Boolean))]
  return {
    delta,
    primaryTargetTrackId: clipTrackIds[primaryClip.id] || primaryClip.trackId,
    targetTrackIds,
    autoTrackSpecs: [...autoTrackSpecsByKey.values()],
    autoTracks: plannedAutoTracks,
    clipTrackIds,
    clips: selectedClips.map((clip) => ({ ...clip, trackId: clipTrackIds[clip.id] || clip.trackId })),
  }
}

export function applyTrackMovePlan(stateOrClips, maybePlan) {
  const applyClips = (clipList, plan) => {
    const updates = plan?.clipTrackIds || {}
    return (clipList || []).map((clip) => (
      updates[clip.id] && updates[clip.id] !== clip.trackId
        ? { ...clip, trackId: updates[clip.id] }
        : clip
    ))
  }

  if (Array.isArray(stateOrClips)) {
    return applyClips(stateOrClips, maybePlan)
  }

  const { tracks = [], clips = [], plan } = stateOrClips || {}
  const nextTracks = (plan?.autoTracks || []).reduce(
    (acc, track) => insertTrackAtTypeEdge(acc, track, normalizeTrackInsertEdge(track.type, track.edge)),
    tracks
  )
  return {
    tracks: nextTracks,
    clips: applyClips(clips, plan),
  }
}

/**
 * Find the top unlocked video track to use for a text (or video-only) drop
 * that lands in an ambiguous area (TRACK_DROP_BELOW, empty area, or null target).
 * Returns null when a new track must be created instead (TRACK_DROP_ABOVE or no
 * suitable video track exists).
 */
export function findPreferredVideoTrackForDrop(tracks, dropTargetId) {
  if (dropTargetId === TRACK_DROP_ABOVE) return null
  return tracks.find((t) => t.type === 'video' && !t.locked) || null
}

export function getDropZoneModeFromRelativeY(tracks, relativeY, defaultTrackHeight = DEFAULT_TRACK_HEIGHT) {
  const layout = buildSeparatedLayout(tracks || [], defaultTrackHeight)
  if (relativeY < layout.videoEdgeZone.top + layout.videoEdgeZone.height) return 'video'
  if (relativeY >= layout.audioEdgeZone.top) return 'audio'
  const dividerEnd = layout.dividerY + layout.dividerHeight
  if (relativeY < layout.dividerY) return 'video'
  if (relativeY >= dividerEnd) return 'audio'
  const mid = layout.dividerY + layout.dividerHeight / 2
  return relativeY < mid ? 'video' : 'audio'
}

export function resolveTimelineDropTarget({
  tracks,
  dropTargetId,
  requiredTrackType,
}) {
  if (!requiredTrackType) {
    return { valid: true, dropTargetId, reason: 'any' }
  }

  if (dropTargetId === TRACK_DROP_ABOVE) {
    if (requiredTrackType === 'video') {
      return { valid: true, dropTargetId, edge: 'start', reason: 'zone-above' }
    }
    return { valid: false, dropTargetId, reason: 'zone-mismatch' }
  }

  if (dropTargetId === TRACK_DROP_BELOW) {
    if (requiredTrackType === 'audio') {
      return { valid: true, dropTargetId, edge: 'end', reason: 'zone-below' }
    }
    return { valid: false, dropTargetId, reason: 'zone-mismatch' }
  }

  const targetTrack = (tracks || []).find((track) => track.id === dropTargetId)
  if (!targetTrack) {
    return { valid: false, dropTargetId, reason: 'missing-target' }
  }

  if (targetTrack.type !== requiredTrackType) {
    return { valid: false, dropTargetId, targetTrack, reason: 'type-mismatch' }
  }

  return { valid: true, dropTargetId, targetTrack, reason: 'track' }
}

export function getTrackIdAtTimelineY({
  clientY,
  containerTop,
  scrollTop = 0,
  rulerHeight = 30,
  tracks,
}) {
  const relativeY = clientY - containerTop + scrollTop - rulerHeight
  if (relativeY < 0) return TRACK_DROP_ABOVE

  const layout = buildSeparatedLayout(tracks || [], DEFAULT_TRACK_HEIGHT)
  const { videoTracksLayout, audioTracksLayout, dividerY, dividerHeight, videoEdgeZone, audioEdgeZone } = layout
  const dividerEnd = dividerY + dividerHeight

  if (relativeY < videoEdgeZone.top + videoEdgeZone.height) return TRACK_DROP_ABOVE

  if (videoTracksLayout.length === 0 && audioTracksLayout.length === 0) {
    return TRACK_DROP_BELOW
  }

  for (const { track, top, height } of videoTracksLayout) {
    if (relativeY >= top && relativeY < top + height) return track.id
  }

  if (relativeY >= dividerY && relativeY < dividerEnd) {
    const mid = dividerY + dividerHeight / 2
    if (relativeY < mid) {
      const lastVideo = videoTracksLayout[videoTracksLayout.length - 1]
      return lastVideo?.track.id ?? TRACK_DROP_ABOVE
    }
    const firstAudio = audioTracksLayout[0]
    return firstAudio?.track.id ?? TRACK_DROP_BELOW
  }

  for (const { track, top, height } of audioTracksLayout) {
    if (relativeY >= top && relativeY < top + height) return track.id
  }

  return TRACK_DROP_BELOW
}

export function validateClipsOnTracks(tracks, clips) {
  let valid = true
  const trackById = new Map((tracks || []).map((track) => [track.id, track]))
  for (const clip of clips || []) {
    const track = trackById.get(clip.trackId)
    if (!track) continue
    if (!assertTrackTypeCompatibility(clip, track)) valid = false
  }
  return valid
}

export { getClipExpectedTrackType }
