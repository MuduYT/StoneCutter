import { useCallback, useEffect } from "react";
import {
  createEmptyProjectState,
  sanitizeProjectName,
} from "../lib/project.js";
import { createDefaultTracks } from "../lib/trackStore.js";
import { normalizePreviewQuality } from "../lib/proxyGenerator.js";
import {
  createProjectDocument,
  createProjectFolder,
  loadProjectFile,
  saveProjectFile,
} from "../lib/projectHelpers.js";

export function useProjectLifecycle({
  // Environment / constants
  isTauri,
  projectFilter,
  recentProjectsKey,
  focusSource,

  // Project + UI state
  currentProject,
  newProjectName,
  isProjectDirty,
  settings,
  aspectRatio,
  pxPerSec,
  snapEnabled,
  volume,
  muted,
  timelineTime,
  videos,
  clips,
  sourceRanges,
  videoDurations,
  tracks,
  recentProjects,

  // Refs
  projectHydratingRef,
  mediaAnalysisRef,
  timelineTimeRef,
  historyRef,

  // Setters
  setRecentProjects,
  setSettings,
  setVideos,
  setClips,
  setSourceRanges,
  setVideoDurations,
  setTracks,
  setPeaksMap,
  setThumbsMap,
  setTimelineTime,
  setAspectRatio,
  setPxPerSec,
  setSnapEnabled,
  setVolume,
  setMuted,
  setMediaSelectionId,
  setActiveId,
  setSourceMonitorId,
  setEditorFocus,
  setActiveClipId,
  setSelectedClipIds,
  setSelectedGap,
  setShowProjectStart,
  setCurrentProject,
  setIsProjectDirty,
  setHistorySizes,
  setShowSaveConfirmDialog,
  setShowNewProjectDialog,
  setProjectStatus,

  // Helpers
  revokeBrowserObjectUrls,
  buildProjectSnapshot,
}) {
  const persistRecentProjects = useCallback(
    (items) => {
      setRecentProjects(items);
      try {
        localStorage.setItem(recentProjectsKey, JSON.stringify(items));
      } catch {
        /* ignored */
      }
    },
    [recentProjectsKey, setRecentProjects],
  );

  const rememberProject = useCallback(
    (project) => {
      if (!project?.path) return;
      const entry = {
        name: project.name || "Untitled Project",
        path: project.path,
        directory: project.directory || "",
        openedAt: new Date().toISOString(),
      };
      const next = [
        entry,
        ...recentProjects.filter((item) => item.path !== entry.path),
      ].slice(0, 8);
      persistRecentProjects(next);
    },
    [persistRecentProjects, recentProjects],
  );

  const getProjectSnapshot = useCallback(
    (name = currentProject?.name || newProjectName) =>
      buildProjectSnapshot(
        name,
        videos,
        clips,
        sourceRanges,
        videoDurations,
        tracks,
        timelineTime,
        settings,
        aspectRatio,
        pxPerSec,
        snapEnabled,
        volume,
        muted,
      ),
    [
      aspectRatio,
      buildProjectSnapshot,
      clips,
      currentProject?.name,
      muted,
      newProjectName,
      pxPerSec,
      settings,
      snapEnabled,
      sourceRanges,
      timelineTime,
      tracks,
      videoDurations,
      videos,
      volume,
    ],
  );

  const applyProjectState = useCallback(
    (state, projectInfo) => {
      projectHydratingRef.current = true;
      revokeBrowserObjectUrls(videos);
      setVideos(state.videos);
      setClips(state.clips);
      setSourceRanges(state.sourceRanges);
      setVideoDurations(state.videoDurations);
      setTracks(state.tracks);
      setPeaksMap({});
      setThumbsMap({});
      mediaAnalysisRef.current.waveformStarted = new Set();
      mediaAnalysisRef.current.thumbnailStarted = new Set();
      timelineTimeRef.current = state.timelineTime;
      setTimelineTime(state.timelineTime);
      setSettings((prev) => ({
        ...prev,
        ...state.settings,
        previewQuality: normalizePreviewQuality(state.settings?.previewQuality),
      }));
      setAspectRatio(state.ui.aspectRatio);
      setPxPerSec(state.ui.pxPerSec);
      setSnapEnabled(state.ui.snapEnabled);
      setVolume(state.ui.volume);
      setMuted(state.ui.muted);
      const initialMediaId = state.videos[0]?.id || null;
      setMediaSelectionId(initialMediaId);
      setActiveId(initialMediaId);
      setSourceMonitorId(null);
      setEditorFocus(focusSource);
      setActiveClipId(null);
      setSelectedClipIds(new Set());
      setSelectedGap(null);
      setShowProjectStart(false);
      setCurrentProject(projectInfo);
      setIsProjectDirty(false);
      historyRef.current = { past: [], future: [] };
      setHistorySizes({ past: 0, future: 0 });
      setTimeout(() => {
        projectHydratingRef.current = false;
      }, 0);
    },
    [
      focusSource,
      historyRef,
      mediaAnalysisRef,
      projectHydratingRef,
      revokeBrowserObjectUrls,
      setActiveClipId,
      setActiveId,
      setAspectRatio,
      setClips,
      setCurrentProject,
      setEditorFocus,
      setHistorySizes,
      setIsProjectDirty,
      setMediaSelectionId,
      setMuted,
      setPeaksMap,
      setPxPerSec,
      setSelectedClipIds,
      setSelectedGap,
      setSettings,
      setShowProjectStart,
      setSnapEnabled,
      setSourceMonitorId,
      setSourceRanges,
      setThumbsMap,
      setTimelineTime,
      setTracks,
      setVideoDurations,
      setVideos,
      setVolume,
      timelineTimeRef,
      videos,
    ],
  );

  const handleCreateProject = useCallback(async () => {
    if (!isTauri) {
      const name = sanitizeProjectName(newProjectName);
      applyProjectState(createEmptyProjectState(name), {
        name,
        path: "",
        directory: "",
      });
      setShowNewProjectDialog(false);
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const parentDir = await open({
        directory: true,
        multiple: false,
        title: "Projektordner-Speicherort waehlen",
      });
      if (!parentDir) return;
      const document = await createProjectDocument(newProjectName);
      const info = await createProjectFolder(parentDir, newProjectName, document);
      applyProjectState(createEmptyProjectState(info.name), info);
      rememberProject(info);
      setShowNewProjectDialog(false);
      setProjectStatus({ ok: true, msg: `Projekt angelegt: ${info.name}` });
    } catch (err) {
      setProjectStatus({ ok: false, msg: String(err) });
    }
  }, [
    applyProjectState,
    isTauri,
    newProjectName,
    rememberProject,
    setProjectStatus,
    setShowNewProjectDialog,
  ]);

  const openProjectPath = useCallback(
    async (path) => {
      if (!isTauri || !path) return;
      try {
        const { state, directory } = await loadProjectFile(path);
        const projectInfo = { name: state.name, path, directory };
        applyProjectState(state, projectInfo);
        rememberProject(projectInfo);
        setProjectStatus({ ok: true, msg: `Projekt geoeffnet: ${state.name}` });
      } catch (err) {
        setProjectStatus({ ok: false, msg: String(err) });
      }
    },
    [applyProjectState, isTauri, rememberProject, setProjectStatus],
  );

  const handleOpenProject = useCallback(async () => {
    if (!isTauri) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ multiple: false, filters: projectFilter });
      if (selected) await openProjectPath(selected);
    } catch (err) {
      setProjectStatus({ ok: false, msg: String(err) });
    }
  }, [isTauri, openProjectPath, projectFilter, setProjectStatus]);

  const saveCurrentProject = useCallback(async () => {
    if (!currentProject?.path || !isTauri) {
      setProjectStatus({ ok: false, msg: "Kein gespeichertes Projekt aktiv." });
      return false;
    }
    try {
      const document = JSON.stringify(getProjectSnapshot(currentProject.name), null, 2);
      await saveProjectFile(currentProject.path, document);
      setIsProjectDirty(false);
      rememberProject(currentProject);
      setProjectStatus({ ok: true, msg: "Projekt gespeichert." });
      return true;
    } catch (err) {
      setProjectStatus({ ok: false, msg: String(err) });
      return false;
    }
  }, [
    currentProject,
    getProjectSnapshot,
    isTauri,
    rememberProject,
    setIsProjectDirty,
    setProjectStatus,
  ]);

  const resetToProjectOverview = useCallback(() => {
    setShowProjectStart(true);
    setCurrentProject(null);
    setClips([]);
    setVideos([]);
    setTracks(createDefaultTracks());
    setMediaSelectionId(null);
    setActiveId(null);
    setActiveClipId(null);
    setSelectedClipIds(new Set());
    setSelectedGap(null);
    setIsProjectDirty(false);
    historyRef.current = { past: [], future: [] };
    setHistorySizes({ past: 0, future: 0 });
  }, [
    historyRef,
    setActiveClipId,
    setActiveId,
    setClips,
    setCurrentProject,
    setHistorySizes,
    setIsProjectDirty,
    setMediaSelectionId,
    setSelectedClipIds,
    setSelectedGap,
    setShowProjectStart,
    setTracks,
    setVideos,
  ]);

  const handleBackToProjects = useCallback(async () => {
    if (isProjectDirty) {
      setShowSaveConfirmDialog(true);
    } else {
      resetToProjectOverview();
    }
  }, [isProjectDirty, resetToProjectOverview, setShowSaveConfirmDialog]);

  const handleConfirmBack = useCallback(async () => {
    let saved = false;
    if (isTauri && currentProject?.path) {
      saved = await saveCurrentProject();
    } else {
      setProjectStatus({ ok: false, msg: "Kein gespeichertes Projekt aktiv." });
    }
    if (!saved) {
      return;
    }
    setShowSaveConfirmDialog(false);
    resetToProjectOverview();
  }, [
    currentProject,
    isTauri,
    resetToProjectOverview,
    saveCurrentProject,
    setProjectStatus,
    setShowSaveConfirmDialog,
  ]);

  const handleCancelBack = useCallback(() => {
    setShowSaveConfirmDialog(false);
    resetToProjectOverview();
  }, [resetToProjectOverview, setShowSaveConfirmDialog]);

  useEffect(() => {
    if (!currentProject || projectHydratingRef.current) return;
    setIsProjectDirty(true);
  }, [
    aspectRatio,
    clips,
    currentProject,
    muted,
    projectHydratingRef,
    pxPerSec,
    settings,
    setIsProjectDirty,
    snapEnabled,
    sourceRanges,
    tracks,
    videoDurations,
    videos,
    volume,
  ]);

  useEffect(() => {
    try {
      localStorage.setItem("stonecutter.settings", JSON.stringify(settings));
    } catch {
      /* ignored */
    }
  }, [settings]);

  return {
    persistRecentProjects,
    handleCreateProject,
    openProjectPath,
    handleOpenProject,
    saveCurrentProject,
    handleBackToProjects,
    handleConfirmBack,
    handleCancelBack,
  };
}
