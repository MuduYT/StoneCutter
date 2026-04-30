let _seq = 0
export const nextTrackId = () => `track-${++_seq}`

export const DEFAULT_TRACK_HEIGHT = 80
export const MIN_TRACK_HEIGHT = 40
export const MAX_TRACK_HEIGHT = 200

export function createDefaultTracks() {
  return [
    { id: 'track-v1', type: 'video', name: 'Video 1', locked: false, height: DEFAULT_TRACK_HEIGHT },
    { id: 'track-a1', type: 'audio', name: 'Audio 1', muted: false, solo: false, locked: false, height: DEFAULT_TRACK_HEIGHT },
  ]
}

export function addTrack(tracks, type) {
  const count = tracks.filter((t) => t.type === type).length + 1
  const name = type === 'video' ? `Video ${count}` : `Audio ${count}`
  const base = { id: nextTrackId(), type, name, locked: false, height: DEFAULT_TRACK_HEIGHT }
  if (type === 'audio') { base.muted = false; base.solo = false }
  return [...tracks, base]
}

export function removeTrack(tracks, trackId) {
  return tracks.filter((t) => t.id !== trackId)
}

export function updateTrack(tracks, trackId, changes) {
  return tracks.map((t) => (t.id === trackId ? { ...t, ...changes } : t))
}
