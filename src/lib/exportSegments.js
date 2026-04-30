import { clipDuration, clipEnd } from './timeline.js'

export const isAbsoluteSourcePath = (sourcePath) => {
  if (!sourcePath) return false
  return /^[A-Za-z]:[\\/]/.test(sourcePath) ||
    sourcePath.startsWith('/') ||
    sourcePath.startsWith('\\\\')
}

export const buildExportSegments = ({ clips, videos }) => {
  if (!clips || clips.length === 0) {
    return { ok: false, error: 'Keine Clips auf der Timeline.' }
  }

  const sorted = [...clips].sort((a, b) => a.startTime - b.startTime)
  const segments = []
  let prevEnd = 0

  for (const clip of sorted) {
    if (clip.startTime > prevEnd + 0.005) {
      segments.push({
        source_path: '',
        in_point: 0,
        out_point: clip.startTime - prevEnd,
        media_type: 'gap',
        track_mode: 'av',
      })
    }

    const media = videos.find((item) => item.id === clip.videoId)
    const sourcePath = media?.path || ''
    if (!isAbsoluteSourcePath(sourcePath)) {
      return {
        ok: false,
        error: `"${media?.name || clip.videoId}" wurde per Browser importiert – für den Export muss die Datei über den Tauri-Dateidialog geöffnet werden.`,
      }
    }

    segments.push({
      source_path: sourcePath,
      in_point: clip.inPoint,
      out_point: clip.outPoint,
      media_type: media?.mediaType || 'video',
      track_mode: clip.trackMode || 'av',
    })
    prevEnd = clipEnd(clip)
  }

  return { ok: true, segments }
}

export const totalExportDuration = (segments) => {
  return segments.reduce((total, segment) => total + Math.max(0, segment.out_point - segment.in_point), 0)
}

export const totalTimelineDuration = (clips) => {
  return clips.reduce((total, clip) => total + Math.max(0, clipDuration(clip)), 0)
}
