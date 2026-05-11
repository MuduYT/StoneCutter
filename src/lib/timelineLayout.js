import { getTrackHeight } from './timeline.js'

export const DIVIDER_HEIGHT = 8

/**
 * Build the separated video/audio timeline layout (DaVinci Resolve style).
 *
 * All `top` values are relative to the track area start (0 = first pixel
 * directly below the ruler). Add the ruler height to convert to
 * tracks-content / tracks-inner coordinates.
 *
 * Returns:
 *   videoTracksLayout  Array<{ track, height, top }>
 *   audioTracksLayout  Array<{ track, height, top }>
 *   dividerY           Y of the video/audio divider (track-area-relative)
 *   dividerHeight      always DIVIDER_HEIGHT (8 px)
 *   totalTracksHeight  total height of the track area (video + divider + audio)
 *   trackTopById       Map<trackId, { top, height, bottom }>
 */
export function buildSeparatedLayout(tracks = [], defaultTrackHeight = 80) {
  const videoTracks = (tracks || []).filter((t) => t.type === 'video')
  const audioTracks = (tracks || []).filter((t) => t.type === 'audio')

  let offset = 0

  const videoTracksLayout = videoTracks.map((track) => {
    const height = getTrackHeight(track, defaultTrackHeight)
    const entry = { track, height, top: offset }
    offset += height
    return entry
  })

  const dividerY = offset
  offset += DIVIDER_HEIGHT

  const audioTracksLayout = audioTracks.map((track) => {
    const height = getTrackHeight(track, defaultTrackHeight)
    const entry = { track, height, top: offset }
    offset += height
    return entry
  })

  const totalTracksHeight = offset

  const trackTopById = new Map()
  for (const { track, top, height } of [...videoTracksLayout, ...audioTracksLayout]) {
    trackTopById.set(track.id, { top, height, bottom: top + height })
  }

  return {
    videoTracksLayout,
    audioTracksLayout,
    dividerY,
    dividerHeight: DIVIDER_HEIGHT,
    totalTracksHeight,
    trackTopById,
  }
}
