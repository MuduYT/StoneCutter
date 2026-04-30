export const PROJECT_FILE_EXTENSION = 'stonecutter'
export const PROJECT_SCHEMA_VERSION = 1

export function sanitizeProjectName(name) {
  const cleaned = String(name || '')
    .trim()
    .split('')
    .map((ch) => (/[<>:"/\\|?*]/.test(ch) || ch.charCodeAt(0) < 32 ? '-' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/[.\s-]+$/g, '')
  return cleaned || 'Untitled Project'
}

export function getProjectFileName(name) {
  return `${sanitizeProjectName(name)}.${PROJECT_FILE_EXTENSION}`
}

export function createEmptyProjectState(name = 'Untitled Project') {
  return {
    name: sanitizeProjectName(name),
    videos: [],
    clips: [],
    sourceRanges: {},
    videoDurations: {},
    timelineTime: 0,
    settings: { imageDuration: 3 },
    ui: {
      aspectRatio: '16:9',
      pxPerSec: 40,
      snapEnabled: true,
      volume: 1,
      muted: false,
    },
  }
}

export function buildProjectDocument(state) {
  const now = new Date().toISOString()
  return {
    app: 'StoneCutter',
    schemaVersion: PROJECT_SCHEMA_VERSION,
    savedAt: now,
    project: {
      name: sanitizeProjectName(state.name),
    },
    media: (state.videos || []).map((item) => ({
      id: item.id,
      name: item.name,
      path: item.path || '',
      mediaType: item.mediaType || 'video',
    })),
    timeline: {
      clips: (state.clips || []).map((clip) => ({
        id: clip.id,
        videoId: clip.videoId,
        name: clip.name,
        sourceDuration: clip.sourceDuration,
        inPoint: clip.inPoint,
        outPoint: clip.outPoint,
        startTime: clip.startTime,
        trackMode: clip.trackMode || 'av',
      })),
      playhead: Number.isFinite(state.timelineTime) ? state.timelineTime : 0,
    },
    sourceRanges: state.sourceRanges || {},
    videoDurations: state.videoDurations || {},
    settings: {
      imageDuration: state.settings?.imageDuration ?? 3,
    },
    ui: {
      aspectRatio: state.aspectRatio || state.ui?.aspectRatio || '16:9',
      pxPerSec: state.pxPerSec ?? state.ui?.pxPerSec ?? 40,
      snapEnabled: state.snapEnabled ?? state.ui?.snapEnabled ?? true,
      volume: state.volume ?? state.ui?.volume ?? 1,
      muted: state.muted ?? state.ui?.muted ?? false,
    },
  }
}

export function parseProjectDocument(raw) {
  const doc = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!doc || doc.app !== 'StoneCutter') {
    throw new Error('Keine gueltige StoneCutter-Projektdatei.')
  }
  if (doc.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new Error(`Nicht unterstuetzte Projektversion: ${doc.schemaVersion}`)
  }
  return doc
}

export function hydrateProjectState(doc, convertFileSrc = (path) => path) {
  const parsed = parseProjectDocument(doc)
  const media = Array.isArray(parsed.media) ? parsed.media : []
  const clips = Array.isArray(parsed.timeline?.clips) ? parsed.timeline.clips : []
  return {
    name: sanitizeProjectName(parsed.project?.name),
    videos: media.map((item) => ({
      id: item.id,
      name: item.name,
      path: item.path || '',
      src: item.path ? convertFileSrc(item.path) : '',
      mediaType: item.mediaType || 'video',
    })),
    clips,
    sourceRanges: parsed.sourceRanges || {},
    videoDurations: parsed.videoDurations || {},
    timelineTime: parsed.timeline?.playhead || 0,
    settings: { imageDuration: 3, ...(parsed.settings || {}) },
    ui: {
      aspectRatio: parsed.ui?.aspectRatio || '16:9',
      pxPerSec: parsed.ui?.pxPerSec || 40,
      snapEnabled: parsed.ui?.snapEnabled ?? true,
      volume: parsed.ui?.volume ?? 1,
      muted: parsed.ui?.muted ?? false,
    },
  }
}
