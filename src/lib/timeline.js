export const SNAP_THRESHOLD_PX = 8
export const MOVE_THRESHOLD_PX = 3
export const MIN_CLIP_DURATION = 0.05

export const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif']
export const VIDEO_EXTS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v']
export const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a']

export const clipDuration = (clip) => clip.outPoint - clip.inPoint

export const clipEnd = (clip) => clip.startTime + clipDuration(clip)

let _linkCounter = 0
export const nextLinkGroupId = () => `lg-${++_linkCounter}`

const TIMELINE_EPSILON = 1e-3

const sourceAtTimelineTime = (clip, timelineTime) => clip.inPoint + (timelineTime - clip.startTime)

const mergeTimeRanges = (ranges) => {
  const sorted = ranges
    .map(([start, end]) => [
      Number.isFinite(start) ? start : 0,
      Number.isFinite(end) ? end : 0,
    ])
    .map(([start, end]) => [start, Math.max(start, end)])
    .filter(([start, end]) => end > start + TIMELINE_EPSILON)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])

  const merged = []
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1] + TIMELINE_EPSILON) {
      last[1] = Math.max(last[1], end)
    } else {
      merged.push([start, end])
    }
  }
  return merged
}

export const getMediaType = (nameOrPath) => {
  const ext = (nameOrPath.split('.').pop() || '').toLowerCase()
  if (IMAGE_EXTS.includes(ext)) return 'image'
  if (AUDIO_EXTS.includes(ext)) return 'audio'
  return 'video'
}

export const normalizeSourceSelection = ({
  media,
  probedDuration,
  savedRange,
  defaultImageDuration = 3,
  fallbackVideoDuration = 5,
}) => {
  if (!media) {
    return {
      inPoint: 0,
      outPoint: fallbackVideoDuration,
      duration: fallbackVideoDuration,
      clipDuration: fallbackVideoDuration,
    }
  }

  const fallback = media.mediaType === 'image' ? defaultImageDuration : fallbackVideoDuration
  const duration = Math.max(MIN_CLIP_DURATION, probedDuration || fallback)
  const maxIn = Math.max(0, duration - MIN_CLIP_DURATION)
  const inPoint = Math.max(0, Math.min(maxIn, savedRange?.inPoint ?? 0))
  const outPoint = Math.max(
    inPoint + MIN_CLIP_DURATION,
    Math.min(duration, savedRange?.outPoint ?? duration)
  )

  return { inPoint, outPoint, duration, clipDuration: outPoint - inPoint }
}

export const constrainMoveStart = (desired, dur, others) => {
  const safeDur = Number.isFinite(dur) ? Math.max(0, dur) : 0
  const sorted = mergeTimeRanges(others.map((o) => [o.startTime, clipEnd(o)]))
  const gaps = []
  let prevEnd = 0
  for (const [oS, oE] of sorted) {
    if (oS - prevEnd >= safeDur - TIMELINE_EPSILON) {
      gaps.push([prevEnd, Math.max(prevEnd, oS - safeDur)])
    }
    prevEnd = Math.max(prevEnd, oE)
  }
  gaps.push([prevEnd, Infinity])
  let best = desired
  let bestDist = Infinity
  for (const [lo, hi] of gaps) {
    const candidate = Math.max(lo, Math.min(hi, desired))
    const distance = Math.abs(candidate - desired)
    if (distance < bestDist) {
      bestDist = distance
      best = candidate
    }
  }
  return Math.max(0, best)
}

export const minStartForTrimLeft = (fixedRight, others) => {
  let limit = 0
  for (const clip of others) {
    const end = clipEnd(clip)
    if (end <= fixedRight + 1e-3 && end > limit) limit = end
  }
  return limit
}

export const maxEndForTrimRight = (fixedLeft, others) => {
  let limit = Infinity
  for (const clip of others) {
    if (clip.startTime >= fixedLeft - 1e-3 && clip.startTime < limit) limit = clip.startTime
  }
  return limit
}

export const detectInsertPoint = (excludeId, center, dur, snapshot) => {
  const others = snapshot
    .filter((clip) => clip.id !== excludeId)
    .sort((a, b) => a.startTime - b.startTime || clipEnd(a) - clipEnd(b))
  for (const clip of others) {
    const end = clipEnd(clip)
    if (Math.abs(center - clip.startTime) <= TIMELINE_EPSILON) {
      return { insertPoint: clip.startTime }
    }
    if (Math.abs(center - end) <= TIMELINE_EPSILON) {
      return { insertPoint: end }
    }
    if (center > clip.startTime && center < end) {
      const clipCenter = (clip.startTime + end) / 2
      return { insertPoint: center < clipCenter ? clip.startTime : end }
    }
  }

  let leftEnd = 0
  let rightStart = Infinity
  for (const clip of others) {
    const end = clipEnd(clip)
    if (end <= center + 1e-3 && end > leftEnd) leftEnd = end
    if (clip.startTime > center - 1e-3 && clip.startTime < rightStart) rightStart = clip.startTime
  }
  if (rightStart < Infinity && rightStart - leftEnd < dur - 1e-3) {
    const gapCenter = (leftEnd + rightStart) / 2
    return { insertPoint: center < gapCenter ? leftEnd : rightStart }
  }
  return null
}

export const applyRippleInsert = (snapshot, draggedId, insertPoint, dur) => {
  return snapshot.map((clip) => {
    if (clip.id === draggedId) return { ...clip, startTime: insertPoint }
    if (clip.startTime >= insertPoint - 1e-3) return { ...clip, startTime: clip.startTime + dur }
    return clip
  })
}

export const findGapAtTime = (time, list) => {
  const sorted = [...list].sort((a, b) => a.startTime - b.startTime)
  let prevEnd = 0
  for (const clip of sorted) {
    if (time < clip.startTime - 1e-3) {
      return { start: prevEnd, end: clip.startTime }
    }
    const end = clipEnd(clip)
    if (time < end) return null
    prevEnd = Math.max(prevEnd, end)
  }
  return null
}

export const findTimelineSpaceAtTime = (time, list, tailDuration = 2) => {
  const sorted = [...list].sort((a, b) => a.startTime - b.startTime)
  let prevEnd = 0
  for (const clip of sorted) {
    if (time < clip.startTime - 1e-3) {
      return { start: prevEnd, end: clip.startTime, type: 'gap' }
    }
    const end = clipEnd(clip)
    if (time < end - 1e-3) return null
    prevEnd = Math.max(prevEnd, end)
  }
  const tailStart = prevEnd
  const tailEnd = Math.max(tailStart + tailDuration, time + tailDuration)
  return { start: tailStart, end: tailEnd, type: 'tail' }
}

export const closeGap = (list, gap) => {
  const dur = gap.end - gap.start
  if (dur <= 0) return list
  return list.map((clip) =>
    clip.startTime >= gap.end - 1e-3
      ? { ...clip, startTime: clip.startTime - dur }
      : clip
  )
}

export const rippleDeleteClips = (list, idsToDelete) => {
  const ids = idsToDelete instanceof Set ? idsToDelete : new Set(idsToDelete)
  const removed = list.filter((clip) => ids.has(clip.id))
  const remaining = list.filter((clip) => !ids.has(clip.id))
  const removedRanges = mergeTimeRanges(
    removed.map((clip) => [clip.startTime, clip.startTime + Math.max(0, clipDuration(clip))])
  )
  return remaining.map((clip) => {
    let shift = 0
    for (const [start, end] of removedRanges) {
      if (start >= clip.startTime - TIMELINE_EPSILON) break
      const shiftedEnd = Math.min(end, clip.startTime)
      if (shiftedEnd > start + TIMELINE_EPSILON) shift += shiftedEnd - start
    }
    return { ...clip, startTime: Math.max(0, clip.startTime - shift) }
  })
}

export const resolveOverlaps = (clipList, modifiedId, makeId, protectedIds) => {
  const moved = clipList.find((clip) => clip.id === modifiedId)
  if (!moved) return clipList

  const protect = protectedIds || null
  const movedStart = moved.startTime
  const movedEnd = clipEnd(moved)
  const out = []

  for (const clip of clipList) {
    if (clip.id === modifiedId) {
      out.push(clip)
      continue
    }
    if (protect && protect.has(clip.id)) {
      out.push(clip)
      continue
    }

    const start = clip.startTime
    const end = clipEnd(clip)
    if (end <= movedStart + 1e-3 || start >= movedEnd - 1e-3) {
      out.push(clip)
      continue
    }
    if (movedStart <= start + 1e-3 && movedEnd >= end - 1e-3) continue
    if (start < movedStart - 1e-3 && end > movedEnd + 1e-3) {
      const left = { ...clip, outPoint: sourceAtTimelineTime(clip, movedStart) }
      const right = { ...clip, id: makeId(), inPoint: sourceAtTimelineTime(clip, movedEnd), startTime: movedEnd }
      if (clipDuration(left) > MIN_CLIP_DURATION) out.push(left)
      if (clipDuration(right) > MIN_CLIP_DURATION) out.push(right)
      continue
    }
    if (start >= movedStart - 1e-3 && start < movedEnd - 1e-3) {
      const nextClip = { ...clip, inPoint: sourceAtTimelineTime(clip, movedEnd), startTime: movedEnd }
      if (clipDuration(nextClip) > MIN_CLIP_DURATION) out.push(nextClip)
      continue
    }
    if (end > movedStart + 1e-3 && end <= movedEnd + 1e-3) {
      const nextClip = { ...clip, outPoint: sourceAtTimelineTime(clip, movedStart) }
      if (clipDuration(nextClip) > MIN_CLIP_DURATION) out.push(nextClip)
      continue
    }
    out.push(clip)
  }
  return out
}

export const resolveOverlapsMulti = (clipList, modifierIds, makeId) => {
  const ids = modifierIds instanceof Set ? modifierIds : new Set(modifierIds)
  let result = clipList
  for (const id of ids) {
    result = resolveOverlaps(result, id, makeId, ids)
  }
  return result
}

// -------------- Linked-Clip helpers (Filmora/DaVinci-style V+A linking) --------------

export const isAudioOnlyMedia = (nameOrPath) => {
  const ext = (nameOrPath.split('.').pop() || '').toLowerCase()
  return AUDIO_EXTS.includes(ext)
}

// Build a primary clip object from a source selection.
const buildClip = ({ id, media, startTime, inPoint, outPoint, sourceDuration, trackId, trackMode, linkGroupId }) => ({
  id,
  videoId: media.id,
  name: media.name,
  src: media.src,
  sourceDuration,
  inPoint,
  outPoint,
  startTime,
  trackMode,
  trackId,
  linkGroupId: linkGroupId || null,
})

/**
 * Create one or two clips for a dropped media item.
 *
 * Inputs
 *   - media: { id, name, src, mediaType }
 *   - selection: { inPoint, outPoint, duration }
 *   - startTime: placement on the timeline
 *   - videoClipId / audioClipId: pre-generated ids (caller allocates so ripple snapshots stay stable)
 *   - videoTrackId / audioTrackId: target track ids (pass null to skip that side)
 *   - trackMode: 'av' | 'video' | 'audio'
 *   - hasAudio: boolean (if false, no audio clip is produced, even for 'av')
 *   - linkGroupIdFactory: () => string, used when both clips are produced
 *
 * Returns an array of 0..2 clip objects. The video clip goes first when both are produced.
 */
export const splitMediaIntoLinkedClips = ({
  media,
  selection,
  startTime,
  videoClipId,
  audioClipId,
  videoTrackId,
  audioTrackId,
  trackMode = 'av',
  hasAudio = true,
  linkGroupIdFactory = nextLinkGroupId,
}) => {
  if (!media || !selection) return []

  const inPoint = selection.inPoint
  const outPoint = selection.outPoint
  const sourceDuration = selection.duration

  // Images never get an audio partner
  const mediaType = media.mediaType || 'video'
  const canHaveAudio = mediaType !== 'image' && hasAudio

  // Audio-only drop: produce a single audio clip (caller must supply audioTrackId)
  if (trackMode === 'audio') {
    if (!audioTrackId) return []
    return [buildClip({
      id: audioClipId || videoClipId,
      media, startTime, inPoint, outPoint, sourceDuration,
      trackId: audioTrackId,
      trackMode: 'audio',
      linkGroupId: null,
    })]
  }

  // Video-only drop, or AV drop where the source has no audio track: single video clip
  if (trackMode === 'video' || !canHaveAudio || !audioTrackId) {
    if (!videoTrackId) return []
    return [buildClip({
      id: videoClipId,
      media, startTime, inPoint, outPoint, sourceDuration,
      trackId: videoTrackId,
      trackMode: 'video',
      linkGroupId: null,
    })]
  }

  // AV drop with audio: produce linked video + audio pair
  const linkGroupId = linkGroupIdFactory()
  const videoClip = buildClip({
    id: videoClipId,
    media, startTime, inPoint, outPoint, sourceDuration,
    trackId: videoTrackId,
    trackMode: 'video',
    linkGroupId,
  })
  const audioClip = buildClip({
    id: audioClipId,
    media, startTime, inPoint, outPoint, sourceDuration,
    trackId: audioTrackId,
    trackMode: 'audio',
    linkGroupId,
  })
  return [videoClip, audioClip]
}

/** Given a clip id, return the Set of ids that share its linkGroupId (includes the clip itself). */
export const getLinkedClipIds = (clips, clipId) => {
  const clip = clips.find((c) => c.id === clipId)
  if (!clip) return new Set([clipId])
  if (!clip.linkGroupId) return new Set([clipId])
  const linked = clips.filter((c) => c.linkGroupId === clip.linkGroupId)
  return new Set(linked.map((c) => c.id))
}

/** Expand a set of ids to include their link-group partners. Never returns an empty set if `ids` is non-empty. */
export const expandWithLinkedPartners = (clips, ids) => {
  const input = ids instanceof Set ? ids : new Set(ids || [])
  if (input.size === 0) return new Set()
  const groupIds = new Set()
  for (const clip of clips) {
    if (clip.linkGroupId && input.has(clip.id)) groupIds.add(clip.linkGroupId)
  }
  const out = new Set(input)
  for (const clip of clips) {
    if (clip.linkGroupId && groupIds.has(clip.linkGroupId)) out.add(clip.id)
  }
  return out
}

/** Shift every clip in the same link group as `primaryId` by `deltaSec`. Pure. */
export const applyGroupShift = (clips, primaryId, deltaSec) => {
  const groupIds = getLinkedClipIds(clips, primaryId)
  return clips.map((c) => (groupIds.has(c.id)
    ? { ...c, startTime: Math.max(0, c.startTime + deltaSec) }
    : c))
}

/** Apply a trim-left change to the primary clip and propagate to link partners. */
export const applyGroupTrimLeft = (clips, primaryId, { inPoint, startTime }) => {
  const primary = clips.find((c) => c.id === primaryId)
  if (!primary) return clips
  const groupIds = getLinkedClipIds(clips, primaryId)
  return clips.map((c) => {
    if (!groupIds.has(c.id)) return c
    const clampedIn = Math.max(0, Math.min(c.outPoint - MIN_CLIP_DURATION, inPoint))
    return { ...c, inPoint: clampedIn, startTime: Math.max(0, startTime) }
  })
}

/** Apply a trim-right change to the primary clip and propagate to link partners. */
export const applyGroupTrimRight = (clips, primaryId, { outPoint }) => {
  const primary = clips.find((c) => c.id === primaryId)
  if (!primary) return clips
  const groupIds = getLinkedClipIds(clips, primaryId)
  return clips.map((c) => {
    if (!groupIds.has(c.id)) return c
    const clampedOut = Math.max(c.inPoint + MIN_CLIP_DURATION, Math.min(c.sourceDuration || outPoint, outPoint))
    return { ...c, outPoint: clampedOut }
  })
}

/** Remove linkGroupId from all clips in the group of `primaryId`. Pure. */
export const unlinkClipGroup = (clips, primaryId) => {
  const groupIds = getLinkedClipIds(clips, primaryId)
  return clips.map((c) => (groupIds.has(c.id) ? { ...c, linkGroupId: null } : c))
}

/**
 * Split every clip in the primary clip's link group at the given timeline time.
 * Each pair of left/right halves shares a new linkGroupId, preserving link integrity.
 */
export const applyGroupSplit = (clips, primaryId, timelineTime, makeId, linkGroupIdFactory = nextLinkGroupId) => {
  const primary = clips.find((c) => c.id === primaryId)
  if (!primary) return clips
  const groupIds = getLinkedClipIds(clips, primaryId)
  const targets = clips.filter((c) => groupIds.has(c.id)
    && timelineTime > c.startTime + MIN_CLIP_DURATION
    && timelineTime < clipEnd(c) - MIN_CLIP_DURATION)
  if (targets.length === 0) return clips

  // Right halves of a linked split get a new shared linkGroupId so later operations keep them in sync.
  const rightGroupId = primary.linkGroupId ? linkGroupIdFactory() : null

  const out = []
  for (const c of clips) {
    const target = targets.find((t) => t.id === c.id)
    if (!target) { out.push(c); continue }
    const sourceSplit = c.inPoint + (timelineTime - c.startTime)
    const left = { ...c, outPoint: sourceSplit }
    const right = {
      ...c,
      id: makeId(),
      inPoint: sourceSplit,
      startTime: timelineTime,
      linkGroupId: rightGroupId,
    }
    if (clipDuration(left) > MIN_CLIP_DURATION) out.push(left)
    if (clipDuration(right) > MIN_CLIP_DURATION) out.push(right)
  }
  return out
}
