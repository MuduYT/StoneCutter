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

const finiteNumber = (value, fallback) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function clampSourceRange({ duration, currentRange, patch }) {
  const safeDuration = Math.max(MIN_CLIP_DURATION, Number(duration) || MIN_CLIP_DURATION)
  const safeCurrentRange = currentRange || {}
  const safePatch = patch || {}
  let inPoint = finiteNumber(safePatch.inPoint ?? safeCurrentRange.inPoint, 0)
  let outPoint = finiteNumber(safePatch.outPoint ?? safeCurrentRange.outPoint, safeDuration)

  inPoint = Math.max(0, Math.min(safeDuration - MIN_CLIP_DURATION, inPoint))
  outPoint = Math.max(MIN_CLIP_DURATION, Math.min(safeDuration, outPoint))

  if (outPoint - inPoint < MIN_CLIP_DURATION) {
    if (safePatch.inPoint != null) {
      inPoint = Math.max(0, outPoint - MIN_CLIP_DURATION)
    } else {
      outPoint = Math.min(safeDuration, inPoint + MIN_CLIP_DURATION)
    }
  }

  return { inPoint, outPoint }
}

export function timeFromClientX({ clientX, rect, duration }) {
  const width = Number(rect?.width)
  if (!Number.isFinite(width) || width <= 0) return 0
  const left = Number.isFinite(Number(rect?.left)) ? Number(rect.left) : 0
  const pointerX = Number(clientX) - left
  const x = Number.isFinite(pointerX) ? Math.max(0, Math.min(width, pointerX)) : 0
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
