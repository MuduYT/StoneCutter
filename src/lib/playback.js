import { MIN_CLIP_DURATION, clipEnd } from './timeline.js'

export const TIMELINE_TRANSITION_EPSILON = 0.02

export const findClipAtTime = (time, clips) => {
  for (const clip of clips) {
    if (time >= clip.startTime - 1e-3 && time < clipEnd(clip) - 1e-3) return clip
  }
  return null
}

export const getClipTimelineEnd = (clip) => clipEnd(clip)

export const getTimelineContentEnd = (clips) => {
  return clips.reduce((max, clip) => Math.max(max, clipEnd(clip)), 0)
}

export const findNextClipAfter = (time, clips, excludeId = null) => {
  let best = null
  for (const clip of clips) {
    if (clip.id === excludeId) continue
    if (clip.startTime >= time - 1e-3) {
      if (!best || clip.startTime < best.startTime) best = clip
    }
  }
  return best
}

export const getPlaybackTarget = (timelineTime, clips) => {
  const atHead = findClipAtTime(timelineTime, clips)
  const target = atHead || findNextClipAfter(timelineTime + 0.001, clips)
  return {
    atHead,
    target,
    startAtTime: target ? (atHead ? timelineTime : target.startTime) : timelineTime,
  }
}

export const getVirtualTimelinePlaybackTime = ({ timelinePlayback, nowMs, fallbackTimelineTime }) => {
  const timelineStart = timelinePlayback?.timelineStart ?? fallbackTimelineTime
  const startedAtMs = timelinePlayback?.startedAtMs ?? nowMs
  const elapsed = (nowMs - startedAtMs) / 1000
  return {
    timelineStart,
    startedAtMs,
    timelineTime: timelineStart + elapsed,
  }
}

export const shouldStartNextClipFromGap = ({
  timelineTime,
  nextClip,
  threshold = TIMELINE_TRANSITION_EPSILON,
}) => Boolean(nextClip && timelineTime >= nextClip.startTime - threshold)

export const shouldLeaveClipPlayback = ({
  sourceTime,
  clip,
  threshold = TIMELINE_TRANSITION_EPSILON,
}) => Boolean(clip && sourceTime >= clip.outPoint - threshold)

export const getClipPlaybackPosition = (clip, startAtTime) => {
  const duration = Math.max(MIN_CLIP_DURATION, clip.outPoint - clip.inPoint)
  const offsetInClip = Math.min(duration, Math.max(0, startAtTime - clip.startTime))
  return {
    duration,
    offsetInClip,
    sourceTime: clip.inPoint + offsetInClip,
    timelineTime: clip.startTime + offsetInClip,
  }
}

export const getImagePlaybackTimelineTime = ({ clip, imagePlayback, nowMs, fallbackTimelineTime }) => {
  const duration = clip.outPoint - clip.inPoint
  const endTime = clip.startTime + duration
  const timelineStart = imagePlayback?.clipId === clip.id
    ? imagePlayback.timelineStart
    : Math.max(clip.startTime, fallbackTimelineTime)
  const startedAtMs = imagePlayback?.clipId === clip.id ? imagePlayback.startedAtMs : nowMs
  const elapsed = (nowMs - startedAtMs) / 1000
  const timelineTime = timelineStart + elapsed
  return {
    timelineStart,
    startedAtMs,
    timelineTime,
    endTime,
    ended: timelineTime >= endTime - 0.02,
  }
}
