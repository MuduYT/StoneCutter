import { MIN_CLIP_DURATION } from './timeline.js'

export const FOCUS_SOURCE = 'source'
export const FOCUS_TIMELINE = 'timeline'

export function isSourceMonitorVisible({ media, sourceMonitorId }) {
  return Boolean(media && media.mediaType === 'video' && media.id === sourceMonitorId)
}

export function clampSourceTime(time, duration) {
  const safeDuration = Math.max(MIN_CLIP_DURATION, Number(duration) || MIN_CLIP_DURATION)
  return Math.max(0, Math.min(safeDuration, Number(time) || 0))
}

export function clampSourceRange({ duration, currentRange, patch }) {
  const safeDuration = Math.max(MIN_CLIP_DURATION, Number(duration) || MIN_CLIP_DURATION)
  let inPoint = patch.inPoint ?? currentRange.inPoint ?? 0
  let outPoint = patch.outPoint ?? currentRange.outPoint ?? safeDuration

  inPoint = Math.max(0, Math.min(safeDuration - MIN_CLIP_DURATION, inPoint))
  outPoint = Math.max(MIN_CLIP_DURATION, Math.min(safeDuration, outPoint))

  if (outPoint - inPoint < MIN_CLIP_DURATION) {
    if (patch.inPoint != null) {
      inPoint = Math.max(0, outPoint - MIN_CLIP_DURATION)
    } else {
      outPoint = Math.min(safeDuration, inPoint + MIN_CLIP_DURATION)
    }
  }

  return { inPoint, outPoint }
}

export function timeFromClientX({ clientX, rect, duration }) {
  const width = Math.max(1, rect?.width || 1)
  const left = rect?.left || 0
  const x = Math.max(0, Math.min(width, clientX - left))
  return (x / width) * Math.max(MIN_CLIP_DURATION, duration || MIN_CLIP_DURATION)
}

export function stepSourcePreviewTime({ keyCode, currentTime, inPoint, outPoint, shiftKey = false }) {
  const frame = 1 / 30
  const step = shiftKey ? 1 : frame
  switch (keyCode) {
    case 'ArrowLeft':
      return currentTime - step
    case 'ArrowRight':
      return currentTime + step
    case 'Comma':
      return currentTime - frame
    case 'Period':
      return currentTime + frame
    case 'Home':
      return inPoint
    case 'End':
      return outPoint
    case 'KeyJ':
      return currentTime - 0.5
    default:
      return currentTime
  }
}
