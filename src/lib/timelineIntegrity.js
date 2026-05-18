import { buildSeparatedLayout, EDGE_ZONE_HEIGHT } from './timelineLayout.js'

const DEV = typeof import.meta !== 'undefined' && import.meta.env?.DEV

export function warnTimelineIntegrity(message, detail = null) {
  if (!DEV) return
  if (detail != null) {
    console.warn(`[TimelineIntegrity] ${message}`, detail)
  } else {
    console.warn(`[TimelineIntegrity] ${message}`)
  }
}

export function getClipExpectedTrackType(clip) {
  if (!clip) return null
  if (clip.kind === 'text') return 'video'
  if (clip.trackMode === 'audio') return 'audio'
  return 'video'
}

export function getDividerIndex(tracks = []) {
  return (tracks || []).filter((track) => track.type === 'video').length
}

export function getTrackZone(trackIndex, dividerIndex) {
  if (trackIndex < dividerIndex) return 'video'
  if (trackIndex > dividerIndex) return 'audio'
  return 'divider'
}

export function assertValidTrackPlacement(tracks, options = {}) {
  const list = tracks || []
  const dividerIndex = getDividerIndex(list)
  const issues = []
  let seenAudio = false

  list.forEach((track, index) => {
    if (track.type === 'audio') seenAudio = true
    if (track.type === 'video' && seenAudio) {
      issues.push({ trackId: track.id, index, expected: 'video', actual: 'after-audio' })
    }
    if (track.type === 'video' && index >= dividerIndex && dividerIndex < list.length) {
      const hasAudioBefore = list.slice(0, index).some((item) => item.type === 'audio')
      if (hasAudioBefore) {
        issues.push({ trackId: track.id, index, expected: 'video', actual: 'after-divider' })
      }
    }
    if (track.type === 'audio' && index < dividerIndex) {
      issues.push({ trackId: track.id, index, expected: 'audio', actual: 'before-divider' })
    }
  })

  if (issues.length > 0) {
    warnTimelineIntegrity('Invalid track placement (video must be above divider, audio below)', issues)
    if (options.throwOnError) {
      throw new Error('Invalid track placement')
    }
    return false
  }
  return true
}

export function assertTrackTypeCompatibility(clip, track, options = {}) {
  if (!clip || !track) return true
  const expected = getClipExpectedTrackType(clip)
  if (!expected || track.type === expected) return true

  const message =
    expected === 'video'
      ? 'Invalid video/text clip on audio track'
      : 'Invalid audio clip on video track'
  warnTimelineIntegrity(message, { clipId: clip.id, trackId: track.id })
  if (options.throwOnError) throw new Error(message)
  return false
}

export function assertClipBounds(clip, totalEnd = Number.POSITIVE_INFINITY, options = {}) {
  if (!clip) return true
  const start = Number.isFinite(clip.startTime) ? clip.startTime : 0
  const duration = Math.max(0, (clip.outPoint || 0) - (clip.inPoint || 0))
  const end = start + duration
  const issues = []

  if (start < -1e-6) issues.push('negative-start')
  if (duration < 1e-6) issues.push('zero-duration')
  if (Number.isFinite(totalEnd) && end > totalEnd + 1e-3) issues.push('past-timeline-end')

  if (issues.length === 0) return true

  warnTimelineIntegrity('Clip bounds violation', { clipId: clip.id, issues, start, end, totalEnd })
  if (options.throwOnError) throw new Error('Clip bounds violation')
  return false
}

export function assertTimelineLayoutConsistency(tracks, defaultTrackHeight = 80) {
  const list = tracks || []
  if (!assertValidTrackPlacement(list)) return false

  const layout = buildSeparatedLayout(list, defaultTrackHeight)
  const videoCount = layout.videoTracksLayout.length
  const audioCount = layout.audioTracksLayout.length
  const dividerIndex = getDividerIndex(list)

  if (layout.dividerY !== EDGE_ZONE_HEIGHT + list.slice(0, dividerIndex).reduce((sum, track) => {
    const height = track.height ?? defaultTrackHeight
    return sum + height
  }, 0)) {
    warnTimelineIntegrity('Divider Y drift vs track heights')
    return false
  }

  if (videoCount + audioCount !== list.length) {
    warnTimelineIntegrity('Mixed or unknown track types in layout', {
      videoCount,
      audioCount,
      total: list.length,
    })
    return false
  }

  return true
}

export function isTrackPlacementValid(tracks) {
  return assertValidTrackPlacement(tracks)
}
