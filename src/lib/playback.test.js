import assert from 'node:assert/strict'
import {
  MIN_CLIP_DURATION,
} from './timeline.js'
import {
  buildTimelinePlaybackLookups,
  findClipAtTime,
  findClipsAtTime,
  findNextClipAfter,
  getClipPlaybackPosition,
  getClipTimelineEnd,
  getImagePlaybackTimelineTime,
  getPlaybackTarget,
  getTimelineAudibleClips,
  getTimelineContentEnd,
  getTimelineVisualClips,
  getTopVisibleTimelineClip,
  getVirtualTimelinePlaybackTime,
  shouldLeaveClipPlayback,
  shouldStartNextClipFromGap,
} from './playback.js'
import {
  buildThumbnailItems,
  buildWaveformBars,
  getVisibleTimelineRange,
  groupVisibleClipsByTrack,
} from './timelineRender.js'

const clip = (id, startTime, inPoint, outPoint) => ({
  id,
  videoId: `${id}-video`,
  startTime,
  inPoint,
  outPoint,
})

test('finds clips at the playhead and stops at exact clip end', () => {
  const clips = [clip('a', 1, 3, 6)]

  assert.equal(findClipAtTime(1, clips)?.id, 'a')
  assert.equal(findClipAtTime(3.97, clips)?.id, 'a')
  assert.equal(findClipAtTime(3.98, clips)?.id, 'a')
  assert.equal(findClipAtTime(3.999, clips)?.id, 'a')
  assert.equal(findClipAtTime(4, clips), null)
  assert.equal(findClipAtTime(4.001, clips), null)
  assert.deepEqual(findClipsAtTime(1, clips).map((item) => item.id), ['a'])
})

test('handles direct cuts without overlap between adjacent clips', () => {
  const clips = [clip('a', 0, 0, 4), clip('b', 4, 0, 4)]

  // Before cut point, only clip A should be active
  assert.equal(findClipAtTime(3.99, clips)?.id, 'a')
  assert.equal(findClipAtTime(3.999, clips)?.id, 'a')
  
  // At exact cut point, only clip B should be active (clip A ended)
  assert.equal(findClipAtTime(4, clips)?.id, 'b')
  
  // After cut point, only clip B should be active
  assert.equal(findClipAtTime(4.01, clips)?.id, 'b')
  
  // No overlap: at 3.99 only clip A, at 4.0 only clip B
  assert.deepEqual(findClipsAtTime(3.99, clips).map((item) => item.id), ['a'])
  assert.deepEqual(findClipsAtTime(4, clips).map((item) => item.id), ['b'])
})

test('prefers video clips over aligned audio-only clips for timeline playback targets', () => {
  const audio = { ...clip('audio', 0, 0, 2), trackMode: 'audio' }
  const video = { ...clip('video', 0, 0, 2), trackMode: 'av' }
  const laterAudio = { ...clip('later-audio', 5, 0, 2), trackMode: 'audio' }
  const laterVideo = { ...clip('later-video', 5, 0, 2), trackMode: 'av' }

  assert.equal(findClipAtTime(1, [audio, video])?.id, 'video')
  assert.equal(findNextClipAfter(2, [laterAudio, laterVideo])?.id, 'later-video')
})

test('returns stacked visual clips from lower tracks to upper tracks', () => {
  const tracks = [
    { id: 'track-v1', type: 'video' },
    { id: 'track-v2', type: 'video' },
    { id: 'track-a1', type: 'audio' },
  ]
  const videos = [
    { id: 'base-video', mediaType: 'video', src: 'base.mp4' },
    { id: 'overlay-image', mediaType: 'image', src: 'overlay.png' },
    { id: 'voice', mediaType: 'audio', src: 'voice.wav' },
  ]
  const clips = [
    { ...clip('base', 0, 0, 5), videoId: 'base-video', trackId: 'track-v1', trackMode: 'video' },
    { ...clip('png', 1, 0, 2), videoId: 'overlay-image', trackId: 'track-v2', trackMode: 'video' },
    { ...clip('audio', 1, 0, 2), videoId: 'voice', trackId: 'track-a1', trackMode: 'audio' },
  ]

  assert.deepEqual(
    getTimelineVisualClips({ time: 1.5, clips, tracks, videos }).map(({ clip }) => clip.id),
    ['png', 'base']
  )
  assert.equal(getTopVisibleTimelineClip({ time: 1.5, clips, tracks, videos })?.id, 'base')
})

test('returns text clips as visual timeline layers without media assets', () => {
  const tracks = [
    { id: 'track-v1', type: 'video' },
    { id: 'track-a1', type: 'audio' },
  ]
  const clips = [
    {
      ...clip('title', 2, 0, 5),
      videoId: '',
      trackId: 'track-v1',
      trackMode: 'video',
      kind: 'text',
      content: { text: 'Text', style: { fontSize: 48, color: '#ffffff' } },
    },
    {
      ...clip('audio-text', 2, 0, 5),
      videoId: '',
      trackId: 'track-a1',
      trackMode: 'audio',
      kind: 'text',
    },
  ]

  const layers = getTimelineVisualClips({ time: 3, clips, tracks, videos: [] })

  assert.deepEqual(layers.map(({ clip: item }) => item.id), ['title'])
  assert.equal(layers[0].media, undefined)
})

test('returns audible clips while honoring audio mute and solo state', () => {
  const tracks = [
    { id: 'track-v1', type: 'video' },
    { id: 'track-a1', type: 'audio', muted: false, solo: false },
    { id: 'track-a2', type: 'audio', muted: true, solo: false },
    { id: 'track-a3', type: 'audio', muted: false, solo: true },
  ]
  const videos = [
    { id: 'music', mediaType: 'audio', src: 'music.wav' },
    { id: 'muted', mediaType: 'audio', src: 'muted.wav' },
    { id: 'solo', mediaType: 'audio', src: 'solo.wav' },
  ]
  const clips = [
    { ...clip('music', 0, 0, 5), videoId: 'music', trackId: 'track-a1', trackMode: 'audio' },
    { ...clip('muted', 0, 0, 5), videoId: 'muted', trackId: 'track-a2', trackMode: 'audio' },
    { ...clip('solo', 0, 0, 5), videoId: 'solo', trackId: 'track-a3', trackMode: 'audio' },
  ]

  assert.deepEqual(
    getTimelineAudibleClips({ time: 2, clips, tracks, videos }).map(({ clip }) => clip.id),
    ['solo']
  )
})

test('reuses prepared playback lookups for visual and audible clip selection', () => {
  const tracks = [
    { id: 'track-v1', type: 'video' },
    { id: 'track-a1', type: 'audio', muted: false },
  ]
  const videos = [
    { id: 'image', mediaType: 'image', src: 'image.png' },
    { id: 'voice', mediaType: 'audio', src: 'voice.wav' },
  ]
  const clips = [
    { ...clip('image-clip', 0, 0, 5), videoId: 'image', trackId: 'track-v1', trackMode: 'video' },
    { ...clip('voice-clip', 0, 0, 5), videoId: 'voice', trackId: 'track-a1', trackMode: 'audio' },
  ]
  const lookups = buildTimelinePlaybackLookups({ tracks, videos })

  assert.equal(lookups.mediaById.get('image')?.src, 'image.png')
  assert.equal(lookups.trackById.get('track-a1')?.type, 'audio')
  assert.equal(lookups.trackOrder.get('track-a1'), 1)
  assert.equal(lookups.hasSoloAudio, false)
  assert.deepEqual(
    getTimelineVisualClips({ time: 1, clips, lookups }).map(({ clip }) => clip.id),
    ['image-clip']
  )
  assert.deepEqual(
    getTimelineAudibleClips({ time: 1, clips, lookups }).map(({ clip }) => clip.id),
    ['voice-clip']
  )
})


test('finds the next clip after gaps and can exclude the current clip', () => {
  const clips = [clip('a', 0, 0, 2), clip('b', 5, 0, 2), clip('c', 8, 0, 1)]

  assert.equal(findNextClipAfter(2.1, clips)?.id, 'b')
  assert.equal(findNextClipAfter(5, clips, 'b')?.id, 'c')
})

test('chooses playback target at playhead or next clip after the playhead', () => {
  const clips = [clip('a', 0, 0, 2), clip('b', 5, 0, 2)]

  assert.deepEqual(getPlaybackTarget(1, clips), {
    atHead: clips[0],
    target: clips[0],
    startAtTime: 1,
  })
  assert.deepEqual(getPlaybackTarget(3, clips), {
    atHead: null,
    target: clips[1],
    startAtTime: 5,
  })
  assert.deepEqual(getPlaybackTarget(2, clips), {
    atHead: null,
    target: clips[1],
    startAtTime: 5,
  })
})

test('computes source and timeline playback positions inside a clip', () => {
  const result = getClipPlaybackPosition(clip('a', 10, 3, 8), 12.5)

  assert.deepEqual(result, {
    duration: 5,
    offsetInClip: 2.5,
    sourceTime: 5.5,
    timelineTime: 12.5,
  })
})

test('computes clip and content end positions', () => {
  const clips = [clip('a', 0, 0, 2), clip('b', 5, 1, 4)]

  assert.equal(getClipTimelineEnd(clips[1]), 8)
  assert.equal(getTimelineContentEnd(clips), 8)
  assert.equal(getTimelineContentEnd([]), 0)
})

test('decides timeline transitions through gaps and clip ends', () => {
  const nextClip = clip('b', 5, 0, 2)
  const currentClip = clip('a', 0, 0, 2)

  assert.equal(shouldStartNextClipFromGap({ timelineTime: 4.97, nextClip }), false)
  assert.equal(shouldStartNextClipFromGap({ timelineTime: 4.99, nextClip }), true)
  assert.equal(shouldStartNextClipFromGap({ timelineTime: 5, nextClip }), true)
  assert.equal(shouldStartNextClipFromGap({ timelineTime: 12, nextClip: null }), false)
  assert.equal(shouldLeaveClipPlayback({ sourceTime: 1.97, clip: currentClip }), false)
  assert.equal(shouldLeaveClipPlayback({ sourceTime: 1.99, clip: currentClip }), true)
  assert.equal(shouldLeaveClipPlayback({ sourceTime: 2, clip: currentClip }), true)
})

test('computes virtual image playback progress and end state', () => {
  const imageClip = clip('image', 4, 0, 3)
  const initial = getImagePlaybackTimelineTime({
    clip: imageClip,
    imagePlayback: null,
    nowMs: 1000,
    fallbackTimelineTime: 4.5,
  })

  assert.deepEqual(initial, {
    timelineStart: 4.5,
    startedAtMs: 1000,
    timelineTime: 4.5,
    endTime: 7,
    ended: false,
  })

  const ended = getImagePlaybackTimelineTime({
    clip: imageClip,
    imagePlayback: { clipId: 'image', startedAtMs: 1000, timelineStart: 4.5 },
    nowMs: 3600,
    fallbackTimelineTime: 4.5,
  })

  assert.equal(ended.ended, true)
  assert.equal(ended.timelineTime, 7.1)
})

test('computes virtual timeline playback through empty space', () => {
  const result = getVirtualTimelinePlaybackTime({
    timelinePlayback: { startedAtMs: 1000, timelineStart: 12 },
    nowMs: 2500,
    fallbackTimelineTime: 0,
  })

  assert.deepEqual(result, {
    timelineStart: 12,
    startedAtMs: 1000,
    timelineTime: 13.5,
  })
})

test('keeps virtual timeline clocks anchored across repeated gap transitions', () => {
  let timelineStart = 0
  let startedAtMs = 1000
  for (let i = 0; i < 100; i++) {
    const state = getVirtualTimelinePlaybackTime({
      timelinePlayback: { startedAtMs, timelineStart },
      nowMs: startedAtMs + 10,
      fallbackTimelineTime: -1,
    })
    timelineStart = state.timelineTime
    startedAtMs += 10
  }

  assert.equal(timelineStart.toFixed(6), '1.000000')
})

test('plays tail gap without requesting a next clip transition', () => {
  const tailState = getVirtualTimelinePlaybackTime({
    timelinePlayback: { startedAtMs: 1000, timelineStart: 8 },
    nowMs: 3500,
    fallbackTimelineTime: 0,
  })

  assert.equal(tailState.timelineTime, 10.5)
  assert.equal(shouldStartNextClipFromGap({ timelineTime: tailState.timelineTime, nextClip: null }), false)
})

test('groups only visible timeline clips with overscan and forced includes', () => {
  const clips = [
    { ...clip('hidden-left', 0, 0, 2), trackId: 'v1' },
    { ...clip('visible', 10, 0, 3), trackId: 'v1' },
    { ...clip('included', 30, 0, 2), trackId: 'a1' },
  ]
  const range = getVisibleTimelineRange({
    scrollLeft: 400,
    clientWidth: 200,
    pxPerSec: 40,
    overscanPx: 0,
  })
  const grouped = groupVisibleClipsByTrack({
    clips,
    visibleRange: range,
    includeIds: ['included'],
  })

  assert.deepEqual(grouped.get('v1').map((item) => item.id), ['visible'])
  assert.deepEqual(grouped.get('a1').map((item) => item.id), ['included'])
  assert.equal(grouped.has('missing'), false)
})

test('builds bounded waveform bars from peaks and placeholders', () => {
  const peaks = Array.from({ length: 1000 }, (_, index) => index / 1000)
  const bars = buildWaveformBars({
    width: 3000,
    peaks,
    inPoint: 10,
    outPoint: 90,
    sourceDuration: 100,
    volume: 2,
  })
  const placeholders = buildWaveformBars({
    width: 3000,
    peaks: null,
    inPoint: 1,
    seed: 4,
  })

  assert.equal(bars.length, 240)
  assert.equal(bars.some((bar) => bar.placeholder), false)
  assert.equal(placeholders.length, 240)
  assert.equal(placeholders.every((bar) => bar.placeholder), true)
})

test('builds bounded thumbnail items from trimmed source ranges', () => {
  const thumbs = Array.from({ length: 500 }, (_, index) => `thumb-${index}`)
  const items = buildThumbnailItems({
    width: 10000,
    thumbs,
    inPoint: 20,
    outPoint: 80,
    sourceDuration: 100,
  })

  assert.equal(items.length, 200)
  assert.equal(items[0].url, 'thumb-100')
  assert.equal(items.at(-1).sourceIndex < 400, true)
})

test('does not end a minimum-duration image clip before its exact end', () => {
  const imageClip = clip('image', 4, 0, MIN_CLIP_DURATION)
  const running = getImagePlaybackTimelineTime({
    clip: imageClip,
    imagePlayback: { clipId: 'image', startedAtMs: 1000, timelineStart: 4 },
    nowMs: 1030,
    fallbackTimelineTime: 4,
  })
  const ended = getImagePlaybackTimelineTime({
    clip: imageClip,
    imagePlayback: { clipId: 'image', startedAtMs: 1000, timelineStart: 4 },
    nowMs: 1050,
    fallbackTimelineTime: 4,
  })

  assert.equal(running.endTime, 4 + MIN_CLIP_DURATION)
  assert.equal(running.ended, false)
  assert.equal(ended.ended, true)
})
