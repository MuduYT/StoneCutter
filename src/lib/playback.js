import { MIN_CLIP_DURATION, clipEnd } from './timeline.js'

export const TIMELINE_TRANSITION_EPSILON = 0.02

const clipContainsTime = (time, clip) => {
  return time >= clip.startTime - TIMELINE_TRANSITION_EPSILON &&
    time < clipEnd(clip)
}

const preferPlaybackClip = (current, candidate) => {
  if (!current) return candidate
  if (candidate.startTime < current.startTime - 1e-3) return candidate
  if (Math.abs(candidate.startTime - current.startTime) > 1e-3) return current
  if (current.trackMode === 'audio' && candidate.trackMode !== 'audio') return candidate
  return current
}

const getTrackIndex = (trackOrder, clip) => {
  const index = trackOrder.get(clip.trackId)
  return Number.isFinite(index) ? index : Number.MAX_SAFE_INTEGER
}

const getTrackType = (track, clip) => {
  if (track?.type) return track.type
  return clip.trackMode === 'audio' ? 'audio' : 'video'
}

export const findClipAtTime = (time, clips) => {
  let best = null
  for (const clip of clips) {
    if (clipContainsTime(time, clip)) {
      best = preferPlaybackClip(best, clip)
    }
  }
  return best
}

export const findClipsAtTime = (time, clips) => {
  return clips.filter((clip) => clipContainsTime(time, clip))
}

export const getTimelineVisualClips = ({ time, clips, tracks = [], videos = [] }) => {
  const mediaById = new Map(videos.map((media) => [media.id, media]))
  const trackById = new Map(tracks.map((track) => [track.id, track]))
  const trackOrder = new Map(tracks.map((track, index) => [track.id, index]))

  return findClipsAtTime(time, clips)
    .map((clip) => {
      const media = mediaById.get(clip.videoId)
      const track = trackById.get(clip.trackId)
      return {
        clip,
        media,
        track,
        trackIndex: getTrackIndex(trackOrder, clip),
      }
    })
    .filter(({ clip, media, track }) => {
      const mediaType = media?.mediaType || 'video'
      return getTrackType(track, clip) === 'video' &&
        clip.trackMode !== 'audio' &&
        (mediaType === 'video' || mediaType === 'image')
    })
    .sort((a, b) => b.trackIndex - a.trackIndex ||
      a.clip.startTime - b.clip.startTime ||
      String(a.clip.id).localeCompare(String(b.clip.id)))
}

export const getTimelineAudibleClips = ({ time, clips, tracks = [], videos = [] }) => {
  const mediaById = new Map(videos.map((media) => [media.id, media]))
  const trackById = new Map(tracks.map((track) => [track.id, track]))
  const trackOrder = new Map(tracks.map((track, index) => [track.id, index]))
  const hasSoloAudio = tracks.some((track) => track.type === 'audio' && track.solo)

  return findClipsAtTime(time, clips)
    .map((clip) => {
      const media = mediaById.get(clip.videoId)
      const track = trackById.get(clip.trackId)
      return {
        clip,
        media,
        track,
        trackIndex: getTrackIndex(trackOrder, clip),
      }
    })
    .filter(({ clip, media, track }) => {
      if (!media?.src) return false
      if (getTrackType(track, clip) !== 'audio' && clip.trackMode !== 'audio') return false
      if (track?.muted) return false
      if (hasSoloAudio && !track?.solo) return false
      return true
    })
    .sort((a, b) => a.trackIndex - b.trackIndex ||
      a.clip.startTime - b.clip.startTime ||
      String(a.clip.id).localeCompare(String(b.clip.id)))
}

export const getTopVisibleTimelineClip = ({ time, clips, tracks = [], videos = [] }) => {
  const visualClips = getTimelineVisualClips({ time, clips, tracks, videos })
  return visualClips.length > 0 ? visualClips[visualClips.length - 1].clip : findClipAtTime(time, clips)
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
      best = preferPlaybackClip(best, clip)
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
  const duration = Math.max(MIN_CLIP_DURATION, clip.outPoint - clip.inPoint)
  const endTime = clip.startTime + duration
  const timelineStart = imagePlayback?.clipId === clip.id
    ? imagePlayback.timelineStart
    : Math.max(clip.startTime, fallbackTimelineTime)
  const startedAtMs = imagePlayback?.clipId === clip.id ? imagePlayback.startedAtMs : nowMs
  const elapsed = (nowMs - startedAtMs) / 1000
  const timelineTime = timelineStart + elapsed
  const transitionThreshold = Math.min(
    TIMELINE_TRANSITION_EPSILON,
    Math.max(0, duration - MIN_CLIP_DURATION)
  )
  return {
    timelineStart,
    startedAtMs,
    timelineTime,
    endTime,
    ended: timelineTime >= endTime - transitionThreshold,
  }
}
