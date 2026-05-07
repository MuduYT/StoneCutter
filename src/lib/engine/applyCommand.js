import {
  MIN_CLIP_DURATION,
  applyGroupSplit,
  applyGroupTrimLeft,
  applyGroupTrimRight,
  applySingleClipSplit,
  clipDuration,
  expandWithLinkedPartners,
  resolveOverlaps,
  resolveOverlapsMulti,
  rippleDeleteClips,
} from "../timeline.js"
import {
  PROJECT_FPS,
  addOrUpdateKeyframe,
  createGroupKeyframes,
  getClipPropertyTrack,
  moveKeyframe,
  removeKeyframe,
  removeKeyframeAt,
  setClipPropertyTrack,
  shiftKeyframeMap,
  toggleClipKeyframeAt,
} from "../keyframes.js"

let commandGeneratedId = 0
const nextGeneratedId = (prefix = "gen") => {
  commandGeneratedId += 1
  return `${prefix}-${Date.now().toString(36)}-${commandGeneratedId}`
}

const cloneTracks = (tracks = []) => tracks.map((track) => ({ ...track }))
const cloneClips = (clips = []) => clips.map((clip) => ({ ...clip }))

const cloneState = (state) => ({
  ...state,
  timeline: {
    ...(state?.timeline || {}),
    tracks: cloneTracks(state?.timeline?.tracks),
    clips: cloneClips(state?.timeline?.clips),
  },
  selection: {
    clipIds: [...(state?.selection?.clipIds || [])],
    primaryClipId: state?.selection?.primaryClipId ?? null,
  },
  history: {
    past: [...(state?.history?.past || [])],
    future: [...(state?.history?.future || [])],
  },
})

const createHistoryEntry = (state) => ({
  timeline: {
    ...state.timeline,
    tracks: cloneTracks(state.timeline?.tracks),
    clips: cloneClips(state.timeline?.clips),
  },
  selection: {
    clipIds: [...(state.selection?.clipIds || [])],
    primaryClipId: state.selection?.primaryClipId ?? null,
  },
})

const withHistorySnapshot = (state) => {
  const next = cloneState(state)
  next.history.past = [...next.history.past, createHistoryEntry(state)]
  if (next.history.past.length > 100) {
    next.history.past = next.history.past.slice(next.history.past.length - 100)
  }
  next.history.future = []
  return next
}

const finish = (state, commandId, changed = {}) => {
  const events = [
    {
      type: "state.changed",
      payload: {
        changedClipIds: changed.changedClipIds || [],
        changedTrackIds: changed.changedTrackIds || [],
      },
    },
    {
      type: "history.changed",
      payload: {
        past: state.history?.past?.length || 0,
        future: state.history?.future?.length || 0,
      },
    },
  ]
  return { state, events, commandId }
}

const validationError = (state, commandId, reason) => ({
  state,
  events: [{ type: "validation.error", payload: { commandId, reason } }],
})

const findClipById = (clips, clipId) => clips.find((clip) => clip.id === clipId) || null
const linkedClipIdsFor = (clips, clipId) => [...expandWithLinkedPartners(clips, [clipId])]

const shiftClipOnTimeline = (clip, deltaSec) => ({
  ...clip,
  startTime: Math.max(0, clip.startTime + deltaSec),
  keyframes: shiftKeyframeMap(clip.keyframes, deltaSec),
})

const resolveClipMoveOverlaps = (clipList, movedIds, makeId) => {
  const ids = movedIds instanceof Set ? movedIds : new Set(movedIds)
  const byTrack = new Map()
  for (const clip of clipList) {
    if (!byTrack.has(clip.trackId)) byTrack.set(clip.trackId, [])
    byTrack.get(clip.trackId).push(clip)
  }

  const resolved = []
  for (const trackClips of byTrack.values()) {
    const modifiedIds = trackClips
      .filter((clip) => ids.has(clip.id))
      .map((clip) => clip.id)
    if (modifiedIds.length === 0) {
      resolved.push(...trackClips)
    } else if (modifiedIds.length === 1) {
      resolved.push(...resolveOverlaps(trackClips, modifiedIds[0], makeId))
    } else {
      resolved.push(...resolveOverlapsMulti(trackClips, modifiedIds, makeId))
    }
  }
  return resolved
}

const ensureSelectionExists = (state) => {
  if (!state.selection) {
    state.selection = { clipIds: [], primaryClipId: null }
  }
}

const applyUndo = (state, commandId) => {
  if (!state.history.past.length) {
    return validationError(state, commandId, "Nothing to undo.")
  }
  const next = cloneState(state)
  const previousEntry = next.history.past[next.history.past.length - 1]
  next.history.past = next.history.past.slice(0, -1)
  next.history.future = [createHistoryEntry(state), ...next.history.future]
  next.timeline = {
    ...next.timeline,
    ...previousEntry.timeline,
    tracks: cloneTracks(previousEntry.timeline?.tracks),
    clips: cloneClips(previousEntry.timeline?.clips),
  }
  next.selection = {
    clipIds: [...(previousEntry.selection?.clipIds || [])],
    primaryClipId: previousEntry.selection?.primaryClipId ?? null,
  }
  return finish(next, commandId)
}

const applyRedo = (state, commandId) => {
  if (!state.history.future.length) {
    return validationError(state, commandId, "Nothing to redo.")
  }
  const next = cloneState(state)
  const redoEntry = next.history.future[0]
  next.history.future = next.history.future.slice(1)
  next.history.past = [...next.history.past, createHistoryEntry(state)]
  next.timeline = {
    ...next.timeline,
    ...redoEntry.timeline,
    tracks: cloneTracks(redoEntry.timeline?.tracks),
    clips: cloneClips(redoEntry.timeline?.clips),
  }
  next.selection = {
    clipIds: [...(redoEntry.selection?.clipIds || [])],
    primaryClipId: redoEntry.selection?.primaryClipId ?? null,
  }
  return finish(next, commandId)
}

export const applyCommand = (engineState, command) => {
  const state = cloneState(engineState)
  const commandId = command?.id || nextGeneratedId("cmd")
  const type = command?.type
  const payload = command?.payload || {}

  if (!type) {
    return validationError(state, commandId, "Missing command type.")
  }

  if (type === "history.undo") return applyUndo(state, commandId)
  if (type === "history.redo") return applyRedo(state, commandId)

  if (type === "timeline.setPlayhead") {
    const next = cloneState(state)
    const time = Number(payload.time)
    next.timeline.playhead = Number.isFinite(time) ? Math.max(0, time) : next.timeline.playhead
    return finish(next, commandId)
  }

  if (type === "selection.set") {
    const next = cloneState(state)
    ensureSelectionExists(next)
    next.selection.clipIds = Array.isArray(payload.clipIds) ? [...payload.clipIds] : []
    next.selection.primaryClipId = payload.primaryClipId ?? next.selection.clipIds[0] ?? null
    return finish(next, commandId)
  }

  let next = withHistorySnapshot(state)
  const clips = next.timeline.clips || []

  if (type === "clip.add") {
    if (payload.ripple) {
      return validationError(state, commandId, "ripple not implemented for this command")
    }
    const additions = Array.isArray(payload.clips) ? payload.clips.map((clip) => ({ ...clip })) : []
    if (additions.length === 0) return validationError(state, commandId, "No clips provided.")
    let updated = [...clips, ...additions]
    if (payload.resolveOverlaps) {
      for (const clip of additions) {
        updated = resolveOverlaps(updated, clip.id, () => nextGeneratedId("clip"))
      }
    }
    next.timeline.clips = updated
    return finish(next, commandId, { changedClipIds: additions.map((clip) => clip.id) })
  }

  if (type === "clip.updateProps") {
    const clipId = payload.clipId
    const clip = findClipById(clips, clipId)
    if (!clip) return validationError(state, commandId, `Clip not found: ${clipId}`)
    next.timeline.clips = clips.map((item) =>
      item.id === clipId ? { ...item, ...(payload.props || {}) } : item
    )
    return finish(next, commandId, { changedClipIds: [clipId] })
  }

  if (type === "clip.move") {
    if (payload.ripple) {
      return validationError(state, commandId, "ripple not implemented for this command")
    }
    const clipIds = Array.isArray(payload.clipIds) ? payload.clipIds : []
    if (clipIds.length === 0) return validationError(state, commandId, "No clip ids provided.")
    const expandedIds = payload.expandLinked
      ? [...expandWithLinkedPartners(clips, clipIds)]
      : clipIds
    const expandedSet = new Set(expandedIds)
    const changedClipIds = new Set(expandedIds)
    const delta = Number(payload.deltaTime)
    const safeDelta = Number.isFinite(delta) ? delta : 0
    let updated = clips

    if (payload.targetTrackId) {
      updated = updated.map((item) =>
        expandedSet.has(item.id) ? { ...item, trackId: payload.targetTrackId } : item
      )
    }
    if (safeDelta !== 0) {
      if (payload.expandLinked) {
        updated = updated.map((item) =>
          expandedSet.has(item.id) ? shiftClipOnTimeline(item, safeDelta) : item
        )
      } else {
        const shiftedLinkGroups = new Set()
        for (const id of expandedIds) {
          const clip = findClipById(updated, id)
          if (!clip) continue
          if (clip.linkGroupId) {
            if (shiftedLinkGroups.has(clip.linkGroupId)) continue
            shiftedLinkGroups.add(clip.linkGroupId)
            for (const linkedId of linkedClipIdsFor(updated, id)) changedClipIds.add(linkedId)
            const linkedIds = new Set(linkedClipIdsFor(updated, id))
            updated = updated.map((item) =>
              linkedIds.has(item.id) ? shiftClipOnTimeline(item, safeDelta) : item
            )
          } else {
            updated = updated.map((item) =>
              item.id === id ? shiftClipOnTimeline(item, safeDelta) : item
            )
          }
        }
      }
    }
    if (payload.resolveOverlaps) {
      updated = resolveClipMoveOverlaps(updated, changedClipIds, () => nextGeneratedId("clip"))
    }
    next.timeline.clips = updated
    return finish(next, commandId, { changedClipIds: [...changedClipIds] })
  }

  if (type === "clip.trimLeft") {
    if (payload.ripple) {
      return validationError(state, commandId, "ripple not implemented for this command")
    }
    const clipId = payload.clipId
    const clip = findClipById(clips, clipId)
    if (!clip) return validationError(state, commandId, `Clip not found: ${clipId}`)
    const trimTime = Number(payload.time)
    const hasTrimTime = Number.isFinite(trimTime)
    const maxStart = clip.startTime + (clip.outPoint - clip.inPoint) - MIN_CLIP_DURATION
    const nextTime = hasTrimTime
      ? Math.max(0, Math.min(maxStart, trimTime))
      : null
    const nextInPoint = hasTrimTime
      ? clip.inPoint + (nextTime - clip.startTime)
      : Number(payload.newInPoint)
    const nextStart = hasTrimTime ? nextTime : Number(payload.newStartTime)
    if (!Number.isFinite(nextInPoint) || !Number.isFinite(nextStart)) {
      return validationError(state, commandId, "Invalid trimLeft values.")
    }
    if (payload.expandLinked && !clip.linkGroupId) {
      return validationError(
        state,
        commandId,
        "expandLinked requested but clip has no linkGroupId"
      )
    }
    if (clip.linkGroupId) {
      next.timeline.clips = applyGroupTrimLeft(clips, clipId, {
        inPoint: nextInPoint,
        startTime: nextStart,
      })
    } else {
      next.timeline.clips = clips.map((item) =>
        item.id === clipId
          ? {
              ...item,
              inPoint: Math.max(0, Math.min(item.outPoint - MIN_CLIP_DURATION, nextInPoint)),
              startTime: Math.max(0, nextStart),
            }
          : item
      )
    }
    return finish(next, commandId, {
      changedClipIds: clip.linkGroupId ? linkedClipIdsFor(clips, clipId) : [clipId],
    })
  }

  if (type === "clip.trimRight") {
    if (payload.ripple) {
      return validationError(state, commandId, "ripple not implemented for this command")
    }
    const clipId = payload.clipId
    const clip = findClipById(clips, clipId)
    if (!clip) return validationError(state, commandId, `Clip not found: ${clipId}`)
    const trimTime = Number(payload.time)
    const hasTrimTime = Number.isFinite(trimTime)
    const minEnd = clip.startTime + MIN_CLIP_DURATION
    const maxEnd = clip.sourceDuration
      ? clip.startTime + (clip.sourceDuration - clip.inPoint)
      : Number.MAX_SAFE_INTEGER
    const nextTime = hasTrimTime
      ? Math.max(minEnd, Math.min(maxEnd, trimTime))
      : null
    const nextOutPoint = hasTrimTime
      ? clip.inPoint + (nextTime - clip.startTime)
      : Number(payload.newOutPoint)
    if (!Number.isFinite(nextOutPoint)) {
      return validationError(state, commandId, "Invalid trimRight value.")
    }
    if (payload.expandLinked && !clip.linkGroupId) {
      return validationError(
        state,
        commandId,
        "expandLinked requested but clip has no linkGroupId"
      )
    }
    if (clip.linkGroupId) {
      next.timeline.clips = applyGroupTrimRight(clips, clipId, { outPoint: nextOutPoint })
    } else {
      next.timeline.clips = clips.map((item) =>
        item.id === clipId
          ? {
              ...item,
              outPoint: Math.max(item.inPoint + MIN_CLIP_DURATION, nextOutPoint),
            }
          : item
      )
    }
    return finish(next, commandId, {
      changedClipIds: clip.linkGroupId ? linkedClipIdsFor(clips, clipId) : [clipId],
    })
  }

  if (type === "clip.split") {
    const clipId = payload.clipId
    const clip = findClipById(clips, clipId)
    if (!clip) return validationError(state, commandId, `Clip not found: ${clipId}`)
    const timelineTime = Number(payload.timelineTime)
    if (!Number.isFinite(timelineTime)) {
      return validationError(state, commandId, "Invalid split time.")
    }
    if (payload.expandLinked && !clip.linkGroupId) {
      return validationError(
        state,
        commandId,
        "expandLinked requested but clip has no linkGroupId"
      )
    }
    const linked = Boolean(payload.linked || payload.expandLinked)
    next.timeline.clips =
      linked && clip.linkGroupId
        ? applyGroupSplit(clips, clipId, timelineTime, () => nextGeneratedId("clip"))
        : applySingleClipSplit(clips, clipId, timelineTime, () => nextGeneratedId("clip"))
    return finish(next, commandId, {
      changedClipIds: linked && clip.linkGroupId ? linkedClipIdsFor(clips, clipId) : [clipId],
    })
  }

  if (type === "clip.delete") {
    const clipIds = Array.isArray(payload.clipIds) ? payload.clipIds : []
    if (clipIds.length === 0) return validationError(state, commandId, "No clip ids provided.")
    // Delete keeps legacy behavior: linked partners are removed together.
    // payload.expandLinked is accepted as an explicit no-op compatibility flag.
    const expanded = expandWithLinkedPartners(clips, clipIds)
    next.timeline.clips = payload.ripple
      ? rippleDeleteClips(clips, expanded)
      : clips.filter((clip) => !expanded.has(clip.id))
    ensureSelectionExists(next)
    next.selection.clipIds = next.selection.clipIds.filter((id) => !expanded.has(id))
    if (expanded.has(next.selection.primaryClipId)) {
      next.selection.primaryClipId = next.selection.clipIds[0] || null
    }
    return finish(next, commandId, { changedClipIds: [...expanded] })
  }

  const applyKeyframeChange = (clipId, updater) => {
    const clip = findClipById(clips, clipId)
    if (!clip) return { ok: false, error: `Clip not found: ${clipId}` }
    const nextClip = updater(clip)
    next.timeline.clips = clips.map((item) => (item.id === clipId ? nextClip : item))
    return { ok: true }
  }

  if (type === "keyframe.toggle") {
    const clipId = payload.clipId
    const time = Number(payload.time)
    const propertyKey = payload.propertyKey
    if (!propertyKey || !Number.isFinite(time)) {
      return validationError(state, commandId, "Invalid keyframe.toggle payload.")
    }
    const result = applyKeyframeChange(clipId, (clip) => ({
      ...clip,
      keyframes: toggleClipKeyframeAt({
        clip,
        propertyKey,
        time,
        fps: next.timeline.fps || PROJECT_FPS,
      }),
    }))
    if (!result.ok) return validationError(state, commandId, result.error)
    return finish(next, commandId, { changedClipIds: [clipId] })
  }

  if (type === "keyframe.set") {
    const { clipId, propertyKey, keyframe } = payload
    if (!clipId || !propertyKey || !keyframe) {
      return validationError(state, commandId, "Invalid keyframe.set payload.")
    }
    const result = applyKeyframeChange(clipId, (clip) => {
      const currentTrack = getClipPropertyTrack(clip, propertyKey)
      const nextTrack = addOrUpdateKeyframe(currentTrack, keyframe, next.timeline.fps || PROJECT_FPS)
      return { ...clip, keyframes: setClipPropertyTrack(clip, propertyKey, nextTrack) }
    })
    if (!result.ok) return validationError(state, commandId, result.error)
    return finish(next, commandId, { changedClipIds: [clipId] })
  }

  if (type === "keyframe.remove") {
    const { clipId, propertyKey, keyframeId, time } = payload
    if (!clipId || !propertyKey) {
      return validationError(state, commandId, "Invalid keyframe.remove payload.")
    }
    if (!keyframeId && !Number.isFinite(Number(time))) {
      return validationError(
        state,
        commandId,
        "keyframe.remove requires keyframeId or a finite time."
      )
    }
    const result = applyKeyframeChange(clipId, (clip) => {
      const currentTrack = getClipPropertyTrack(clip, propertyKey)
      const nextTrack = keyframeId
        ? removeKeyframe(currentTrack, keyframeId)
        : removeKeyframeAt(currentTrack, time, next.timeline.fps || PROJECT_FPS)
      return { ...clip, keyframes: setClipPropertyTrack(clip, propertyKey, nextTrack) }
    })
    if (!result.ok) return validationError(state, commandId, result.error)
    return finish(next, commandId, { changedClipIds: [clipId] })
  }

  if (type === "keyframe.move") {
    const { clipId, propertyKey, keyframeId, newTime } = payload
    if (!clipId || !propertyKey || !keyframeId || !Number.isFinite(Number(newTime))) {
      return validationError(state, commandId, "Invalid keyframe.move payload.")
    }
    const result = applyKeyframeChange(clipId, (clip) => {
      const currentTrack = getClipPropertyTrack(clip, propertyKey)
      const nextTrack = moveKeyframe(
        currentTrack,
        keyframeId,
        newTime,
        next.timeline.fps || PROJECT_FPS
      )
      return { ...clip, keyframes: setClipPropertyTrack(clip, propertyKey, nextTrack) }
    })
    if (!result.ok) return validationError(state, commandId, result.error)
    return finish(next, commandId, { changedClipIds: [clipId] })
  }

  if (type === "keyframe.groupSet") {
    const { clipId, groupId, time } = payload
    if (!clipId || !groupId || !Number.isFinite(Number(time))) {
      return validationError(state, commandId, "Invalid keyframe.groupSet payload.")
    }
    const result = applyKeyframeChange(clipId, (clip) => ({
      ...clip,
      keyframes: createGroupKeyframes({
        clip,
        groupId,
        time,
        fps: next.timeline.fps || PROJECT_FPS,
      }),
    }))
    if (!result.ok) return validationError(state, commandId, result.error)
    return finish(next, commandId, { changedClipIds: [clipId] })
  }

  return {
    state,
    events: [
      {
        type: "warning",
        payload: {
          commandId,
          message: `Unsupported command type: ${type}`,
        },
      },
    ],
  }
}

export const createInitialEngineState = ({
  fps = PROJECT_FPS,
  playhead = 0,
  tracks = [],
  clips = [],
} = {}) => ({
  version: 1,
  timeline: {
    fps,
    playhead: Math.max(0, Number(playhead) || 0),
    tracks: cloneTracks(tracks),
    clips: cloneClips(clips),
  },
  selection: {
    clipIds: [],
    primaryClipId: null,
  },
  history: {
    past: [],
    future: [],
  },
})

export const clipIdsFromSelection = (state) => {
  const selected = state?.selection?.clipIds || []
  return selected.filter(Boolean)
}

export const getClipDurationSafe = (clip) =>
  Math.max(MIN_CLIP_DURATION, clipDuration(clip))
