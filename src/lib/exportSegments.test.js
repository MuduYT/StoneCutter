import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildExportSegments,
  isAbsoluteSourcePath,
  totalExportDuration,
  totalTimelineDuration,
} from './exportSegments.js'

const media = [
  { id: 'v1', name: 'A.mp4', path: 'C:\\media\\A.mp4', mediaType: 'video' },
  { id: 'v2', name: 'B.png', path: '/media/B.png', mediaType: 'image' },
]

const clip = (id, videoId, startTime, inPoint, outPoint, trackMode = 'av') => ({
  id,
  videoId,
  name: id,
  startTime,
  inPoint,
  outPoint,
  sourceDuration: outPoint,
  trackMode,
})

test('recognizes Windows, UNC and POSIX absolute export paths', () => {
  assert.equal(isAbsoluteSourcePath('C:\\media\\clip.mp4'), true)
  assert.equal(isAbsoluteSourcePath('D:/media/clip.mp4'), true)
  assert.equal(isAbsoluteSourcePath('\\\\server\\share\\clip.mp4'), true)
  assert.equal(isAbsoluteSourcePath('/media/clip.mp4'), true)
  assert.equal(isAbsoluteSourcePath('clip.mp4'), false)
})

test('rejects empty timelines before export', () => {
  const result = buildExportSegments({ clips: [], videos: media })

  assert.equal(result.ok, false)
  assert.equal(result.error, 'Keine Clips auf der Timeline.')
})

test('builds sorted export segments with timeline gaps and track modes', () => {
  const clips = [
    clip('later', 'v2', 5, 0, 2),
    clip('first', 'v1', 1, 2, 5, 'audio'),
  ]
  const result = buildExportSegments({ clips, videos: media })

  assert.equal(result.ok, true)
  assert.deepEqual(result.segments, [
    { source_path: '', in_point: 0, out_point: 1, media_type: 'gap', track_mode: 'av' },
    { source_path: 'C:\\media\\A.mp4', in_point: 2, out_point: 5, media_type: 'video', track_mode: 'audio' },
    { source_path: '', in_point: 0, out_point: 1, media_type: 'gap', track_mode: 'av' },
    { source_path: '/media/B.png', in_point: 0, out_point: 2, media_type: 'image', track_mode: 'av' },
  ])
  assert.equal(totalExportDuration(result.segments), 7)
  assert.equal(totalTimelineDuration(clips), 5)
})

test('rejects browser-imported files because ffmpeg needs absolute paths', () => {
  const result = buildExportSegments({
    clips: [clip('bad', 'browser', 0, 0, 2)],
    videos: [{ id: 'browser', name: 'Browser Clip.mp4', path: 'Browser Clip.mp4', mediaType: 'video' }],
  })

  assert.equal(result.ok, false)
  assert.match(result.error, /Browser Clip\.mp4/)
  assert.match(result.error, /Tauri-Dateidialog/)
})
