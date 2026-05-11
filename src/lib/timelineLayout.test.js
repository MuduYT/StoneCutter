import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSeparatedLayout, DIVIDER_HEIGHT } from './timelineLayout.js'

test('separates video and audio tracks with a fixed divider gap', () => {
  const tracks = [
    { id: 'v1', type: 'video', height: 80 },
    { id: 'v2', type: 'video', height: 100 },
    { id: 'a1', type: 'audio', height: 80 },
    { id: 'a2', type: 'audio', height: 60 },
  ]
  const layout = buildSeparatedLayout(tracks)

  assert.equal(layout.videoTracksLayout.length, 2)
  assert.equal(layout.audioTracksLayout.length, 2)

  assert.equal(layout.videoTracksLayout[0].top, 0)
  assert.equal(layout.videoTracksLayout[0].height, 80)
  assert.equal(layout.videoTracksLayout[1].top, 80)
  assert.equal(layout.videoTracksLayout[1].height, 100)

  assert.equal(layout.dividerY, 180)
  assert.equal(layout.dividerHeight, DIVIDER_HEIGHT)

  const audioStart = 180 + DIVIDER_HEIGHT
  assert.equal(layout.audioTracksLayout[0].top, audioStart)
  assert.equal(layout.audioTracksLayout[0].height, 80)
  assert.equal(layout.audioTracksLayout[1].top, audioStart + 80)
  assert.equal(layout.audioTracksLayout[1].height, 60)

  assert.equal(layout.totalTracksHeight, audioStart + 80 + 60)
})

test('trackTopById maps every track id to its absolute bounds', () => {
  const tracks = [
    { id: 'v1', type: 'video', height: 80 },
    { id: 'a1', type: 'audio', height: 60 },
  ]
  const { trackTopById, dividerY } = buildSeparatedLayout(tracks)

  assert.equal(trackTopById.get('v1').top, 0)
  assert.equal(trackTopById.get('v1').height, 80)
  assert.equal(trackTopById.get('v1').bottom, 80)

  const audioStart = dividerY + DIVIDER_HEIGHT
  assert.equal(trackTopById.get('a1').top, audioStart)
  assert.equal(trackTopById.get('a1').height, 60)
  assert.equal(trackTopById.get('a1').bottom, audioStart + 60)
})

test('handles zero video tracks (audio-only project)', () => {
  const tracks = [{ id: 'a1', type: 'audio', height: 80 }]
  const layout = buildSeparatedLayout(tracks)

  assert.equal(layout.videoTracksLayout.length, 0)
  assert.equal(layout.dividerY, 0)
  assert.equal(layout.audioTracksLayout[0].top, DIVIDER_HEIGHT)
  assert.equal(layout.totalTracksHeight, DIVIDER_HEIGHT + 80)
})

test('handles zero audio tracks (video-only project)', () => {
  const tracks = [{ id: 'v1', type: 'video', height: 80 }]
  const layout = buildSeparatedLayout(tracks)

  assert.equal(layout.audioTracksLayout.length, 0)
  assert.equal(layout.dividerY, 80)
  assert.equal(layout.totalTracksHeight, 80 + DIVIDER_HEIGHT)
})

test('handles empty track list', () => {
  const layout = buildSeparatedLayout([])

  assert.equal(layout.videoTracksLayout.length, 0)
  assert.equal(layout.audioTracksLayout.length, 0)
  assert.equal(layout.dividerY, 0)
  assert.equal(layout.totalTracksHeight, DIVIDER_HEIGHT)
})

test('uses default track height when track.height is missing', () => {
  const tracks = [
    { id: 'v1', type: 'video' },
    { id: 'a1', type: 'audio' },
  ]
  const layout = buildSeparatedLayout(tracks, 80)

  assert.equal(layout.videoTracksLayout[0].height, 80)
  assert.equal(layout.audioTracksLayout[0].height, 80)
})

test('video and audio tops are independent of each other track counts', () => {
  const tracksA = [
    { id: 'v1', type: 'video', height: 80 },
    { id: 'a1', type: 'audio', height: 80 },
    { id: 'a2', type: 'audio', height: 80 },
    { id: 'a3', type: 'audio', height: 80 },
  ]
  const layoutA = buildSeparatedLayout(tracksA)

  const tracksB = [
    { id: 'v1', type: 'video', height: 80 },
    { id: 'v2', type: 'video', height: 80 },
    { id: 'v3', type: 'video', height: 80 },
    { id: 'a1', type: 'audio', height: 80 },
  ]
  const layoutB = buildSeparatedLayout(tracksB)

  assert.equal(layoutA.videoTracksLayout[0].top, 0)
  assert.equal(layoutB.videoTracksLayout[0].top, 0)

  assert.equal(layoutA.audioTracksLayout[0].top, 80 + DIVIDER_HEIGHT)
  assert.equal(layoutB.audioTracksLayout[0].top, 240 + DIVIDER_HEIGHT)
})

test('resizing a video track does not shift audio track heights', () => {
  const before = buildSeparatedLayout([
    { id: 'v1', type: 'video', height: 80 },
    { id: 'a1', type: 'audio', height: 80 },
    { id: 'a2', type: 'audio', height: 80 },
  ])
  const after = buildSeparatedLayout([
    { id: 'v1', type: 'video', height: 120 },
    { id: 'a1', type: 'audio', height: 80 },
    { id: 'a2', type: 'audio', height: 80 },
  ])

  const audioStartBefore = before.audioTracksLayout[0].top
  const audioStartAfter = after.audioTracksLayout[0].top

  assert.equal(before.audioTracksLayout[1].top - audioStartBefore, 80)
  assert.equal(after.audioTracksLayout[1].top - audioStartAfter, 80)
})

test('collapsing an audio track does not affect video tops', () => {
  const before = buildSeparatedLayout([
    { id: 'v1', type: 'video', height: 80 },
    { id: 'a1', type: 'audio', height: 80 },
    { id: 'a2', type: 'audio', height: 80 },
  ])
  const after = buildSeparatedLayout([
    { id: 'v1', type: 'video', height: 80 },
    { id: 'a1', type: 'audio', height: 40 },
    { id: 'a2', type: 'audio', height: 80 },
  ])

  assert.equal(before.videoTracksLayout[0].top, after.videoTracksLayout[0].top)
  assert.equal(before.videoTracksLayout[0].height, after.videoTracksLayout[0].height)
})
