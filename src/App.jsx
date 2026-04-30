import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import logoUrl from '../media/Logo/StoneCutter-Logo.png'
import './App.css'
import {
  SNAP_THRESHOLD_PX,
  MOVE_THRESHOLD_PX,
  MIN_CLIP_DURATION,
  IMAGE_EXTS,
  VIDEO_EXTS,
  getMediaType,
  normalizeSourceSelection,
  constrainMoveStart,
  minStartForTrimLeft,
  maxEndForTrimRight,
  detectInsertPoint,
  applyRippleInsert,
  findGapAtTime,
  findTimelineSpaceAtTime,
  closeGap,
  rippleDeleteClips,
  resolveOverlaps,
  resolveOverlapsMulti,
} from './lib/timeline.js'
import {
  nextTrackId,
  createDefaultTracks,
  addTrack as addTrackToList,
  removeTrack as removeTrackFromList,
  updateTrack as updateTrackInList,
  DEFAULT_TRACK_HEIGHT,
} from './lib/trackStore.js'
import { buildExportSegments } from './lib/exportSegments.js'
import {
  buildProjectDocument,
  createEmptyProjectState,
  hydrateProjectState,
  sanitizeProjectName,
} from './lib/project.js'
import {
  findClipAtTime,
  findNextClipAfter,
  getClipPlaybackPosition,
  getClipTimelineEnd,
  getImagePlaybackTimelineTime,
  getTimelineContentEnd,
  getVirtualTimelinePlaybackTime,
  shouldLeaveClipPlayback,
  shouldStartNextClipFromGap,
} from './lib/playback.js'
import {
  FOCUS_SOURCE,
  FOCUS_TIMELINE,
  clampSourceRange,
  clampSourceTime,
  isSourceMonitorVisible,
  stepSourcePreviewTime,
  timeFromClientX,
} from './lib/sourceMonitor.js'

const isTauri = '__TAURI_INTERNALS__' in window
const RECENT_PROJECTS_KEY = 'stonecutter.recentProjects'
const PROJECT_FILTER = [{ name: 'StoneCutter Project', extensions: ['stonecutter'] }]

let _idCounter = 0
const nextId = (prefix) => `${prefix}-${++_idCounter}`

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
  Save: () => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>,
  FolderOpen: () => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v2"/><path d="M3 9h18l-2 10H5z"/></svg>,
  File: () => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  VideoTrack: () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 10h18M3 14h18"/></svg>,
  AudioTrack: () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12v2M8 8v8M12 5v14M16 8v8M20 11v2"/></svg>,
}

function App() {
  const videoRef = useRef(null)
  const fileRef = useRef(null)
  const tracksContentRef = useRef(null)
  const pendingSeekRef = useRef(null)
  const pendingPlayRef = useRef(false) // play after src change + metadata
  const historyRef = useRef({ past: [], future: [] })
  const interactionRef = useRef(null)
  const playbackRef = useRef({ clips: [], activeClipId: null, activeId: null, isPlaying: false, videos: [], timelineTime: 0 })
  const playbackModeRef = useRef(null) // "timeline" | "source" | null
  const playingClipIdRef = useRef(null) // tracks current clip for playback engine — never touches user selection
  const imagePlaybackRef = useRef(null) // virtual playback clock for still-image clips
  const timelinePlaybackRef = useRef(null) // virtual clock for empty sequence/gap playback
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
  const [sourceRanges, setSourceRanges] = useState({}) // videoId -> { inPoint, outPoint } for source preview drags
  const [sourceMonitorId, setSourceMonitorId] = useState(null) // only set by explicit video clicks in the media library
  const [editorFocus, setEditorFocus] = useState(FOCUS_SOURCE)
  const [contextMenu, setContextMenu] = useState(null) // {x, y, clipId}
  const [scrubTooltip, setScrubTooltip] = useState(null) // {x, time} during seek drag
  const [selectedGap, setSelectedGap] = useState(null) // { start, end }
  const [selectedClipIds, setSelectedClipIds] = useState(() => new Set())
  const [marqueeBox, setMarqueeBox] = useState(null) // { x1, y1, x2, y2 } in tracks-content px
  const [importDragInfo, setImportDragInfo] = useState(null) // { videoId, name, dur, insertPoint, mode, simulatedLayout }
  const draggedVideoIdRef = useRef(null)
  const draggedTrackModeRef = useRef('av') // "av" = video with audio, "audio" = audio-only
  const sourceTrimDragRef = useRef(null)
  const sourceSeekDragRef = useRef(null)
  const [dragTooltip, setDragTooltip] = useState(null) // { x, y, label }
  const [tracks, setTracks] = useState(() => createDefaultTracks())
  const trackHeadersListRef = useRef(null)
  const [editingTrackId, setEditingTrackId] = useState(null)
  const [dropTargetTrackId, setDropTargetTrackId] = useState(null)

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
  const [previewTime, setPreviewTime] = useState(0)
  const [playbackMode, setPlaybackMode] = useState(null) // "timeline" | "source" | null
  const [currentProject, setCurrentProject] = useState(null) // { name, path, directory }
  const [showProjectStart, setShowProjectStart] = useState(true)
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false)
  const [newProjectName, setNewProjectName] = useState('Untitled Project')
  const [projectStatus, setProjectStatus] = useState(null)
  const [isProjectDirty, setIsProjectDirty] = useState(false)
  const [recentProjects, setRecentProjects] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_PROJECTS_KEY) || '[]')
    } catch {
      return []
    }
  })
  const projectHydratingRef = useRef(false)

  const persistRecentProjects = useCallback((items) => {
    setRecentProjects(items)
    try { localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(items)) } catch { /* ignored */ }
  }, [])

  const rememberProject = useCallback((project) => {
    if (!project?.path) return
    const entry = {
      name: project.name || 'Untitled Project',
      path: project.path,
      directory: project.directory || '',
      openedAt: new Date().toISOString(),
    }
    const next = [entry, ...recentProjects.filter((item) => item.path !== entry.path)].slice(0, 8)
    persistRecentProjects(next)
  }, [persistRecentProjects, recentProjects])

  const getProjectSnapshot = useCallback((name = currentProject?.name || newProjectName) => buildProjectDocument({
    name,
    videos,
    clips,
    sourceRanges,
    videoDurations,
    timelineTime,
    settings,
    aspectRatio,
    pxPerSec,
    snapEnabled,
    volume,
    muted,
  }), [aspectRatio, clips, currentProject?.name, muted, newProjectName, pxPerSec, settings, snapEnabled, sourceRanges, timelineTime, videoDurations, videos, volume])

  const applyProjectState = useCallback((state, projectInfo) => {
    projectHydratingRef.current = true
    setVideos(state.videos)
    setClips(state.clips)
    setSourceRanges(state.sourceRanges)
    setVideoDurations(state.videoDurations)
    setPeaksMap({})
    setThumbsMap({})
    setTimelineTime(state.timelineTime)
    setSettings((prev) => ({ ...prev, ...state.settings }))
    setAspectRatio(state.ui.aspectRatio)
    setPxPerSec(state.ui.pxPerSec)
    setSnapEnabled(state.ui.snapEnabled)
    setVolume(state.ui.volume)
    setMuted(state.ui.muted)
    setActiveId(state.videos[0]?.id || null)
    setSourceMonitorId(null)
    setEditorFocus(FOCUS_SOURCE)
    setActiveClipId(null)
    setSelectedClipIds(new Set())
    setSelectedGap(null)
    setShowProjectStart(false)
    setCurrentProject(projectInfo)
    setIsProjectDirty(false)
    historyRef.current = { past: [], future: [] }
    setHistorySizes({ past: 0, future: 0 })
    setTimeout(() => { projectHydratingRef.current = false }, 0)
  }, [setSettings])

  const handleCreateProject = useCallback(async () => {
    if (!isTauri) {
      const name = sanitizeProjectName(newProjectName)
      applyProjectState(createEmptyProjectState(name), { name, path: '', directory: '' })
      setShowNewProjectDialog(false)
      return
    }
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const { invoke } = await import('@tauri-apps/api/core')
      const parentDir = await open({ directory: true, multiple: false, title: 'Projektordner-Speicherort waehlen' })
      if (!parentDir) return
      const name = sanitizeProjectName(newProjectName)
      const document = JSON.stringify(buildProjectDocument(createEmptyProjectState(name)), null, 2)
      const info = await invoke('create_project_folder', { parentDir, projectName: name, document })
      applyProjectState(createEmptyProjectState(info.name), info)
      rememberProject(info)
      setShowNewProjectDialog(false)
      setProjectStatus({ ok: true, msg: `Projekt angelegt: ${info.name}` })
    } catch (err) {
      setProjectStatus({ ok: false, msg: String(err) })
    }
  }, [applyProjectState, newProjectName, rememberProject])

  const openProjectPath = useCallback(async (path) => {
    if (!isTauri || !path) return
    try {
      const { invoke, convertFileSrc } = await import('@tauri-apps/api/core')
      const raw = await invoke('load_project_file', { projectPath: path })
      const state = hydrateProjectState(raw, convertFileSrc)
      const directory = path.replace(/[\\/][^\\/]+$/, '')
      const projectInfo = { name: state.name, path, directory }
      applyProjectState(state, projectInfo)
      rememberProject(projectInfo)
      setProjectStatus({ ok: true, msg: `Projekt geoeffnet: ${state.name}` })
    } catch (err) {
      setProjectStatus({ ok: false, msg: String(err) })
    }
  }, [applyProjectState, rememberProject])

  const handleOpenProject = useCallback(async () => {
    if (!isTauri) return
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({ multiple: false, filters: PROJECT_FILTER })
      if (selected) await openProjectPath(selected)
    } catch (err) {
      setProjectStatus({ ok: false, msg: String(err) })
    }
  }, [openProjectPath])

  const saveCurrentProject = useCallback(async () => {
    if (!currentProject?.path || !isTauri) {
      setProjectStatus({ ok: false, msg: 'Kein gespeichertes Projekt aktiv.' })
      return
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const document = JSON.stringify(getProjectSnapshot(currentProject.name), null, 2)
      await invoke('save_project_file', { projectPath: currentProject.path, document })
      setIsProjectDirty(false)
      rememberProject(currentProject)
      setProjectStatus({ ok: true, msg: 'Projekt gespeichert.' })
    } catch (err) {
      setProjectStatus({ ok: false, msg: String(err) })
    }
  }, [currentProject, getProjectSnapshot, rememberProject])

  useEffect(() => {
    if (!currentProject || projectHydratingRef.current) return
    setIsProjectDirty(true)
  }, [aspectRatio, clips, currentProject, muted, pxPerSec, settings, snapEnabled, sourceRanges, timelineTime, videoDurations, videos, volume])

  const handleExport = async () => {
    if (!isTauri) return
    const exportPlan = buildExportSegments({ clips, videos })
    if (!exportPlan.ok) {
      setExportStatus({ ok: false, msg: exportPlan.error })
      return
    }
    const { segments } = exportPlan

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

  useEffect(() => {
    playbackModeRef.current = playbackMode
  }, [playbackMode])

  useEffect(() => {
    if (!projectStatus) return undefined
    const clearTimer = window.setTimeout(() => setProjectStatus(null), 1500)
    return () => {
      window.clearTimeout(clearTimer)
    }
  }, [projectStatus])

  const activeVideo = videos.find((v) => v.id === activeId)
  const videoSrc = activeVideo?.src || ''
  const activeClip = clips.find((c) => c.id === activeClipId)

  const getSourceSelection = useCallback((mediaOrId) => {
    const media = typeof mediaOrId === 'string'
      ? videos.find((v) => v.id === mediaOrId)
      : mediaOrId
    return normalizeSourceSelection({
      media,
      probedDuration: media ? videoDurations[media.id] : null,
      savedRange: media ? sourceRanges[media.id] : null,
      defaultImageDuration: settings.imageDuration,
    })
  }, [settings.imageDuration, sourceRanges, videoDurations, videos])

  const activeSourceSelection = activeVideo ? getSourceSelection(activeVideo) : null
  const isSourceMonitorActive = isSourceMonitorVisible({ media: activeVideo, sourceMonitorId }) && activeSourceSelection

  const updateSourceRange = useCallback((videoId, patch) => {
    const media = videos.find((v) => v.id === videoId)
    if (!media) return
    const current = getSourceSelection(media)
    const { inPoint: nextIn, outPoint: nextOut } = clampSourceRange({
      duration: current.duration,
      currentRange: current,
      patch,
    })

    setSourceRanges((prev) => ({ ...prev, [videoId]: { inPoint: nextIn, outPoint: nextOut } }))
    if (videoId === activeId && videoRef.current && media.mediaType === 'video') {
      try { videoRef.current.currentTime = patch.outPoint != null ? nextOut : nextIn } catch { /* ignored */ }
      setPreviewTime(patch.outPoint != null ? nextOut : nextIn)
    }
  }, [activeId, getSourceSelection, videos])

  const sourceTimeFromClientX = useCallback((clientX) => {
    const drag = sourceTrimDragRef.current
    if (!drag) return 0
    return timeFromClientX({ clientX, rect: drag.rect, duration: drag.selection.duration })
  }, [])

  const sourceTimelineTimeFromClientX = useCallback((clientX) => {
    const drag = sourceSeekDragRef.current
    if (!drag) return 0
    return timeFromClientX({ clientX, rect: drag.rect, duration: drag.duration })
  }, [])

  const seekSourcePreviewTo = useCallback((time) => {
    if (!activeVideo || activeVideo.mediaType !== 'video' || !activeSourceSelection) return
    setEditorFocus(FOCUS_SOURCE)
    const next = clampSourceTime(time, activeSourceSelection.duration)
    setPreviewTime(next)
    if (videoRef.current && activeId === activeVideo.id) {
      try { videoRef.current.currentTime = next } catch { /* ignored */ }
    } else {
      setActiveId(activeVideo.id)
      pendingSeekRef.current = next
      pendingPlayRef.current = false
    }
  }, [activeId, activeSourceSelection, activeVideo])

  const beginSourcePreviewSeek = useCallback((e) => {
    if (!activeVideo || activeVideo.mediaType !== 'video' || !activeSourceSelection) return
    e.preventDefault()
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    sourceSeekDragRef.current = { rect, duration: activeSourceSelection.duration }
    seekSourcePreviewTo(timeFromClientX({ clientX: e.clientX, rect, duration: activeSourceSelection.duration }))
  }, [activeSourceSelection, activeVideo, seekSourcePreviewTo])

  const beginSourceTimelineDrag = useCallback((e, edge) => {
    if (!activeVideo || !activeSourceSelection || activeVideo.mediaType !== 'video') return
    e.preventDefault()
    e.stopPropagation()
    const timelineEl = e.currentTarget.closest('.source-preview-timeline') || e.currentTarget
    const rect = timelineEl.getBoundingClientRect()
    const clickTime = timeFromClientX({ clientX: e.clientX, rect, duration: activeSourceSelection.duration })
    const inferredEdge = edge || (
      Math.abs(clickTime - activeSourceSelection.inPoint) <= Math.abs(clickTime - activeSourceSelection.outPoint)
        ? 'inPoint'
        : 'outPoint'
    )

    sourceTrimDragRef.current = {
      videoId: activeVideo.id,
      edge: inferredEdge,
      rect,
      selection: activeSourceSelection,
    }
    updateSourceRange(activeVideo.id, { [inferredEdge]: clickTime })
  }, [activeSourceSelection, activeVideo, updateSourceRange])

  const setSourcePointAtPreviewTime = useCallback((edge) => {
    if (!activeVideo || activeVideo.mediaType !== 'video' || !activeSourceSelection) return
    const time = clampSourceTime(previewTime, activeSourceSelection.duration)
    updateSourceRange(activeVideo.id, { [edge]: time })
  }, [activeSourceSelection, activeVideo, previewTime, updateSourceRange])

  useEffect(() => {
    const onMove = (e) => {
      const drag = sourceTrimDragRef.current
      if (drag) {
        updateSourceRange(drag.videoId, { [drag.edge]: sourceTimeFromClientX(e.clientX) })
      }
      if (sourceSeekDragRef.current) {
        seekSourcePreviewTo(sourceTimelineTimeFromClientX(e.clientX))
      }
    }
    const onUp = () => {
      sourceTrimDragRef.current = null
      sourceSeekDragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [seekSourcePreviewTo, sourceTimeFromClientX, sourceTimelineTimeFromClientX, updateSourceRange])

  const makeClipFromSource = useCallback((media, clipId, startTime, trackMode = 'av') => {
    const selection = getSourceSelection(media)
    return {
      id: clipId,
      videoId: media.id,
      name: media.name,
      src: media.src,
      sourceDuration: selection.duration,
      inPoint: selection.inPoint,
      outPoint: selection.outPoint,
      startTime,
      trackMode,
    }
  }, [getSourceSelection])

  // While the user is dragging from the sidebar, render the simulated layout instead of the real clips.
  const displayClips = useMemo(() => {
    const raw = importDragInfo?.simulatedLayout || clips
    const defaultVideoTrackId = tracks.find((t) => t.type === 'video')?.id
    const defaultAudioTrackId = tracks.find((t) => t.type === 'audio')?.id
    // Migrate legacy clips without trackId based on trackMode
    return raw.map((c) => {
      if (c.trackId) return c
      let targetTrackId = null
      if (c.trackMode === 'audio') { targetTrackId = defaultAudioTrackId }
      else { targetTrackId = defaultVideoTrackId }
      return { ...c, trackId: targetTrackId }
    })
  }, [importDragInfo?.simulatedLayout, clips, tracks])

  // Track which clips are currently being dragged → used for `.dragging` CSS class (z-index lift)
  const draggingIds = useMemo(() => {
    if (!interaction) return null
    if (interaction.type !== 'move' && interaction.type !== 'trim-left' && interaction.type !== 'trim-right') return null
    if (interaction.selectedSnaps) return new Set(interaction.selectedSnaps.map((s) => s.id))
    if (interaction.clipId) return new Set([interaction.clipId])
    return null
  }, [interaction])
  const totalEnd = useMemo(
    () => getTimelineContentEnd(displayClips),
    [displayClips]
  )
  const totalWidth = Math.max(800, totalEnd * pxPerSec + 200, timelineTime * pxPerSec + 200)
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

  // --- track management ---
  const handleAddTrack = useCallback((type) => {
    setTracks((prev) => addTrackToList(prev, type))
  }, [])
  const handleRemoveTrack = useCallback((trackId) => {
    setTracks((prev) => removeTrackFromList(prev, trackId))
    // Remove all clips on this track
    setClips((prev) => prev.filter((c) => c.trackId !== trackId))
  }, [])
  const handleUpdateTrack = useCallback((trackId, changes) => {
    setTracks((prev) => updateTrackInList(prev, trackId, changes))
  }, [])

  // --- multi-track helpers ---
  const getTrackY = useCallback(() => {
    const tc = tracksContentRef.current
    if (!tc) return { y: 0, scrollTop: 0 }
    const rect = tc.getBoundingClientRect()
    const RULER_HEIGHT = 30
    const yOffset = tc.scrollTop - RULER_HEIGHT
    return { y: rect.top, scrollTop: yOffset }
  }, [])

  const getTrackAtClientY = useCallback((clientY) => {
    const { y, scrollTop } = getTrackY()
    const relativeY = clientY - y - scrollTop
    if (relativeY < 0) return null
    let accumulated = 0
    for (const track of tracks) {
      const h = track.height || DEFAULT_TRACK_HEIGHT
      if (relativeY < accumulated + h) return track.id
      accumulated += h
    }
    return '__below__'
  }, [tracks, getTrackY])

  const handleTracksScroll = useCallback((e) => {
    if (trackHeadersListRef.current) {
      trackHeadersListRef.current.scrollTop = e.target.scrollTop
    }
  }, [])

  // --- player ---
  const startImageClipPlayback = useCallback((clip, startAtTime) => {
    const { duration } = getClipPlaybackPosition(clip, startAtTime)
    const timelineStart = Math.min(clip.startTime + duration, Math.max(clip.startTime, startAtTime))
    playingClipIdRef.current = clip.id
    imagePlaybackRef.current = {
      clipId: clip.id,
      startedAtMs: performance.now(),
      timelineStart,
    }
    timelinePlaybackRef.current = null
    setPlaybackMode('timeline')
    setEditorFocus(FOCUS_TIMELINE)
    setSourceMonitorId(null)
    setActiveId(clip.videoId)
    setTimelineTime(timelineStart)
    setIsPlaying(true)
  }, [])

  const startClipPlayback = useCallback((target, startAtTime) => {
    setPlaybackMode('timeline')
    setEditorFocus(FOCUS_TIMELINE)
    setSourceMonitorId(null)
    timelinePlaybackRef.current = null
    const media = videos.find((v) => v.id === target.videoId)
    if (media?.mediaType === 'image') {
      startImageClipPlayback(target, startAtTime)
      return
    }

    const { offsetInClip, sourceTime: videoTime } = getClipPlaybackPosition(target, startAtTime)
    playingClipIdRef.current = target.id
    imagePlaybackRef.current = null
    setTimelineTime(target.startTime + offsetInClip)

    if (target.videoId !== activeId || !videoRef.current) {
      setActiveId(target.videoId)
      pendingSeekRef.current = videoTime
      pendingPlayRef.current = true
      return
    }

    try { videoRef.current.currentTime = videoTime } catch { /* ignored */ }
    videoRef.current.play().catch(() => {})
  }, [activeId, startImageClipPlayback, videos])

  const startTimelineGapPlayback = useCallback((startAtTime) => {
    if (videoRef.current && !videoRef.current.paused) videoRef.current.pause()
    setPlaybackMode('timeline')
    setEditorFocus(FOCUS_TIMELINE)
    setSourceMonitorId(null)
    playingClipIdRef.current = null
    imagePlaybackRef.current = null
    timelinePlaybackRef.current = {
      startedAtMs: performance.now(),
      timelineStart: Math.max(0, startAtTime),
    }
    setTimelineTime(Math.max(0, startAtTime))
    setIsPlaying(true)
  }, [])

  const stopPlayback = useCallback(() => {
    playbackModeRef.current = null
    const videoEl = videoRef.current
    if (videoEl && !videoEl.paused) videoEl.pause()
    imagePlaybackRef.current = null
    timelinePlaybackRef.current = null
    pendingPlayRef.current = false
    setPlaybackMode(null)
    setIsPlaying(false)
  }, [])

  const handleSourcePreviewPlay = useCallback(() => {
    const videoEl = videoRef.current
    if (!activeVideo || activeVideo.mediaType !== 'video' || !activeSourceSelection || !videoEl) return
    if (playbackMode === 'source' && isPlaying) {
      stopPlayback()
      setSourceMonitorId(activeVideo.id)
      return
    }

    const outsideRange = videoEl.currentTime < activeSourceSelection.inPoint - 0.02 ||
      videoEl.currentTime >= activeSourceSelection.outPoint - 0.02
    if (outsideRange) {
      try { videoEl.currentTime = activeSourceSelection.inPoint } catch { /* ignored */ }
      setPreviewTime(activeSourceSelection.inPoint)
    }
    playingClipIdRef.current = null
    imagePlaybackRef.current = null
    timelinePlaybackRef.current = null
    pendingPlayRef.current = false
    setPlaybackMode('source')
    setEditorFocus(FOCUS_SOURCE)
    videoEl.play().catch(() => {})
  }, [activeSourceSelection, activeVideo, isPlaying, playbackMode, stopPlayback])

  const handleTimelinePlay = useCallback(() => {
    setEditorFocus(FOCUS_TIMELINE)
    if (playbackMode === 'timeline' && isPlaying) {
      stopPlayback()
      return
    }

    const target = findClipAtTime(timelineTime, clips)
    if (target) {
      startClipPlayback(target, timelineTime)
    } else {
      startTimelineGapPlayback(timelineTime)
    }
  }, [clips, isPlaying, playbackMode, startClipPlayback, startTimelineGapPlayback, stopPlayback, timelineTime])

  const handlePlay = useCallback(() => {
    if (isSourceMonitorActive) {
      handleSourcePreviewPlay()
    } else {
      handleTimelinePlay()
    }
  }, [handleSourcePreviewPlay, handleTimelinePlay, isSourceMonitorActive])

  const handlePreviewTimeUpdate = useCallback((e) => {
    const nextTime = e.currentTarget.currentTime || 0
    setPreviewTime(nextTime)
    if (playbackModeRef.current === 'source' && activeSourceSelection && nextTime >= activeSourceSelection.outPoint - 0.02) {
      e.currentTarget.pause()
      try { e.currentTarget.currentTime = activeSourceSelection.outPoint } catch { /* ignored */ }
      setPreviewTime(activeSourceSelection.outPoint)
      imagePlaybackRef.current = null
      timelinePlaybackRef.current = null
      setPlaybackMode(null)
      setIsPlaying(false)
    }
  }, [activeSourceSelection])

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
    playbackRef.current = { clips, activeClipId, activeId, isPlaying, videos, timelineTime }
  }, [clips, activeClipId, activeId, isPlaying, videos, timelineTime])

  // ---- Smooth playhead via rAF + continuous playback through cuts ----
  useEffect(() => {
    if (!isPlaying || playbackMode !== 'timeline') return
    let raf = 0
    const tick = () => {
      const state = playbackRef.current
      if (interactionRef.current?.type === 'seek') { raf = requestAnimationFrame(tick); return }
      const clip = state.clips.find((c) => c.id === playingClipIdRef.current)
      const media = clip ? state.videos.find((v) => v.id === clip.videoId) : null
      const continueWithGap = (startAtTime, currentVideo) => {
        timelinePlaybackRef.current = {
          startedAtMs: performance.now(),
          timelineStart: Math.max(0, startAtTime),
        }
        playingClipIdRef.current = null
        imagePlaybackRef.current = null
        if (currentVideo && !currentVideo.paused) currentVideo.pause()
        setPlaybackMode('timeline')
        setTimelineTime(Math.max(0, startAtTime))
        setIsPlaying(true)
      }
      const continueWithNext = (next, currentVideo) => {
        setTimelineTime(next.startTime)
        playingClipIdRef.current = next.id
        timelinePlaybackRef.current = null
        const nextMedia = state.videos.find((v) => v.id === next.videoId)
        if (nextMedia?.mediaType === 'image') {
          imagePlaybackRef.current = {
            clipId: next.id,
            startedAtMs: performance.now(),
            timelineStart: next.startTime,
          }
          if (currentVideo && !currentVideo.paused) currentVideo.pause()
          setActiveId(next.videoId)
          queueMicrotask(() => setIsPlaying(true))
          return
        }
        imagePlaybackRef.current = null
        if (next.videoId !== state.activeId) {
          setActiveId(next.videoId)
          pendingSeekRef.current = next.inPoint
          pendingPlayRef.current = true
          if (currentVideo && !currentVideo.paused) currentVideo.pause()
        } else if (currentVideo) {
          try { currentVideo.currentTime = next.inPoint } catch { /* ignored */ }
          if (currentVideo.paused) currentVideo.play().catch(() => {})
        }
      }

      if (!clip && timelinePlaybackRef.current) {
        const gapState = getVirtualTimelinePlaybackTime({
          timelinePlayback: timelinePlaybackRef.current,
          nowMs: performance.now(),
          fallbackTimelineTime: state.timelineTime,
        })
        const next = findNextClipAfter(gapState.timelineTime, state.clips)
        if (shouldStartNextClipFromGap({ timelineTime: gapState.timelineTime, nextClip: next })) {
          continueWithNext(next, videoRef.current)
        } else {
          setTimelineTime(gapState.timelineTime)
        }
        raf = requestAnimationFrame(tick)
        return
      }

      if (clip && media?.mediaType === 'image') {
        const imageState = getImagePlaybackTimelineTime({
          clip,
          imagePlayback: imagePlaybackRef.current,
          nowMs: performance.now(),
          fallbackTimelineTime: state.timelineTime,
        })
        if (imagePlaybackRef.current?.clipId !== clip.id) {
          imagePlaybackRef.current = {
            clipId: clip.id,
            startedAtMs: imageState.startedAtMs,
            timelineStart: imageState.timelineStart,
          }
        }
        if (imageState.ended) {
          const next = findNextClipAfter(imageState.endTime - 0.02, state.clips, clip.id)
          if (next) {
            if (next.startTime > imageState.endTime + 0.02) {
              continueWithGap(imageState.endTime, videoRef.current)
            } else {
              continueWithNext(next, videoRef.current)
            }
          } else {
            continueWithGap(imageState.endTime, videoRef.current)
          }
        } else {
          setTimelineTime(imageState.timelineTime)
        }
        raf = requestAnimationFrame(tick)
        return
      }

      const v = videoRef.current
      if (!v) { raf = requestAnimationFrame(tick); return }
      const ct = v.currentTime
      if (v.paused && (!clip || !shouldLeaveClipPlayback({ sourceTime: ct, clip }))) {
        raf = requestAnimationFrame(tick)
        return
      }
      if (clip) {
        // End of current clip → continue with the next clip on the timeline
        if (shouldLeaveClipPlayback({ sourceTime: ct, clip })) {
          const clipTimelineEnd = getClipTimelineEnd(clip)
          const next = findNextClipAfter(clipTimelineEnd - 0.02, state.clips, clip.id)
          if (next) {
            if (next.startTime > clipTimelineEnd + 0.02) {
              continueWithGap(clipTimelineEnd, v)
            } else {
              continueWithNext(next, v)
            }
          } else {
            // No more clips → stop at end of timeline
            continueWithGap(clipTimelineEnd, v)
          }
        } else if (ct >= clip.inPoint - 0.02) {
          setTimelineTime(clip.startTime + (ct - clip.inPoint))
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying, playbackMode])

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
    if (files.length === 0) return []
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
    return items
  }

  const handleSelectMedia = (id) => {
    stopPlayback()
    setEditorFocus(FOCUS_SOURCE)
    setActiveId(id)
    setActiveClipId(null)
    playingClipIdRef.current = null
    const media = videos.find((v) => v.id === id)
    setSourceMonitorId(media?.mediaType === 'video' ? id : null)
    const selection = getSourceSelection(id)
    setPreviewTime(selection.inPoint)
    if (media?.mediaType === 'video') {
      pendingSeekRef.current = selection.inPoint
      pendingPlayRef.current = false
      if (videoRef.current && activeId === id) {
        try { videoRef.current.currentTime = selection.inPoint } catch { /* ignored */ }
      }
    }
  }
  const handleDoubleClickMedia = (id) => {
    stopPlayback()
    setEditorFocus(FOCUS_SOURCE)
    setActiveId(id)
    setActiveClipId(null)
    playingClipIdRef.current = null
    const media = videos.find((v) => v.id === id)
    setSourceMonitorId(media?.mediaType === 'video' ? id : null)
    const selection = getSourceSelection(id)
    setPreviewTime(selection.inPoint)
    setIsPlaying(false)
    setTimeout(() => {
      if (videoRef.current) {
        setPlaybackMode('source')
        videoRef.current.currentTime = selection.inPoint
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
    if (sourceMonitorId === id) setSourceMonitorId(null)
  }

  // --- drag from sidebar ---
  const handleDragStart = (e, video, trackMode = 'av') => {
    draggedVideoIdRef.current = video.id
    draggedTrackModeRef.current = trackMode
    // Probe lazily if not yet cached, so the very first preview is accurate too.
    if (videoDurations[video.id] == null) {
      probeDuration(video.src, video.mediaType, settings.imageDuration).then((dur) => {
        setVideoDurations((prev) => ({ ...prev, [video.id]: dur }))
      })
    }
    const selection = getSourceSelection(video)
    const ghost = document.createElement('div')
    ghost.className = 'drag-ghost'
    const icon = document.createElement('span')
    icon.className = 'drag-ghost-icon'
    icon.textContent = trackMode === 'audio' ? 'A' : 'V'
    const name = document.createElement('span')
    name.className = 'drag-ghost-name'
    name.textContent = `${video.name} · ${formatTime(selection.clipDuration)}`
    ghost.append(icon, name)
    Object.assign(ghost.style, { position: 'absolute', top: '-1000px', left: '0px', pointerEvents: 'none' })
    document.body.appendChild(ghost)
    try { e.dataTransfer.setDragImage(ghost, 14, 18) } catch { /* ignored */ }
    setTimeout(() => { if (ghost.parentNode) ghost.parentNode.removeChild(ghost) }, 0)
    e.dataTransfer.setData('text/plain', video.id)
    e.dataTransfer.setData('text', video.id)
    e.dataTransfer.setData('application/x-stonecutter-track-mode', trackMode)
    e.dataTransfer.effectAllowed = 'copy'
  }
  const handleDragEnd = () => {
    draggedVideoIdRef.current = null
    draggedTrackModeRef.current = 'av'
    setImportDragInfo(null)
    setDragTooltip(null)
  }

  const handleSourceDragStart = (e, trackMode) => {
    if (!activeVideo) return
    handleDragStart(e, activeVideo, trackMode)
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
  const computeImportPreview = useCallback((videoId, dropTime, fileName = '', trackMode = 'av', targetTrack = null) => {
    const media = videos.find((v) => v.id === videoId)
    const selection = media
      ? getSourceSelection(media)
      : { inPoint: 0, outPoint: videoDurations[videoId] || 5, duration: videoDurations[videoId] || 5, clipDuration: videoDurations[videoId] || 5 }
    const dur = selection.clipDuration
    const targetTrackId = targetTrack?.id
    const trackClips = clips.filter((c) => c.trackId === targetTrackId)
    if (snapEnabled) {
      const ins = detectInsertPoint('__preview__', dropTime + dur / 2, dur, trackClips)
      if (ins) {
        const rippledTrack = applyRippleInsert(trackClips, '__preview__', ins.insertPoint, dur)
        return {
          insertPoint: ins.insertPoint,
          mode: 'insert',
          simulatedLayout: clips.map((c) => (c.trackId === targetTrackId ? rippledTrack.find((x) => x.id === c.id) || c : c)),
          dur,
        }
      }
      return {
        insertPoint: constrainMoveStart(dropTime, dur, trackClips),
        mode: 'constrain',
        simulatedLayout: clips,
        dur,
      }
    }
    // Snap-off: simulate Filmora-style overwrite (cut existing clips that overlap)
    const start = Math.max(0, dropTime)
    const placeholder = {
      id: '__preview__', videoId, name: fileName, src: '',
      sourceDuration: selection.duration,
      inPoint: selection.inPoint,
      outPoint: selection.outPoint,
      startTime: start,
      trackMode,
      trackId: targetTrackId,
    }
    const cut = resolveOverlaps([...trackClips, placeholder], '__preview__', () => `prev-${Math.random()}`)
    const trackLayout = cut.filter((c) => c.id !== '__preview__')
    const simulatedLayout = clips.filter((c) => c.trackId !== targetTrackId).concat(trackLayout)
    return { insertPoint: start, mode: 'overwrite', simulatedLayout, dur }
  }, [clips, getSourceSelection, snapEnabled, videoDurations, videos])

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

    // Detect target track
    const targetTrackId = getTrackAtClientY(e.clientY)
    setDropTargetTrackId(targetTrackId)

    // Check for files from Explorer
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('video/') || f.type.startsWith('image/'))
    if (files.length > 0) {
      const file = files[0]
      const targetTrack = targetTrackId && targetTrackId !== '__below__'
        ? tracks.find((t) => t.id === targetTrackId)
        : null
      const preview = computeImportPreview('__explorer__', dropTime, file.name, 'av', targetTrack)
      setImportDragInfo({ videoId: '__explorer__', name: file.name, trackMode: 'av', mediaType: getMediaType(file.name), ...preview })
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
      const trackMode = draggedTrackModeRef.current || 'av'
      const targetTrack = targetTrackId && targetTrackId !== '__below__'
        ? tracks.find((t) => t.id === targetTrackId)
        : null
      const preview = computeImportPreview(videoId, dropTime, '', trackMode, targetTrack)
      setImportDragInfo({ videoId, name: video?.name || '', trackMode, mediaType: video?.mediaType || 'video', ...preview })
      // Tooltip near cursor
      const rect = tracksContentRef.current?.getBoundingClientRect()
      if (rect) {
        setDragTooltip({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          label: `${trackMode === 'audio' ? 'Nur Audio' : 'Video + Audio'} · ${formatTime(preview.insertPoint)} · ${formatTime(preview.dur)}`,
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
    setDropTargetTrackId(null)
  }
  const handleTimelineDrop = async (e) => {
    e.preventDefault()
    setDragOver(false)
    setDropIndicatorTime(null)
    setImportDragInfo(null)
    setDragTooltip(null)
    setDropTargetTrackId(null)
    const droppedVideoId = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text') || draggedVideoIdRef.current
    const droppedTrackMode = e.dataTransfer.getData('application/x-stonecutter-track-mode') || draggedTrackModeRef.current || 'av'
    draggedVideoIdRef.current = null
    draggedTrackModeRef.current = 'av'

    // Determine target track
    const dropTargetId = getTrackAtClientY(e.clientY)
    let targetTrack = dropTargetId && dropTargetId !== '__below__'
      ? tracks.find((t) => t.id === dropTargetId)
      : null

    // Check for dropped files from Explorer
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('video/') || f.type.startsWith('image/'))
    if (files.length > 0) {
      // Handle file drop from Explorer
      const importedItems = await handleFileChange({ target: { files } })
      // Auto-drop the first imported file to timeline at drop position
      const dropTime = dropTimeFromEvent(e)
      const lastVideo = importedItems?.[0]
      if (lastVideo) {
        // If dropped below existing tracks, create a new video track
        if (dropTargetId === '__below__' || !targetTrack) {
          setTracks((prev) => addTrackToList(prev, 'video'))
          const newTrack = tracks.find((t) => t.type === 'video' && !clips.some((c) => c.trackId === t.id))
            || tracks[tracks.length - 1]
          targetTrack = { id: nextTrackId(), type: 'video' }
          setTracks((prev) => [...prev, targetTrack])
        }
        const targetTrackId = targetTrack.id
        const duration = await probeDuration(lastVideo.src, lastVideo.mediaType, settings.imageDuration)
        setVideoDurations((prev) => ({ ...prev, [lastVideo.id]: duration }))
        const clipId = nextId('clip')
        const placeholderDur = duration
        const trackClips = clips.filter((c) => c.trackId === targetTrackId)
        let placeholderStart = dropTime
        let baseTrackClips = trackClips
        if (snapEnabled) {
          const ins = detectInsertPoint(clipId, dropTime, placeholderDur, trackClips)
          if (ins) {
            placeholderStart = ins.insertPoint
            baseTrackClips = applyRippleInsert(trackClips, clipId, ins.insertPoint, placeholderDur)
          } else {
            placeholderStart = constrainMoveStart(dropTime, placeholderDur, trackClips)
          }
        }
        const placeholder = {
          id: clipId,
          videoId: lastVideo.id,
          name: lastVideo.name,
          src: lastVideo.src,
          sourceDuration: duration,
          inPoint: 0,
          outPoint: duration,
          startTime: placeholderStart,
          trackMode: 'av',
          trackId: targetTrackId,
        }
        // Merge updated track clips with clips from other tracks
        const baseList = clips.filter((c) => c.trackId !== targetTrackId).concat(baseTrackClips)
        const initialList = [...baseList, placeholder]
        commitClips(snapEnabled
          ? initialList
          : resolveOverlaps(initialList.filter((c) => c.trackId === targetTrackId), clipId, () => nextId('clip'))
              .concat(initialList.filter((c) => c.trackId !== targetTrackId)))
      }
      return
    }

    // Handle drag from sidebar
    const videoId = droppedVideoId
    const video = videos.find((v) => v.id === videoId)
    if (!video) return
    const trackMode = droppedTrackMode
    const selection = getSourceSelection(video)
    const hasExplicitSourceRange = !!sourceRanges[video.id]

    // Validate track type compatibility
    const requiredTrackType = trackMode === 'audio' ? 'audio' : 'video'
    if (targetTrack && targetTrack.type !== requiredTrackType) {
      alert(`Incompatible: ${trackMode === 'audio' ? 'Audio-only' : 'Video'} clip cannot be placed on ${targetTrack.type} track.`)
      return
    }

    // If dropped below existing tracks, create a new track of the required type
    if (dropTargetId === '__below__' || !targetTrack) {
      const newTrack = { id: nextTrackId(), type: requiredTrackType, name: `${requiredTrackType === 'audio' ? 'Audio' : 'Video'} ${tracks.filter((t) => t.type === requiredTrackType).length + 1}`, locked: false, height: DEFAULT_TRACK_HEIGHT }
      if (requiredTrackType === 'audio') { newTrack.muted = false; newTrack.solo = false }
      setTracks((prev) => [...prev, newTrack])
      targetTrack = newTrack
    }

    const targetTrackId = targetTrack.id
    const dropTime = dropTimeFromEvent(e)
    const clipId = nextId('clip')
    const placeholderDur = selection.clipDuration
    const trackClips = clips.filter((c) => c.trackId === targetTrackId)

    // Decide placement (insert / constrain / free)
    let placeholderStart = dropTime
    let baseTrackClips = trackClips
    let insertPoint = null // remembered for probe re-ripple
    if (snapEnabled) {
      const ins = detectInsertPoint(clipId, dropTime, placeholderDur, trackClips)
      if (ins) {
        insertPoint = ins.insertPoint
        placeholderStart = ins.insertPoint
        baseTrackClips = applyRippleInsert(trackClips, clipId, ins.insertPoint, placeholderDur)
      } else {
        placeholderStart = constrainMoveStart(dropTime, placeholderDur, trackClips)
      }
    }
    const placeholder = { ...makeClipFromSource(video, clipId, placeholderStart, trackMode), trackId: targetTrackId }
    const baseList = clips.filter((c) => c.trackId !== targetTrackId).concat(baseTrackClips)
    const initialList = [...baseList, placeholder]
    commitClips(snapEnabled
      ? initialList
      : resolveOverlaps(initialList.filter((c) => c.trackId === targetTrackId), clipId, () => nextId('clip'))
          .concat(initialList.filter((c) => c.trackId !== targetTrackId)))

    const duration = await probeDuration(video.src, video.mediaType, settings.imageDuration)
    setClips((prev) => {
      const placeholderClip = prev.find((c) => c.id === clipId)
      if (!placeholderClip) return prev // user removed it during probe
      const resolvedIn = hasExplicitSourceRange ? selection.inPoint : 0
      const resolvedOut = hasExplicitSourceRange ? Math.min(selection.outPoint, duration) : duration
      let updated = prev.map((c) =>
        c.id === clipId ? { ...c, sourceDuration: duration, inPoint: resolvedIn, outPoint: Math.max(resolvedIn + MIN_CLIP_DURATION, resolvedOut) } : c
      )
      // Track-aware overlap resolution
      const resolveTrackAware = (clipList) => {
        const byTrack = new Map()
        clipList.forEach((c) => {
          if (!byTrack.has(c.trackId)) byTrack.set(c.trackId, [])
          byTrack.get(c.trackId).push(c)
        })
        const resolved = []
        byTrack.forEach((trackClipList, trackId) => {
          const modified = trackClipList.find((c) => c.id === clipId)
          if (modified) {
            resolved.push(...resolveOverlaps(trackClipList, clipId, () => nextId('clip')))
          } else {
            resolved.push(...trackClipList)
          }
        })
        return resolved
      }
      if (!snapEnabled) {
        return resolveTrackAware(updated)
      }
      // Snap-on: adjust ripple by (actualDuration - placeholderDur) for clips behind the insert point
      if (insertPoint != null) {
        const extra = (Math.max(resolvedIn + MIN_CLIP_DURATION, resolvedOut) - resolvedIn) - placeholderDur
        if (Math.abs(extra) > 1e-3) {
          const insertEnd = placeholderStart + placeholderDur // boundary in current (already-rippled) timeline
          updated = updated.map((x) => {
            if (x.id === clipId) return x
            if (x.trackId === targetTrackId && x.startTime >= insertEnd - 1e-3) return { ...x, startTime: x.startTime + extra }
            return x
          })
        }
        return updated
      }
      // Gap mode: trim outPoint if it now overlaps the right neighbor
      const c = updated.find((x) => x.id === clipId)
      if (!c) return updated
      const others = updated.filter((x) => x.id !== clipId && x.trackId === targetTrackId)
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
    setSourceMonitorId(null)
    setTimelineTime(t)
    const clip = findClipAtTime(t, clips)
    if (clip) {
      playingClipIdRef.current = clip.id
      timelinePlaybackRef.current = null
      const within = t - clip.startTime
      const videoTime = clip.inPoint + within
      const media = videos.find((v) => v.id === clip.videoId)
      if (media?.mediaType === 'image') {
        setActiveClipId(clip.id)
        setActiveId(clip.videoId)
        pendingSeekRef.current = null
        pendingPlayRef.current = false
        if (playbackModeRef.current === 'timeline' && isPlaying) {
          imagePlaybackRef.current = {
            clipId: clip.id,
            startedAtMs: performance.now(),
            timelineStart: t,
          }
        }
        return
      }
      imagePlaybackRef.current = null
      if (clip.id !== activeClipId) {
        setActiveClipId(clip.id)
        if (clip.videoId !== playbackRef.current.activeId) {
          setActiveId(clip.videoId)
          pendingSeekRef.current = videoTime
        } else if (videoRef.current) {
          try { videoRef.current.currentTime = videoTime } catch { /* ignored */ }
        }
      } else if (videoRef.current) {
        try { videoRef.current.currentTime = videoTime } catch { /* ignored */ }
      }
    } else {
      playingClipIdRef.current = null
      imagePlaybackRef.current = null
      pendingSeekRef.current = null
      pendingPlayRef.current = false
      if (videoRef.current && !videoRef.current.paused) videoRef.current.pause()
      if (playbackModeRef.current === 'timeline' && isPlaying) {
        timelinePlaybackRef.current = {
          startedAtMs: performance.now(),
          timelineStart: t,
        }
      } else {
        timelinePlaybackRef.current = null
      }
    }
  }, [clips, activeClipId, isPlaying, videos])

  const getXInTracks = (clientX) => {
    if (!tracksContentRef.current) return 0
    const rect = tracksContentRef.current.getBoundingClientRect()
    return clientX - rect.left + tracksContentRef.current.scrollLeft
  }

  // --- mouse interactions ---
  // Pause helper: pauses if playing and remembers state for resume on mouseup
  const beginScrub = () => {
    const v = videoRef.current
    const wasPlaying = playbackModeRef.current === 'timeline' && isPlaying
    if (wasPlaying && v && !v.paused) v.pause()
    return wasPlaying
  }

  const handleTracksMouseDown = (e) => {
    if (e.target.closest('.clip') || e.target.closest('.playhead-handle')) return
    if (e.button !== 0) return
    setEditorFocus(FOCUS_TIMELINE)
    setSourceMonitorId(null)
    if (playbackModeRef.current === 'source') stopPlayback()
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
    setEditorFocus(FOCUS_TIMELINE)
    setSourceMonitorId(null)
    if (playbackModeRef.current === 'source') stopPlayback()
    const wasPlaying = beginScrub()
    const i = { type: 'seek', wasPlaying }
    interactionRef.current = i
    setInteraction(i)
  }

  const handleClipMouseDown = (e, clip) => {
    if (e.target.closest('.trim-handle') || e.target.closest('.clip-remove')) return
    if (e.button !== 0) return
    e.stopPropagation()
    setEditorFocus(FOCUS_TIMELINE)
    setSourceMonitorId(null)
    if (playbackModeRef.current === 'source') stopPlayback()
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
    setEditorFocus(FOCUS_TIMELINE)
    setSourceMonitorId(null)
    if (playbackModeRef.current === 'source') stopPlayback()
    setActiveClipId(clip.id)
    setActiveId(clip.videoId)
    const media = videos.find((v) => v.id === clip.videoId)
    const x = getXInTracks(e.clientX)
    const i = {
      type: side === 'left' ? 'trim-left' : 'trim-right',
      clipId: clip.id,
      startX: x,
      originalClip: { ...clip, mediaType: media?.mediaType || 'video' },
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
          // Track-aware: only consider clips on the same track as the primary clip
          const origTrackId = snaps[0].trackId
          const trackNonSelected = nonSelected.filter((c) => c.trackId === origTrackId)
          const ins = detectInsertPoint('__group__', proposedCenter, groupDur, trackNonSelected)
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
          // Track-aware: only consider clips on the same track as the group
          const origTrackId = snaps[0].trackId
          const trackNonSelected = nonSelected.filter((c) => c.trackId === origTrackId)
          let maxRightShift = Infinity, maxLeftShift = Infinity
          for (const s of snaps) {
            const sE = s.startTime + (s.outPoint - s.inPoint)
            for (const n of trackNonSelected) {
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
        const origTrackId = orig.trackId
        // Track-aware: filter snapshot to only clips on the same track
        const trackSnapshot = it.snapshotBefore.filter((c) => c.trackId === origTrackId)
        if (effSnap) {
          // Ripple-insert mode: when the dragged clip's center sits over another clip,
          // or in a gap too small for it, push the rest of the timeline aside (Filmora-style).
          const center = newStart + dur / 2
          const ins = detectInsertPoint(orig.id, center, dur, trackSnapshot)
          if (ins) {
            const rippledTrack = applyRippleInsert(trackSnapshot, orig.id, ins.insertPoint, dur)
            // Merge rippled track back with other tracks
            setClips(it.snapshotBefore.filter((c) => c.trackId !== origTrackId).concat(rippledTrack))
            setSnapIndicatorTime(ins.insertPoint)
            it.moved = true
            return
          }
          // Otherwise: edge-snap to snapshot positions, then constrain to non-overlap
          const sStart = snapValue(newStart, orig.id, trackSnapshot)
          const sEnd = snapValue(newStart + dur, orig.id, trackSnapshot)
          const distStart = Math.abs(sStart.value - newStart)
          const distEnd = Math.abs(sEnd.value - (newStart + dur))
          let snappedAt = null
          if (sStart.snapped && (!sEnd.snapped || distStart * pxPerSec <= distEnd * pxPerSec)) {
            newStart = sStart.value; snappedAt = sStart.value
          } else if (sEnd.snapped) {
            newStart = sEnd.value - dur; snappedAt = sEnd.value
          }
          if (newStart < 0) { newStart = 0; snappedAt = 0 }
          const others = trackSnapshot.filter((c) => c.id !== orig.id)
          const constrained = constrainMoveStart(newStart, dur, others)
          if (Math.abs(constrained - newStart) > 1e-3) snappedAt = null
          newStart = constrained
          // Restore other clips to snapshot positions (in case a previous frame rippled them)
          setSnapIndicatorTime(snappedAt)
          setClips(it.snapshotBefore.map((c) => (c.id === orig.id ? { ...c, startTime: newStart } : c)))
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
          const origTrackId = orig.trackId
          const others = clips.filter((c) => c.id !== orig.id && c.trackId === origTrackId)
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
        const maxOutPoint = orig.mediaType === 'image' ? Infinity : orig.sourceDuration
        let newOutPoint = Math.max(orig.inPoint + MIN_CLIP_DURATION,
                                    Math.min(maxOutPoint, orig.outPoint + deltaSec))
        let rightOnTimeline = orig.startTime + (newOutPoint - orig.inPoint)
        const s = snapValue(rightOnTimeline, orig.id)
        let snappedAt = null
        if (s.snapped) {
          const adjustedOut = newOutPoint + (s.value - rightOnTimeline)
          if (adjustedOut > orig.inPoint + MIN_CLIP_DURATION && adjustedOut <= maxOutPoint) {
            newOutPoint = adjustedOut
            rightOnTimeline = orig.startTime + (newOutPoint - orig.inPoint)
            snappedAt = s.value
          }
        }
        // Snap-on: prevent overlap with right neighbor
        if (effSnap) {
          const origTrackId = orig.trackId
          const others = clips.filter((c) => c.id !== orig.id && c.trackId === origTrackId)
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
      } else if (it && it.type === 'move' && !it.moved) {
        // Click without drag: collapse multi-selection to just the clicked clip
        setSelectedClipIds(new Set([it.clipId]))
      } else if (it && it.moved && it.snapshotBefore) {
        // Alt-drag stores a separate pre-clone snapshot so undo restores to before duplication.
        pushHistory(it.historyBefore || it.snapshotBefore)
        // Snap-off: cut overlapping neighbors (Filmora overwrite)
        if (!snapEnabled) {
          const isMultiMove = it.type === 'move' && it.selectedSnaps && it.selectedSnaps.length > 1
          if (isMultiMove) {
            const ids = new Set(it.selectedSnaps.map((s) => s.id))
            // Track-aware: resolve overlaps per track
            setClips((prev) => {
              const byTrack = new Map()
              prev.forEach((c) => {
                if (!byTrack.has(c.trackId)) byTrack.set(c.trackId, [])
                byTrack.get(c.trackId).push(c)
              })
              const resolved = []
              byTrack.forEach((trackClipList) => {
                const modified = trackClipList.filter((c) => ids.has(c.id))
                if (modified.length > 0) {
                  const modifierIds = modified.map((c) => c.id)
                  resolved.push(...resolveOverlapsMulti(trackClipList, modifierIds, () => nextId('clip')))
                } else {
                  resolved.push(...trackClipList)
                }
              })
              return resolved
            })
          } else if (it.type === 'move' || it.type === 'trim-left' || it.type === 'trim-right') {
            // Track-aware: resolve overlaps only within the clip's track
            setClips((prev) => {
              const orig = prev.find((c) => c.id === it.clipId)
              if (!orig) return prev
              const trackId = orig.trackId
              const trackClips = prev.filter((c) => c.trackId === trackId)
              const otherTracks = prev.filter((c) => c.trackId !== trackId)
              const resolvedTrack = resolveOverlaps(trackClips, it.clipId, () => nextId('clip'))
              return [...otherTracks, ...resolvedTrack]
            })
          }
        }
      }
      // Resume timeline playback at the scrubbed position, including empty gaps.
      if (it && it.type === 'seek' && it.wasPlaying) {
        const resumeTime = playbackRef.current.timelineTime
        const resumeClip = findClipAtTime(resumeTime, playbackRef.current.clips)
        if (resumeClip) startClipPlayback(resumeClip, resumeTime)
        else startTimelineGapPlayback(resumeTime)
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
    setEditorFocus(FOCUS_TIMELINE)
    setSourceMonitorId(null)
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
    setEditorFocus(FOCUS_TIMELINE)
    setSourceMonitorId(null)
    setActiveClipId(clip.id)
    setActiveId(clip.videoId)
    playingClipIdRef.current = clip.id
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

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault(); saveCurrentProject()
        return
      }

      if (editorFocus === FOCUS_SOURCE && isSourceMonitorActive) {
        if (e.code === 'Space' || e.code === 'KeyK') {
          e.preventDefault(); handleSourcePreviewPlay()
          return
        }
        if (e.code === 'ArrowLeft') {
          e.preventDefault()
          seekSourcePreviewTo(stepSourcePreviewTime({ keyCode: e.code, currentTime: previewTime, inPoint: activeSourceSelection.inPoint, outPoint: activeSourceSelection.outPoint, shiftKey: e.shiftKey }))
          return
        }
        if (e.code === 'ArrowRight') {
          e.preventDefault()
          seekSourcePreviewTo(stepSourcePreviewTime({ keyCode: e.code, currentTime: previewTime, inPoint: activeSourceSelection.inPoint, outPoint: activeSourceSelection.outPoint, shiftKey: e.shiftKey }))
          return
        }
        if (e.code === 'Comma') {
          e.preventDefault(); seekSourcePreviewTo(stepSourcePreviewTime({ keyCode: e.code, currentTime: previewTime, inPoint: activeSourceSelection.inPoint, outPoint: activeSourceSelection.outPoint }))
          return
        }
        if (e.code === 'Period') {
          e.preventDefault(); seekSourcePreviewTo(stepSourcePreviewTime({ keyCode: e.code, currentTime: previewTime, inPoint: activeSourceSelection.inPoint, outPoint: activeSourceSelection.outPoint }))
          return
        }
        if (e.code === 'Home') {
          e.preventDefault(); seekSourcePreviewTo(stepSourcePreviewTime({ keyCode: e.code, currentTime: previewTime, inPoint: activeSourceSelection.inPoint, outPoint: activeSourceSelection.outPoint }))
          return
        }
        if (e.code === 'End') {
          e.preventDefault(); seekSourcePreviewTo(stepSourcePreviewTime({ keyCode: e.code, currentTime: previewTime, inPoint: activeSourceSelection.inPoint, outPoint: activeSourceSelection.outPoint }))
          return
        }
        if (e.code === 'KeyJ') {
          e.preventDefault(); seekSourcePreviewTo(stepSourcePreviewTime({ keyCode: e.code, currentTime: previewTime, inPoint: activeSourceSelection.inPoint, outPoint: activeSourceSelection.outPoint }))
          return
        }
        if (e.code === 'KeyL') {
          e.preventDefault()
          if (playbackMode !== 'source' || !isPlaying) handleSourcePreviewPlay()
          return
        }
      }

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
        if (playbackMode !== 'timeline' || !isPlaying) handlePlay()
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
  }, [activeClipId, activeSourceSelection, clips, commitClips, duplicateClip, editorFocus, handlePlay, handleSourcePreviewPlay, isPlaying, isSourceMonitorActive, playbackMode, previewTime, redo, saveCurrentProject, seekSourcePreviewTo, seekToTime, selectedClipIds, selectedGap, snapEnabled, splitAtPlayhead, timelineTime, totalEnd, undo])

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

  const activePlaybackSpace = useMemo(() => {
    if (playbackMode !== 'timeline' || !isPlaying) return null
    if (findClipAtTime(timelineTime, displayClips)) return null
    return findTimelineSpaceAtTime(timelineTime, displayClips)
  }, [displayClips, isPlaying, playbackMode, timelineTime])

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

  if (showProjectStart) {
    return (
      <div className="app project-start-app">
        <div className="project-start-shell">
          <img src={logoUrl} alt="StoneCutter" className="project-start-logo" draggable={false} />
          <h1>Willkommen zu StoneCutter</h1>
          <div className="project-start-actions">
            <button className="project-primary-action" onClick={() => setShowNewProjectDialog(true)}>
              <Icon.Plus /> Neues Projekt
            </button>
            <button className="project-secondary-action" onClick={handleOpenProject} disabled={!isTauri}>
              <Icon.FolderOpen /> Projekt oeffnen
            </button>
          </div>

          <section className="recent-projects-panel">
            <div className="recent-projects-header">
              <h2>Zuletzt benutzt</h2>
              {recentProjects.length > 0 && (
                <button className="recent-clear-btn" onClick={() => persistRecentProjects([])}>Leeren</button>
              )}
            </div>
            {recentProjects.length === 0 ? (
              <div className="recent-empty">Noch keine Projekte geoeffnet.</div>
            ) : (
              <div className="recent-project-list">
                {recentProjects.map((project) => (
                  <button
                    key={project.path}
                    className="recent-project-item"
                    onClick={() => openProjectPath(project.path)}
                    title={project.path}
                  >
                    <span className="recent-project-icon"><Icon.File /></span>
                    <span className="recent-project-info">
                      <strong>{project.name}</strong>
                      <span>{project.path}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {projectStatus && (
            <div className={`project-status ${projectStatus.ok ? 'ok' : 'err'}`}>
              {projectStatus.msg}
            </div>
          )}
        </div>

        {showNewProjectDialog && (
          <div className="settings-overlay" onClick={() => setShowNewProjectDialog(false)}>
            <div className="settings-panel project-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="settings-header">
                <h3><Icon.Plus /> Neues Projekt</h3>
                <button className="settings-close" onClick={() => setShowNewProjectDialog(false)}>x</button>
              </div>
              <div className="settings-body">
                <label className="project-name-field">
                  <span>Projektname</span>
                  <input
                    autoFocus
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateProject()
                    }}
                  />
                </label>
                <p className="settings-hint">StoneCutter erstellt einen Projektordner mit einer `.stonecutter`-Projektdatei.</p>
                <button className="export-start-btn" onClick={handleCreateProject}>
                  <Icon.FolderOpen /> Speicherort waehlen
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="app">
      <div className="logo-area">
        <img
          src={logoUrl}
          alt="StoneCutter"
          className="app-logo"
          draggable={false}
        />
        <div className="project-toolbar">
          <button
            className="project-toolbar-btn"
            onClick={() => setShowProjectStart(true)}
            title="Startscreen anzeigen"
          >
            <Icon.File /> {currentProject?.name || 'Projekt'}
          </button>
          <button
            className="project-toolbar-btn"
            onClick={saveCurrentProject}
            title="Projekt speichern (Ctrl+S)"
            disabled={!currentProject?.path || !isProjectDirty}
          >
            <Icon.Save /> {isProjectDirty ? 'Speichern' : 'Gespeichert'}
          </button>
        </div>
        {isTauri && (
          <button
            className="logo-export-btn"
            onClick={() => { setExportStatus(null); setShowExport(true) }}
            title="Als MP4 exportieren"
            disabled={clips.length === 0}
          >
            <Icon.Export /> Exportieren
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="video/*,image/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      {projectStatus && (
        <div className={`project-toast ${projectStatus.ok ? 'ok' : 'err'}`}>
          {projectStatus.msg}
          <button onClick={() => setProjectStatus(null)}>x</button>
        </div>
      )}

      {/* ===== Sidebar ===== */}
      <aside className={`sidebar ${editorFocus === FOCUS_SOURCE ? 'focus-source' : ''}`}>
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
      <main className={`main-content ${editorFocus === FOCUS_SOURCE ? 'focus-source' : ''}`}>
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
                onClick={handlePlay}
                draggable={false}
              />
            ) : videoSrc ? (
              <video
                ref={videoRef}
                key={videoSrc}
                className="video"
                onClick={handlePlay}
                onPlay={() => setIsPlaying(true)}
                onPause={() => {
                  if (playbackModeRef.current === 'timeline' && playingClipIdRef.current) return
                  if (!imagePlaybackRef.current && !timelinePlaybackRef.current) setIsPlaying(false)
                }}
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handlePreviewTimeUpdate}
                src={videoSrc}
              />
            ) : (
              <div className="empty-overlay">
                <p>Wähle ein Medium aus der Mediathek</p>
                <p className="hint">Doppelklick zur Vorschau · Ziehen auf die Timeline</p>
              </div>
            )}
            {isSourceMonitorActive && (
              <div className="preview-player-bar">
                <button className="preview-player-btn" onClick={handlePlay} title="Vorschau abspielen">
                  {playbackMode === 'source' && isPlaying ? <Icon.Pause /> : <Icon.Play />}
                </button>
                <span className="preview-player-time">{formatTC(previewTime)}</span>
                <div className="preview-player-progress" aria-hidden="true">
                  <div
                    className="preview-player-progress-fill"
                    style={{ width: `${Math.min(100, Math.max(0, (previewTime / activeSourceSelection.duration) * 100))}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {activeVideo && (
            <div className="video-title-bar">
              <span className="title-name">{activeVideo.name}</span>
              {activeVideo.mediaType === 'image' && <span className="media-type-badge">Bild · {settings.imageDuration}s</span>}
            </div>
          )}

          {isSourceMonitorActive && (
            <div className="source-trim-panel">
              <div className="source-trim-header">
                <span>Source In/Out</span>
                <strong>
                  {formatTC(activeSourceSelection.inPoint)} - {formatTC(activeSourceSelection.outPoint)}
                  {' '}({formatTime(activeSourceSelection.clipDuration)})
                </strong>
                <div className="source-point-actions">
                  <button type="button" onClick={() => setSourcePointAtPreviewTime('inPoint')} title="In auf aktuelle Vorschauposition setzen">
                    In
                  </button>
                  <button type="button" onClick={() => setSourcePointAtPreviewTime('outPoint')} title="Out auf aktuelle Vorschauposition setzen">
                    Out
                  </button>
                </div>
              </div>
              <div
                className="source-preview-timeline"
                onMouseDown={beginSourcePreviewSeek}
                title="Vorschauposition setzen; In/Out-Handles ziehen"
              >
                <div
                  className="source-preview-window"
                  style={{
                    left: `${(activeSourceSelection.inPoint / activeSourceSelection.duration) * 100}%`,
                    width: `${(activeSourceSelection.clipDuration / activeSourceSelection.duration) * 100}%`,
                  }}
                />
                <div
                  className="source-preview-playhead"
                  style={{ left: `${Math.min(100, Math.max(0, (previewTime / activeSourceSelection.duration) * 100))}%` }}
                />
                <button
                  type="button"
                  className="source-preview-handle in"
                  style={{ left: `${(activeSourceSelection.inPoint / activeSourceSelection.duration) * 100}%` }}
                  onMouseDown={(e) => beginSourceTimelineDrag(e, 'inPoint')}
                  aria-label="Source In setzen"
                  title="In ziehen"
                />
                <button
                  type="button"
                  className="source-preview-handle out"
                  style={{ left: `${(activeSourceSelection.outPoint / activeSourceSelection.duration) * 100}%` }}
                  onMouseDown={(e) => beginSourceTimelineDrag(e, 'outPoint')}
                  aria-label="Source Out setzen"
                  title="Out ziehen"
                />
              </div>
              <div className="source-drag-actions">
                <button
                  type="button"
                  className="source-drag-btn video-source"
                  draggable
                  onDragStart={(e) => handleSourceDragStart(e, 'av')}
                  onDragEnd={handleDragEnd}
                  aria-label={activeVideo.mediaType === 'image' ? 'Bildauswahl in die Timeline ziehen' : 'Auswahl als Video mit Audio in die Timeline ziehen'}
                  title={activeVideo.mediaType === 'image' ? 'Bildauswahl in die Timeline ziehen' : 'Auswahl als Video mit Audio in die Timeline ziehen'}
                >
                  <Icon.VideoTrack /> {activeVideo.mediaType === 'image' ? 'Bild' : 'Video + Audio'}
                </button>
                {activeVideo.mediaType === 'video' && (
                  <button
                    type="button"
                    className="source-drag-btn audio-source"
                    draggable
                    onDragStart={(e) => handleSourceDragStart(e, 'audio')}
                    onDragEnd={handleDragEnd}
                    aria-label="Nur Audio der Auswahl in die Timeline ziehen"
                    title="Nur Audio der Auswahl in die Timeline ziehen"
                  >
                    <Icon.AudioTrack /> Nur Audio
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ===== Timeline ===== */}
      <section
        className={`timeline ${dragOver ? 'drag-over' : ''} ${editorFocus === FOCUS_TIMELINE ? 'focus-timeline' : ''}`}
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
              {playbackMode === 'timeline' && isPlaying ? <Icon.Pause /> : <Icon.Play />}
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
          {/* Fixed track headers column */}
          <div className="track-headers">
            <div className="track-header time-header" />
            <div className="track-headers-list" ref={trackHeadersListRef}>
              {tracks.map((track) => (
                <div
                  key={track.id}
                  className={`track-header-row ${track.type === 'video' ? 'video' : 'audio'} ${dropTargetTrackId === track.id ? 'drop-target' : ''}`}
                  style={{ height: `${track.height || DEFAULT_TRACK_HEIGHT}px` }}
                >
                  <div className="track-header-left">
                    <span className="track-icon">{track.type === 'video' ? '▶' : '🔊'}</span>
                    {editingTrackId === track.id ? (
                      <input
                        className="track-name-input"
                        defaultValue={track.name}
                        autoFocus
                        onBlur={(e) => { handleUpdateTrack(track.id, { name: e.target.value }); setEditingTrackId(null) }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { handleUpdateTrack(track.id, { name: e.currentTarget.value }); setEditingTrackId(null) } if (e.key === 'Escape') setEditingTrackId(null) }}
                      />
                    ) : (
                      <span className="track-name" onDoubleClick={() => setEditingTrackId(track.id)} title="Doppelklick zum Bearbeiten">
                        {track.name}
                      </span>
                    )}
                  </div>
                  <div className="track-header-controls">
                    {track.type === 'audio' && (
                      <>
                        <button
                          className={`track-btn mute ${track.muted ? 'active' : ''}`}
                          onClick={() => handleUpdateTrack(track.id, { muted: !track.muted })}
                          title={track.muted ? 'Stumm aus' : 'Stumm'}
                        >M</button>
                        <button
                          className={`track-btn solo ${track.solo ? 'active' : ''}`}
                          onClick={() => handleUpdateTrack(track.id, { solo: !track.solo })}
                          title={track.solo ? 'Solo aus' : 'Solo'}
                        >S</button>
                      </>
                    )}
                    <button
                      className={`track-btn lock ${track.locked ? 'active' : ''}`}
                      onClick={() => handleUpdateTrack(track.id, { locked: !track.locked })}
                      title={track.locked ? 'Entsperren' : 'Sperren'}
                    >🔒</button>
                    {tracks.length > 1 && (
                      <button
                        className="track-btn delete"
                        onClick={() => handleRemoveTrack(track.id)}
                        title="Spur löschen"
                      >×</button>
                    )}
                  </div>
                </div>
              ))}
              {/* Drop target below tracks */}
              {dropTargetTrackId === '__below__' && (
                <div className="track-header-row drop-target-below">
                  <span>+ Neue Spur</span>
                </div>
              )}
            </div>
            {/* Add track buttons */}
            <div className="track-header-actions">
              <button className="add-track-btn" onClick={() => handleAddTrack('video')} title="Video-Spur hinzufügen">+ Video</button>
              <button className="add-track-btn" onClick={() => handleAddTrack('audio')} title="Audio-Spur hinzufügen">+ Audio</button>
            </div>
          </div>

          <div
            className="tracks-content"
            ref={tracksContentRef}
            onMouseDown={handleTracksMouseDown}
            onScroll={handleTracksScroll}
          >
            <div className="tracks-inner" style={{ width: `${totalWidth}px`, minHeight: `${30 + tracks.reduce((h, t) => h + (t.height || DEFAULT_TRACK_HEIGHT), 0) + 60}px` }}>
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

              {/* Track lanes */}
              {tracks.map((track) => (
                <div
                  key={track.id}
                  className={`track-lane ${track.type} ${dropTargetTrackId === track.id ? 'drop-target' : ''} ${track.locked ? 'locked' : ''}`}
                  style={{ height: `${track.height || DEFAULT_TRACK_HEIGHT}px` }}
                  data-track-id={track.id}
                >
                  {displayClips.filter((c) => c.trackId === track.id).map((clip) => {
                    const dur = clip.outPoint - clip.inPoint
                    const left = clip.startTime * pxPerSec
                    const width = Math.max(20, dur * pxPerSec)
                    const isVideo = track.type === 'video'
                    const trimmedLeft = clip.inPoint > 0.01
                    const trimmedRight = clip.outPoint < clip.sourceDuration - 0.01
                    return (
                      <div
                        key={clip.id}
                        className={`clip ${isVideo ? 'video-clip' : 'audio-clip'} ${activeClipId === clip.id ? 'active' : ''} ${selectedClipIds.has(clip.id) ? 'selected' : ''} ${draggingIds?.has(clip.id) ? 'dragging' : ''} ${track.locked ? 'track-locked' : ''}`}
                        style={{ left: `${left}px`, width: `${width}px` }}
                        onMouseDown={(e) => !track.locked && handleClipMouseDown(e, clip)}
                        onDoubleClick={(e) => handleClipDoubleClick(clip, e)}
                        onContextMenu={(e) => handleClipContextMenu(e, clip)}
                        title={`${clip.name}\nIn: ${formatTime(clip.inPoint)} · Out: ${formatTime(clip.outPoint)} · Dauer: ${formatTime(dur)}`}
                      >
                        <div
                          className={`trim-handle left ${trimmedLeft ? 'trimmed' : ''}`}
                          onMouseDown={(e) => !track.locked && handleTrimMouseDown(e, clip, 'left')}
                          title="Links trimmen"
                        />
                        {isVideo ? (
                          <>
                            {(() => {
                              const thumbs = thumbsMap[clip.videoId]
                              if (thumbs && thumbs.length > 0) {
                                const sd = Math.max(0.001, clip.sourceDuration)
                                const startIdx = Math.max(0, Math.floor((clip.inPoint / sd) * thumbs.length))
                                const endIdx = Math.min(thumbs.length, Math.max(startIdx + 1, Math.ceil((clip.outPoint / sd) * thumbs.length)))
                                const visible = thumbs.slice(startIdx, endIdx)
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
                          </>
                        ) : (
                          <>
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
                            <span className="clip-name">{clip.name}</span>
                          </>
                        )}
                        <button
                          className="clip-remove"
                          onClick={(e) => handleClipRemove(clip.id, e)}
                          onMouseDown={(e) => e.stopPropagation()}
                          title="Aus Timeline entfernen"
                        ><Icon.Trash /></button>
                        <div
                          className={`trim-handle right ${trimmedRight ? 'trimmed' : ''}`}
                          onMouseDown={(e) => !track.locked && handleTrimMouseDown(e, clip, 'right')}
                          title="Rechts trimmen"
                        />
                      </div>
                    )
                  })}
                </div>
              ))}

              {/* Drop indicator (during drag) */}
              {dragOver && dropIndicatorTime != null && (
                <div className="drop-indicator" style={{ left: `${dropIndicatorTime * pxPerSec}px` }} />
              )}

              {/* Snap indicator (during move/trim) */}
              {snapIndicatorTime != null && (
                <div className="snap-indicator" style={{ left: `${snapIndicatorTime * pxPerSec}px` }} />
              )}

              {activePlaybackSpace && (
                <div
                  className={`playback-space playback-space-${activePlaybackSpace.type}`}
                  style={{
                    left: `${activePlaybackSpace.start * pxPerSec}px`,
                    width: `${Math.max(2, (activePlaybackSpace.end - activePlaybackSpace.start) * pxPerSec)}px`,
                  }}
                  aria-hidden="true"
                />
              )}

              {/* Import-drag preview: ghost clip showing exact position + duration */}
              {importDragInfo && dropTargetTrackId && dropTargetTrackId !== '__below__' && (
                (() => {
                  const targetTrack = tracks.find((t) => t.id === dropTargetTrackId)
                  if (!targetTrack) return null
                  const isVideo = targetTrack.type === 'video'
                  return (
                    <>
                      <div
                        className={`clip ghost-clip ${isVideo ? 'video-clip' : 'audio-clip'} mode-${importDragInfo.mode}`}
                        style={{
                          left: `${importDragInfo.insertPoint * pxPerSec}px`,
                          width: `${Math.max(20, importDragInfo.dur * pxPerSec)}px`,
                          top: `${30 + tracks.slice(0, tracks.findIndex((t) => t.id === dropTargetTrackId)).reduce((h, t) => h + (t.height || DEFAULT_TRACK_HEIGHT), 0)}px`,
                          position: 'absolute',
                        }}
                      >
                        <div className="clip-name">{importDragInfo.name}</div>
                        <div className="ghost-badge">
                          {importDragInfo.mode === 'insert' && '⇆ Einfügen'}
                          {importDragInfo.mode === 'overwrite' && '✂ Überschreiben'}
                          {importDragInfo.mode === 'constrain' && '↔ Anpassen'}
                        </div>
                      </div>
                      {importDragInfo.mode === 'insert' && (
                        <div className="insert-indicator" style={{ left: `${importDragInfo.insertPoint * pxPerSec}px` }} />
                      )}
                    </>
                  )
                })()
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
                      {[
                        { val: 'low',    label: 'Niedrig', crf: 28, preset: 'veryfast', hint: '~2–4 Mbit/s',  desc: 'Kleinste Datei, sichtbare Artefakte' },
                        { val: 'medium', label: 'Mittel',  crf: 23, preset: 'fast',     hint: '~6–10 Mbit/s', desc: 'Empfohlen – gute Qualität & Größe' },
                        { val: 'high',   label: 'Hoch',    crf: 18, preset: 'slow',     hint: '~15–30 Mbit/s',desc: 'Maximale Qualität, große Datei' },
                      ].map(({ val, label, crf, preset, hint, desc }) => (
                        <label key={val} className={`export-quality-btn ${exportQuality === val ? 'active' : ''}`}>
                          <input type="radio" name="quality" value={val} checked={exportQuality === val} onChange={() => setExportQuality(val)} />
                          <span className="eq-label">{label}</span>
                          <span className="eq-hint">{hint}</span>
                          <span className="eq-desc">{desc}</span>
                          <span className="eq-tech">CRF {crf} · {preset}</span>
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
        const isTrimmed = clip.inPoint > 0.01 || Math.abs(clip.outPoint - clip.sourceDuration) > 0.01
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
              onClick={() => handleContextMenuDuplicate(clip.id)} // eslint-disable-line react-hooks/refs
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
