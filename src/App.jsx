/* eslint-disable react-hooks/rules-of-hooks */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import logoUrl from '../media/Logo/StoneCutter-Logo.png'
import './App.css'

const isTauri = '__TAURI_INTERNALS__' in window
const SNAP_THRESHOLD_PX = 8
const MOVE_THRESHOLD_PX = 3
const MIN_CLIP_DURATION = 0.05

let _idCounter = 0
const nextId = (prefix) => `${prefix}-${++_idCounter}`

// --- Collision / overlap helpers (Filmora-style track behavior) ---
const constrainMoveStart = (desired, dur, others) => {
  const sorted = others
    .map((o) => [o.startTime, o.startTime + (o.outPoint - o.inPoint)])
    .sort((a, b) => a[0] - b[0])
  const gaps = []
  let prevEnd = 0
  for (const [oS, oE] of sorted) {
    if (oS - prevEnd >= dur - 1e-3) gaps.push([prevEnd, oS - dur])
    prevEnd = Math.max(prevEnd, oE)
  }
  gaps.push([prevEnd, Infinity])
  let best = desired, bestDist = Infinity
  for (const [lo, hi] of gaps) {
    const c = Math.max(lo, Math.min(hi, desired))
    const d = Math.abs(c - desired)
    if (d < bestDist) { bestDist = d; best = c }
  }
  return Math.max(0, best)
}

const minStartForTrimLeft = (fixedRight, others) => {
  let limit = 0
  for (const o of others) {
    const oE = o.startTime + (o.outPoint - o.inPoint)
    if (oE <= fixedRight + 1e-3 && oE > limit) limit = oE
  }
  return limit
}

const maxEndForTrimRight = (fixedLeft, others) => {
  let limit = Infinity
  for (const o of others) {
    if (o.startTime >= fixedLeft - 1e-3 && o.startTime < limit) limit = o.startTime
  }
  return limit
}

// Detect ripple-insert intent: cursor is over a clip OR in a gap too small for the dragged dur.
// Returns { insertPoint } or null. `excludeId` skips the dragged clip itself.
const detectInsertPoint = (excludeId, center, dur, snapshot) => {
  const others = snapshot.filter((c) => c.id !== excludeId)
  for (const o of others) {
    const oE = o.startTime + (o.outPoint - o.inPoint)
    if (center >= o.startTime && center <= oE) {
      const oCenter = (o.startTime + oE) / 2
      return { insertPoint: center < oCenter ? o.startTime : oE }
    }
  }
  let leftEnd = 0, rightStart = Infinity
  for (const o of others) {
    const oE = o.startTime + (o.outPoint - o.inPoint)
    if (oE <= center + 1e-3 && oE > leftEnd) leftEnd = oE
    if (o.startTime > center - 1e-3 && o.startTime < rightStart) rightStart = o.startTime
  }
  if (rightStart < Infinity && rightStart - leftEnd < dur - 1e-3) {
    const gapCenter = (leftEnd + rightStart) / 2
    return { insertPoint: center < gapCenter ? leftEnd : rightStart }
  }
  return null
}

// Apply a ripple-insert to `snapshot`: dragged clip placed at `insertPoint`,
// every clip with startTime >= insertPoint (except the dragged) is shifted by `dur`.
const applyRippleInsert = (snapshot, draggedId, insertPoint, dur) => {
  return snapshot.map((c) => {
    if (c.id === draggedId) return { ...c, startTime: insertPoint }
    if (c.startTime >= insertPoint - 1e-3) return { ...c, startTime: c.startTime + dur }
    return c
  })
}

// Find a gap at time t. Returns { start, end } or null (only for gaps BETWEEN clips).
const findGapAtTime = (t, list) => {
  const sorted = [...list].sort((a, b) => a.startTime - b.startTime)
  let prevEnd = 0
  for (const c of sorted) {
    if (t < c.startTime - 1e-3) {
      return { start: prevEnd, end: c.startTime }
    }
    const cE = c.startTime + (c.outPoint - c.inPoint)
    if (t < cE) return null
    prevEnd = Math.max(prevEnd, cE)
  }
  return null
}

// Close a gap: shift all clips with startTime >= gap.end left by gap width.
const closeGap = (list, gap) => {
  const dur = gap.end - gap.start
  if (dur <= 0) return list
  return list.map((c) =>
    c.startTime >= gap.end - 1e-3
      ? { ...c, startTime: c.startTime - dur }
      : c
  )
}

// Ripple-delete: remove clips with given ids; shift later clips left to fill the freed slots.
// Pre-existing gaps between non-deleted clips are preserved.
const rippleDeleteClips = (list, idsToDelete) => {
  const ids = idsToDelete instanceof Set ? idsToDelete : new Set(idsToDelete)
  const removed = list.filter((c) => ids.has(c.id))
  const remaining = list.filter((c) => !ids.has(c.id))
  return remaining.map((c) => {
    let shift = 0
    for (const r of removed) {
      if (r.startTime < c.startTime - 1e-3) shift += (r.outPoint - r.inPoint)
    }
    return { ...c, startTime: Math.max(0, c.startTime - shift) }
  })
}

// Filmora-style overwrite: trim/split neighbors that overlap modifiedId.
// `protectedIds` (optional Set) keeps those clips untouched — useful for multi-clip drags
// where other selected clips should not be cut by the moved one.
const resolveOverlaps = (clipList, modifiedId, makeId, protectedIds) => {
  const moved = clipList.find((c) => c.id === modifiedId)
  if (!moved) return clipList
  const protect = protectedIds || null
  const mS = moved.startTime
  const mE = moved.startTime + (moved.outPoint - moved.inPoint)
  const out = []
  for (const c of clipList) {
    if (c.id === modifiedId) { out.push(c); continue }
    if (protect && protect.has(c.id)) { out.push(c); continue }
    const cS = c.startTime
    const cE = c.startTime + (c.outPoint - c.inPoint)
    if (cE <= mS + 1e-3 || cS >= mE - 1e-3) { out.push(c); continue }
    if (mS <= cS + 1e-3 && mE >= cE - 1e-3) continue
    if (cS < mS - 1e-3 && cE > mE + 1e-3) {
      const left = { ...c, outPoint: c.inPoint + (mS - cS) }
      const right = { ...c, id: makeId(), inPoint: c.inPoint + (mE - cS), startTime: mE }
      if (left.outPoint - left.inPoint > MIN_CLIP_DURATION) out.push(left)
      if (right.outPoint - right.inPoint > MIN_CLIP_DURATION) out.push(right)
      continue
    }
    if (cS >= mS - 1e-3 && cS < mE - 1e-3) {
      const nc = { ...c, inPoint: c.inPoint + (mE - cS), startTime: mE }
      if (nc.outPoint - nc.inPoint > MIN_CLIP_DURATION) out.push(nc)
      continue
    }
    if (cE > mS + 1e-3 && cE <= mE + 1e-3) {
      const nc = { ...c, outPoint: c.outPoint - (cE - mS) }
      if (nc.outPoint - nc.inPoint > MIN_CLIP_DURATION) out.push(nc)
      continue
    }
    out.push(c)
  }
  return out
}

// Run resolveOverlaps for every modifier id, protecting other modifiers from being cut.
const resolveOverlapsMulti = (clipList, modifierIds, makeId) => {
  const ids = modifierIds instanceof Set ? modifierIds : new Set(modifierIds)
  let result = clipList
  for (const id of ids) {
    result = resolveOverlaps(result, id, makeId, ids)
  }
  return result
}

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif']
const VIDEO_EXTS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v']

const getMediaType = (nameOrPath) => {
  const ext = (nameOrPath.split('.').pop() || '').toLowerCase()
  if (IMAGE_EXTS.includes(ext)) return 'image'
  return 'video'
}

async function openVideoDialog() {
  if (!isTauri) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const { convertFileSrc } = await import('@tauri-apps/api/core')
  const selected = await open({
    multiple: true,
    filters: [
      { name: 'Medien', extensions: [...VIDEO_EXTS, ...IMAGE_EXTS] },
      { name: 'Videos', extensions: VIDEO_EXTS },
      { name: 'Bilder', extensions: IMAGE_EXTS },
      { name: 'All', extensions: ['*'] }
    ]
  })
  if (!selected) return []
  const paths = Array.isArray(selected) ? selected : [selected]
  return paths.map((p) => {
    const name = p.split(/[\\/]/).pop() || p
    return { id: nextId('vid'), name, path: p, src: convertFileSrc(p), mediaType: getMediaType(name) }
  })
}

function probeDuration(src, mediaType = 'video', defaultImageDuration = 3) {
  if (mediaType === 'image') return Promise.resolve(defaultImageDuration)
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    const cleanup = () => { v.onloadedmetadata = null; v.onerror = null; v.src = '' }
    v.onloadedmetadata = () => {
      const d = isFinite(v.duration) && v.duration > 0 ? v.duration : 5
      cleanup(); resolve(d)
    }
    v.onerror = () => { cleanup(); resolve(5) }
    v.src = src
  })
}

async function generateImageThumbnails(src, count = 12) {
  // For images: return the same src multiple times (rendered as a strip).
  return Array(count).fill(src)
}

async function generateThumbnails(src, count = 12) {
  const v = document.createElement('video')
  v.muted = true
  v.preload = 'auto'
  v.crossOrigin = 'anonymous'
  v.playsInline = true
  v.src = src
  const ok = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 5000)
    v.onloadedmetadata = () => { clearTimeout(t); resolve(true) }
    v.onerror = () => { clearTimeout(t); resolve(false) }
  })
  if (!ok || !v.duration || !isFinite(v.duration)) {
    v.src = ''
    return []
  }
  const dur = v.duration
  const aspect = (v.videoWidth && v.videoHeight) ? v.videoHeight / v.videoWidth : 9 / 16
  const tw = 120
  const th = Math.max(40, Math.round(tw * aspect))
  const canvas = document.createElement('canvas')
  canvas.width = tw
  canvas.height = th
  const ctx = canvas.getContext('2d')
  const thumbs = []
  for (let i = 0; i < count; i++) {
    const targetT = ((i + 0.5) / count) * dur
    await new Promise((resolve) => {
      const timer = setTimeout(() => { v.onseeked = null; resolve() }, 2000)
      v.onseeked = () => { clearTimeout(timer); v.onseeked = null; resolve() }
      try { v.currentTime = Math.min(dur - 0.05, Math.max(0, targetT)) } catch { /* ignored */ }
    })
    try {
      ctx.drawImage(v, 0, 0, tw, th)
      thumbs.push(canvas.toDataURL('image/jpeg', 0.55))
    } catch {
      thumbs.push(null)
    }
  }
  v.src = ''
  return thumbs
}

async function generateWaveform(src, samples = 200) {
  try {
    const response = await fetch(src)
    const arrayBuffer = await response.arrayBuffer()
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return null
    const audioCtx = new AudioCtx()
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer).catch(() => null)
    if (!audioBuffer) { audioCtx.close(); return null }
    const channels = []
    for (let ch = 0; ch < Math.min(audioBuffer.numberOfChannels, 2); ch++) {
      channels.push(audioBuffer.getChannelData(ch))
    }
    const length = channels[0].length
    const blockSize = Math.max(1, Math.floor(length / samples))
    const peaks = []
    for (let i = 0; i < samples; i++) {
      let max = 0
      const start = i * blockSize
      const end = Math.min(start + blockSize, length)
      for (let j = start; j < end; j++) {
        let v = 0
        for (const c of channels) {
          const s = Math.abs(c[j] || 0)
          if (s > v) v = s
        }
        if (v > max) max = v
      }
      peaks.push(max)
    }
    audioCtx.close()
    return peaks
  } catch {
    return null
  }
}

function formatTC(s) {
  if (!isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const tenths = Math.floor((s % 1) * 10)
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${tenths}`
}

function formatTime(s) {
  if (!isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// SVG Icons (no external deps)
const Icon = {
  Play: () => <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>,
  Pause: () => <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>,
  SkipStart: () => <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 6h2v12H6zM9.5 12l8.5 6V6z"/></svg>,
  SkipEnd: () => <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>,
  StepBack: () => <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M15.5 6L7 12l8.5 6V6z"/></svg>,
  StepFwd: () => <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8.5 6L17 12l-8.5 6V6z"/></svg>,
  Magnet: () => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 3v8a7 7 0 0 0 14 0V3h-4v8a3 3 0 0 1-6 0V3zM5 3h4M15 3h4"/></svg>,
  Volume: () => <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>,
  Mute: () => <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M16.5 12A4.5 4.5 0 0 0 14 8v2.18l2.45 2.45c.03-.2.05-.41.05-.63zM3 9v6h4l5 5v-6.18L7.83 9H3zm15.6 9.27L19.73 19.4 12 11.67V20l-5-5H3V9h2.27L1.73 5.46l1.27-1.27L18.6 18.27z"/></svg>,
  Plus: () => <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/></svg>,
  Trash: () => <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zm2.46-7.12l1.41-1.41L12 12.59l2.12-2.12 1.41 1.41L13.41 14l2.12 2.12-1.41 1.41L12 15.41l-2.12 2.12-1.41-1.41L10.59 14zM15.5 4l-1-1h-5l-1 1H5v2h14V4z"/></svg>,
  Cut: () => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>,
  Undo: () => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>,
  Redo: () => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 7v6h-6M3 17a9 9 0 0 1 15-6.7L21 13"/></svg>,
  Settings: () => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  Image: () => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
  Export: () => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
}

function App() {
  const videoRef = useRef(null)
  const fileRef = useRef(null)
  const tracksContentRef = useRef(null)
  const pendingSeekRef = useRef(null)
  const pendingPlayRef = useRef(false) // play after src change + metadata
  const historyRef = useRef({ past: [], future: [] })
  const interactionRef = useRef(null)
  const playbackRef = useRef({ clips: [], activeClipId: null, isPlaying: false })
  const clipboardRef = useRef([]) // copied clips (with relative startTimes)

  const [isPlaying, setIsPlaying] = useState(false)
  const [videos, setVideos] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [clips, setClips] = useState([])
  const [activeClipId, setActiveClipId] = useState(null)
  const [timelineTime, setTimelineTime] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const [dropIndicatorTime, setDropIndicatorTime] = useState(null)
  const [snapIndicatorTime, setSnapIndicatorTime] = useState(null)
  const [interaction, setInteraction] = useState(null)
  const [pxPerSec, setPxPerSec] = useState(40)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [historySizes, setHistorySizes] = useState({ past: 0, future: 0 })
  const [peaksMap, setPeaksMap] = useState({}) // videoId -> peaks[] (or null while loading)
  const [thumbsMap, setThumbsMap] = useState({}) // videoId -> dataURL[] (or null while loading)
  const [videoDurations, setVideoDurations] = useState({}) // videoId -> seconds (probed once after import)
  const [contextMenu, setContextMenu] = useState(null) // {x, y, clipId}
  const [scrubTooltip, setScrubTooltip] = useState(null) // {x, time} during seek drag
  const [selectedGap, setSelectedGap] = useState(null) // { start, end }
  const [selectedClipIds, setSelectedClipIds] = useState(() => new Set())
  const [marqueeBox, setMarqueeBox] = useState(null) // { x1, y1, x2, y2 } in tracks-content px
  const [importDragInfo, setImportDragInfo] = useState(null) // { videoId, name, dur, insertPoint, mode, simulatedLayout }
  const draggedVideoIdRef = useRef(null)
  const [dragTooltip, setDragTooltip] = useState(null) // { x, y, label }

  // --- Settings (persisted in localStorage) ---
  const [settings, setSettings] = useState(() => {
    try {
      const raw = localStorage.getItem('stonecutter.settings')
      if (raw) return { imageDuration: 3, ...JSON.parse(raw) }
    } catch { /* ignored */ }
    return { imageDuration: 3 }
  })
  const [showSettings, setShowSettings] = useState(false)
  const [aspectRatio, setAspectRatio] = useState('16:9')
  const [showExport, setShowExport] = useState(false)
  const [exportQuality, setExportQuality] = useState('medium')
  const [exportStatus, setExportStatus] = useState(null) // null | 'running' | { ok, msg }

  const handleExport = async () => {
    if (!isTauri) return
    if (clips.length === 0) { setExportStatus({ ok: false, msg: 'Keine Clips auf der Timeline.' }); return }

    // Build segments: sorted clips + gaps
    const sorted = [...clips].sort((a, b) => a.startTime - b.startTime)
    const segments = []
    let prevEnd = 0
    for (const clip of sorted) {
      if (clip.startTime > prevEnd + 0.005) {
        segments.push({ source_path: '', in_point: 0, out_point: clip.startTime - prevEnd, media_type: 'gap' })
      }
      const vid = videos.find((v) => v.id === clip.videoId)
      const srcPath = vid?.path || ''
      // Validate full path (not just filename)
      const isAbsolute = /^[A-Za-z]:[\\/]/.test(srcPath) || srcPath.startsWith('/')
      if (!isAbsolute) {
        setExportStatus({ ok: false, msg: `"${vid?.name || clip.videoId}" wurde per Browser importiert – für den Export muss die Datei über den Tauri-Dateidialog geöffnet werden.` })
        return
      }
      segments.push({ source_path: srcPath, in_point: clip.inPoint, out_point: clip.outPoint, media_type: vid?.mediaType || 'video' })
      prevEnd = clip.startTime + (clip.outPoint - clip.inPoint)
    }

    const qualityMap = { low: { crf: 28, preset: 'veryfast' }, medium: { crf: 23, preset: 'fast' }, high: { crf: 18, preset: 'slow' } }
    const { crf, preset } = qualityMap[exportQuality]
    const [w, h] = aspectRatio === '9:16' ? [1080, 1920] : [1920, 1080]

    try {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const outputPath = await save({ defaultPath: 'export.mp4', filters: [{ name: 'MP4 Video', extensions: ['mp4'] }] })
      if (!outputPath) return

      setExportStatus('running')
      const { invoke } = await import('@tauri-apps/api/core')
      const result = await invoke('export_video', { segments, outputPath, width: w, height: h, crf, preset })

      const noAudio = typeof result === 'string' && result.includes('|no_audio')
      setExportStatus({ ok: true, msg: noAudio ? 'Export erfolgreich (kein Audiotrack in den Quellen – stilles Video).' : 'Export erfolgreich!' })
    } catch (err) {
      setExportStatus({ ok: false, msg: String(err) })
    }
  }
  useEffect(() => {
    try { localStorage.setItem('stonecutter.settings', JSON.stringify(settings)) } catch { /* ignored */ }
  }, [settings])

  const activeVideo = videos.find((v) => v.id === activeId)
  const videoSrc = activeVideo?.src || ''
  const activeClip = clips.find((c) => c.id === activeClipId)

  // While the user is dragging from the sidebar, render the simulated layout instead of the real clips.
  const displayClips = importDragInfo?.simulatedLayout || clips

  // Track which clips are currently being dragged → used for `.dragging` CSS class (z-index lift)
  const draggingIds = useMemo(() => {
    if (!interaction) return null
    if (interaction.type !== 'move' && interaction.type !== 'trim-left' && interaction.type !== 'trim-right') return null
    if (interaction.selectedSnaps) return new Set(interaction.selectedSnaps.map((s) => s.id))
    if (interaction.clipId) return new Set([interaction.clipId])
    return null
  }, [interaction])
  const totalEnd = useMemo(
    () => displayClips.reduce((m, c) => Math.max(m, c.startTime + (c.outPoint - c.inPoint)), 0),
    [displayClips]
  )
  const totalWidth = Math.max(800, totalEnd * pxPerSec + 200)
  const playheadX = timelineTime * pxPerSec

  // --- history ---
  const syncHistorySizes = useCallback(() => {
    setHistorySizes({
      past: historyRef.current.past.length,
      future: historyRef.current.future.length,
    })
  }, [])

  const pushHistory = useCallback((snapshot) => {
    historyRef.current.past.push(snapshot)
    if (historyRef.current.past.length > 50) historyRef.current.past.shift()
    historyRef.current.future = []
    syncHistorySizes()
  }, [syncHistorySizes])

  const commitClips = useCallback((newClips) => {
    pushHistory(clips.map((c) => ({ ...c })))
    setClips(newClips)
  }, [clips, pushHistory])

  const undo = useCallback(() => {
    const past = historyRef.current.past
    if (past.length === 0) return
    const prev = past.pop()
    historyRef.current.future.push(clips.map((c) => ({ ...c })))
    setClips(prev)
    syncHistorySizes()
    setActiveClipId((aid) => (aid && prev.some((c) => c.id === aid) ? aid : null))
  }, [clips, syncHistorySizes])

  const redo = useCallback(() => {
    const fut = historyRef.current.future
    if (fut.length === 0) return
    const next = fut.pop()
    historyRef.current.past.push(clips.map((c) => ({ ...c })))
    setClips(next)
    syncHistorySizes()
    setActiveClipId((aid) => (aid && next.some((c) => c.id === aid) ? aid : null))
  }, [clips, syncHistorySizes])

  // ---- Helpers: find clip at time / next clip ----
  const findClipAtTime = useCallback((t, list = clips) => {
    for (const c of list) {
      const dur = c.outPoint - c.inPoint
      if (t >= c.startTime - 1e-3 && t < c.startTime + dur - 1e-3) return c
    }
    return null
  }, [clips])

  const findNextClipAfter = useCallback((t, list = clips) => {
    let best = null
    for (const c of list) {
      if (c.startTime >= t - 1e-3) {
        if (!best || c.startTime < best.startTime) best = c
      }
    }
    return best
  }, [clips])

  // --- player ---
  const handlePlay = useCallback(() => {
    if (!videoRef.current) return
    if (!videoRef.current.paused) {
      videoRef.current.pause()
      return
    }
    // Try to find the clip at current playhead, or the next one after
    const atHead = findClipAtTime(timelineTime)
    const target = atHead || findNextClipAfter(timelineTime + 0.001)
    if (target) {
      const sameClip = target.id === activeClipId
      const offsetInClip = atHead ? Math.max(0, timelineTime - target.startTime) : 0
      const videoTime = target.inPoint + offsetInClip
      if (sameClip) {
        if (videoRef.current.currentTime >= target.outPoint - 0.05) {
          videoRef.current.currentTime = target.inPoint
        }
        videoRef.current.play().catch(() => {})
      } else {
        // switch source if needed; play after metadata ready
        if (target.videoId !== activeId) {
          setActiveId(target.videoId)
          pendingSeekRef.current = videoTime
          pendingPlayRef.current = true
        } else {
          try { videoRef.current.currentTime = videoTime } catch { /* ignored */ }
          videoRef.current.play().catch(() => {})
        }
        setActiveClipId(target.id)
        if (!atHead) setTimelineTime(target.startTime)
      }
    } else if (videoSrc) {
      // No clips on timeline but a media source is loaded: just play preview
      videoRef.current.play().catch(() => {})
    }
  }, [timelineTime, activeClipId, activeId, videoSrc, findClipAtTime, findNextClipAfter])

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      videoRef.current.volume = volume
      videoRef.current.muted = muted
      if (pendingSeekRef.current != null) {
        try { videoRef.current.currentTime = pendingSeekRef.current } catch { /* ignored */ }
        pendingSeekRef.current = null
      }
      if (pendingPlayRef.current) {
        pendingPlayRef.current = false
        videoRef.current.play().catch(() => {})
      }
    }
  }

  // sync volume/mute to video
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume
      videoRef.current.muted = muted
    }
  }, [volume, muted])

  // Keep playbackRef synced (used inside rAF loop without re-binding)
  useEffect(() => {
    playbackRef.current = { clips, activeClipId, activeId, isPlaying }
  }, [clips, activeClipId, activeId, isPlaying])

  // ---- Smooth playhead via rAF + continuous playback through cuts ----
  useEffect(() => {
    if (!isPlaying) return
    let raf = 0
    const tick = () => {
      const v = videoRef.current
      const state = playbackRef.current
      if (!v || v.paused) { raf = requestAnimationFrame(tick); return }
      if (interactionRef.current?.type === 'seek') { raf = requestAnimationFrame(tick); return }
      const clip = state.clips.find((c) => c.id === state.activeClipId)
      const ct = v.currentTime
      if (clip) {
        // End of current clip → continue with the next clip on the timeline
        if (ct >= clip.outPoint - 0.02) {
          const clipEnd = clip.startTime + (clip.outPoint - clip.inPoint)
          const next = (() => {
            let best = null
            for (const c of state.clips) {
              if (c.id === clip.id) continue
              if (c.startTime >= clipEnd - 0.02) {
                if (!best || c.startTime < best.startTime) best = c
              }
            }
            return best
          })()
          if (next) {
            // Jump (skip any gap) to the next clip and continue playing
            setTimelineTime(next.startTime)
            setActiveClipId(next.id)
            if (next.videoId !== state.activeId) {
              setActiveId(next.videoId)
              pendingSeekRef.current = next.inPoint
              pendingPlayRef.current = true
              v.pause()
            } else {
              try { v.currentTime = next.inPoint } catch { /* ignored */ }
            }
          } else {
            // No more clips → stop at end of timeline
            v.pause()
            setTimelineTime(clipEnd)
          }
        } else if (ct >= clip.inPoint - 0.02) {
          setTimelineTime(clip.startTime + (ct - clip.inPoint))
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying])

  // --- import ---
  // Probe duration for newly imported videos so drag-from-sidebar can show a real-width preview.
  const probeAndCacheDurations = useCallback((items) => {
    for (const item of items) {
      probeDuration(item.src, item.mediaType, settings.imageDuration).then((dur) => {
        setVideoDurations((prev) => ({ ...prev, [item.id]: dur }))
      })
    }
  }, [settings.imageDuration])

  const handleImport = async () => {
    if (isTauri) {
      try {
        const items = await openVideoDialog()
        if (items && items.length > 0) {
          setVideos((prev) => [...prev, ...items])
          if (!activeId) setActiveId(items[0].id)
          probeAndCacheDurations(items)
        }
      } catch (err) {
        console.error('Import failed:', err)
        alert('Import fehlgeschlagen: ' + err)
      }
    } else {
      fileRef.current?.click()
    }
  }

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    const items = files.map((f) => ({
      id: nextId('vid'),
      name: f.name,
      path: f.name,
      src: URL.createObjectURL(f),
      mediaType: f.type.startsWith('image/') ? 'image' : (f.type.startsWith('video/') ? 'video' : getMediaType(f.name)),
    }))
    setVideos((prev) => [...prev, ...items])
    if (!activeId && items.length > 0) setActiveId(items[0].id)
    probeAndCacheDurations(items)
    if (e.target && 'value' in e.target) e.target.value = ''
  }

  const handleSelectMedia = (id) => setActiveId(id)
  const handleDoubleClickMedia = (id) => {
    setActiveId(id)
    setActiveClipId(null)
    setIsPlaying(false)
    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.currentTime = 0
        videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {})
      }
    }, 50)
  }
  const handleRemoveMedia = (id, e) => {
    e.stopPropagation()
    setVideos((prev) => prev.filter((v) => v.id !== id))
    if (activeId === id) {
      setActiveId(null)
      setIsPlaying(false)
    }
  }

  // --- drag from sidebar ---
  const handleDragStart = (e, video) => {
    draggedVideoIdRef.current = video.id
    // Probe lazily if not yet cached, so the very first preview is accurate too.
    if (videoDurations[video.id] == null) {
      probeDuration(video.src, video.mediaType, settings.imageDuration).then((dur) => {
        setVideoDurations((prev) => ({ ...prev, [video.id]: dur }))
      })
    }
    const ghost = document.createElement('div')
    ghost.className = 'drag-ghost'
    ghost.innerHTML = `<span class="drag-ghost-icon">🎬</span><span class="drag-ghost-name">${video.name}</span>`
    Object.assign(ghost.style, { position: 'absolute', top: '-1000px', left: '0px', pointerEvents: 'none' })
    document.body.appendChild(ghost)
    try { e.dataTransfer.setDragImage(ghost, 14, 18) } catch { /* ignored */ }
    setTimeout(() => { if (ghost.parentNode) ghost.parentNode.removeChild(ghost) }, 0)
    e.dataTransfer.setData('text/plain', video.id)
    e.dataTransfer.setData('text', video.id)
    e.dataTransfer.effectAllowed = 'copy'
  }
  const handleDragEnd = () => {
    draggedVideoIdRef.current = null
    setImportDragInfo(null)
    setDragTooltip(null)
  }

  // --- timeline drop ---
  const dropTimeFromEvent = (e) => {
    if (!tracksContentRef.current) return totalEnd
    const rect = tracksContentRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left + tracksContentRef.current.scrollLeft
    return Math.max(0, x / pxPerSec)
  }

  // Compute the simulated timeline layout that would result from dropping `videoId` at `dropTime`.
  // Returns { insertPoint, mode, simulatedLayout, dur }.
  // For Explorer files: videoId = '__explorer__', optional fileName.
  const computeImportPreview = useCallback((videoId, dropTime, fileName = '') => {
    const dur = videoDurations[videoId] || 5
    if (snapEnabled) {
      const ins = detectInsertPoint('__preview__', dropTime + dur / 2, dur, clips)
      if (ins) {
        return {
          insertPoint: ins.insertPoint,
          mode: 'insert',
          simulatedLayout: applyRippleInsert(clips, '__preview__', ins.insertPoint, dur),
          dur,
        }
      }
      return {
        insertPoint: constrainMoveStart(dropTime, dur, clips),
        mode: 'constrain',
        simulatedLayout: clips,
        dur,
      }
    }
    // Snap-off: simulate Filmora-style overwrite (cut existing clips that overlap)
    const start = Math.max(0, dropTime)
    const placeholder = {
      id: '__preview__', videoId, name: fileName, src: '',
      sourceDuration: dur, inPoint: 0, outPoint: dur, startTime: start,
    }
    const cut = resolveOverlaps([...clips, placeholder], '__preview__', () => `prev-${Math.random()}`)
    const simulatedLayout = cut.filter((c) => c.id !== '__preview__')
    return { insertPoint: start, mode: 'overwrite', simulatedLayout, dur }
  }, [clips, snapEnabled, videoDurations])

  const handleTimelineDragEnter = (e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true) }
  const handleTimelineDragOver = (e) => {
    e.preventDefault(); e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    if (!dragOver) setDragOver(true)
    // Auto-scroll near edges during sidebar drag too
    const tcEl = tracksContentRef.current
    if (tcEl) {
      const tcRect = tcEl.getBoundingClientRect()
      const edge = 50
      if (e.clientX < tcRect.left + edge) tcEl.scrollLeft -= 12
      else if (e.clientX > tcRect.right - edge) tcEl.scrollLeft += 12
    }
    const dropTime = dropTimeFromEvent(e)
    setDropIndicatorTime(dropTime)

    // Check for files from Explorer
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('video/') || f.type.startsWith('image/'))
    if (files.length > 0) {
      const file = files[0]
      const preview = computeImportPreview('__explorer__', dropTime, file.name, file.size)
      setImportDragInfo({ videoId: '__explorer__', name: file.name, ...preview })
      const rect = tracksContentRef.current?.getBoundingClientRect()
      if (rect) {
        setDragTooltip({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          label: `${file.name} · ${formatTime(preview.dur || 5)}`,
        })
      }
      return
    }

    // Handle drag from sidebar
    const videoId = draggedVideoIdRef.current
    if (videoId) {
      const video = videos.find((v) => v.id === videoId)
      const preview = computeImportPreview(videoId, dropTime)
      setImportDragInfo({ videoId, name: video?.name || '', ...preview })
      // Tooltip near cursor
      const rect = tracksContentRef.current?.getBoundingClientRect()
      if (rect) {
        setDragTooltip({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          label: `${formatTime(preview.insertPoint)} · ${formatTime(preview.dur)}`,
        })
      }
    }
  }
  const handleTimelineDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return
    setDragOver(false)
    setDropIndicatorTime(null)
    setImportDragInfo(null)
    setDragTooltip(null)
  }
  const handleTimelineDrop = async (e) => {
    e.preventDefault()
    setDragOver(false)
    setDropIndicatorTime(null)
    setImportDragInfo(null)
    setDragTooltip(null)
    draggedVideoIdRef.current = null

    // Check for dropped files from Explorer
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('video/') || f.type.startsWith('image/'))
    if (files.length > 0) {
      // Handle file drop from Explorer
      await handleFileChange({ target: { files } })
      // Auto-drop the first imported file to timeline at drop position
      const dropTime = dropTimeFromEvent(e)
      setTimeout(() => {
        const newVideos = [...videos]
        const lastVideo = newVideos[newVideos.length - 1] // most recently added
        if (lastVideo) {
          const clipId = nextId('clip')
          const placeholderDur = videoDurations[lastVideo.id] || 5
          const pristine = clips
          let placeholderStart = dropTime
          let baseList = pristine
          if (snapEnabled) {
            const ins = detectInsertPoint(clipId, dropTime, placeholderDur, pristine)
            if (ins) {
              placeholderStart = ins.insertPoint
              baseList = applyRippleInsert(pristine, clipId, ins.insertPoint, placeholderDur)
            } else {
              placeholderStart = constrainMoveStart(dropTime, placeholderDur, pristine)
            }
          }
          const placeholder = {
            id: clipId,
            videoId: lastVideo.id,
            name: lastVideo.name,
            src: lastVideo.src,
            sourceDuration: placeholderDur,
            inPoint: 0,
            outPoint: placeholderDur,
            startTime: placeholderStart,
          }
          const initialList = [...baseList, placeholder]
          commitClips(snapEnabled
            ? initialList
            : resolveOverlaps(initialList, clipId, () => nextId('clip')))
        }
      }, 100)
      return
    }

    // Handle drag from sidebar
    const videoId = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text')
    const video = videos.find((v) => v.id === videoId)
    if (!video) return

    const dropTime = dropTimeFromEvent(e)
    const clipId = nextId('clip')
    const placeholderDur = 5
    const pristine = clips // snapshot before insert (for re-rippling after probe)

    // Decide placement (insert / constrain / free)
    let placeholderStart = dropTime
    let baseList = pristine
    let insertPoint = null // remembered for probe re-ripple
    if (snapEnabled) {
      const ins = detectInsertPoint(clipId, dropTime, placeholderDur, pristine)
      if (ins) {
        insertPoint = ins.insertPoint
        placeholderStart = ins.insertPoint
        baseList = applyRippleInsert(pristine, clipId, ins.insertPoint, placeholderDur)
        // applyRippleInsert with non-existent draggedId just shifts later clips; OK.
      } else {
        placeholderStart = constrainMoveStart(dropTime, placeholderDur, pristine)
      }
    }
    const placeholder = {
      id: clipId,
      videoId: video.id,
      name: video.name,
      src: video.src,
      sourceDuration: placeholderDur,
      inPoint: 0,
      outPoint: placeholderDur,
      startTime: placeholderStart,
    }
    const initialList = [...baseList, placeholder]
    commitClips(snapEnabled
      ? initialList
      : resolveOverlaps(initialList, clipId, () => nextId('clip')))

    const duration = await probeDuration(video.src)
    setClips((prev) => {
      const placeholderClip = prev.find((c) => c.id === clipId)
      if (!placeholderClip) return prev // user removed it during probe
      let updated = prev.map((c) =>
        c.id === clipId ? { ...c, sourceDuration: duration, outPoint: duration } : c
      )
      if (!snapEnabled) {
        return resolveOverlaps(updated, clipId, () => nextId('clip'))
      }
      // Snap-on: adjust ripple by (actualDuration - placeholderDur) for clips behind the insert point
      if (insertPoint != null) {
        const extra = duration - placeholderDur
        if (Math.abs(extra) > 1e-3) {
          const insertEnd = placeholderStart + placeholderDur // boundary in current (already-rippled) timeline
          updated = updated.map((x) => {
            if (x.id === clipId) return x
            if (x.startTime >= insertEnd - 1e-3) return { ...x, startTime: x.startTime + extra }
            return x
          })
        }
        return updated
      }
      // Gap mode: trim outPoint if it now overlaps the right neighbor
      const c = updated.find((x) => x.id === clipId)
      if (!c) return updated
      const others = updated.filter((x) => x.id !== clipId)
      const maxRight = maxEndForTrimRight(c.startTime, others)
      const cEnd = c.startTime + (c.outPoint - c.inPoint)
      if (cEnd > maxRight + 1e-3) {
        const newOutPoint = Math.max(
          c.inPoint + MIN_CLIP_DURATION,
          c.inPoint + (maxRight - c.startTime)
        )
        return updated.map((x) => x.id === clipId ? { ...x, outPoint: newOutPoint } : x)
      }
      return updated
    })
  }

  // --- seeking ---
  const seekToTime = useCallback((t) => {
    t = Math.max(0, t)
    setTimelineTime(t)
    const clip = (() => {
      for (const c of clips) {
        const dur = c.outPoint - c.inPoint
        if (t >= c.startTime && t < c.startTime + dur) return c
      }
      return null
    })()
    if (clip) {
      const within = t - clip.startTime
      const videoTime = clip.inPoint + within
      if (clip.id !== activeClipId) {
        setActiveClipId(clip.id)
        setActiveId(clip.videoId)
        pendingSeekRef.current = videoTime
      } else if (videoRef.current) {
        try { videoRef.current.currentTime = videoTime } catch { /* ignored */ }
      }
    }
  }, [clips, activeClipId])

  const getXInTracks = (clientX) => {
    if (!tracksContentRef.current) return 0
    const rect = tracksContentRef.current.getBoundingClientRect()
    return clientX - rect.left + tracksContentRef.current.scrollLeft
  }

  // --- mouse interactions ---
  // Pause helper: pauses if playing and remembers state for resume on mouseup
  const beginScrub = () => {
    const v = videoRef.current
    const wasPlaying = !!(v && !v.paused)
    if (wasPlaying) v.pause()
    return wasPlaying
  }

  const handleTracksMouseDown = (e) => {
    if (e.target.closest('.clip') || e.target.closest('.playhead-handle')) return
    if (e.button !== 0) return
    const x = getXInTracks(e.clientX)
    const t = Math.max(0, x / pxPerSec)
    // Click on the time-ruler keeps classic seek/scrub behavior.
    if (e.target.closest('.time-ruler')) {
      const wasPlaying = beginScrub()
      seekToTime(t)
      const i = { type: 'seek', wasPlaying }
      interactionRef.current = i
      setInteraction(i)
      return
    }
    // Click on track area: detect gap, otherwise prepare for marquee/deselect.
    const gap = findGapAtTime(t, clips)
    const rect = tracksContentRef.current?.getBoundingClientRect()
    const startY = rect
      ? e.clientY - rect.top + (tracksContentRef.current.scrollTop || 0)
      : 0
    const i = {
      type: 'select-pending',
      startX: x,
      startY,
      startClientX: e.clientX,
      startClientY: e.clientY,
      pendingGap: gap,
      additive: e.shiftKey || e.ctrlKey || e.metaKey,
      initialSelection: new Set(selectedClipIds),
    }
    interactionRef.current = i
    setInteraction(i)
  }

  const handlePlayheadMouseDown = (e) => {
    e.stopPropagation(); e.preventDefault()
    const wasPlaying = beginScrub()
    const i = { type: 'seek', wasPlaying }
    interactionRef.current = i
    setInteraction(i)
  }

  const handleClipMouseDown = (e, clip) => {
    if (e.target.closest('.trim-handle') || e.target.closest('.clip-remove')) return
    if (e.button !== 0) return
    e.stopPropagation()
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    setSelectedGap(null)

    // Alt-drag → duplicate the clip(s) and drag the copies (Premiere/Filmora-style)
    if (e.altKey) {
      const idsToClone = (selectedClipIds.has(clip.id) && selectedClipIds.size > 1)
        ? Array.from(selectedClipIds)
        : [clip.id]
      const idMap = new Map()
      const clones = []
      for (const oldId of idsToClone) {
        const c = clips.find((x) => x.id === oldId)
        if (!c) continue
        const newId = nextId('clip')
        idMap.set(oldId, newId)
        clones.push({ ...c, id: newId })
      }
      if (clones.length === 0) return
      const preCloneSnapshot = clips.map((c) => ({ ...c }))
      const newClips = [...clips, ...clones]
      setClips(newClips)
      const newPrimaryId = idMap.get(clip.id)
      const newSelected = new Set(idMap.values())
      setSelectedClipIds(newSelected)
      setActiveClipId(newPrimaryId)
      setActiveId(clip.videoId)
      const x = getXInTracks(e.clientX)
      const i = {
        type: 'move',
        clipId: newPrimaryId,
        startX: x,
        originalClip: clones.find((c) => c.id === newPrimaryId),
        selectedSnaps: clones.length > 1 ? clones.map((c) => ({ ...c })) : null,
        snapshotBefore: newClips.map((c) => ({ ...c })),
        historyBefore: preCloneSnapshot, // undo restores to pre-clone state
        moved: true,
      }
      interactionRef.current = i
      setInteraction(i)
      return
    }

    let selectedIds
    if (additive) {
      // Shift/Ctrl+Click toggles the clip in the multi-selection (no drag)
      const next = new Set(selectedClipIds)
      if (next.has(clip.id)) next.delete(clip.id)
      else next.add(clip.id)
      setSelectedClipIds(next)
      if (next.has(clip.id)) {
        setActiveClipId(clip.id)
        setActiveId(clip.videoId)
      } else if (activeClipId === clip.id) {
        setActiveClipId(next.size > 0 ? next.values().next().value : null)
      }
      return
    }
    if (selectedClipIds.has(clip.id) && selectedClipIds.size > 1) {
      // Clip is part of the multi-selection → drag the whole group
      selectedIds = selectedClipIds
    } else {
      // Single clip: replace selection
      selectedIds = new Set([clip.id])
      setSelectedClipIds(selectedIds)
    }
    setActiveClipId(clip.id)
    setActiveId(clip.videoId)

    const x = getXInTracks(e.clientX)
    const selectedSnaps = clips.filter((c) => selectedIds.has(c.id)).map((c) => ({ ...c }))
    const i = {
      type: 'move',
      clipId: clip.id,
      startX: x,
      originalClip: { ...clip },
      selectedSnaps,
      snapshotBefore: clips.map((c) => ({ ...c })),
      moved: false,
    }
    interactionRef.current = i
    setInteraction(i)
  }

  const handleTrimMouseDown = (e, clip, side) => {
    e.stopPropagation(); e.preventDefault()
    setActiveClipId(clip.id)
    setActiveId(clip.videoId)
    const x = getXInTracks(e.clientX)
    const i = {
      type: side === 'left' ? 'trim-left' : 'trim-right',
      clipId: clip.id,
      startX: x,
      originalClip: { ...clip },
      snapshotBefore: clips.map((c) => ({ ...c })),
      moved: false,
    }
    interactionRef.current = i
    setInteraction(i)
  }

  // snap helper (now returns {value, snapped}). Pass `sourceList` to use snapshot
  // edges instead of live (important during ripple-insert so snap targets stay stable).
  const snapValue = (value, excludeClipId, sourceList = clips) => {
    if (!snapEnabled) return { value, snapped: false }
    const points = [0, timelineTime]
    for (const c of sourceList) {
      if (c.id === excludeClipId) continue
      points.push(c.startTime)
      points.push(c.startTime + (c.outPoint - c.inPoint))
    }
    let best = value
    let bestDistPx = SNAP_THRESHOLD_PX
    let didSnap = false
    for (const p of points) {
      const dPx = Math.abs(p - value) * pxPerSec
      if (dPx < bestDistPx) { bestDistPx = dPx; best = p; didSnap = true }
    }
    return { value: best, snapped: didSnap, snappedTo: didSnap ? best : null }
  }

  // global mouse move/up
  useEffect(() => {
    if (!interaction) return
    const onMove = (ev) => {
      const x = getXInTracks(ev.clientX)
      const it = interactionRef.current
      if (!it) return
      // Shift held → temporarily disable snap during this move (Premiere-style)
      const effSnap = snapEnabled && !ev.shiftKey
      // Auto-scroll near viewport edges while dragging
      const tcEl = tracksContentRef.current
      if (tcEl) {
        const tcRect = tcEl.getBoundingClientRect()
        const edge = 50
        if (ev.clientX < tcRect.left + edge) tcEl.scrollLeft -= 12
        else if (ev.clientX > tcRect.right - edge) tcEl.scrollLeft += 12
      }

      if (it.type === 'seek') {
        const t = Math.max(0, x / pxPerSec)
        seekToTime(t)
        setScrubTooltip({ x, time: t })
        return
      }

      // Pending click on empty track area: become a marquee on enough drag
      if (it.type === 'select-pending') {
        const dx = ev.clientX - it.startClientX
        const dy = ev.clientY - it.startClientY
        if (Math.abs(dx) < MOVE_THRESHOLD_PX && Math.abs(dy) < MOVE_THRESHOLD_PX) return
        it.type = 'marquee'
      }
      if (it.type === 'marquee') {
        const rect = tracksContentRef.current?.getBoundingClientRect()
        if (!rect) return
        const curX = ev.clientX - rect.left + tracksContentRef.current.scrollLeft
        const curY = ev.clientY - rect.top + tracksContentRef.current.scrollTop
        const x1 = Math.min(it.startX, curX), x2 = Math.max(it.startX, curX)
        const y1 = Math.min(it.startY, curY), y2 = Math.max(it.startY, curY)
        setMarqueeBox({ x1, y1, x2, y2 })
        const tStart = x1 / pxPerSec, tEnd = x2 / pxPerSec
        const hits = new Set(it.additive ? Array.from(it.initialSelection) : [])
        for (const c of clips) {
          const cS = c.startTime, cE = c.startTime + (c.outPoint - c.inPoint)
          if (cE > tStart + 1e-3 && cS < tEnd - 1e-3) hits.add(c.id)
        }
        setSelectedClipIds(hits)
        return
      }

      // movement threshold
      if (!it.moved && Math.abs(x - it.startX) < MOVE_THRESHOLD_PX) return
      const orig = it.originalClip
      if (!orig) return
      const deltaSec = (x - it.startX) / pxPerSec

      // Multi-clip move: shift the whole group uniformly, with snap-on ripple-insert support
      if (it.type === 'move' && it.selectedSnaps && it.selectedSnaps.length > 1) {
        const snaps = it.selectedSnaps
        const selectedIdsSet = new Set(snaps.map((s) => s.id))
        const nonSelected = it.snapshotBefore.filter((c) => !selectedIdsSet.has(c.id))
        const leftmostStart = Math.min(...snaps.map((s) => s.startTime))
        const rightmostEnd = Math.max(...snaps.map((s) => s.startTime + (s.outPoint - s.inPoint)))
        const groupDur = rightmostEnd - leftmostStart

        // ── Snap-ON ripple-insert: if the group's projected center is over a non-selected clip
        // (or falls in a too-small gap), push everything aside and drop the entire group there.
        if (effSnap) {
          const proposedLeftmost = leftmostStart + deltaSec
          const proposedCenter = proposedLeftmost + groupDur / 2
          const ins = detectInsertPoint('__group__', proposedCenter, groupDur, nonSelected)
          if (ins) {
            const groupShift = ins.insertPoint - leftmostStart
            const moved = it.snapshotBefore.map((c) => {
              if (selectedIdsSet.has(c.id)) return { ...c, startTime: c.startTime + groupShift }
              // Non-selected clips at-or-after the insert point get pushed right by the group span
              if (c.startTime >= ins.insertPoint - 1e-3) return { ...c, startTime: c.startTime + groupDur }
              return c
            })
            setSnapIndicatorTime(ins.insertPoint)
            setClips(moved)
            it.moved = true
            return
          }
        }

        // ── Otherwise: clamped uniform shift (no insert)
        let delta = deltaSec
        if (effSnap) {
          let maxRightShift = Infinity, maxLeftShift = Infinity
          for (const s of snaps) {
            const sE = s.startTime + (s.outPoint - s.inPoint)
            for (const n of nonSelected) {
              const nS = n.startTime, nE = n.startTime + (n.outPoint - n.inPoint)
              if (nS >= sE - 1e-3 && nS - sE < maxRightShift) maxRightShift = nS - sE
              if (nE <= s.startTime + 1e-3 && s.startTime - nE < maxLeftShift) maxLeftShift = s.startTime - nE
            }
          }
          delta = Math.max(-maxLeftShift, Math.min(maxRightShift, delta))
        }
        delta = Math.max(-leftmostStart, delta)
        // Cache snap map once per move event (was O(n*m) inside the .map below)
        if (!it.snapsMap) it.snapsMap = new Map(snaps.map((s) => [s.id, s]))
        const moved = it.snapshotBefore.map((c) => {
          const s = it.snapsMap.get(c.id)
          return s ? { ...s, startTime: s.startTime + delta } : c
        })
        setSnapIndicatorTime(null)
        setClips(moved)
        it.moved = true
        return
      }

      if (it.type === 'move') {
        const dur = orig.outPoint - orig.inPoint
        let newStart = Math.max(0, orig.startTime + deltaSec)
        if (effSnap) {
          // Ripple-insert mode: when the dragged clip's center sits over another clip,
          // or in a gap too small for it, push the rest of the timeline aside (Filmora-style).
          const center = newStart + dur / 2
          const ins = detectInsertPoint(orig.id, center, dur, it.snapshotBefore)
          if (ins) {
            setClips(applyRippleInsert(it.snapshotBefore, orig.id, ins.insertPoint, dur))
            setSnapIndicatorTime(ins.insertPoint)
            it.moved = true
            return
          }
          // Otherwise: edge-snap to snapshot positions, then constrain to non-overlap
          const sStart = snapValue(newStart, orig.id, it.snapshotBefore)
          const sEnd = snapValue(newStart + dur, orig.id, it.snapshotBefore)
          const distStart = Math.abs(sStart.value - newStart)
          const distEnd = Math.abs(sEnd.value - (newStart + dur))
          let snappedAt = null
          if (sStart.snapped && (!sEnd.snapped || distStart * pxPerSec <= distEnd * pxPerSec)) {
            newStart = sStart.value; snappedAt = sStart.value
          } else if (sEnd.snapped) {
            newStart = sEnd.value - dur; snappedAt = sEnd.value
          }
          if (newStart < 0) { newStart = 0; snappedAt = 0 }
          const others = it.snapshotBefore.filter((c) => c.id !== orig.id)
          const constrained = constrainMoveStart(newStart, dur, others)
          if (Math.abs(constrained - newStart) > 1e-3) snappedAt = null
          newStart = constrained
          // Restore other clips to snapshot positions (in case a previous frame rippled them)
          setSnapIndicatorTime(snappedAt)
          setClips(it.snapshotBefore.map((c) => c.id === orig.id ? { ...c, startTime: newStart } : c))
          it.moved = true
        } else {
          // Snap-off: free move; snap-off snap is no-op anyway
          if (newStart < 0) newStart = 0
          setSnapIndicatorTime(null)
          setClips((prev) => prev.map((c) => c.id === orig.id ? { ...c, startTime: newStart } : c))
          it.moved = true
        }
      } else if (it.type === 'trim-left') {
        const minNewIn = Math.max(0, orig.inPoint - orig.startTime)
        let newInPoint = Math.max(minNewIn, Math.min(orig.outPoint - MIN_CLIP_DURATION, orig.inPoint + deltaSec))
        let finalStart = Math.max(0, orig.startTime + (newInPoint - orig.inPoint))
        const s = snapValue(finalStart, orig.id)
        let snappedAt = null
        if (s.snapped) {
          const adjustedIn = newInPoint + (s.value - finalStart)
          if (adjustedIn >= minNewIn && adjustedIn < orig.outPoint - MIN_CLIP_DURATION) {
            newInPoint = adjustedIn
            finalStart = orig.startTime + (newInPoint - orig.inPoint)
            snappedAt = s.value
          }
        }
        // Snap-on: prevent overlap with left neighbor
        if (effSnap) {
          const others = clips.filter((c) => c.id !== orig.id)
          const fixedRight = orig.startTime + (orig.outPoint - orig.inPoint)
          const minLeft = minStartForTrimLeft(fixedRight, others)
          if (finalStart < minLeft - 1e-3) {
            const delta = minLeft - finalStart
            newInPoint = Math.min(orig.outPoint - MIN_CLIP_DURATION, newInPoint + delta)
            finalStart = orig.startTime + (newInPoint - orig.inPoint)
            snappedAt = null
          }
        }
        setSnapIndicatorTime(snappedAt)
        setClips((prev) => prev.map((c) => c.id === orig.id
          ? { ...c, inPoint: newInPoint, startTime: finalStart }
          : c))
        it.moved = true
      } else if (it.type === 'trim-right') {
        let newOutPoint = Math.max(orig.inPoint + MIN_CLIP_DURATION,
                                    Math.min(orig.sourceDuration, orig.outPoint + deltaSec))
        let rightOnTimeline = orig.startTime + (newOutPoint - orig.inPoint)
        const s = snapValue(rightOnTimeline, orig.id)
        let snappedAt = null
        if (s.snapped) {
          const adjustedOut = newOutPoint + (s.value - rightOnTimeline)
          if (adjustedOut > orig.inPoint + MIN_CLIP_DURATION && adjustedOut <= orig.sourceDuration) {
            newOutPoint = adjustedOut
            rightOnTimeline = orig.startTime + (newOutPoint - orig.inPoint)
            snappedAt = s.value
          }
        }
        // Snap-on: prevent overlap with right neighbor
        if (effSnap) {
          const others = clips.filter((c) => c.id !== orig.id)
          const maxRight = maxEndForTrimRight(orig.startTime, others)
          if (rightOnTimeline > maxRight + 1e-3) {
            const delta = rightOnTimeline - maxRight
            newOutPoint = Math.max(orig.inPoint + MIN_CLIP_DURATION, newOutPoint - delta)
            snappedAt = null
          }
        }
        setSnapIndicatorTime(snappedAt)
        setClips((prev) => prev.map((c) => c.id === orig.id ? { ...c, outPoint: newOutPoint } : c))
        it.moved = true
      }
    }
    const onUp = () => {
      const it = interactionRef.current
      if (it && it.type === 'select-pending') {
        // Pure click: select gap, or deselect everything
        if (it.pendingGap) {
          setSelectedGap(it.pendingGap)
          if (!it.additive) setSelectedClipIds(new Set())
          setActiveClipId(null)
        } else if (!it.additive) {
          setSelectedClipIds(new Set())
          setSelectedGap(null)
          setActiveClipId(null)
        }
      } else if (it && it.type === 'marquee') {
        // Selection already updated during drag; just clear the box
        setMarqueeBox(null)
      } else if (it && it.moved && it.snapshotBefore) {
        // Alt-drag stores a separate pre-clone snapshot so undo restores to before duplication.
        pushHistory(it.historyBefore || it.snapshotBefore)
        // Snap-off: cut overlapping neighbors (Filmora overwrite)
        if (!snapEnabled) {
          const isMultiMove = it.type === 'move' && it.selectedSnaps && it.selectedSnaps.length > 1
          if (isMultiMove) {
            const ids = new Set(it.selectedSnaps.map((s) => s.id))
            setClips((prev) => resolveOverlapsMulti(prev, ids, () => nextId('clip')))
          } else if (it.type === 'move' || it.type === 'trim-left' || it.type === 'trim-right') {
            setClips((prev) => resolveOverlaps(prev, it.clipId, () => nextId('clip')))
          }
        }
      }
      // Resume playback if it was playing before a scrub
      if (it && it.type === 'seek' && it.wasPlaying && videoRef.current) {
        videoRef.current.play().catch(() => {})
      }
      interactionRef.current = null
      setInteraction(null)
      setSnapIndicatorTime(null)
      setScrubTooltip(null)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interaction, clips, timelineTime, activeClipId, pxPerSec, snapEnabled])

  // ---- Clip actions ----
  const duplicateClip = useCallback((clipId) => {
    const clip = clips.find((c) => c.id === clipId)
    if (!clip) return
    const dur = clip.outPoint - clip.inPoint
    const newId = nextId('clip')
    let newStart = clip.startTime + dur
    if (snapEnabled) newStart = constrainMoveStart(newStart, dur, clips)
    const newClip = { ...clip, id: newId, startTime: newStart }
    let next = [...clips, newClip]
    if (!snapEnabled) next = resolveOverlaps(next, newId, () => nextId('clip'))
    commitClips(next)
    setActiveClipId(newId)
  }, [clips, commitClips, snapEnabled])

  const restoreTrim = useCallback((clipId) => {
    const clip = clips.find((c) => c.id === clipId)
    if (!clip) return
    const others = clips.filter((c) => c.id !== clipId)
    const fullStart = clip.startTime - clip.inPoint
    const proposedStart = Math.max(0, fullStart)
    const proposedEnd = fullStart + clip.sourceDuration
    if (snapEnabled) {
      let leftLimit = 0
      for (const o of others) {
        const oE = o.startTime + (o.outPoint - o.inPoint)
        if (oE <= clip.startTime + 1e-3 && oE > leftLimit) leftLimit = oE
      }
      const oldRight = clip.startTime + (clip.outPoint - clip.inPoint)
      let rightLimit = Infinity
      for (const o of others) {
        if (o.startTime >= oldRight - 1e-3 && o.startTime < rightLimit) rightLimit = o.startTime
      }
      const newStart = Math.max(proposedStart, leftLimit)
      const newEnd = Math.min(proposedEnd, rightLimit)
      if (newEnd - newStart < MIN_CLIP_DURATION) return
      const newInPoint = newStart - fullStart
      const newOutPoint = newEnd - fullStart
      commitClips(clips.map((c) => c.id === clipId
        ? { ...c, inPoint: newInPoint, outPoint: newOutPoint, startTime: newStart }
        : c))
    } else {
      const restored = clips.map((c) => c.id === clipId
        ? { ...c, inPoint: 0, outPoint: c.sourceDuration, startTime: proposedStart }
        : c)
      commitClips(resolveOverlaps(restored, clipId, () => nextId('clip')))
    }
  }, [clips, commitClips, snapEnabled])

  const handleClipContextMenu = (e, clip) => {
    e.preventDefault()
    e.stopPropagation()
    setActiveClipId(clip.id)
    setActiveId(clip.videoId)
    setContextMenu({ x: e.clientX, y: e.clientY, clipId: clip.id })
  }

  // --- split at playhead ---
  const splitAtPlayhead = useCallback(() => {
    const clip = (() => {
      for (const c of clips) {
        const dur = c.outPoint - c.inPoint
        if (timelineTime >= c.startTime && timelineTime < c.startTime + dur) return c
      }
      return null
    })()
    if (!clip) return
    const splitInSource = clip.inPoint + (timelineTime - clip.startTime)
    if (splitInSource <= clip.inPoint + MIN_CLIP_DURATION ||
        splitInSource >= clip.outPoint - MIN_CLIP_DURATION) return
    const rightId = nextId('clip')
    const left = { ...clip, outPoint: splitInSource }
    const right = {
      ...clip,
      id: rightId,
      inPoint: splitInSource,
      startTime: timelineTime,
    }
    const newClips = clips.flatMap((c) => c.id === clip.id ? [left, right] : [c])
    commitClips(newClips)
    // Move active selection to the right half so subsequent split-key presses keep walking forward
    setActiveClipId(rightId)
    if (selectedClipIds.has(clip.id)) {
      const next = new Set(selectedClipIds)
      next.delete(clip.id)
      next.add(clip.id) // keep left part too (id unchanged)
      next.add(rightId)
      setSelectedClipIds(next)
    }
  }, [clips, timelineTime, commitClips, selectedClipIds])

  const handleClipRemove = (clipId, e) => {
    e.stopPropagation()
    commitClips(clips.filter((c) => c.id !== clipId))
    if (activeClipId === clipId) setActiveClipId(null)
    if (selectedClipIds.has(clipId)) {
      const next = new Set(selectedClipIds)
      next.delete(clipId)
      setSelectedClipIds(next)
    }
  }

  // Context menu handlers (to avoid ESLint ref access warnings)
  const handleContextMenuDuplicate = (clipId) => {
    duplicateClip(clipId)
    setContextMenu(null)
  }

  const handleContextMenuDelete = (clipId) => {
    commitClips(clips.filter((c) => c.id !== clipId))
    setActiveClipId(null)
    setContextMenu(null)
  }

  const handleClipDoubleClick = (clip, e) => {
    e.stopPropagation()
    setActiveClipId(clip.id)
    setActiveId(clip.videoId)
    pendingSeekRef.current = clip.inPoint
    setTimelineTime(clip.startTime)
    setIsPlaying(false)
    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.currentTime = clip.inPoint
        videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {})
      }
    }, 50)
  }

  // --- keyboard shortcuts ---
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return

      if (e.code === 'Space') {
        e.preventDefault()
        handlePlay()
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        // Ctrl/Cmd+Delete = ripple-delete (also closes the gap left behind)
        const ripple = e.ctrlKey || e.metaKey
        if (selectedGap) {
          e.preventDefault()
          commitClips(closeGap(clips, selectedGap))
          setSelectedGap(null)
          return
        }
        const ids = selectedClipIds.size > 0
          ? selectedClipIds
          : (activeClipId ? new Set([activeClipId]) : null)
        if (ids && ids.size > 0) {
          e.preventDefault()
          if (ripple) {
            commitClips(rippleDeleteClips(clips, ids))
          } else {
            commitClips(clips.filter((c) => !ids.has(c.id)))
          }
          setSelectedClipIds(new Set())
          setActiveClipId(null)
        }
      } else if (e.code === 'Escape') {
        setSelectedClipIds(new Set())
        setSelectedGap(null)
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault(); undo()
      } else if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
                 ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault(); redo()
      } else if (e.code === 'KeyS' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault(); splitAtPlayhead()
      } else if (e.code === 'KeyN' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault(); setSnapEnabled((v) => !v)
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        if (activeClipId) duplicateClip(activeClipId)
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        // Copy selected clips to clipboard
        const ids = selectedClipIds.size > 0 ? selectedClipIds : (activeClipId ? new Set([activeClipId]) : null)
        if (ids && ids.size > 0) {
          e.preventDefault()
          const sel = clips.filter((c) => ids.has(c.id))
          const minStart = Math.min(...sel.map((c) => c.startTime))
          clipboardRef.current = sel.map((c) => ({ ...c, _relStart: c.startTime - minStart }))
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        const ids = selectedClipIds.size > 0 ? selectedClipIds : (activeClipId ? new Set([activeClipId]) : null)
        if (ids && ids.size > 0) {
          e.preventDefault()
          const sel = clips.filter((c) => ids.has(c.id))
          const minStart = Math.min(...sel.map((c) => c.startTime))
          clipboardRef.current = sel.map((c) => ({ ...c, _relStart: c.startTime - minStart }))
          commitClips(clips.filter((c) => !ids.has(c.id)))
          setSelectedClipIds(new Set())
          setActiveClipId(null)
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (clipboardRef.current && clipboardRef.current.length > 0) {
          e.preventDefault()
          const groupMinStart = Math.min(...clipboardRef.current.map((c) => c._relStart || 0))
          const pasteTime = timelineTime
          const groupDur = Math.max(...clipboardRef.current.map((c) => (c.outPoint - c.inPoint) + (c._relStart || 0))) - groupMinStart
          let insertPoint = pasteTime

          // Compute insert point like import drag does
          if (snapEnabled) {
            const ins = detectInsertPoint('__paste__', pasteTime + groupDur / 2, groupDur, clips)
            if (ins) insertPoint = ins.insertPoint
          }

          const newIds = []
          const newClips = clipboardRef.current.map((c) => {
            const newId = nextId('clip')
            newIds.push(newId)
            const { _relStart, ...rest } = c
            return { ...rest, id: newId, startTime: insertPoint + ((_relStart || 0) - groupMinStart) }
          })

          let merged = [...clips, ...newClips]
          if (snapEnabled) {
            // Ripple insert: shift clips at/after insertPoint
            merged = applyRippleInsert(merged, '__paste__', insertPoint, groupDur)
          } else {
            // Overwrite mode: cut conflicts
            for (const id of newIds) merged = resolveOverlaps(merged, id, () => nextId('clip'))
          }
          commitClips(merged)
          setSelectedClipIds(new Set(newIds))
          setActiveClipId(newIds[0])
        }
      } else if (e.code === 'ArrowLeft' && selectedClipIds.size > 0 && !e.repeat) {
        // Move selected clip(s) by 1 frame (or 1s with Shift). Only if a selection exists; otherwise seek.
        e.preventDefault()
        const step = e.shiftKey ? 1 : 1 / 30
        commitClips(clips.map((c) => selectedClipIds.has(c.id)
          ? { ...c, startTime: Math.max(0, c.startTime - step) } : c))
      } else if (e.code === 'ArrowRight' && selectedClipIds.size > 0 && !e.repeat) {
        e.preventDefault()
        const step = e.shiftKey ? 1 : 1 / 30
        commitClips(clips.map((c) => selectedClipIds.has(c.id)
          ? { ...c, startTime: c.startTime + step } : c))
      } else if (e.code === 'KeyJ') {
        e.preventDefault()
        if (videoRef.current) {
          videoRef.current.playbackRate = -1 // not supported in most browsers; fallback: just rewind
          videoRef.current.pause()
          seekToTime(Math.max(0, timelineTime - 0.5))
        }
      } else if (e.code === 'KeyK') {
        e.preventDefault(); handlePlay()
      } else if (e.code === 'KeyL') {
        e.preventDefault()
        if (videoRef.current) videoRef.current.play().catch(() => {})
      } else if (e.code === 'Comma') {
        e.preventDefault()
        // frame back (~33ms = 30fps)
        seekToTime(Math.max(0, timelineTime - 0.033))
      } else if (e.code === 'Period') {
        e.preventDefault()
        seekToTime(timelineTime + 0.033)
      } else if (e.code === 'Home') {
        e.preventDefault(); seekToTime(0)
      } else if (e.code === 'End') {
        e.preventDefault(); seekToTime(totalEnd)
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        seekToTime(Math.max(0, timelineTime - (e.shiftKey ? 1 : 0.1)))
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        seekToTime(timelineTime + (e.shiftKey ? 1 : 0.1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeClipId, clips, timelineTime, totalEnd, handlePlay, undo, redo, splitAtPlayhead, seekToTime, commitClips, duplicateClip, selectedClipIds, selectedGap, snapEnabled])

  // Generate waveforms for clips' source videos (cached per videoId)
  useEffect(() => {
    const needed = new Set(clips.map((c) => c.videoId))
    needed.forEach((vid) => {
      if (vid in peaksMap) return
      const video = videos.find((v) => v.id === vid)
      if (!video) return
      setPeaksMap((prev) => ({ ...prev, [vid]: null }))
      generateWaveform(video.src).then((peaks) => {
        setPeaksMap((prev) => ({ ...prev, [vid]: peaks || [] }))
      })
    })
  }, [clips, videos, peaksMap])

  // Generate video-frame thumbnails for clips' source videos (cached per videoId)
  useEffect(() => {
    const needed = new Set(clips.map((c) => c.videoId))
    needed.forEach((vid) => {
      if (vid in thumbsMap) return
      const video = videos.find((v) => v.id === vid)
      if (!video) return
      setThumbsMap((prev) => ({ ...prev, [vid]: null }))
      const genFn = video.mediaType === 'image' ? generateImageThumbnails : generateThumbnails
      genFn(video.src).then((thumbs) => {
        setThumbsMap((prev) => ({ ...prev, [vid]: thumbs || [] }))
      })
    })
  }, [clips, videos, thumbsMap])

  // Close context menu on outside click / scroll
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    document.addEventListener('mousedown', close)
    document.addEventListener('scroll', close, true)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('scroll', close, true)
      window.removeEventListener('blur', close)
    }
  }, [contextMenu])

  // Validate the selected gap on every render: only show if it still exists in the live clip layout.
  // Stale `selectedClipIds` IDs are harmless (`.has()` simply returns false for non-existent ids).
  const validSelectedGap = useMemo(() => {
    if (!selectedGap) return null
    const sorted = [...clips].sort((a, b) => a.startTime - b.startTime)
    let prevEnd = 0
    for (const c of sorted) {
      if (c.startTime > prevEnd + 1e-3 &&
          Math.abs(prevEnd - selectedGap.start) < 0.05 &&
          Math.abs(c.startTime - selectedGap.end) < 0.05) {
        return selectedGap
      }
      prevEnd = Math.max(prevEnd, c.startTime + (c.outPoint - c.inPoint))
    }
    return null
  }, [selectedGap, clips])

  // Auto-scroll only when needed
  useEffect(() => {
    const el = tracksContentRef.current
    if (!el) return
    const margin = 60
    if (playheadX < el.scrollLeft + margin) {
      el.scrollLeft = Math.max(0, playheadX - margin)
    } else if (playheadX > el.scrollLeft + el.clientWidth - margin) {
      el.scrollLeft = playheadX - el.clientWidth + margin
    }
  }, [playheadX])

  const stepBack = () => seekToTime(Math.max(0, timelineTime - 1))
  const stepFwd = () => seekToTime(timelineTime + 1)

  return (
    <div className="app">
      <img
        src={logoUrl}
        alt="StoneCutter"
        className="app-logo"
        draggable={false}
      />
      <input
        ref={fileRef}
        type="file"
        accept="video/*,image/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* ===== Sidebar ===== */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2 className="sidebar-title">Mediathek</h2>
          <button className="import-btn" onClick={handleImport} title="Videos importieren">
            <Icon.Plus /> Import
          </button>
        </div>
        <div
          className="video-list"
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy' }}
          onDrop={async (e) => {
            e.preventDefault(); e.stopPropagation()
            const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('video/') || f.type.startsWith('image/'))
            if (files.length === 0) return
            await handleFileChange({ target: { files } })
          }}
        >
          {videos.length === 0 && (
            <div className="empty-list">
              <p>Keine Videos importiert.</p>
              <p className="hint">Klicke "+ Import" oder ziehe Dateien hierher.</p>
            </div>
          )}
          {videos.map((v) => (
            <div
              key={v.id}
              className={`video-item ${v.id === activeId ? 'active' : ''}`}
              draggable
              onDragStart={(e) => handleDragStart(e, v)}
              onDragEnd={handleDragEnd}
              onClick={() => handleSelectMedia(v.id)}
              onDoubleClick={() => handleDoubleClickMedia(v.id)}
              title={`${v.path}\nDoppelklick = Vorschau · Ziehen = auf Timeline`}
            >
              <div className="video-icon">{v.mediaType === 'image' ? <Icon.Image /> : <Icon.Play />}</div>
              <div className="video-info">
                <div className="video-name">{v.name}</div>
              </div>
              <button
                className="remove-btn"
                onClick={(e) => handleRemoveMedia(v.id, e)}
                title="Aus Mediathek entfernen"
              ><Icon.Trash /></button>
            </div>
          ))}
        </div>
      </aside>

      {/* ===== Player ===== */}
      <main className="main-content">
        <div className={`player-wrapper ${aspectRatio === '9:16' ? 'ar-portrait' : 'ar-landscape'}`}>
          {/* Aspect Ratio Switcher */}
          <div className="ar-switcher">
            {['16:9', '9:16'].map((ar) => (
              <button
                key={ar}
                className={`ar-btn ${aspectRatio === ar ? 'active' : ''}`}
                onClick={() => setAspectRatio(ar)}
                title={ar === '16:9' ? 'Querformat (16:9)' : 'Hochformat (9:16)'}
              >
                <span className={`ar-icon ar-icon-${ar.replace(':', '-')}`} />
                {ar}
              </button>
            ))}
          </div>

          <div className="video-container">
            {videoSrc && activeVideo?.mediaType === 'image' ? (
              <img
                key={videoSrc}
                src={videoSrc}
                className="video player-image"
                alt={activeVideo?.name}
                draggable={false}
              />
            ) : videoSrc ? (
              <video
                ref={videoRef}
                key={videoSrc}
                className="video"
                onClick={handlePlay}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onLoadedMetadata={handleLoadedMetadata}
                src={videoSrc}
              />
            ) : (
              <div className="empty-overlay">
                <p>Wähle ein Medium aus der Mediathek</p>
                <p className="hint">Doppelklick zur Vorschau · Ziehen auf die Timeline</p>
              </div>
            )}
          </div>

          {activeVideo && (
            <div className="video-title-bar">
              <span className="title-name">{activeVideo.name}</span>
              {activeVideo.mediaType === 'image' && <span className="media-type-badge">Bild · {settings.imageDuration}s</span>}
            </div>
          )}
        </div>
      </main>

      {/* ===== Timeline ===== */}
      <section
        className={`timeline ${dragOver ? 'drag-over' : ''}`}
        onDragEnter={handleTimelineDragEnter}
        onDragOver={handleTimelineDragOver}
        onDragLeave={handleTimelineDragLeave}
        onDrop={handleTimelineDrop}
      >
        {/* Toolbar */}
        <div className="timeline-toolbar">
          <div className="tb-group">
            <button className="tb-btn" onClick={() => seekToTime(0)} title="Zum Anfang (Home)"><Icon.SkipStart /></button>
            <button className="tb-btn" onClick={stepBack} title="1s zurück (←)"><Icon.StepBack /></button>
            <button className="tb-btn play" onClick={handlePlay} title="Play/Pause (Space)">
              {isPlaying ? <Icon.Pause /> : <Icon.Play />}
            </button>
            <button className="tb-btn" onClick={stepFwd} title="1s vor (→)"><Icon.StepFwd /></button>
            <button className="tb-btn" onClick={() => seekToTime(totalEnd)} title="Zum Ende (End)"><Icon.SkipEnd /></button>
          </div>

          <div className="tb-timecode">
            <span className="tc-current">{formatTC(timelineTime)}</span>
            <span className="tc-sep">/</span>
            <span className="tc-total">{formatTC(totalEnd)}</span>
          </div>

          <div className="tb-group">
            <button className="tb-btn" onClick={splitAtPlayhead} title="Am Playhead teilen (S)"><Icon.Cut /></button>
            <button className="tb-btn" onClick={undo} title="Rückgängig (Ctrl+Z)" disabled={historySizes.past === 0}><Icon.Undo /></button>
            <button className="tb-btn" onClick={redo} title="Wiederholen (Ctrl+Y)" disabled={historySizes.future === 0}><Icon.Redo /></button>
          </div>

          <div className="tb-spacer" />

          <button
            className={`tb-btn toggle ${snapEnabled ? 'on' : ''}`}
            onClick={() => setSnapEnabled((v) => !v)}
            title="Magnet-Snap (N)"
          ><Icon.Magnet /></button>

          <button
            className={`tb-btn ${showSettings ? 'active' : ''}`}
            onClick={() => setShowSettings((v) => !v)}
            title="Einstellungen"
          ><Icon.Settings /></button>

          {isTauri && (
            <button
              className="tb-btn export-btn"
              onClick={() => { setExportStatus(null); setShowExport(true) }}
              title="Als MP4 exportieren"
              disabled={clips.length === 0}
            ><Icon.Export /> Export</button>
          )}

          <div className="tb-group volume">
            <button className="tb-btn" onClick={() => setMuted((v) => !v)} title={muted ? 'Stumm aufheben' : 'Stummschalten'}>
              {muted || volume === 0 ? <Icon.Mute /> : <Icon.Volume />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={muted ? 0 : volume}
              onChange={(e) => { setVolume(parseFloat(e.target.value)); if (parseFloat(e.target.value) > 0) setMuted(false) }}
              className="vol-slider"
              title="Lautstärke"
            />
          </div>

          <div className="tb-group zoom">
            <span className="tb-label">Zoom</span>
            <input
              type="range"
              min="10"
              max="120"
              step="2"
              value={pxPerSec}
              onChange={(e) => setPxPerSec(parseInt(e.target.value, 10))}
              className="zoom-slider"
              title="Zoom (px/s)"
            />
          </div>
        </div>

        {/* Tracks */}
        <div className="timeline-tracks">
          <div className="track-labels">
            <div className="track-label time-label" />
            <div className="track-label video-label">V1</div>
            <div className="track-label audio-label">A1</div>
          </div>

          <div
            className="tracks-content"
            ref={tracksContentRef}
            onMouseDown={handleTracksMouseDown}
          >
            <div className="tracks-inner" style={{ width: `${totalWidth}px` }}>
              {/* Time ruler */}
              <div className="time-ruler">
                {Array.from({ length: Math.max(20, Math.ceil(totalEnd) + 5) }).map((_, i) => (
                  <div
                    key={i}
                    className={`tick ${i % 5 === 0 ? 'major' : ''}`}
                    style={{ left: `${i * pxPerSec}px` }}
                  >
                    {i % 5 === 0 && <span className="tick-label">{formatTime(i)}</span>}
                  </div>
                ))}
              </div>

              {/* Video track */}
              <div className="track video-track">
                {displayClips.map((clip) => {
                  const dur = clip.outPoint - clip.inPoint
                  const left = clip.startTime * pxPerSec
                  const width = Math.max(20, dur * pxPerSec)
                  const trimmedLeft = clip.inPoint > 0.01
                  const trimmedRight = clip.outPoint < clip.sourceDuration - 0.01
                  return (
                    <div
                      key={`v-${clip.id}`}
                      className={`clip video-clip ${activeClipId === clip.id ? 'active' : ''} ${selectedClipIds.has(clip.id) ? 'selected' : ''} ${draggingIds?.has(clip.id) ? 'dragging' : ''}`}
                      style={{ left: `${left}px`, width: `${width}px` }}
                      onMouseDown={(e) => handleClipMouseDown(e, clip)}
                      onDoubleClick={(e) => handleClipDoubleClick(clip, e)}
                      onContextMenu={(e) => handleClipContextMenu(e, clip)}
                      title={`${clip.name}\nIn: ${formatTime(clip.inPoint)} · Out: ${formatTime(clip.outPoint)} · Dauer: ${formatTime(dur)}`}
                    >
                      <div
                        className={`trim-handle left ${trimmedLeft ? 'trimmed' : ''}`}
                        onMouseDown={(e) => handleTrimMouseDown(e, clip, 'left')}
                        title="Links trimmen"
                      />
                      {(() => {
                        const thumbs = thumbsMap[clip.videoId]
                        if (thumbs && thumbs.length > 0) {
                          const sd = Math.max(0.001, clip.sourceDuration)
                          const startIdx = Math.max(0, Math.floor((clip.inPoint / sd) * thumbs.length))
                          const endIdx = Math.min(thumbs.length, Math.max(startIdx + 1, Math.ceil((clip.outPoint / sd) * thumbs.length)))
                          const visible = thumbs.slice(startIdx, endIdx)
                          // Stretch to fill clip width via flex
                          return (
                            <div className="video-thumb-strip">
                              {visible.map((url, i) => url
                                ? <div key={i} className="video-thumb" style={{ backgroundImage: `url(${url})` }} />
                                : <div key={i} className="video-thumb empty" />
                              )}
                            </div>
                          )
                        }
                        return <div className={`video-thumb-strip ${thumbs === null ? 'loading' : ''}`} />
                      })()}
                      <div className="clip-content">
                        <span className="clip-name">{clip.name}</span>
                        <span className="clip-duration">{formatTime(dur)}</span>
                      </div>
                      <button
                        className="clip-remove"
                        onClick={(e) => handleClipRemove(clip.id, e)}
                        onMouseDown={(e) => e.stopPropagation()}
                        title="Aus Timeline entfernen"
                      ><Icon.Trash /></button>
                      <div
                        className={`trim-handle right ${trimmedRight ? 'trimmed' : ''}`}
                        onMouseDown={(e) => handleTrimMouseDown(e, clip, 'right')}
                        title="Rechts trimmen"
                      />
                    </div>
                  )
                })}
              </div>

              {/* Audio track */}
              <div className="track audio-track">
                {displayClips.map((clip) => {
                  const dur = clip.outPoint - clip.inPoint
                  const left = clip.startTime * pxPerSec
                  const width = Math.max(20, dur * pxPerSec)
                  return (
                    <div
                      key={`a-${clip.id}`}
                      className={`clip audio-clip ${activeClipId === clip.id ? 'active' : ''} ${selectedClipIds.has(clip.id) ? 'selected' : ''} ${draggingIds?.has(clip.id) ? 'dragging' : ''}`}
                      style={{ left: `${left}px`, width: `${width}px` }}
                      onMouseDown={(e) => handleClipMouseDown(e, clip)}
                      onDoubleClick={(e) => handleClipDoubleClick(clip, e)}
                      onContextMenu={(e) => handleClipContextMenu(e, clip)}
                      title={`${clip.name} – Tonspur`}
                    >
                      <div
                        className="trim-handle left"
                        onMouseDown={(e) => handleTrimMouseDown(e, clip, 'left')}
                      />
                      {(() => {
                        const peaks = peaksMap[clip.videoId]
                        const barCount = Math.max(8, Math.floor(width / 3))
                        if (peaks && peaks.length > 0) {
                          const startIdx = Math.floor((clip.inPoint / Math.max(0.001, clip.sourceDuration)) * peaks.length)
                          const endIdx = Math.max(startIdx + 1, Math.floor((clip.outPoint / Math.max(0.001, clip.sourceDuration)) * peaks.length))
                          const segLen = endIdx - startIdx
                          return (
                            <div className="waveform">
                              {Array.from({ length: barCount }).map((_, i) => {
                                const idx = startIdx + Math.floor((i / barCount) * segLen)
                                const v = peaks[idx] || 0
                                return (
                                  <span
                                    key={i}
                                    className="wave-bar"
                                    style={{ height: `${Math.max(6, v * 100)}%` }}
                                  />
                                )
                              })}
                            </div>
                          )
                        }
                        // loading or unsupported
                        return (
                          <div className={`waveform ${peaks === null ? 'loading' : ''}`}>
                            {Array.from({ length: barCount }).map((_, i) => (
                              <span
                                key={i}
                                className="wave-bar placeholder"
                                style={{ height: `${20 + Math.abs(Math.sin((i + clip.inPoint * 4) * 0.7 + clip.id.length)) * 50}%` }}
                              />
                            ))}
                          </div>
                        )
                      })()}
                      <div
                        className="trim-handle right"
                        onMouseDown={(e) => handleTrimMouseDown(e, clip, 'right')}
                      />
                    </div>
                  )
                })}
              </div>

              {/* Drop indicator (during drag) */}
              {dragOver && dropIndicatorTime != null && (
                <div className="drop-indicator" style={{ left: `${dropIndicatorTime * pxPerSec}px` }} />
              )}

              {/* Snap indicator (during move/trim) */}
              {snapIndicatorTime != null && (
                <div className="snap-indicator" style={{ left: `${snapIndicatorTime * pxPerSec}px` }} />
              )}

              {/* Import-drag preview: ghost clip showing exact position + duration on both tracks */}
              {importDragInfo && (
                <>
                  <div
                    className={`clip ghost-clip video-clip mode-${importDragInfo.mode}`}
                    style={{
                      left: `${importDragInfo.insertPoint * pxPerSec}px`,
                      width: `${Math.max(20, importDragInfo.dur * pxPerSec)}px`,
                    }}
                  >
                    <div className="clip-thumb-strip ghost-thumb" />
                    <div className="clip-name">{importDragInfo.name}</div>
                    <div className="ghost-badge">
                      {importDragInfo.mode === 'insert' && '⇆ Einfügen'}
                      {importDragInfo.mode === 'overwrite' && '✂ Überschreiben'}
                      {importDragInfo.mode === 'constrain' && '↔ Anpassen'}
                    </div>
                  </div>
                  <div
                    className={`clip ghost-clip audio-clip mode-${importDragInfo.mode}`}
                    style={{
                      left: `${importDragInfo.insertPoint * pxPerSec}px`,
                      width: `${Math.max(20, importDragInfo.dur * pxPerSec)}px`,
                    }}
                  />
                  {importDragInfo.mode === 'insert' && (
                    <div className="insert-indicator" style={{ left: `${importDragInfo.insertPoint * pxPerSec}px` }} />
                  )}
                </>
              )}

              {/* Drag tooltip near cursor */}
              {dragTooltip && (
                <div
                  className="drag-tooltip"
                  style={{ left: `${dragTooltip.x + 14}px`, top: `${dragTooltip.y + 14}px` }}
                >
                  {dragTooltip.label}
                </div>
              )}

              {/* Selected gap highlight (click to select, Delete/Ctrl+Delete to remove) */}
              {validSelectedGap && (
                <div
                  className="gap-selected"
                  style={{
                    left: `${validSelectedGap.start * pxPerSec}px`,
                    width: `${Math.max(2, (validSelectedGap.end - validSelectedGap.start) * pxPerSec)}px`,
                  }}
                  title={`Lücke ${formatTime(validSelectedGap.end - validSelectedGap.start)} – Entf zum Schließen`}
                />
              )}

              {/* Marquee selection box */}
              {marqueeBox && (
                <div
                  className="marquee-box"
                  style={{
                    left: `${marqueeBox.x1}px`,
                    top: `${marqueeBox.y1}px`,
                    width: `${marqueeBox.x2 - marqueeBox.x1}px`,
                    height: `${marqueeBox.y2 - marqueeBox.y1}px`,
                  }}
                />
              )}

              {/* Playhead */}
              <div
                className={`playhead ${interaction?.type === 'seek' ? 'dragging' : ''}`}
                style={{ left: `${playheadX}px` }}
              >
                <div
                  className="playhead-handle"
                  onMouseDown={handlePlayheadMouseDown}
                  title="Ziehen zum Spulen"
                />
                <div className="playhead-line" />
              </div>

              {/* Scrub tooltip during seek-drag */}
              {scrubTooltip && (
                <div className="scrub-tooltip" style={{ left: `${scrubTooltip.x}px` }}>
                  {formatTC(scrubTooltip.time)}
                </div>
              )}

              {/* Empty state */}
              {clips.length === 0 && (
                <div className="timeline-empty-state">
                  Ziehe Videos aus der Mediathek auf die Timeline
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Status bar */}
        <div className="status-bar">
          <div className="status-left">
            <span className="status-item">
              <span className="status-label">Clips:</span> {clips.length}
            </span>
            <span className="status-item">
              <span className="status-label">Länge:</span> {formatTC(totalEnd)}
            </span>
            {activeClip && (
              <span className="status-item">
                <span className="status-label">Auswahl:</span> {activeClip.name} ({formatTime(activeClip.outPoint - activeClip.inPoint)})
              </span>
            )}
          </div>
          <div className="status-right">
            <span className="status-item">
              <span className="status-label">Snap:</span> {snapEnabled ? 'Ein (N)' : 'Aus (N)'}
            </span>
            <span className="status-item">
              <span className="status-label">Zoom:</span> {pxPerSec}px/s
            </span>
            <span className="status-item kbd-hints">
              <kbd>Space</kbd> Play · <kbd>S</kbd> Split · <kbd>N</kbd> Snap · <kbd>Ctrl+C/X/V</kbd> Copy/Cut/Paste · <kbd>Ctrl+D</kbd> Duplicate · <kbd>Del</kbd> Löschen · <kbd>Ctrl+Del</kbd> Ripple · <kbd>←/→</kbd> Frame · <kbd>Shift</kbd> Snap aus · <kbd>Alt+Drag</kbd> Klon
            </span>
          </div>
        </div>
      </section>

      {/* Export modal */}
      {showExport && (
        <div className="settings-overlay" onClick={() => { if (exportStatus !== 'running') setShowExport(false) }}>
          <div className="settings-panel export-panel" onClick={(e) => e.stopPropagation()}>
            <div className="settings-header">
              <h3><Icon.Export /> Video exportieren</h3>
              {exportStatus !== 'running' && (
                <button className="settings-close" onClick={() => setShowExport(false)}>✕</button>
              )}
            </div>
            <div className="settings-body">

              {exportStatus === 'running' ? (
                <div className="export-running">
                  <div className="export-spinner" />
                  <p>FFmpeg läuft… Das kann bei langen Videos einige Minuten dauern.</p>
                </div>
              ) : exportStatus?.ok != null ? (
                <div className={`export-result ${exportStatus.ok ? 'ok' : 'err'}`}>
                  <p>{exportStatus.msg}</p>
                  <button className="export-action-btn" onClick={() => { setExportStatus(null); if (exportStatus.ok) setShowExport(false) }}>
                    {exportStatus.ok ? 'Schließen' : 'Erneut versuchen'}
                  </button>
                </div>
              ) : (
                <>
                  <div className="settings-section">
                    <h4>Format</h4>
                    <div className="export-info-row">
                      <span>Auflösung</span>
                      <strong>{aspectRatio === '9:16' ? '1080 × 1920 (9:16)' : '1920 × 1080 (16:9)'}</strong>
                    </div>
                    <div className="export-info-row">
                      <span>Container</span>
                      <strong>MP4 (H.264 + AAC)</strong>
                    </div>
                    <div className="export-info-row">
                      <span>Timeline-Dauer</span>
                      <strong>{formatTC(totalEnd)}</strong>
                    </div>
                  </div>

                  <div className="settings-section">
                    <h4>Qualität</h4>
                    <div className="export-quality-group">
                      {[['low', 'Niedrig', 'kleinste Datei'], ['medium', 'Mittel', 'empfohlen'], ['high', 'Hoch', 'beste Qualität']].map(([val, label, hint]) => (
                        <label key={val} className={`export-quality-btn ${exportQuality === val ? 'active' : ''}`}>
                          <input type="radio" name="quality" value={val} checked={exportQuality === val} onChange={() => setExportQuality(val)} />
                          <span className="eq-label">{label}</span>
                          <span className="eq-hint">{hint}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <button className="export-start-btn" onClick={handleExport}>
                    <Icon.Export /> Speicherort wählen & Exportieren
                  </button>
                  <p className="settings-hint">Benötigt FFmpeg im System-PATH.</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Settings panel */}
      {showSettings && (
        <div className="settings-overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <div className="settings-header">
              <h3><Icon.Settings /> Einstellungen</h3>
              <button className="settings-close" onClick={() => setShowSettings(false)}>✕</button>
            </div>
            <div className="settings-body">
              <div className="settings-section">
                <h4>Bilder</h4>
                <label className="settings-row">
                  <span>Standard-Bildlänge</span>
                  <div className="settings-input-group">
                    <input
                      type="number"
                      min="0.1"
                      max="60"
                      step="0.1"
                      value={settings.imageDuration}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value)
                        if (v > 0) setSettings((s) => ({ ...s, imageDuration: v }))
                      }}
                      className="settings-number"
                    />
                    <span className="settings-unit">s</span>
                  </div>
                </label>
                <p className="settings-hint">Wird für neu importierte Bilder verwendet.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (() => {
        const clip = clips.find((c) => c.id === contextMenu.clipId)
        if (!clip) return null
        const isTrimmed = clip.inPoint > 0.01 || clip.outPoint < clip.sourceDuration - 0.01
        return (
          <div
            className="context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              className="cm-item"
              onClick={() => { splitAtPlayhead(); setContextMenu(null) }}
              disabled={!(timelineTime > clip.startTime && timelineTime < clip.startTime + (clip.outPoint - clip.inPoint))}
            >
              <Icon.Cut /> Am Playhead teilen <span className="cm-shortcut">S</span>
            </button>
            <button
              className="cm-item"
              onClick={() => handleContextMenuDuplicate(clip.id)}
            >
              <Icon.Plus /> Duplizieren <span className="cm-shortcut">Ctrl+D</span>
            </button>
            <button
              className="cm-item"
              onClick={() => { restoreTrim(clip.id); setContextMenu(null) }}
              disabled={!isTrimmed}
            >
              <Icon.Undo /> Trim zurücksetzen
            </button>
            <div className="cm-divider" />
            <button
              className="cm-item danger"
              onClick={() => handleContextMenuDelete(clip.id)}
            >
              <Icon.Trash /> Löschen <span className="cm-shortcut">Del</span>
            </button>
          </div>
        )
      })()}
    </div>
  )
}

export default App
