import test from 'node:test'
import assert from 'node:assert/strict'
import { filterAndSortMedia } from './mediaBin.js'

const items = [
  { id: 'v1', name: 'B Roll.mp4', path: 'C:/Media/B Roll.mp4', mediaType: 'video', importedAt: '2026-01-01T10:00:00.000Z' },
  { id: 'a1', name: 'Voice.wav', path: 'C:/Audio/Voice.wav', mediaType: 'audio', importedAt: '2026-01-03T10:00:00.000Z' },
  { id: 'i1', name: 'Logo.png', path: 'C:/Images/Logo.png', mediaType: 'image', importedAt: '2026-01-02T10:00:00.000Z' },
  { id: 'v2', name: 'Interview.mp4', path: 'D:/Projects/Interview.mp4', mediaType: 'video', importedAt: '2026-01-04T10:00:00.000Z' },
]

test('filters media by case-insensitive name and path search', () => {
  assert.deepEqual(
    filterAndSortMedia(items, { query: 'voice' }).map((item) => item.id),
    ['a1']
  )
  assert.deepEqual(
    filterAndSortMedia(items, { query: 'projects' }).map((item) => item.id),
    ['v2']
  )
})

test('filters media by type', () => {
  assert.deepEqual(
    filterAndSortMedia(items, { typeFilter: 'video', sortBy: 'name' }).map((item) => item.id),
    ['v1', 'v2']
  )
  assert.deepEqual(
    filterAndSortMedia(items, { typeFilter: 'image' }).map((item) => item.id),
    ['i1']
  )
})

test('sorts media by name, duration, type and import time', () => {
  assert.deepEqual(
    filterAndSortMedia(items, { sortBy: 'importedAt' }).map((item) => item.id),
    ['v2', 'a1', 'i1', 'v1']
  )
  assert.deepEqual(
    filterAndSortMedia(items, { sortBy: 'name' }).map((item) => item.id),
    ['v1', 'v2', 'i1', 'a1']
  )
  assert.deepEqual(
    filterAndSortMedia(items, { sortBy: 'duration', durations: { v1: 8, a1: 30, i1: 3, v2: 12 } }).map((item) => item.id),
    ['a1', 'v2', 'v1', 'i1']
  )
  assert.deepEqual(
    filterAndSortMedia(items, { sortBy: 'type' }).map((item) => item.id),
    ['v1', 'v2', 'i1', 'a1']
  )
})

test('preserves stable order when sort keys are equal or input is invalid', () => {
  assert.deepEqual(
    filterAndSortMedia([{ id: 'a', name: 'Same' }, { id: 'b', name: 'Same' }], { sortBy: 'name' }).map((item) => item.id),
    ['a', 'b']
  )
  assert.deepEqual(filterAndSortMedia(null), [])
})
