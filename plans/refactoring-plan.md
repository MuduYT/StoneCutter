# StoneCutter Refactoring Plan

## Current State

| File | Lines | Est. Size | Target |
|------|-------|-----------|--------|
| `src/App.jsx` | 5205 | ~185 KB | <100 KB |
| `src/App.css` | 4300 | ~95 KB | <10 KB (only app-specific layout) |

## Strategy

Extract 7 custom hooks from `App.jsx` in 3 phases, then modularize `App.css`.

---

## Phase 1 — High Priority (largest, most cohesive blocks)

### 1.1 `useTimelineInteraction` (~800 lines)

**Lines:** 2882–3797  
**New file:** `src/hooks/useTimelineInteraction.js`

**Functions to extract:**
- `seekToTime` (2883–2919)
- `getXInTracks` (2921–2925)
- `beginScrub` (2929–2935)
- `handleTracksMouseDown` (2937–2989)
- `handlePlayheadMouseDown` (2991–3001)
- `handleClipMouseDown` (3003–3106)
- `handleTrimMouseDown` (3108–3128)
- `handlePreviewClipMouseDown` (3130–3174)
- `snapValue` (3178–3198)
- Global `mousemove/mouseup` useEffect (3201–3797) — the massive `onMove`/`onUp` handler
- `handleClipContextMenu` (3872–3880)
- `handleContextMenuDuplicate` (3960–3964)
- `handleContextMenuDelete` (3965–3970)
- `handleContextMenuUnlink` (3972–3976)

**State/refs needed (passed as params or via refs):**
- `clips`, `setClips`
- `tracks`, `setTracks`
- `pxPerSec`, `snapEnabled`
- `interaction`, `setInteraction`
- `interactionRef`
- `selectedClipIds`, `setSelectedClipIds`
- `activeClipId`, `setActiveClipId`
- `activeId`, `setActiveId`
- `timelineTime`, `setTimelineTime`
- `timelineTimeRef`
- `tracksContentRef`
- `timelinePlaybackLookups`
- `playbackModeRef`
- `isPlaying`
- `videoRef`
- `timelinePreviewRef`
- `setSnapIndicatorTime`
- `setScrubTooltip`
- `setMarqueeBox`
- `setPreviewSnapGuides`
- `setDropTargetTrackId`
- `setTrackMovePreview`
- `setSelectedGap`
- `setSelectedKeyframe`
- `setEditorFocus`
- `setSourceMonitorId`
- `setActiveClipId`
- `setActiveId`
- `pushHistory`, `createHistorySnapshot`
- `stopPlayback`, `pauseTimelinePreviewMedia`
- `startClipPlayback`, `startTimelineGapPlayback`
- `getMoveTrackPlan`, `updateTrackMovePreview`, `updateTrackMovePreviewFromClips`
- `placeLinkedSyncClips`
- `getTopVisibleTimelineClip`
- `findGapAtTime`
- `commitClips`
- `duplicateClip`
- `unlinkClipGroup`
- `nextId`
- `SNAP_THRESHOLD_PX`, `MOVE_THRESHOLD_PX`, `MIN_CLIP_DURATION`

**Return:** All handler functions + `seekToTime`

---

### 1.2 `useDragDrop` (~700 lines)

**Lines:** 2097–2880  
**New file:** `src/hooks/useDragDrop.js`

**Functions to extract:**
- `handleDragStart` (2097–2157)
- `handleDragEnd` (2158–2165)
- `handleSourceDragStart` (2167–2170)
- `computeImportPreview` (2183–2271)
- `handleTimelineDragEnter` (2273–2277)
- `handleTimelineDragOver` (2278–2373)
- `handleTimelineDragLeave` (2374–2383)
- `handleTimelineDrop` (2384–2880)

**State/refs needed:**
- `videos`, `setVideos`
- `clips`, `setClips`
- `tracks`, `setTracks`
- `pxPerSec`, `snapEnabled`
- `setDragOver`
- `setDropIndicatorTime`
- `setImportDragInfo`
- `setDragTooltip`
- `setDropTargetTrackId`
- `setDropZoneTrackMode`
- `setProjectStatus`
- `setSelectedClipIds`
- `setActiveClipId`
- `setActiveId`
- `setEditorFocus`
- `setSourceMonitorId`
- `draggedVideoIdRef`
- `draggedTrackModeRef`
- `draggedUseSourceRangeRef`
- `tracksContentRef`
- `pushHistory`, `createHistorySnapshot`
- `getSourceSelection`, `getFullMediaSelection`
- `splitMediaIntoLinkedClips`
- `detectInsertPoint`, `applyRippleInsert`
- `resolveOverlaps`
- `nextId`, `nextTrackId`
- `createDefaultTracks`
- `insertTrackOrdered`
- `getTrackIdAtTimelineY`
- `getCollisionFreeTrackForClip`
- `getAutoTrackZoneTop`
- `DEFAULT_TRACK_HEIGHT`
- `MIN_CLIP_DURATION`
- `MediaAssetService`

**Return:** All handler functions

---

### 1.3 `usePlayback` (~500 lines)

**Lines:** 1388–1876  
**New file:** `src/hooks/usePlayback.js`

**Functions/effects to extract:**
- `primeTimelinePlayback` (1328–1386)
- `handleTimelinePlay` (1488–1526)
- `handleLoadedMetadata` (1576–1593)
- Playback sync useEffect (1603–1718)
- Active layers ref useEffect (1726–1741)
- Playback tick useEffect (1760–1876)
- `stopPlayback`, `startClipPlayback`, `startTimelineGapPlayback`, `pauseTimelinePreviewMedia` (need to locate exact lines)

**State/refs needed:**
- `playbackRef`
- `playbackModeRef`
- `playingClipIdRef`
- `imagePlaybackRef`
- `timelinePlaybackRef`
- `timelinePlaybackStartTokenRef`
- `transportToggleAtRef`
- `sourcePauseLockUntilRef`
- `timelineSeekGraceUntilRef`
- `timelineMediaSeekPromisesRef`
- `timelineTimeRef`
- `timelinePlayheadRefs`
- `timelineLastStateUpdateRef`
- `activeTimelineLayersRef`
- `videoRef`
- `timelineVisualRefs`
- `timelineAudioRefs`
- `clips`, `videos`, `tracks`
- `isPlaying`, `setIsPlaying`
- `playbackMode`, `setPlaybackMode`
- `timelineTime`, `setTimelineTime`
- `activeClipId`, `setActiveClipId`
- `activeId`, `setActiveId`
- `setEditorFocus`
- `setSourceMonitorId`
- `volume`, `muted`
- `timelinePlaybackLookups`
- `getTopVisibleTimelineClip`
- `getTimelineVisualClips`, `getTimelineAudibleClips`
- `getVirtualTimelinePlaybackTime`
- `buildTimelinePlaybackLookups`
- `updateTimelinePlayheadPosition`
- `seekToTime`
- `TIMELINE_MEDIA_SEEK_GRACE_MS`, `TIMELINE_MEDIA_SEEK_TIMEOUT_MS`
- `TIMELINE_STATE_FPS`
- `TRANSPORT_TOGGLE_DEBOUNCE_MS`
- `SOURCE_PLAY_LOCK_MS`
- `TIMELINE_LAYER_BOUNDARY_EPSILON`
- `TIMELINE_PLAYING_VIDEO_DRIFT_TOLERANCE`
- `TIMELINE_PLAYING_AUDIO_DRIFT_TOLERANCE`
- `TIMELINE_PAUSED_DRIFT_TOLERANCE`

**Return:** `handleTimelinePlay`, `stopPlayback`, `startClipPlayback`, `startTimelineGapPlayback`, `pauseTimelinePreviewMedia`, `handleLoadedMetadata`

---

## Phase 2 — Medium Priority

### 2.1 `useMediaManagement` (~400 lines)

**Lines:** 1878–2157  
**New file:** `src/hooks/useMediaManagement.js`

**Functions to extract:**
- `handleImport` (1953–1972)
- `handleFileChange` (1974–1997)
- `handleSelectMedia` (1999–2027)
- `handleDoubleClickMedia` (2028–2048)
- `handleRemoveMedia` (2049–2094)
- `handleDragStart` (2097–2157) — media library drag start
- `handleDragEnd` (2158–2165)

**State/refs needed:**
- `videos`, `setVideos`
- `setMediaSelectionId`
- `setActiveId`
- `setSourceMonitorId`
- `setEditorFocus`
- `setVideoDurations`
- `setPeaksMap`
- `setThumbsMap`
- `setProjectStatus`
- `mediaAnalysisRef`
- `browserObjectUrlsRef`
- `revokeBrowserObjectUrls`
- `fileRef`
- `draggedVideoIdRef`
- `draggedTrackModeRef`
- `draggedUseSourceRangeRef`
- `getSourceSelection`
- `MediaAssetService`
- `isTauri`

**Return:** All handler functions

---

### 2.2 `useKeyboardShortcuts` (~400 lines)

**Lines:** 3978–4373  
**New file:** `src/hooks/useKeyboardShortcuts.js`

**Functions/effects to extract:**
- The entire keyboard shortcut useEffect (3979–4373)

**State/refs needed:**
- `editorFocus`, `isSourceMonitorActive`, `activeSourceSelection`
- `previewTime`, `seekSourcePreviewTo`
- `handlePlay`, `saveCurrentProject`
- `clips`, `commitClips`
- `selectedClipIds`, `setSelectedClipIds`
- `activeClipId`, `setActiveClipId`
- `selectedGap`, `setSelectedGap`
- `selectedKeyframe`, `setSelectedKeyframe`
- `timelineTime`, `seekToTime`
- `totalEnd`
- `snapEnabled`, `setSnapEnabled`
- `splitAtPlayhead`
- `undo`, `redo`
- `pushHistory`, `createHistorySnapshot`
- `duplicateClip`
- `clipboardRef`
- `videoRef`
- `playbackMode`, `isPlaying`
- `detectInsertPoint`, `applyRippleInsert`
- `resolveOverlaps`
- `closeGap`, `rippleDeleteClips`
- `expandWithLinkedPartners`
- `unlinkClipGroup`
- `getClipPropertyTrack`, `removeKeyframe`, `setClipPropertyTrack`
- `nextId`

**Return:** Nothing (it's a self-contained useEffect)

---

### 2.3 `useKeyframes` (~300 lines)

**Lines:** 4672–4878  
**New file:** `src/hooks/useKeyframes.js`

**Functions/effects to extract:**
- `toggleKeyframeAtPlayhead` (4674–4683)
- `toggleGroupKeyframeAtPlayhead` (4685–4694)
- `selectKeyframeAndSeek` (4696–4703)
- `beginKeyframeDrag` (4705–4733)
- `beginVolumeKeyframeDrag` (4736–4760)
- `addVolumeKeyframeFromCurve` (4762–4792)
- Keyframe drag useEffect (4794–4878)

**State/refs needed:**
- `clips`, `setClips`
- `pxPerSec`
- `timelineTimeRef`
- `keyframeDragRef`
- `setSelectedKeyframe`
- `setActiveClipId`
- `seekToTime`
- `pushHistory`, `createHistorySnapshot`
- `updateInspectorClip`
- `snapTimeToFrame`, `PROJECT_FPS`
- `toggleClipKeyframeAt`, `createGroupKeyframes`
- `getClipPropertyTrack`, `setClipPropertyTrack`
- `addOrUpdateKeyframe`, `moveKeyframe`

**Return:** All keyframe handler functions

---

## Phase 3 — Lower Priority

### 3.1 `useHistory` (~100 lines)

**Lines:** 922–1000  
**New file:** `src/hooks/useHistory.js`

**Functions to extract:**
- `pushHistory`
- `undo`
- `redo`
- `createHistorySnapshot`

**State/refs needed:**
- `historyRef`
- `setHistorySizes`
- `clips`, `setClips`
- `tracks`, `setTracks`
- `setSelectedClipIds`
- `setActiveClipId`
- `setActiveId`
- `setSelectedGap`
- `setSelectedKeyframe`
- `setTimelineTime`
- `timelineTimeRef`
- `setSourceMonitorId`
- `setEditorFocus`
- `setPeaksMap`, `setThumbsMap`
- `mediaAnalysisRef`
- `revokeBrowserObjectUrls`
- `groupVisibleClipsByTrack`

**Return:** `pushHistory`, `undo`, `redo`, `createHistorySnapshot`

---

### 3.2 `useProjectManagement` (~200 lines)

**Lines:** 405–536  
**New file:** `src/hooks/useProjectManagement.js`

**Functions to extract:**
- `handleCreateProject` (405–433)
- `openProjectPath` (435–449)
- `handleOpenProject` (451–460)
- `saveCurrentProject` (462–476)
- `handleBackToProjects` (478–497)
- `handleConfirmBack` (499–517)
- `handleCancelBack` (519–535)

**State/refs needed:**
- `currentProject`, `setCurrentProject`
- `newProjectName`
- `isProjectDirty`, `setIsProjectDirty`
- `setShowProjectStart`
- `setShowNewProjectDialog`
- `setShowSaveConfirmDialog`
- `setProjectStatus`
- `setClips`, `setVideos`
- `setTracks`
- `setMediaSelectionId`
- `setActiveId`, `setActiveClipId`
- `setSelectedClipIds`, `setSelectedGap`
- `setHistorySizes`
- `historyRef`
- `getProjectSnapshot`
- `applyProjectState`
- `rememberProject`
- `createEmptyProjectState`
- `createProjectDocument`, `createProjectFolder`
- `loadProjectFile`
- `saveProjectFile`
- `sanitizeProjectName`
- `createDefaultTracks`
- `isTauri`

**Return:** All project management handler functions

---

## Phase 4 — CSS Modularization

### Extract from App.css into component files:

| New File | Lines from App.css | Content |
|----------|-------------------|---------|
| `src/styles/project-start.css` | 73–334 | Project Start Screen |
| `src/styles/sidebar.css` | 335–559 | Sidebar, Media Bin |
| `src/styles/player.css` | 560–1163 | Player, Video Container, Preview |
| `src/styles/source-monitor.css` | 1164–1449 | Source Trim Panel |
| `src/styles/overlays.css` | 1535–1981 | Context Menu, Settings, Export Modals |
| `src/styles/inspector.css` | 2470–2941 | Inspector Panel & Controls |
| `src/styles/topbar.css` | 2942–3256 | Top Navigation Bar |
| `src/styles/keyframes.css` | 4046–4300 | Keyframe Styles |

**Remaining in App.css after extraction:** ~500 lines (app layout, polish pass, transitions, scrollbars, preview controls, fade overlays, volume tooltip, audio clip, sidebar/inspector placeholders)

---

## Execution Order

```
Phase 1a: useTimelineInteraction  → -800 lines from App.jsx
Phase 1b: useDragDrop             → -700 lines from App.jsx
Phase 1c: usePlayback             → -500 lines from App.jsx
                                    ─────────
                                    -2000 lines total → App.jsx ~3200 lines

Phase 2a: useMediaManagement      → -400 lines
Phase 2b: useKeyboardShortcuts    → -400 lines
Phase 2c: useKeyframes            → -300 lines
                                    ─────────
                                    -1100 lines total → App.jsx ~2100 lines

Phase 3a: useHistory              → -100 lines
Phase 3b: useProjectManagement    → -200 lines
                                    ─────────
                                    -300 lines total → App.jsx ~1800 lines

Phase 4:  CSS modularization      → App.css <500 lines
```

## Risk Assessment

| Hook | Risk | Reason |
|------|------|--------|
| `useTimelineInteraction` | **HIGH** | 800 lines, complex state coupling, the onMove/onUp handler references ~30 state setters and refs. Must carefully thread all dependencies. |
| `useDragDrop` | **HIGH** | 700 lines, complex async drop logic, references many lib functions. |
| `usePlayback` | **MEDIUM** | 500 lines, tightly coupled to videoRef and playbackRef, timing-sensitive. |
| `useMediaManagement` | **LOW** | Clean I/O boundary, mostly self-contained. |
| `useKeyboardShortcuts` | **LOW** | Single useEffect, all read-only state access. |
| `useKeyframes` | **LOW** | Clean separation, well-defined API surface. |
| `useHistory` | **LOW** | Small, well-defined. |
| `useProjectManagement` | **LOW** | Already partially extracted. |

## Recommended Start

Begin with **Phase 2a (`useMediaManagement`)** as a warm-up — low risk, builds confidence in the extraction pattern. Then tackle **Phase 1a (`useTimelineInteraction`)** for maximum size reduction.
