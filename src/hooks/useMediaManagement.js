import { useCallback, useEffect, useMemo } from "react";
import { MediaAssetService } from "../lib/services/MediaAssetService.js";
import { normalizePreviewQuality } from "../lib/proxyGenerator.js";
import { FOCUS_SOURCE } from "../lib/sourceMonitor.js";
import { nextId, formatTime } from "../lib/utils.js";

/**
 * useMediaManagement — media import, selection, removal, and sidebar drag-start.
 *
 * Extracted from App.jsx lines 1878–2170.
 */
export function useMediaManagement({
  // Videos / clips state
  videos,
  setVideos,
  clips,
  activeClipId,
  setActiveClipId,
  activeId,
  setActiveId,
  mediaSelectionId,
  setMediaSelectionId,
  sourceMonitorId,
  setSourceMonitorId,
  setSelectedClipIds,

  // UI state
  setEditorFocus,
  setPreviewTime,
  setIsPlaying,
  setDropZoneTrackMode,
  setImportDragInfo,
  setDragTooltip,

  // Derived / cached data
  videoDurations,
  setVideoDurations,
  setPeaksMap,
  setThumbsMap,
  setSourceRanges,
  settings,

  // Refs
  mediaAnalysisRef,
  browserObjectUrlsRef,
  fileRef,
  draggedVideoIdRef,
  draggedTrackModeRef,
  draggedUseSourceRangeRef,
  playingClipIdRef,
  pendingSeekRef,
  pendingPlayRef,
  videoRef,

  // Callbacks
  revokeBrowserObjectUrls,
  getSourceSelection,
  getFullMediaSelection,
  commitClips,
  stopPlayback,

  // Constants
  isTauri,
}) {
  const activeVideo = useMemo(
    () => videos.find((v) => v.id === activeId),
    [activeId, videos],
  );
  // --- probe durations ---
  const probeAndCacheDurations = useCallback(
    (items) => {
      for (const item of items) {
        if (videoDurations[item.id] != null) continue;
        MediaAssetService.probeDuration(
          item.src,
          item.mediaType,
          settings.imageDuration,
        ).then(
          (dur) => {
            setVideoDurations((prev) =>
              prev[item.id] != null ? prev : { ...prev, [item.id]: dur },
            );
          },
        );
      }
    },
    [settings.imageDuration, videoDurations, setVideoDurations],
  );

  // --- preview proxies ---
  const generatePreviewProxies = useCallback(
    (items, previewQuality = settings.previewQuality) => {
      if (!isTauri) return;
      const quality = normalizePreviewQuality(previewQuality);
      if (quality === "full") return;
      items
        .filter((item) => item.mediaType === "video")
        .forEach((item) => {
          const proxyKey = `${item.id}:${quality}`;
          if (mediaAnalysisRef.current.previewProxyStarted.has(proxyKey)) return;
          mediaAnalysisRef.current.previewProxyStarted.add(proxyKey);
          MediaAssetService.generateProxy(item, quality)
            .then((proxy) => {
              if (!proxy) return;
              setVideos((prev) =>
                prev.map((video) =>
                  video.id === item.id
                    ? {
                        ...video,
                        ...proxy,
                        previewProxies: {
                          ...(video.previewProxies || {}),
                          ...(proxy.previewProxies || {}),
                        },
                      }
                    : video,
                ),
              );
            })
            .catch((err) => {
              mediaAnalysisRef.current.previewProxyStarted.delete(proxyKey);
              console.warn("Proxy generation failed:", err);
            });
        });
    },
    [isTauri, mediaAnalysisRef, settings.previewQuality, setVideos],
  );

  // Auto-generate proxies when quality setting changes or new videos appear
  useEffect(() => {
    if (!isTauri) return;
    const quality = normalizePreviewQuality(settings.previewQuality);
    if (quality === "full") return;
    const items = videos.filter(
      (item) =>
        item.mediaType === "video" &&
        item.path &&
        !item.previewProxies?.[quality] &&
        !(item.proxyQuality === quality && item.proxySrc) &&
        !mediaAnalysisRef.current.previewProxyStarted.has(`${item.id}:${quality}`),
    );
    if (items.length > 0) generatePreviewProxies(items, quality);
  }, [generatePreviewProxies, isTauri, mediaAnalysisRef, settings.previewQuality, videos]);

  // --- import ---
  const handleImport = useCallback(async () => {
    if (isTauri) {
      try {
        const items = await MediaAssetService.openMediaDialog({
          isTauri,
          makeId: nextId,
        });
        if (items && items.length > 0) {
          setVideos((prev) => [...prev, ...items]);
          probeAndCacheDurations(items);
          generatePreviewProxies(items, settings.previewQuality);
        }
      } catch (err) {
        console.error("Import failed:", err);
        alert("Import fehlgeschlagen: " + err);
      }
    } else {
      fileRef.current?.click();
    }
  }, [
    fileRef,
    generatePreviewProxies,
    isTauri,
    probeAndCacheDurations,
    setVideos,
    settings.previewQuality,
  ]);

  // --- file change (browser fallback) ---
  const handleFileChange = useCallback(
    (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return [];
      const items = files.map((f) => {
        const src = URL.createObjectURL(f);
        browserObjectUrlsRef.current.add(src);
        return {
          id: nextId("vid"),
          name: f.name,
          path: f.name,
          src,
          originalPath: f.name,
          proxyPath: null,
          proxySrc: null,
          proxyResolution: null,
          mediaType: MediaAssetService.getFileMediaType(f),
          importedAt: new Date().toISOString(),
        };
      });
      setVideos((prev) => [...prev, ...items]);
      probeAndCacheDurations(items);
      if (e.target && "value" in e.target) e.target.value = "";
      return items;
    },
    [browserObjectUrlsRef, probeAndCacheDurations, setVideos],
  );

  // --- select media ---
  const handleSelectMedia = useCallback(
    (id) => {
      if (mediaSelectionId === id) {
        setMediaSelectionId(null);
        setActiveId(null);
        setSourceMonitorId(null);
        return;
      }
      stopPlayback();
      setEditorFocus(FOCUS_SOURCE);
      setMediaSelectionId(id);
      setActiveId(id);
      setActiveClipId(null);
      playingClipIdRef.current = null;
      const media = videos.find((v) => v.id === id);
      setSourceMonitorId(media?.mediaType === "video" ? id : null);
      const selection = getSourceSelection(id);
      setPreviewTime(selection.inPoint);
      if (media?.mediaType === "video") {
        pendingSeekRef.current = selection.inPoint;
        pendingPlayRef.current = false;
        if (videoRef.current && activeId === id) {
          try {
            videoRef.current.currentTime = selection.inPoint;
          } catch {
            /* ignored */
          }
        }
      }
    },
    [
      activeId,
      getSourceSelection,
      mediaSelectionId,
      pendingPlayRef,
      pendingSeekRef,
      playingClipIdRef,
      setActiveClipId,
      setActiveId,
      setEditorFocus,
      setMediaSelectionId,
      setPreviewTime,
      setSourceMonitorId,
      stopPlayback,
      videoRef,
      videos,
    ],
  );

  // --- double-click media ---
  const handleDoubleClickMedia = useCallback(
    (id) => {
      stopPlayback();
      setEditorFocus(FOCUS_SOURCE);
      setMediaSelectionId(id);
      setActiveId(id);
      setActiveClipId(null);
      playingClipIdRef.current = null;
      const media = videos.find((v) => v.id === id);
      setSourceMonitorId(media?.mediaType === "video" ? id : null);
      const selection = getSourceSelection(id);
      setPreviewTime(selection.inPoint);
      pendingSeekRef.current = selection.inPoint;
      pendingPlayRef.current = false;
      if (videoRef.current && activeId === id) {
        try {
          videoRef.current.currentTime = selection.inPoint;
        } catch {
          /* ignored */
        }
      }
    },
    [
      activeId,
      getSourceSelection,
      pendingPlayRef,
      pendingSeekRef,
      playingClipIdRef,
      setActiveClipId,
      setActiveId,
      setEditorFocus,
      setMediaSelectionId,
      setPreviewTime,
      setSourceMonitorId,
      stopPlayback,
      videoRef,
      videos,
    ],
  );

  // --- remove media ---
  const handleRemoveMedia = useCallback(
    (id, e) => {
      e.stopPropagation();
      const removedMedia = videos.find((v) => v.id === id);
      if (removedMedia) revokeBrowserObjectUrls([removedMedia]);
      const removedClipIds = new Set(
        clips.filter((clip) => clip.videoId === id).map((clip) => clip.id),
      );
      if (removedClipIds.size > 0) {
        commitClips(clips.filter((clip) => clip.videoId !== id));
        setSelectedClipIds((prev) => {
          const next = new Set(prev);
          removedClipIds.forEach((clipId) => next.delete(clipId));
          return next;
        });
        if (removedClipIds.has(activeClipId)) setActiveClipId(null);
      }
      setVideos((prev) => prev.filter((v) => v.id !== id));
      setVideoDurations((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setSourceRanges((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setPeaksMap((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setThumbsMap((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (activeId === id) {
        setActiveId(null);
        setIsPlaying(false);
      }
      if (mediaSelectionId === id) {
        setMediaSelectionId(null);
      }
      if (sourceMonitorId === id) setSourceMonitorId(null);
    },
    [
      activeClipId,
      activeId,
      clips,
      commitClips,
      mediaSelectionId,
      revokeBrowserObjectUrls,
      setActiveClipId,
      setActiveId,
      setIsPlaying,
      setMediaSelectionId,
      setPeaksMap,
      setSelectedClipIds,
      setSourceMonitorId,
      setSourceRanges,
      setThumbsMap,
      setVideoDurations,
      setVideos,
      sourceMonitorId,
      videos,
    ],
  );

  // --- drag from sidebar ---
  const handleDragStart = useCallback(
    (e, video, trackMode = "av", useSourceRange = false) => {
      const effectiveTrackMode =
        video.mediaType === "audio" ? "audio" : trackMode;
      draggedVideoIdRef.current = video.id;
      draggedTrackModeRef.current = effectiveTrackMode;
      draggedUseSourceRangeRef.current = useSourceRange;
      setDropZoneTrackMode(effectiveTrackMode);
      // Probe lazily if not yet cached, so the very first preview is accurate too.
      if (videoDurations[video.id] == null) {
        MediaAssetService.probeDuration(
          video.src,
          video.mediaType,
          settings.imageDuration,
        ).then(
          (dur) => {
            setVideoDurations((prev) =>
              prev[video.id] != null ? prev : { ...prev, [video.id]: dur },
            );
          },
        );
      }
      const selection = useSourceRange
        ? getSourceSelection(video)
        : getFullMediaSelection(video);
      const ghost = document.createElement("div");
      ghost.className = "drag-ghost";
      const icon = document.createElement("span");
      icon.className = "drag-ghost-icon";
      icon.textContent = effectiveTrackMode === "audio" ? "A" : "V";
      const name = document.createElement("span");
      name.className = "drag-ghost-name";
      name.textContent = `${video.name} · ${formatTime(selection.clipDuration)}`;
      ghost.append(icon, name);
      Object.assign(ghost.style, {
        position: "absolute",
        top: "-1000px",
        left: "0px",
        pointerEvents: "none",
      });
      document.body.appendChild(ghost);
      try {
        e.dataTransfer.setDragImage(ghost, 14, 18);
      } catch {
        /* ignored */
      }
      setTimeout(() => {
        if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
      }, 0);
      e.dataTransfer.setData("text/plain", video.id);
      e.dataTransfer.setData("text", video.id);
      e.dataTransfer.setData(
        "application/x-stonecutter-track-mode",
        effectiveTrackMode,
      );
      e.dataTransfer.effectAllowed = "copy";
    },
    [
      draggedTrackModeRef,
      draggedUseSourceRangeRef,
      draggedVideoIdRef,
      getFullMediaSelection,
      getSourceSelection,
      setDropZoneTrackMode,
      setVideoDurations,
      settings.imageDuration,
      videoDurations,
    ],
  );

  const handleDragEnd = useCallback(() => {
    draggedVideoIdRef.current = null;
    draggedTrackModeRef.current = "av";
    draggedUseSourceRangeRef.current = false;
    setDropZoneTrackMode("av");
    setImportDragInfo(null);
    setDragTooltip(null);
  }, [
    draggedTrackModeRef,
    draggedUseSourceRangeRef,
    draggedVideoIdRef,
    setDragTooltip,
    setDropZoneTrackMode,
    setImportDragInfo,
  ]);

  const handleSourceDragStart = useCallback(
    (e, trackMode) => {
      if (!activeVideo) return;
      handleDragStart(e, activeVideo, trackMode, true);
    },
    [activeVideo, handleDragStart],
  );

  return {
    handleImport,
    handleFileChange,
    handleSelectMedia,
    handleDoubleClickMedia,
    handleRemoveMedia,
    handleDragStart,
    handleDragEnd,
    handleSourceDragStart,
  };
}
