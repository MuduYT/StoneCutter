export const SNAP_THRESHOLD_PX = 8
export const MOVE_THRESHOLD_PX = 3
export const MIN_CLIP_DURATION = 0.05

export const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif']
export const VIDEO_EXTS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v']

export const clipDuration = (clip) => clip.outPoint - clip.inPoint

export const clipEnd = (clip) => clip.startTime + clipDuration(clip)

export const getMediaType = (nameOrPath) => {
  const ext = (nameOrPath.split('.').pop() || '').toLowerCase()
  if (IMAGE_EXTS.includes(ext)) return 'image'
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
  const sorted = others
    .map((o) => [o.startTime, clipEnd(o)])
    .sort((a, b) => a[0] - b[0])
  const gaps = []
  let prevEnd = 0
  for (const [oS, oE] of sorted) {
    if (oS - prevEnd >= dur - 1e-3) gaps.push([prevEnd, oS - dur])
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
  const others = snapshot.filter((clip) => clip.id !== excludeId)
  for (const clip of others) {
    const end = clipEnd(clip)
    if (center >= clip.startTime && center <= end) {
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
  return remaining.map((clip) => {
    let shift = 0
    for (const removedClip of removed) {
      if (removedClip.startTime < clip.startTime - 1e-3) shift += clipDuration(removedClip)
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
      const left = { ...clip, outPoint: clip.inPoint + (movedStart - start) }
      const right = { ...clip, id: makeId(), inPoint: clip.inPoint + (movedEnd - start), startTime: movedEnd }
      if (clipDuration(left) > MIN_CLIP_DURATION) out.push(left)
      if (clipDuration(right) > MIN_CLIP_DURATION) out.push(right)
      continue
    }
    if (start >= movedStart - 1e-3 && start < movedEnd - 1e-3) {
      const nextClip = { ...clip, inPoint: clip.inPoint + (movedEnd - start), startTime: movedEnd }
      if (clipDuration(nextClip) > MIN_CLIP_DURATION) out.push(nextClip)
      continue
    }
    if (end > movedStart + 1e-3 && end <= movedEnd + 1e-3) {
      const nextClip = { ...clip, outPoint: clip.outPoint - (end - movedStart) }
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
