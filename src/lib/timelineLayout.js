import { getTrackHeight } from './timeline.js'

export const DIVIDER_HEIGHT = 8
/** Dedicated strip above video / below audio for “+ Spur” drop targets */
export const EDGE_ZONE_HEIGHT = 44
export const MIN_TIMELINE_PX_PER_SEC = 10
export const MAX_TIMELINE_PX_PER_SEC = 120
export const TIMELINE_DRAG_AUTOSCROLL_EDGE_PX = 72
export const TIMELINE_DRAG_AUTOSCROLL_MAX_PX = 28

const clampNumber = (value, min, max) =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))

export function clampTimelinePxPerSec(pxPerSec) {
  return clampNumber(
    pxPerSec,
    MIN_TIMELINE_PX_PER_SEC,
    MAX_TIMELINE_PX_PER_SEC,
  )
}

export function getTimelineMaxScrollLeft(totalWidth, clientWidth) {
  const width = Math.max(0, Number.isFinite(clientWidth) ? clientWidth : 0)
  const content = Math.max(0, Number.isFinite(totalWidth) ? totalWidth : 0)
  return Math.max(0, content - width)
}

export function clampTimelineScrollLeft(scrollLeft, maxScrollLeft) {
  return clampNumber(scrollLeft, 0, Math.max(0, maxScrollLeft || 0))
}

export function computeTimelineTotalWidth(
  totalEnd,
  timelineTime,
  pxPerSec,
  minWidth = 800,
  padding = 200,
) {
  const scale = clampTimelinePxPerSec(pxPerSec)
  const end = Number.isFinite(totalEnd) ? totalEnd : 0
  const time = Math.max(0, Number.isFinite(timelineTime) ? timelineTime : 0)
  return Math.max(minWidth, end * scale + padding, time * scale + padding)
}

/**
 * Single source of truth for zoom scroll math: keep cursorTime stable under cursorX.
 */
export function zoomPxPerSecAtCursor({
  pxPerSec,
  nextPxPerSec,
  scrollLeft,
  cursorX,
  clientWidth,
}) {
  const safePxPerSec = clampTimelinePxPerSec(pxPerSec)
  const safeNextPxPerSec = clampTimelinePxPerSec(nextPxPerSec)
  const safeCursorX = clampNumber(cursorX, 0, Math.max(0, clientWidth || 0))
  const safeScrollLeft = Math.max(0, scrollLeft || 0)
  const cursorTime = (safeScrollLeft + safeCursorX) / Math.max(0.001, safePxPerSec)

  return {
    nextPxPerSec: safeNextPxPerSec,
    nextScrollLeft: Math.max(0, cursorTime * safeNextPxPerSec - safeCursorX),
    cursorTime,
  }
}

export function zoomPxPerSecFromWheelDelta({
  pxPerSec,
  scrollLeft,
  cursorX,
  clientWidth,
  delta,
}) {
  const safePxPerSec = clampTimelinePxPerSec(pxPerSec)
  const safeDelta = Number.isFinite(delta) ? delta : 0
  const scale = Math.pow(2, -safeDelta / 480)
  const nextPxPerSec = clampTimelinePxPerSec(safePxPerSec * scale)
  return zoomPxPerSecAtCursor({
    pxPerSec: safePxPerSec,
    nextPxPerSec,
    scrollLeft,
    cursorX,
    clientWidth,
  })
}

/**
 * One RAF loop per drag session; call setClientX on pointer moves (no new loop per move).
 */
export function createTimelineEdgeAutoScroller(getScrollElement) {
  let rafId = 0
  let lastClientX = null

  const tick = () => {
    const el = getScrollElement()
    if (!el || lastClientX == null) {
      rafId = 0
      return
    }
    const rect = el.getBoundingClientRect()
    const scrollDelta = getTimelineAutoScrollDelta(
      lastClientX,
      rect.left,
      rect.right,
    )
    if (scrollDelta !== 0) {
      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth)
      el.scrollLeft = clampTimelineScrollLeft(
        el.scrollLeft + scrollDelta,
        maxScroll,
      )
    }
    rafId = requestAnimationFrame(tick)
  }

  return {
    setClientX(clientX) {
      if (!Number.isFinite(clientX)) return
      lastClientX = clientX
      if (!rafId) rafId = requestAnimationFrame(tick)
    },
    stop() {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = 0
      lastClientX = null
    },
  }
}

export function getTimelineAutoScrollDelta(
  clientX,
  containerLeft,
  containerRight,
  edgePx = TIMELINE_DRAG_AUTOSCROLL_EDGE_PX,
  maxPx = TIMELINE_DRAG_AUTOSCROLL_MAX_PX,
) {
  if (!Number.isFinite(clientX)) return 0
  if (clientX < containerLeft + edgePx) {
    const intensity = (containerLeft + edgePx - clientX) / edgePx
    return -Math.ceil(clampNumber(intensity, 0, 1) * maxPx)
  }
  if (clientX > containerRight - edgePx) {
    const intensity = (clientX - (containerRight - edgePx)) / edgePx
    return Math.ceil(clampNumber(intensity, 0, 1) * maxPx)
  }
  return 0
}

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
 *   videoEdgeZone      { top, height } strip above video tracks
 *   audioEdgeZone      { top, height } strip below audio tracks
 *   dividerY           Y of the video/audio divider (track-area-relative)
 *   dividerHeight      always DIVIDER_HEIGHT (8 px)
 *   totalTracksHeight  total height of the track area (video + divider + audio)
 *   trackTopById       Map<trackId, { top, height, bottom }>
 */
export function buildSeparatedLayout(tracks = [], defaultTrackHeight = 80) {
  const videoTracks = (tracks || []).filter((t) => t.type === 'video')
  const audioTracks = (tracks || []).filter((t) => t.type === 'audio')

  let offset = EDGE_ZONE_HEIGHT

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

  const audioEdgeTop = offset
  const totalTracksHeight = offset + EDGE_ZONE_HEIGHT

  const trackTopById = new Map()
  for (const { track, top, height } of [...videoTracksLayout, ...audioTracksLayout]) {
    trackTopById.set(track.id, { top, height, bottom: top + height })
  }

  return {
    videoTracksLayout,
    audioTracksLayout,
    videoEdgeZone: { top: 0, height: EDGE_ZONE_HEIGHT },
    audioEdgeZone: { top: audioEdgeTop, height: EDGE_ZONE_HEIGHT },
    dividerY,
    dividerHeight: DIVIDER_HEIGHT,
    dividerIndex: videoTracks.length,
    totalTracksHeight,
    trackTopById,
  }
}
