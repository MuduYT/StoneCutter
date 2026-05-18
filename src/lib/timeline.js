import { shiftKeyframeMap } from './keyframes.js'

export const SNAP_THRESHOLD_PX = 8
export const MOVE_THRESHOLD_PX = 3
export const MIN_CLIP_DURATION = 0.05
export const DEFAULT_TIMELINE_RULER_HEIGHT = 30
export const TIMELINE_DIVIDER_HEIGHT = 8
export const CLIP_VERTICAL_INSET = 4
export const TRIM_HOTSPOT_WIDTH = 14
export const TRIM_HOTSPOT_HEIGHT = 22
export const FADE_HANDLE_WIDTH = 16
export const FADE_HANDLE_HEIGHT = 22

export const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif']
export const VIDEO_EXTS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v']
export const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a']

export const clipDuration = (clip) => {
  if (!clip || !Number.isFinite(clip.outPoint) || !Number.isFinite(clip.inPoint)) {
    return 0;
  }
  return clip.outPoint - clip.inPoint;
}

export const clipEnd = (clip) => clip.startTime + clipDuration(clip)

/** Max gap (seconds) between clip end and next clip start to show a crossfade handle. */
export const ADJACENT_CROSSFADE_MAX_GAP_SEC = 0.5

/**
 * Max crossfade duration for a left/right clip pair (matches timeline mouse interaction).
 */
export const computeCrossfadeMaxDuration = (leftClip, rightClip) => {
  const leftDuration = Math.max(MIN_CLIP_DURATION, clipDuration(leftClip))
  const rightDuration = Math.max(MIN_CLIP_DURATION, clipDuration(rightClip))
  const leftEnd = leftClip.startTime + leftDuration
  const gapBetweenClips = rightClip.startTime - leftEnd
  return Math.max(
    0.05,
    Math.min(
      leftDuration * 0.5,
      rightDuration * 0.5,
      gapBetweenClips + Math.min(leftDuration, rightDuration) * 0.5,
    ),
  )
}

/**
 * Horizontal position of the crossfade handle on the left clip (seconds from clip start).
 */
export const getCrossfadeHandleOffsetSec = (leftClip, rightClip) => {
  const leftDur = clipDuration(leftClip)
  const leftEnd = clipEnd(leftClip)
  const boundaryTime = (leftEnd + rightClip.startTime) / 2
  return Math.max(0, Math.min(leftDur, boundaryTime - leftClip.startTime))
}

/**
 * Audio-clip pairs on the same track that are near or overlapping (eligible for crossfade UI).
 */
export const findAdjacentAudioClipPairs = (
  clips = [],
  tracks = [],
  { maxGapSec = ADJACENT_CROSSFADE_MAX_GAP_SEC } = {},
) => {
  const audioTrackIds = new Set(
    (tracks || []).filter((t) => t?.type === 'audio').map((t) => t.id),
  )
  const byTrack = new Map()
  for (const clip of clips || []) {
    if (!clip || clip.kind === 'text') continue
    if (!audioTrackIds.has(clip.trackId)) continue
    if (!byTrack.has(clip.trackId)) byTrack.set(clip.trackId, [])
    byTrack.get(clip.trackId).push(clip)
  }

  const pairs = []
  for (const trackClips of byTrack.values()) {
    trackClips.sort((a, b) => a.startTime - b.startTime || clipEnd(a) - clipEnd(b))
    for (let i = 0; i < trackClips.length - 1; i += 1) {
      const leftClip = trackClips[i]
      const rightClip = trackClips[i + 1]
      const gap = rightClip.startTime - clipEnd(leftClip)
      if (gap > maxGapSec) continue
      const maxDuration = computeCrossfadeMaxDuration(leftClip, rightClip)
      if (maxDuration < 0.05) continue
      pairs.push({
        leftClip,
        rightClip,
        maxDuration,
        handleOffsetSec: getCrossfadeHandleOffsetSec(leftClip, rightClip),
      })
    }
  }
  return pairs
}

export const isClipTrackLocked = (clip, tracks = []) => {
  if (!clip) return false
  const track = tracks instanceof Map
    ? tracks.get(clip.trackId)
    : (tracks || []).find((item) => item?.id === clip.trackId)
  return Boolean(track?.locked)
}

export const getTrackHeight = (track, defaultTrackHeight = 80) => {
  const height = Number(track?.height)
  return Number.isFinite(height) && height > 0 ? height : defaultTrackHeight
}

export const buildTrackVerticalBounds = (tracks = [], defaultTrackHeight = 80, trackTopOffset = 30) => {
  const bounds = new Map()
  const videoTracks = (tracks || []).filter((t) => t.type === 'video')
  const audioTracks = (tracks || []).filter((t) => t.type === 'audio')

  let top = trackTopOffset
  for (const track of videoTracks) {
    const height = getTrackHeight(track, defaultTrackHeight)
    bounds.set(track.id, { top, bottom: top + height, height })
    top += height
  }
  top += TIMELINE_DIVIDER_HEIGHT
  for (const track of audioTracks) {
    const height = getTrackHeight(track, defaultTrackHeight)
    bounds.set(track.id, { top, bottom: top + height, height })
    top += height
  }
  return bounds
}

export const buildTrackLayoutRows = (tracks = [], defaultTrackHeight = 80) =>
  (tracks || []).map((track) => ({ track, height: getTrackHeight(track, defaultTrackHeight) }))

export const getTimelineClipVisualBounds = (trackBounds, clip, inset = CLIP_VERTICAL_INSET) => {
  const bounds = trackBounds.get(clip?.trackId)
  if (!bounds) return null
  const safeInset = Math.max(0, Math.min(bounds.height / 2, Number(inset) || 0))
  return {
    top: bounds.top + safeInset,
    bottom: bounds.bottom - safeInset,
    height: Math.max(0, bounds.height - safeInset * 2),
  }
}

export const getMarqueeSelectedClipIds = ({
  clips = [],
  tracks = [],
  pxPerSec = 1,
  rect,
  additive = false,
  initialSelection = [],
  defaultTrackHeight = 80,
  trackTopOffset = 30,
}) => {
  const x1 = Math.min(rect?.x1 ?? 0, rect?.x2 ?? 0)
  const x2 = Math.max(rect?.x1 ?? 0, rect?.x2 ?? 0)
  const y1 = Math.min(rect?.y1 ?? 0, rect?.y2 ?? 0)
  const y2 = Math.max(rect?.y1 ?? 0, rect?.y2 ?? 0)
  const hits = new Set(additive ? Array.from(initialSelection || []) : [])
  const trackBounds = buildTrackVerticalBounds(tracks, defaultTrackHeight, trackTopOffset)
  const pixelsPerSecond = Number(pxPerSec) > 0 ? Number(pxPerSec) : 1
  for (const clip of clips || []) {
    const bounds = getTimelineClipVisualBounds(trackBounds, clip)
    if (!bounds) continue
    const clipX1 = (Number(clip.startTime) || 0) * pixelsPerSecond
    const clipX2 = ((Number(clip.startTime) || 0) + clipDuration(clip)) * pixelsPerSecond
    if (clipX2 > x1 + 1e-3 && clipX1 < x2 - 1e-3 && bounds.bottom > y1 + 1e-3 && bounds.top < y2 - 1e-3) {
      hits.add(clip.id)
    }
  }
  return hits
}

export const getMiddlePanScroll = ({
  startClientX = 0,
  startClientY = 0,
  scrollStartLeft = 0,
  scrollStartTop = 0,
  clientX = 0,
  clientY = 0,
  maxScrollLeft = Number.MAX_SAFE_INTEGER,
  maxScrollTop = Number.MAX_SAFE_INTEGER,
}) => ({
  left: Math.max(0, Math.min(maxScrollLeft, scrollStartLeft - (clientX - startClientX))),
  top: Math.max(0, Math.min(maxScrollTop, scrollStartTop - (clientY - startClientY))),
})

/** Corner hit metrics for fade handles; shrinks on very narrow clips to avoid overlap. */
export const getTimelineFadeHandleMetrics = (clipRect, side = 'left') => {
  const rectWidth = clipRect?.width ?? (clipRect ? clipRect.right - clipRect.left : 0)
  const rectHeight = clipRect?.height ?? (clipRect ? clipRect.bottom - clipRect.top : 0)
  const maxPairWidth = Math.max(16, rectWidth - 4)
  const sizeScale = 0.6
  const width = Math.max(8, Math.min(FADE_HANDLE_WIDTH * sizeScale, maxPairWidth / 2))
  const height = Math.max(8, Math.min(FADE_HANDLE_HEIGHT * sizeScale, rectHeight))
  return { width, height }
}

export const isTimelineFadeHotspot = ({
  clientX,
  clientY,
  clipRect,
  side,
  width = FADE_HANDLE_WIDTH,
  height = FADE_HANDLE_HEIGHT,
}) => {
  if (!clipRect || (side !== 'left' && side !== 'right')) return false
  const metrics = getTimelineFadeHandleMetrics(clipRect, side)
  const hotspotWidth = Math.min(Number(width) || metrics.width, metrics.width)
  const hotspotHeight = Math.min(Number(height) || metrics.height, metrics.height)
  const withinY = clientY >= clipRect.top && clientY <= clipRect.top + hotspotHeight
  if (!withinY) return false
  if (side === 'left') {
    return clientX >= clipRect.left && clientX <= clipRect.left + hotspotWidth
  }
  return clientX <= clipRect.right && clientX >= clipRect.right - hotspotWidth
}

/** Trim uses the vertical clip edge below the top fade-handle band. */
export const isTimelineTrimHotspot = ({
  clientX,
  clientY,
  clipRect,
  side,
  width = TRIM_HOTSPOT_WIDTH,
  fadeHandleHeight = FADE_HANDLE_HEIGHT,
}) => {
  if (!clipRect || (side !== 'left' && side !== 'right')) return false
  const rectWidth = clipRect.width ?? clipRect.right - clipRect.left
  const rectHeight = clipRect.height ?? clipRect.bottom - clipRect.top
  const hotspotWidth = Math.max(8, Math.min(Number(width) || TRIM_HOTSPOT_WIDTH, rectWidth))
  const fadeBand = Math.max(
    getTimelineFadeHandleMetrics(clipRect, 'left').height,
    getTimelineFadeHandleMetrics(clipRect, 'right').height,
  )
  const trimZoneTop = clipRect.top + Math.min(fadeBand, rectHeight * 0.45)
  const withinY = clientY >= trimZoneTop && clientY <= clipRect.bottom
  if (!withinY) return false
  if (side === 'left') {
    return clientX >= clipRect.left && clientX <= clipRect.left + hotspotWidth
  }
  return clientX <= clipRect.right && clientX >= clipRect.right - hotspotWidth
}

/** Clamp fadeIn/fadeOut to [0, duration] with combined length <= duration. */
export const clampFadeValues = ({
  duration,
  fadeIn = 0,
  fadeOut = 0,
  side,
  nextValue,
}) => {
  const dur = Math.max(MIN_CLIP_DURATION, Number(duration) || 0)
  let fadeInVal = Math.max(0, Number(fadeIn) || 0)
  let fadeOutVal = Math.max(0, Number(fadeOut) || 0)
  if (side === 'in') fadeInVal = Math.max(0, Number(nextValue) || 0)
  if (side === 'out') fadeOutVal = Math.max(0, Number(nextValue) || 0)
  fadeInVal = Math.min(fadeInVal, dur)
  fadeOutVal = Math.min(fadeOutVal, dur)
  if (fadeInVal + fadeOutVal > dur) {
    if (side === 'in') fadeInVal = Math.max(0, dur - fadeOutVal)
    else if (side === 'out') fadeOutVal = Math.max(0, dur - fadeInVal)
    else {
      const scale = dur / Math.max(MIN_CLIP_DURATION, fadeInVal + fadeOutVal)
      fadeInVal *= scale
      fadeOutVal *= scale
    }
  }
  return { fadeIn: fadeInVal, fadeOut: fadeOutVal }
}

const hasFadeValue = (clip, key) =>
  Object.prototype.hasOwnProperty.call(clip || {}, key) || Number(clip?.[key]) > 0

/**
 * Keep fade boundaries stable on the timeline when a clip edge is trimmed.
 * The stored model remains edge-relative, so we rewrite the relative value
 * instead of introducing a second fade timeline state.
 */
export const preserveFadeTimingOnTrim = (beforeClip, nextClip, side) => {
  if (!beforeClip || !nextClip) return nextClip
  const hasFadeIn = hasFadeValue(beforeClip, 'fadeIn')
  const hasFadeOut = hasFadeValue(beforeClip, 'fadeOut')
  if (!hasFadeIn && !hasFadeOut) return nextClip

  const beforeStart = Number(beforeClip.startTime) || 0
  const nextStart = Number(nextClip.startTime) || 0
  const beforeEnd = clipEnd(beforeClip)
  const nextEnd = clipEnd(nextClip)
  let fadeIn = Math.max(0, Number(beforeClip.fadeIn) || 0)
  let fadeOut = Math.max(0, Number(beforeClip.fadeOut) || 0)

  if (side === 'left') {
    fadeIn = Math.max(0, fadeIn - (nextStart - beforeStart))
  } else if (side === 'right') {
    fadeOut = Math.max(0, fadeOut + (nextEnd - beforeEnd))
  }

  const clamped = clampFadeValues({
    duration: clipDuration(nextClip),
    fadeIn,
    fadeOut,
    side: side === 'left' ? 'in' : 'out',
    nextValue: side === 'left' ? fadeIn : fadeOut,
  })
  return {
    ...nextClip,
    fadeIn: clamped.fadeIn,
    fadeOut: clamped.fadeOut,
  }
}

const getVisibleFadeDuration = (fadeStart, fadeEnd, clipStart, clipEnd) =>
  Math.max(0, Math.min(fadeEnd, clipEnd) - Math.max(fadeStart, clipStart))

/**
 * Rebase original timeline fade ranges onto a newly cut clip segment.
 * Fades stay edge-relative in the data model, but the visible duration is
 * clipped to the segment so split/overwrite cuts cannot draw cross-clip shapes.
 */
export const clipFadesToVisibleSegment = (sourceClip, segmentClip) => {
  if (!sourceClip || !segmentClip) return segmentClip
  const sourceStart = Number(sourceClip.startTime) || 0
  const sourceEnd = clipEnd(sourceClip)
  const segmentStart = Number(segmentClip.startTime) || 0
  const segmentEnd = clipEnd(segmentClip)
  const sourceFadeIn = Math.max(0, Number(sourceClip.fadeIn) || 0)
  const sourceFadeOut = Math.max(0, Number(sourceClip.fadeOut) || 0)

  const fadeIn = sourceFadeIn > 0
    ? getVisibleFadeDuration(
        sourceStart,
        sourceStart + sourceFadeIn,
        segmentStart,
        segmentEnd,
      )
    : 0
  const fadeOut = sourceFadeOut > 0
    ? getVisibleFadeDuration(
        sourceEnd - sourceFadeOut,
        sourceEnd,
        segmentStart,
        segmentEnd,
      )
    : 0

  const clamped = clampFadeValues({
    duration: clipDuration(segmentClip),
    fadeIn,
    fadeOut,
  })
  return {
    ...segmentClip,
    fadeIn: clamped.fadeIn,
    fadeOut: clamped.fadeOut,
  }
}

export const duplicateClipsAfterSelection = ({ clips = [], clipIds = [], makeId }) => {
  const ids = clipIds instanceof Set ? [...clipIds] : Array.isArray(clipIds) ? clipIds : [clipIds]
  const selectedSet = new Set(ids.filter(Boolean))
  const selected = clips
    .filter((clip) => selectedSet.has(clip.id))
    .sort((a, b) => a.startTime - b.startTime || clipEnd(a) - clipEnd(b))
  if (selected.length === 0 || typeof makeId !== 'function') {
    return { duplicatedClips: [], duplicatedClipIds: [], idMap: new Map() }
  }

  const groupStart = Math.min(...selected.map((clip) => clip.startTime))
  const groupEnd = Math.max(...selected.map((clip) => clipEnd(clip)))
  let delta = Math.max(MIN_CLIP_DURATION, groupEnd - groupStart)
  const blockers = clips.filter((clip) => !selectedSet.has(clip.id))

  for (let guard = 0; guard < 1000; guard += 1) {
    let shift = 0
    for (const clip of selected) {
      const nextStart = clip.startTime + delta
      const nextEnd = nextStart + clipDuration(clip)
      for (const blocker of blockers) {
        if (blocker.trackId !== clip.trackId) continue
        const blockerStart = blocker.startTime
        const blockerEnd = clipEnd(blocker)
        if (nextEnd > blockerStart + TIMELINE_EPSILON && nextStart < blockerEnd - TIMELINE_EPSILON) {
          shift = Math.max(shift, blockerEnd - nextStart)
        }
      }
    }
    if (shift <= TIMELINE_EPSILON) break
    delta += shift
  }

  const idMap = new Map()
  const duplicatedClips = selected.map((clip) => {
    const id = makeId()
    idMap.set(clip.id, id)
    return {
      ...clip,
      id,
      startTime: clip.startTime + delta,
      keyframes: shiftKeyframeMap(clip.keyframes, delta),
    }
  })
  return { duplicatedClips, duplicatedClipIds: duplicatedClips.map((clip) => clip.id), idMap, delta }
}

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

export const isTimelineImageClip = (clip) => {
  if (!clip) return false
  if (clip.mediaType === 'image' || clip.sourceMediaType === 'image') return true
  const nameOrPath = clip.src || clip.path || clip.name || ''
  return Boolean(nameOrPath) && getMediaType(String(nameOrPath)) === 'image'
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
  gaps.push([prevEnd, Number.MAX_SAFE_INTEGER])
  let best = desired
  let bestDist = Number.MAX_SAFE_INTEGER
  for (const [lo, hi] of gaps) {
    const candidate = Math.max(lo, Math.min(hi, desired))
    const distance = Math.abs(candidate - desired)
    if (distance < bestDist) {
      bestDist = distance
      best = candidate
    }
  }
  return Math.max(0, Number.isFinite(best) ? best : desired)
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
  let limit = Number.MAX_SAFE_INTEGER
  for (const clip of others) {
    if (clip.startTime >= fixedLeft - 1e-3 && clip.startTime < limit) limit = clip.startTime
  }
  return Number.isFinite(limit) ? limit : Number.MAX_SAFE_INTEGER
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
      const left = clipFadesToVisibleSegment(clip, {
        ...clip,
        outPoint: sourceAtTimelineTime(clip, movedStart),
      })
      const right = clipFadesToVisibleSegment(clip, {
        ...clip,
        id: makeId(),
        inPoint: sourceAtTimelineTime(clip, movedEnd),
        startTime: movedEnd,
      })
      if (clipDuration(left) > MIN_CLIP_DURATION) out.push(left)
      if (clipDuration(right) > MIN_CLIP_DURATION) out.push(right)
      continue
    }
    if (start >= movedStart - 1e-3 && start < movedEnd - 1e-3) {
      const nextClip = clipFadesToVisibleSegment(clip, {
        ...clip,
        inPoint: sourceAtTimelineTime(clip, movedEnd),
        startTime: movedEnd,
      })
      if (clipDuration(nextClip) > MIN_CLIP_DURATION) out.push(nextClip)
      continue
    }
    if (end > movedStart + 1e-3 && end <= movedEnd + 1e-3) {
      const nextClip = clipFadesToVisibleSegment(clip, {
        ...clip,
        outPoint: sourceAtTimelineTime(clip, movedStart),
      })
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
  mediaType: media.mediaType,
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
    return preserveFadeTimingOnTrim(
      c,
      { ...c, inPoint: clampedIn, startTime: Math.max(0, startTime) },
      'left',
    )
  })
}

/** Apply a trim-right change to the primary clip and propagate to link partners. */
export const applyGroupTrimRight = (clips, primaryId, { outPoint }) => {
  const primary = clips.find((c) => c.id === primaryId)
  if (!primary) return clips
  const groupIds = getLinkedClipIds(clips, primaryId)
  return clips.map((c) => {
    if (!groupIds.has(c.id)) return c
    const maxOut = isTimelineImageClip(c) ? Number.MAX_SAFE_INTEGER : (c.sourceDuration || outPoint)
    const clampedOut = Math.max(c.inPoint + MIN_CLIP_DURATION, Math.min(maxOut, outPoint))
    return preserveFadeTimingOnTrim(c, { ...c, outPoint: clampedOut }, 'right')
  })
}

/** Assign a shared linkGroupId to every clip whose id is in `clipIds`. Pure. */
export const linkClipGroup = (clips, clipIds, groupIdFactory = nextLinkGroupId) => {
  const ids = clipIds instanceof Set ? clipIds : new Set(clipIds || [])
  if (ids.size < 2) return clips
  const groupId = groupIdFactory()
  return clips.map((c) => (ids.has(c.id) ? { ...c, linkGroupId: groupId } : c))
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
    const left = clipFadesToVisibleSegment(c, { ...c, outPoint: sourceSplit })
    const right = clipFadesToVisibleSegment(c, {
      ...c,
      id: makeId(),
      inPoint: sourceSplit,
      startTime: timelineTime,
      linkGroupId: rightGroupId,
    })
    if (clipDuration(left) > MIN_CLIP_DURATION) out.push(left)
    if (clipDuration(right) > MIN_CLIP_DURATION) out.push(right)
  }
  return out
}

/** Split only the selected clip, leaving linked partners untouched. */
export const applySingleClipSplit = (clips, clipId, timelineTime, makeId) => {
  const clip = clips.find((c) => c.id === clipId)
  if (!clip) return clips
  if (
    !(timelineTime > clip.startTime + MIN_CLIP_DURATION &&
      timelineTime < clipEnd(clip) - MIN_CLIP_DURATION)
  ) {
    return clips
  }
  const sourceSplit = clip.inPoint + (timelineTime - clip.startTime)
  const left = clipFadesToVisibleSegment(clip, {
    ...clip,
    outPoint: sourceSplit,
    linkGroupId: clip.linkGroupId || null,
  })
  const right = clipFadesToVisibleSegment(clip, {
    ...clip,
    id: makeId(),
    inPoint: sourceSplit,
    startTime: timelineTime,
    linkGroupId: clip.linkGroupId || null,
  })
  const out = []
  for (const c of clips) {
    if (c.id !== clipId) {
      out.push(c)
      continue
    }
    if (clipDuration(left) > MIN_CLIP_DURATION) out.push(left)
    if (clipDuration(right) > MIN_CLIP_DURATION) out.push(right)
  }
  return out
}
