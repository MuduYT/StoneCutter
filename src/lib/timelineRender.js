import { clipEnd, MIN_CLIP_DURATION } from './timeline.js'

export const MAX_WAVEFORM_BARS = 240
export const MAX_THUMBNAIL_ITEMS = 80
export const TIMELINE_OVERSCAN_PX = 800

export const getVisibleTimelineRange = ({
  scrollLeft = 0,
  clientWidth = 0,
  pxPerSec = 1,
  overscanPx = TIMELINE_OVERSCAN_PX,
}) => {
  const scale = Math.max(0.001, pxPerSec)
  const start = Math.max(0, (scrollLeft - overscanPx) / scale)
  const end = Math.max(start, (scrollLeft + clientWidth + overscanPx) / scale)
  return { start, end }
}

export const groupClipsByTrack = (clips) => {
  const clipsByTrack = new Map()
  for (const clip of clips) {
    const list = clipsByTrack.get(clip.trackId)
    if (list) list.push(clip)
    else clipsByTrack.set(clip.trackId, [clip])
  }
  return clipsByTrack
}

export const groupVisibleClipsByTrack = ({ clips, visibleRange, includeIds = [] }) => {
  const includeSet = includeIds instanceof Set ? includeIds : new Set(includeIds)
  const clipsByTrack = new Map()
  for (const clip of clips) {
    const end = clipEnd(clip)
    const isVisible = !visibleRange ||
      includeSet.has(clip.id) ||
      (end >= visibleRange.start && clip.startTime <= visibleRange.end)
    if (!isVisible) continue
    const list = clipsByTrack.get(clip.trackId)
    if (list) list.push(clip)
    else clipsByTrack.set(clip.trackId, [clip])
  }
  return clipsByTrack
}

const clampCount = (count, max) => Math.max(1, Math.min(max, Math.floor(count)))

export const buildWaveformBars = ({
  width,
  peaks,
  inPoint = 0,
  outPoint = 0,
  sourceDuration = 0,
  volume = 1,
  fadeIn = 0,
  fadeOut = 0,
  maxBars = MAX_WAVEFORM_BARS,
  minBars = 8,
  seed = 0,
}) => {
  const count = Math.max(minBars, clampCount(Math.max(1, width) / 3, maxBars))
  const sourceLength = Math.max(0.001, sourceDuration)
  const clipDuration = Math.max(0.001, outPoint - inPoint)
  const volumeGain = Math.max(0, Math.min(2, volume))
  const fadeInLength = Math.max(0, Math.min(fadeIn, clipDuration))
  const fadeOutLength = Math.max(0, Math.min(fadeOut, clipDuration))
  const fadeGainAt = (ratio) => {
    const time = Math.max(0, Math.min(clipDuration, ratio * clipDuration))
    let gain = 1
    if (fadeInLength > 0 && time < fadeInLength) gain = Math.min(gain, time / fadeInLength)
    const timeToEnd = clipDuration - time
    if (fadeOutLength > 0 && timeToEnd < fadeOutLength) {
      gain = Math.min(gain, timeToEnd / fadeOutLength)
    }
    return Math.max(0, Math.min(1, gain))
  }
  if (!peaks || peaks.length === 0) {
    return Array.from({ length: count }, (_, index) => ({
      height: Math.max(
        0,
        (20 + Math.abs(Math.sin((index + inPoint * 4) * 0.7 + seed)) * 50) *
          Math.min(1, volumeGain) *
          fadeGainAt(count <= 1 ? 0 : index / (count - 1))
      ),
      placeholder: true,
    }))
  }
  const safeSourceLength = Math.max(MIN_CLIP_DURATION, sourceLength || MIN_CLIP_DURATION);
  const startIdx = Math.max(0, Math.floor((inPoint / safeSourceLength) * peaks.length))
  const endIdx = Math.min(
    peaks.length,
    Math.max(startIdx + 1, Math.ceil((outPoint / safeSourceLength) * peaks.length))
  )
  const segLen = endIdx - startIdx
  return Array.from({ length: count }, (_, index) => {
    const ratio = count <= 1 ? 0 : index / (count - 1)
    const idx = Math.min(
      peaks.length - 1,
      startIdx + Math.floor((index / count) * segLen)
    )
    const value = Math.min(1, (peaks[idx] || 0) * volumeGain * fadeGainAt(ratio))
    return { height: value * 100, placeholder: false }
  })
}

export const buildThumbnailItems = ({
  width,
  thumbs,
  inPoint = 0,
  outPoint = 0,
  sourceDuration = 0,
  maxItems = MAX_THUMBNAIL_ITEMS,
  minItemWidth = 48,
}) => {
  if (!thumbs || thumbs.length === 0) return []
  const sourceLength = Math.max(0.001, sourceDuration)
  const safeSourceLength = Math.max(MIN_CLIP_DURATION, sourceLength || MIN_CLIP_DURATION);
  const startIdx = Math.max(0, Math.floor((inPoint / safeSourceLength) * thumbs.length))
  const endIdx = Math.min(
    thumbs.length,
    Math.max(startIdx + 1, Math.ceil((outPoint / safeSourceLength) * thumbs.length))
  )
  const available = endIdx - startIdx
  const count = Math.min(available, clampCount(Math.max(1, width) / minItemWidth, maxItems))
  return Array.from({ length: count }, (_, index) => {
    const idx = Math.min(
      thumbs.length - 1,
      startIdx + Math.floor((index / count) * available)
    )
    return { url: thumbs[idx] || null, sourceIndex: idx }
  })
}
