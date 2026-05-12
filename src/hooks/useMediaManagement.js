import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { MediaContext } from "../contexts/MediaContext.jsx";
import { MediaAssetService } from "../lib/services/MediaAssetService.js";
import { getMediaType } from "../lib/timeline.js";
import { normalizePreviewQuality } from "../lib/proxyGenerator.js";
import { FOCUS_SOURCE } from "../lib/sourceMonitor.js";
import { nextId, formatTime } from "../lib/utils.js";

const basenameFromPath = (path = "") => String(path).split(/[\\/]/).pop() || "";

/**
 * useMediaManagement — media import, selection, removal, and sidebar drag-start.
 *
 * Extracted from App.jsx lines 1878–2170.
 */
export function useMediaManagement() {
  const context = useContext(MediaContext);
  if (!context) throw new Error("useMediaManagement must be used within MediaProvider");
  return context;
}

export function useMediaManagementController({
  // Videos / clips state
  videos,
  setVideos,
  clips,
  activeClipId,
  setActiveClipId,
  activeId,
  setActiveId,
  setSelectedMediaIds,
  sourceMonitorId,
  setSourceMonitorId,
  setSelectedClipIds,
  visibleVideos = [],

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
  const visibleVideoIndexById = useMemo(
    () => new Map((visibleVideos || []).map((video, index) => [video.id, index])),
    [visibleVideos],
  );
  const selectionAnchorIdRef = useRef(null);
  const [offlineMediaIds, setOfflineMediaIds] = useState(() => new Set());

  const validateMediaPaths = useCallback(
    async (items = videos) => {
      if (!isTauri) return new Set();
      const missing = new Set();
      await Promise.all(
        (items || []).map(async (item) => {
          const mediaPath = item?.path || item?.originalPath;
          if (!item?.id || !mediaPath) return;
          try {
            const exists = await MediaAssetService.pathExists(mediaPath);
            if (!exists) missing.add(item.id);
          } catch {
            missing.add(item.id);
          }
        }),
      );
      return missing;
    },
    [isTauri, videos],
  );

  useEffect(() => {
    let cancelled = false;
    validateMediaPaths(videos).then((missing) => {
      if (!cancelled) setOfflineMediaIds(missing);
    });
    return () => {
      cancelled = true;
    };
  }, [validateMediaPaths, videos]);
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

  const clearProxy = useCallback(
    async (itemId, previewQuality = settings.previewQuality) => {
      if (!isTauri) return;
      const quality = normalizePreviewQuality(previewQuality);
      if (quality === "full") return;
      const item = videos.find((video) => video.id === itemId);
      if (!item || item.mediaType !== "video") return;
      const proxyEntry = item.previewProxies?.[quality];
      const proxyPath =
        proxyEntry?.proxyPath ||
        (item.proxyQuality === quality ? item.proxyPath : null);
      if (proxyPath) {
        try {
          await MediaAssetService.deleteProxy(proxyPath);
        } catch (err) {
          console.warn("Proxy deletion failed:", err);
        }
      }
      mediaAnalysisRef.current.previewProxyStarted.delete(`${itemId}:${quality}`);
      setVideos((prev) =>
        prev.map((video) => {
          if (video.id !== itemId) return video;
          const nextPreviewProxies = { ...(video.previewProxies || {}) };
          delete nextPreviewProxies[quality];
          const hasPreviewProxies = Object.keys(nextPreviewProxies).length > 0;
          const next = {
            ...video,
            previewProxies: hasPreviewProxies ? nextPreviewProxies : undefined,
          };
          if (video.proxyQuality === quality) {
            next.proxyQuality = undefined;
            next.proxySrc = null;
            next.proxyPath = null;
            next.proxyResolution = null;
          }
          return next;
        }),
      );
    },
    [isTauri, mediaAnalysisRef, setVideos, settings.previewQuality, videos],
  );

  const regenerateProxy = useCallback(
    async (itemId, previewQuality = settings.previewQuality) => {
      if (!isTauri) return;
      const quality = normalizePreviewQuality(previewQuality);
      if (quality === "full") return;
      const item = videos.find((video) => video.id === itemId);
      if (!item || item.mediaType !== "video") return;
      await clearProxy(itemId, quality);
      mediaAnalysisRef.current.previewProxyStarted.add(`${itemId}:${quality}`);
      try {
        const proxy = await MediaAssetService.generateProxy(item, quality);
        if (!proxy) return;
        setVideos((prev) =>
          prev.map((video) =>
            video.id === itemId
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
      } catch (err) {
        console.warn("Proxy regeneration failed:", err);
      } finally {
        mediaAnalysisRef.current.previewProxyStarted.delete(`${itemId}:${quality}`);
      }
    },
    [clearProxy, isTauri, mediaAnalysisRef, setVideos, settings.previewQuality, videos],
  );

  const replaceMedia = useCallback(
    async (itemId, newPath) => {
      if (!isTauri || !newPath) return;
      const item = videos.find((video) => video.id === itemId);
      if (!item) return;
      const { convertFileSrc } = await import("@tauri-apps/api/core");
      const name = basenameFromPath(newPath) || item.name;
      const mediaType = getMediaType(name);
      const nextItem = {
        ...item,
        name,
        path: newPath,
        originalPath: newPath,
        src: convertFileSrc(newPath),
        mediaType: mediaType || item.mediaType,
        proxyPath: null,
        proxySrc: null,
        proxyResolution: null,
        proxyQuality: undefined,
        previewProxies: undefined,
      };
      const proxyPaths = new Set([
        item.proxyPath,
        ...Object.values(item.previewProxies || {}).map((proxy) => proxy?.proxyPath),
      ].filter(Boolean));
      await Promise.all(
        [...proxyPaths].map((proxyPath) =>
          MediaAssetService.deleteProxy(proxyPath).catch((err) =>
            console.warn("Proxy deletion failed:", err),
          ),
        ),
      );
      mediaAnalysisRef.current.thumbnailStarted.delete(itemId);
      mediaAnalysisRef.current.waveformStarted.delete(itemId);
      for (const key of [...mediaAnalysisRef.current.previewProxyStarted]) {
        if (key.startsWith(`${itemId}:`)) {
          mediaAnalysisRef.current.previewProxyStarted.delete(key);
        }
      }
      setVideos((prev) =>
        prev.map((video) => (video.id === itemId ? nextItem : video)),
      );
      setOfflineMediaIds((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      setVideoDurations((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      setThumbsMap((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      setPeaksMap((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      MediaAssetService.probeDuration(
        nextItem.src,
        nextItem.mediaType,
        settings.imageDuration,
      ).then((duration) => {
        setVideoDurations((prev) => ({ ...prev, [itemId]: duration }));
      });
      if (nextItem.mediaType === "video") {
        generatePreviewProxies([nextItem], settings.previewQuality);
      }
    },
    [
      generatePreviewProxies,
      isTauri,
      mediaAnalysisRef,
      setPeaksMap,
      setThumbsMap,
      setVideoDurations,
      setVideos,
      settings.imageDuration,
      settings.previewQuality,
      videos,
    ],
  );

  const relinkMedia = useCallback(
    async (itemId, folderPath) => {
      if (!isTauri || !folderPath) return;
      const item = videos.find((video) => video.id === itemId);
      if (!item) return;
      const fileName = basenameFromPath(item.path || item.originalPath || item.name);
      const foundPath = await MediaAssetService.findMediaByName(folderPath, fileName);
      if (!foundPath) {
        alert("Datei nicht gefunden im ausgewählten Ordner.");
        return;
      }
      await replaceMedia(itemId, foundPath);
    },
    [isTauri, replaceMedia, videos],
  );

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
    (id, modifiers = {}) => {
      const isCtrlOrMeta = Boolean(modifiers.ctrlKey);
      const isShift = Boolean(modifiers.shiftKey);
      const media = videos.find((v) => v.id === id);
      const isAV = media?.mediaType === "video" || media?.mediaType === "audio";

      if (isShift) {
        const anchorId = selectionAnchorIdRef.current ?? id;
        const anchorIndex = visibleVideoIndexById.get(anchorId);
        const currentIndex = visibleVideoIndexById.get(id);
        if (anchorIndex == null || currentIndex == null) {
          setSelectedMediaIds((prev) => new Set(prev).add(id));
        } else {
          const start = Math.min(anchorIndex, currentIndex);
          const end = Math.max(anchorIndex, currentIndex);
          const rangeIds = visibleVideos.slice(start, end + 1).map((video) => video.id);
          setSelectedMediaIds((prev) => {
            const next = new Set(prev);
            rangeIds.forEach((rangeId) => next.add(rangeId));
            return next;
          });
        }
        selectionAnchorIdRef.current = id;
        return;
      }

      if (isCtrlOrMeta) {
        setSelectedMediaIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        selectionAnchorIdRef.current = id;
        return;
      }

      stopPlayback();
      setEditorFocus(FOCUS_SOURCE);
      setSelectedMediaIds(new Set([id]));
      setActiveId(id);
      setActiveClipId(null);
      playingClipIdRef.current = null;
      setSourceMonitorId(isAV ? id : null);
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
      selectionAnchorIdRef.current = id;
    },
    [
      activeId,
      getSourceSelection,
      setSelectedMediaIds,
      pendingPlayRef,
      pendingSeekRef,
      playingClipIdRef,
      setActiveClipId,
      setActiveId,
      setEditorFocus,
      setPreviewTime,
      setSourceMonitorId,
      stopPlayback,
      visibleVideoIndexById,
      visibleVideos,
      videoRef,
      videos,
    ],
  );

  // --- double-click media ---
  const handleDoubleClickMedia = useCallback(
    (id) => {
      stopPlayback();
      setEditorFocus(FOCUS_SOURCE);
      setSelectedMediaIds(new Set([id]));
      setActiveId(id);
      setActiveClipId(null);
      playingClipIdRef.current = null;
      const media = videos.find((v) => v.id === id);
      const isAV = media?.mediaType === "video" || media?.mediaType === "audio";
      setSourceMonitorId(isAV ? id : null);
      const selection = getSourceSelection(id);
      setPreviewTime(selection.inPoint);
      pendingSeekRef.current = selection.inPoint;
      pendingPlayRef.current = false;
      if (media?.mediaType === "video" && videoRef.current && activeId === id) {
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
      setSelectedMediaIds,
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
      e?.stopPropagation?.();
      const idsToRemove = id instanceof Set ? [...id] : Array.isArray(id) ? id : [id];
      const removalSet = new Set(idsToRemove.filter(Boolean));
      if (removalSet.size === 0) return;
      const removedMediaItems = videos.filter((v) => removalSet.has(v.id));
      if (removedMediaItems.length > 0) revokeBrowserObjectUrls(removedMediaItems);
      const removedClipIds = new Set(
        clips.filter((clip) => removalSet.has(clip.videoId)).map((clip) => clip.id),
      );
      if (removedClipIds.size > 0) {
        commitClips(clips.filter((clip) => !removalSet.has(clip.videoId)));
        setSelectedClipIds((prev) => {
          const next = new Set(prev);
          removedClipIds.forEach((clipId) => next.delete(clipId));
          return next;
        });
        if (removedClipIds.has(activeClipId)) setActiveClipId(null);
      }
      setVideos((prev) => prev.filter((v) => !removalSet.has(v.id)));
      setVideoDurations((prev) => {
        const next = { ...prev };
        removalSet.forEach((mediaId) => {
          delete next[mediaId];
        });
        return next;
      });
      setSourceRanges((prev) => {
        const next = { ...prev };
        removalSet.forEach((mediaId) => {
          delete next[mediaId];
        });
        return next;
      });
      setPeaksMap((prev) => {
        const next = { ...prev };
        removalSet.forEach((mediaId) => {
          delete next[mediaId];
        });
        return next;
      });
      setThumbsMap((prev) => {
        const next = { ...prev };
        removalSet.forEach((mediaId) => {
          delete next[mediaId];
        });
        return next;
      });
      setSelectedMediaIds((prev) => {
        const next = new Set(prev);
        removalSet.forEach((mediaId) => next.delete(mediaId));
        return next;
      });
      if (selectionAnchorIdRef.current && removalSet.has(selectionAnchorIdRef.current)) {
        selectionAnchorIdRef.current = null;
      }
      if (removalSet.has(activeId)) {
        setActiveId(null);
        setIsPlaying(false);
      }
      if (sourceMonitorId && removalSet.has(sourceMonitorId)) setSourceMonitorId(null);
    },
    [
      activeClipId,
      activeId,
      clips,
      commitClips,
      revokeBrowserObjectUrls,
      setSelectedMediaIds,
      setActiveClipId,
      setActiveId,
      setIsPlaying,
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
      e.dataTransfer.setData("application/x-stonecutter-media-id", video.id);
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
    regenerateProxy,
    clearProxy,
    replaceMedia,
    relinkMedia,
    validateMediaPaths,
    offlineMediaIds,
  };
}
