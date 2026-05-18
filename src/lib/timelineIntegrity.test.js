import assert from 'node:assert/strict'
import {
  assertClipBounds,
  assertTimelineLayoutConsistency,
  assertTrackTypeCompatibility,
  assertValidTrackPlacement,
  getClipExpectedTrackType,
  getDividerIndex,
  getTrackZone,
} from './timelineIntegrity.js'

test('getDividerIndex and getTrackZone follow video-then-audio ordering', () => {
  const tracks = [
    { id: 'v1', type: 'video' },
    { id: 'v2', type: 'video' },
    { id: 'a1', type: 'audio' },
  ]
  assert.equal(getDividerIndex(tracks), 2)
  assert.equal(getTrackZone(0, 2), 'video')
  assert.equal(getTrackZone(1, 2), 'video')
  assert.equal(getTrackZone(2, 2), 'divider')
  assert.equal(getTrackZone(3, 2), 'audio')
})

test('assertTrackTypeCompatibility rejects mismatched clip and track types', () => {
  const audioClip = { id: 'c1', trackMode: 'audio' }
  const videoClip = { id: 'c2', trackMode: 'video' }
  const textClip = { id: 'c3', kind: 'text' }

  assert.equal(assertTrackTypeCompatibility(audioClip, { type: 'audio' }), true)
  assert.equal(assertTrackTypeCompatibility(audioClip, { type: 'video' }), false)
  assert.equal(assertTrackTypeCompatibility(videoClip, { type: 'video' }), true)
  assert.equal(assertTrackTypeCompatibility(textClip, { type: 'video' }), true)
  assert.equal(assertTrackTypeCompatibility(textClip, { type: 'audio' }), false)
})

test('getClipExpectedTrackType maps text and trackMode', () => {
  assert.equal(getClipExpectedTrackType({ kind: 'text' }), 'video')
  assert.equal(getClipExpectedTrackType({ trackMode: 'audio' }), 'audio')
  assert.equal(getClipExpectedTrackType({ trackMode: 'video' }), 'video')
})

test('assertValidTrackPlacement flags inverted track order', () => {
  const mixed = [
    { id: 'a1', type: 'audio' },
    { id: 'v1', type: 'video' },
  ]
  assert.equal(assertValidTrackPlacement(mixed), false)
  assert.equal(
    assertValidTrackPlacement([
      { id: 'v1', type: 'video' },
      { id: 'a1', type: 'audio' },
    ]),
    true,
  )
})

test('assertClipBounds rejects negative start and zero duration', () => {
  assert.equal(assertClipBounds({ id: 'c', startTime: 0, inPoint: 0, outPoint: 2 }, 10), true)
  assert.equal(assertClipBounds({ id: 'c', startTime: -1, inPoint: 0, outPoint: 2 }, 10), false)
  assert.equal(assertClipBounds({ id: 'c', startTime: 0, inPoint: 1, outPoint: 1 }, 10), false)
})

test('assertTimelineLayoutConsistency validates separated layout', () => {
  assert.equal(
    assertTimelineLayoutConsistency([
      { id: 'v1', type: 'video', height: 80 },
      { id: 'a1', type: 'audio', height: 80 },
    ]),
    true,
  )
})
