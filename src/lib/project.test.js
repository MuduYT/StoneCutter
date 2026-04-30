import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildProjectDocument,
  createEmptyProjectState,
  getProjectFileName,
  hydrateProjectState,
  sanitizeProjectName,
} from './project.js'

test('sanitizes project names for Windows-safe project files', () => {
  assert.equal(sanitizeProjectName('  My:Cut*01.  '), 'My-Cut-01')
  assert.equal(getProjectFileName('A/B'), 'A-B.stonecutter')
  assert.equal(sanitizeProjectName(''), 'Untitled Project')
})

test('builds and hydrates StoneCutter project documents', () => {
  const state = createEmptyProjectState('Demo')
  state.videos = [{ id: 'vid-1', name: 'clip.mp4', path: 'C:\\Media\\clip.mp4', src: 'asset://clip', mediaType: 'video' }]
  state.clips = [{ id: 'clip-1', videoId: 'vid-1', name: 'clip.mp4', sourceDuration: 10, inPoint: 1, outPoint: 4, startTime: 2, trackMode: 'audio' }]
  state.sourceRanges = { 'vid-1': { inPoint: 1, outPoint: 4 } }
  state.videoDurations = { 'vid-1': 10 }
  state.timelineTime = 2.5
  state.ui.pxPerSec = 60

  const doc = buildProjectDocument(state)
  const hydrated = hydrateProjectState(doc, (path) => `asset://${path}`)

  assert.equal(doc.app, 'StoneCutter')
  assert.equal(doc.media[0].path, 'C:\\Media\\clip.mp4')
  assert.equal(hydrated.videos[0].src, 'asset://C:\\Media\\clip.mp4')
  assert.equal(hydrated.clips[0].trackMode, 'audio')
  assert.equal(hydrated.ui.pxPerSec, 60)
})
