import { useCallback } from "react";
import {
  MIN_CLIP_DURATION,
  constrainMoveStart,
  detectInsertPoint,
  applyRippleInsert,
  resolveOverlaps,
  splitMediaIntoLinkedClips,
  nextLinkGroupId,
  maxEndForTrimRight,
} from "../lib/timeline.js";
import {
  nextTrackId,
  insertTrackOrdered,
  DEFAULT_TRACK_HEIGHT,
} from "../lib/trackStore.js";
import { MediaAssetService } from "../lib/services/MediaAssetService.js";

export function useTimelineDrop({
  totalEnd,
  tracksContentRef,
  pxPerSec,
  videos,
  clips,
  tracks,
  snapEnabled,
  videoDurations,
  sourceRanges,
  settings,
  dragOver,
  getTrackAtClientY,
  getSourceSelection,
  getFullMediaSelection,
  handleFileChange,
  createHistorySnapshot,
  pushHistory,
  dispatchEngineCommand,
  nextId,
  formatTime,
  draggedVideoIdRef,
  draggedTrackModeRef,
  draggedUseSourceRangeRef,
  setClips,
  setVideoDurations,
  setProjectStatus,
  setDragOver,
  setDropIndicatorTime,
  setImportDragInfo,
  setDragTooltip,
  setDropTargetTrackId,
  setDropZoneTrackMode,
  setTrackMovePreview,
}) {
  const dropTimeFromEvent = useCallback(
    (e) => {
      if (!tracksContentRef.current) return totalEnd;
      const rect = tracksContentRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left + tracksContentRef.current.scrollLeft;
      return Math.max(0, x / pxPerSec);
    },
    [pxPerSec, totalEnd, tracksContentRef],
  );

  const addClipsWithPreparedTimeline = useCallback(
    (nextClips, addedClipIds, nextTracks = tracks) => {
      const addedIds = new Set((addedClipIds || []).filter(Boolean));
      if (addedIds.size === 0) return;
      const addedClips = nextClips.filter((clip) => addedIds.has(clip.id));
      if (addedClips.length === 0) return;
      const baseClips = nextClips.filter((clip) => !addedIds.has(clip.id));

      pushHistory(createHistorySnapshot());
      dispatchEngineCommand(
        {
          type: "clip.add",
          payload: { clips: addedClips, ripple: false },
        },
        { clips: baseClips, tracks: nextTracks },
      );
    },
    [createHistorySnapshot, dispatchEngineCommand, pushHistory, tracks],
  );

  const computeImportPreview = useCallback(
    (
      videoId,
      dropTime,
      fileName = "",
      trackMode = "av",
      targetTrack = null,
      useSourceRange = false,
    ) => {
      const media = videos.find((v) => v.id === videoId);
      const selection = media
        ? useSourceRange
          ? getSourceSelection(media)
          : getFullMediaSelection(media)
        : {
            inPoint: 0,
            outPoint: videoDurations[videoId] || 5,
            duration: videoDurations[videoId] || 5,
            clipDuration: videoDurations[videoId] || 5,
          };
      const dur = selection.clipDuration;
      const targetTrackId = targetTrack?.id;
      const trackClips = clips.filter((c) => c.trackId === targetTrackId);
      if (snapEnabled) {
        const ins = detectInsertPoint(
          "__preview__",
          dropTime + dur / 2,
          dur,
          trackClips,
        );
        if (ins) {
          const rippledTrack = applyRippleInsert(
            trackClips,
            "__preview__",
            ins.insertPoint,
            dur,
          );
          return {
            insertPoint: ins.insertPoint,
            mode: "insert",
            simulatedLayout: clips.map((c) =>
              c.trackId === targetTrackId
                ? rippledTrack.find((x) => x.id === c.id) || c
                : c,
            ),
            dur,
          };
        }
        return {
          insertPoint: constrainMoveStart(dropTime, dur, trackClips),
          mode: "constrain",
          simulatedLayout: clips,
          dur,
        };
      }
      const start = Math.max(0, dropTime);
      const placeholder = {
        id: "__preview__",
        videoId,
        name: fileName,
        src: "",
        sourceDuration: selection.duration,
        inPoint: selection.inPoint,
        outPoint: selection.outPoint,
        startTime: start,
        trackMode,
        trackId: targetTrackId,
      };
      const cut = resolveOverlaps(
        [...trackClips, placeholder],
        "__preview__",
        () => `prev-${Math.random()}`,
      );
      const trackLayout = cut.filter((c) => c.id !== "__preview__");
      const simulatedLayout = clips
        .filter((c) => c.trackId !== targetTrackId)
        .concat(trackLayout);
      return { insertPoint: start, mode: "overwrite", simulatedLayout, dur };
    },
    [
      clips,
      getFullMediaSelection,
      getSourceSelection,
      snapEnabled,
      videoDurations,
      videos,
    ],
  );

  const handleTimelineDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, [setDragOver]);

  const handleTimelineDragOver = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      if (!dragOver) setDragOver(true);
      const tcEl = tracksContentRef.current;
      if (tcEl) {
        const tcRect = tcEl.getBoundingClientRect();
        const edge = 50;
        if (e.clientX < tcRect.left + edge) tcEl.scrollLeft -= 12;
        else if (e.clientX > tcRect.right - edge) tcEl.scrollLeft += 12;
      }
      const dropTime = dropTimeFromEvent(e);
      setDropIndicatorTime(dropTime);

      const targetTrackId = getTrackAtClientY(e.clientY);
      setDropTargetTrackId(targetTrackId);

      const files = Array.from(e.dataTransfer.files).filter(
        MediaAssetService.isImportableMediaFile,
      );
      if (files.length > 0) {
        const file = files[0];
        const mediaType = MediaAssetService.getFileMediaType(file);
        draggedTrackModeRef.current = mediaType === "audio" ? "audio" : "av";
        setDropZoneTrackMode(mediaType === "audio" ? "audio" : "av");
        const targetTrack =
          targetTrackId && targetTrackId !== "__below__"
            ? tracks.find((t) => t.id === targetTrackId) || null
            : null;
        const preview = computeImportPreview(
          "__explorer__",
          dropTime,
          file.name,
          mediaType === "audio" ? "audio" : "av",
          targetTrack,
        );
        setImportDragInfo({
          videoId: "__explorer__",
          name: file.name,
          trackMode: mediaType === "audio" ? "audio" : "av",
          mediaType,
          ...preview,
        });
        const rect = tracksContentRef.current?.getBoundingClientRect();
        if (rect) {
          setDragTooltip({
            x:
              e.clientX - rect.left + (tracksContentRef.current?.scrollLeft || 0),
            y: e.clientY - rect.top + (tracksContentRef.current?.scrollTop || 0),
            label: `${file.name} · ${formatTime(preview.dur || 5)}`,
          });
        }
        return;
      }

      const videoId = draggedVideoIdRef.current;
      if (videoId) {
        const video = videos.find((v) => v.id === videoId);
        const trackMode = draggedTrackModeRef.current || "av";
        const useSourceRange = draggedUseSourceRangeRef.current;
        const targetTrack =
          targetTrackId && targetTrackId !== "__below__"
            ? tracks.find((t) => t.id === targetTrackId) || null
            : null;
        const preview = computeImportPreview(
          videoId,
          dropTime,
          "",
          trackMode,
          targetTrack,
          useSourceRange,
        );
        setImportDragInfo({
          videoId,
          name: video?.name || "",
          trackMode,
          mediaType: video?.mediaType || "video",
          ...preview,
        });
        const rect = tracksContentRef.current?.getBoundingClientRect();
        if (rect) {
          setDragTooltip({
            x:
              e.clientX - rect.left + (tracksContentRef.current?.scrollLeft || 0),
            y: e.clientY - rect.top + (tracksContentRef.current?.scrollTop || 0),
            label: `${trackMode === "audio" ? "Nur Audio" : "Video + Audio"} · ${formatTime(preview.insertPoint)} · ${formatTime(preview.dur)}`,
          });
        }
      }
    },
    [
      computeImportPreview,
      dragOver,
      draggedTrackModeRef,
      draggedUseSourceRangeRef,
      draggedVideoIdRef,
      dropTimeFromEvent,
      formatTime,
      getTrackAtClientY,
      setDragOver,
      setDragTooltip,
      setDropIndicatorTime,
      setDropTargetTrackId,
      setDropZoneTrackMode,
      setImportDragInfo,
      tracks,
      tracksContentRef,
      videos,
    ],
  );

  const handleTimelineDragLeave = useCallback(
    (e) => {
      if (e.currentTarget.contains(e.relatedTarget)) return;
      setDragOver(false);
      setDropIndicatorTime(null);
      setImportDragInfo(null);
      setDragTooltip(null);
      setDropTargetTrackId(null);
      setDropZoneTrackMode("av");
      setTrackMovePreview(null);
    },
    [
      setDragOver,
      setDragTooltip,
      setDropIndicatorTime,
      setDropTargetTrackId,
      setDropZoneTrackMode,
      setImportDragInfo,
      setTrackMovePreview,
    ],
  );

  const handleTimelineDrop = useCallback(
    async (e) => {
      e.preventDefault();
      setDragOver(false);
      setDropIndicatorTime(null);
      setImportDragInfo(null);
      setDragTooltip(null);
      setDropTargetTrackId(null);
      setDropZoneTrackMode("av");
      setTrackMovePreview(null);
      const droppedVideoId =
        e.dataTransfer.getData("text/plain") ||
        e.dataTransfer.getData("text") ||
        draggedVideoIdRef.current;
      const droppedTrackMode =
        e.dataTransfer.getData("application/x-stonecutter-track-mode") ||
        draggedTrackModeRef.current ||
        "av";
      const droppedUsesSourceRange = draggedUseSourceRangeRef.current;
      draggedVideoIdRef.current = null;
      draggedTrackModeRef.current = "av";
      draggedUseSourceRangeRef.current = false;

      const dropTargetId = getTrackAtClientY(e.clientY);
      let targetTrack =
        dropTargetId && dropTargetId !== "__below__"
          ? tracks.find((t) => t.id === dropTargetId) || null
          : null;

      const files = Array.from(e.dataTransfer.files).filter(
        MediaAssetService.isImportableMediaFile,
      );
      if (files.length > 0) {
        const importedItems = await handleFileChange({ target: { files } });
        const dropTime = dropTimeFromEvent(e);
        const lastVideo = importedItems?.[0];
        if (lastVideo) {
          const isAudioFile = lastVideo.mediaType === "audio";
          const isVideoFile = lastVideo.mediaType === "video";
          const explorerTrackMode = isAudioFile ? "audio" : "av";
          const requiredTrackType = isAudioFile ? "audio" : "video";
          if (targetTrack && targetTrack.type !== requiredTrackType) {
            setProjectStatus({
              ok: false,
              msg: `${isAudioFile ? "Audio-Datei" : "Video-Datei"} passt nicht auf eine ${targetTrack.type === "audio" ? "Audio" : "Video"}-Spur.`,
            });
            return;
          }

          let tracksUpdateExplorer = null;
          if (dropTargetId === "__below__" || !targetTrack) {
            const newTrack = {
              id: nextTrackId(),
              type: requiredTrackType,
              name: `${requiredTrackType === "audio" ? "Audio" : "Video"} ${tracks.filter((t) => t.type === requiredTrackType).length + 1}`,
              locked: false,
              height: DEFAULT_TRACK_HEIGHT,
            };
            if (requiredTrackType === "audio") {
              newTrack.muted = false;
              newTrack.solo = false;
            }
            targetTrack = newTrack;
            tracksUpdateExplorer = insertTrackOrdered(tracks, newTrack);
          }
          let audioTrackForExplorer = null;
          if (isVideoFile) {
            const candidateTracks = tracksUpdateExplorer || tracks;
            audioTrackForExplorer = candidateTracks.find(
              (t) => t.type === "audio" && !t.locked,
            );
            if (!audioTrackForExplorer) {
              audioTrackForExplorer = {
                id: nextTrackId(),
                type: "audio",
                name: `Audio ${candidateTracks.filter((t) => t.type === "audio").length + 1}`,
                locked: false,
                height: DEFAULT_TRACK_HEIGHT,
                muted: false,
                solo: false,
              };
              tracksUpdateExplorer = insertTrackOrdered(
                candidateTracks,
                audioTrackForExplorer,
              );
            }
          }
          const targetTrackId = targetTrack.id;
          const cachedDuration = videoDurations[lastVideo.id];
          const duration =
            cachedDuration ??
            (await MediaAssetService.probeDuration(
              lastVideo.src,
              lastVideo.mediaType,
              settings.imageDuration,
            ));
          if (cachedDuration == null) {
            setVideoDurations((prev) =>
              prev[lastVideo.id] != null
                ? prev
                : { ...prev, [lastVideo.id]: duration },
            );
          }
          const videoClipIdE = nextId("clip");
          const audioClipIdE = isVideoFile || isAudioFile ? nextId("clip") : null;
          const placeholderDur = duration;
          const trackClips = clips.filter((c) => c.trackId === targetTrackId);
          let placeholderStart = dropTime;
          let baseTrackClips = trackClips;
          if (snapEnabled) {
            const ins = detectInsertPoint(
              videoClipIdE,
              dropTime,
              placeholderDur,
              trackClips,
            );
            if (ins) {
              placeholderStart = ins.insertPoint;
              baseTrackClips = applyRippleInsert(
                trackClips,
                videoClipIdE,
                ins.insertPoint,
                placeholderDur,
              );
            } else {
              placeholderStart = constrainMoveStart(
                dropTime,
                placeholderDur,
                trackClips,
              );
            }
          }
          const producedClips = splitMediaIntoLinkedClips({
            media: lastVideo,
            selection: { inPoint: 0, outPoint: duration, duration },
            startTime: placeholderStart,
            videoClipId: videoClipIdE,
            audioClipId: audioClipIdE,
            videoTrackId: isAudioFile ? null : targetTrackId,
            audioTrackId: isAudioFile
              ? targetTrackId
              : audioTrackForExplorer?.id || null,
            trackMode: explorerTrackMode,
            hasAudio: isVideoFile,
            linkGroupIdFactory: nextLinkGroupId,
          });
          let audioSiblingAfter = null;
          if (audioTrackForExplorer) {
            const audioSibling = clips.filter(
              (c) => c.trackId === audioTrackForExplorer.id,
            );
            if (snapEnabled) {
              const ins = detectInsertPoint(
                audioClipIdE,
                placeholderStart + placeholderDur / 2,
                placeholderDur,
                audioSibling,
              );
              audioSiblingAfter = ins
                ? applyRippleInsert(
                    audioSibling,
                    audioClipIdE,
                    placeholderStart,
                    placeholderDur,
                  )
                : audioSibling;
            } else {
              audioSiblingAfter = audioSibling;
            }
          }
          const otherTrackClips = clips.filter(
            (c) =>
              c.trackId !== targetTrackId &&
              (!audioTrackForExplorer || c.trackId !== audioTrackForExplorer.id),
          );
          const primaryList = [
            ...baseTrackClips,
            ...producedClips.filter((c) => c.trackId === targetTrackId),
          ];
          const audioList = audioTrackForExplorer
            ? [
                ...(audioSiblingAfter || []),
                ...producedClips.filter(
                  (c) => c.trackId === audioTrackForExplorer.id,
                ),
              ]
            : [];
          const initialList = [...otherTrackClips, ...primaryList, ...audioList];
          const nextTracksForAdd = tracksUpdateExplorer || tracks;
          if (snapEnabled) {
            addClipsWithPreparedTimeline(
              initialList,
              producedClips.map((clip) => clip.id),
              nextTracksForAdd,
            );
          } else {
            const resolvedPrimary = resolveOverlaps(
              primaryList,
              videoClipIdE,
              () => nextId("clip"),
            );
            const resolvedAudio =
              audioTrackForExplorer && audioClipIdE
                ? resolveOverlaps(audioList, audioClipIdE, () => nextId("clip"))
                : audioList;
            addClipsWithPreparedTimeline(
              [...otherTrackClips, ...resolvedPrimary, ...resolvedAudio],
              producedClips.map((clip) => clip.id),
              nextTracksForAdd,
            );
          }
        }
        return;
      }

      const videoId = droppedVideoId;
      const video = videos.find((v) => v.id === videoId) || null;
      if (!video) return;
      const trackMode = droppedTrackMode;
      const selection = droppedUsesSourceRange
        ? getSourceSelection(video)
        : getFullMediaSelection(video);
      const hasExplicitSourceRange =
        droppedUsesSourceRange && !!sourceRanges[video.id];

      const requiredTrackType = trackMode === "audio" ? "audio" : "video";
      if (targetTrack && targetTrack.type !== requiredTrackType) {
        setProjectStatus({
          ok: false,
          msg: `${trackMode === "audio" ? "Audio-Clip" : "Video-Clip"} passt nicht auf eine ${targetTrack.type === "audio" ? "Audio" : "Video"}-Spur.`,
        });
        return;
      }

      let tracksUpdate = null;
      if (dropTargetId === "__below__" || !targetTrack) {
        const newTrack = {
          id: nextTrackId(),
          type: requiredTrackType,
          name: `${requiredTrackType === "audio" ? "Audio" : "Video"} ${tracks.filter((t) => t.type === requiredTrackType).length + 1}`,
          locked: false,
          height: DEFAULT_TRACK_HEIGHT,
        };
        if (requiredTrackType === "audio") {
          newTrack.muted = false;
          newTrack.solo = false;
        }
        targetTrack = newTrack;
        tracksUpdate = insertTrackOrdered(tracks, newTrack);
      }

      const isAvLinkedDrop = trackMode === "av" && video.mediaType === "video";
      let linkedAudioTrack = null;
      if (isAvLinkedDrop) {
        const candidateTracks = tracksUpdate || tracks;
        linkedAudioTrack = candidateTracks.find(
          (t) => t.type === "audio" && !t.locked,
        );
        if (!linkedAudioTrack) {
          linkedAudioTrack = {
            id: nextTrackId(),
            type: "audio",
            name: `Audio ${candidateTracks.filter((t) => t.type === "audio").length + 1}`,
            locked: false,
            height: DEFAULT_TRACK_HEIGHT,
            muted: false,
            solo: false,
          };
          tracksUpdate = insertTrackOrdered(candidateTracks, linkedAudioTrack);
        }
      }
      const targetTrackId = targetTrack.id;
      const dropTime = dropTimeFromEvent(e);
      const videoClipId = nextId("clip");
      const audioClipId = isAvLinkedDrop ? nextId("clip") : null;
      const placeholderDur = selection.clipDuration;
      const trackClips = clips.filter((c) => c.trackId === targetTrackId);

      let placeholderStart = dropTime;
      let baseTrackClips = trackClips;
      let insertPoint = null;
      if (snapEnabled) {
        const ins = detectInsertPoint(
          videoClipId,
          dropTime,
          placeholderDur,
          trackClips,
        );
        if (ins) {
          insertPoint = ins.insertPoint;
          placeholderStart = ins.insertPoint;
          baseTrackClips = applyRippleInsert(
            trackClips,
            videoClipId,
            ins.insertPoint,
            placeholderDur,
          );
        } else {
          placeholderStart = constrainMoveStart(
            dropTime,
            placeholderDur,
            trackClips,
          );
        }
      }

      const pairSelection = {
        inPoint: selection.inPoint,
        outPoint: selection.outPoint,
        duration: selection.duration,
      };
      const producedClips = splitMediaIntoLinkedClips({
        media: video,
        selection: pairSelection,
        startTime: placeholderStart,
        videoClipId,
        audioClipId,
        videoTrackId: isAvLinkedDrop
          ? targetTrackId
          : trackMode === "audio"
            ? null
            : targetTrackId,
        audioTrackId: isAvLinkedDrop
          ? linkedAudioTrack.id
          : trackMode === "audio"
            ? targetTrackId
            : null,
        trackMode,
        hasAudio: true,
        linkGroupIdFactory: nextLinkGroupId,
      });
      if (producedClips.length === 0) return;

      let audioTrackClipsAfter = null;
      if (isAvLinkedDrop && linkedAudioTrack) {
        const audioTrackId = linkedAudioTrack.id;
        const audioSibling = clips.filter((c) => c.trackId === audioTrackId);
        if (snapEnabled) {
          const ins = detectInsertPoint(
            audioClipId,
            placeholderStart + placeholderDur / 2,
            placeholderDur,
            audioSibling,
          );
          if (ins) {
            audioTrackClipsAfter = applyRippleInsert(
              audioSibling,
              audioClipId,
              placeholderStart,
              placeholderDur,
            );
          } else {
            audioTrackClipsAfter = audioSibling;
          }
        } else {
          audioTrackClipsAfter = audioSibling;
        }
      }

      const otherTrackClips = clips.filter(
        (c) =>
          c.trackId !== targetTrackId &&
          (!linkedAudioTrack || c.trackId !== linkedAudioTrack.id),
      );
      const primaryList = [
        ...baseTrackClips,
        ...producedClips.filter((c) => c.trackId === targetTrackId),
      ];
      const audioList = linkedAudioTrack
        ? [
            ...(audioTrackClipsAfter || []),
            ...producedClips.filter((c) => c.trackId === linkedAudioTrack.id),
          ]
        : [];
      const initialList = [...otherTrackClips, ...primaryList, ...audioList];
      const nextTracksForAdd = tracksUpdate || tracks;

      if (snapEnabled) {
        addClipsWithPreparedTimeline(
          initialList,
          producedClips.map((clip) => clip.id),
          nextTracksForAdd,
        );
      } else {
        const resolvedPrimary = resolveOverlaps(primaryList, videoClipId, () =>
          nextId("clip"),
        );
        const resolvedAudio =
          linkedAudioTrack && audioClipId
            ? resolveOverlaps(audioList, audioClipId, () => nextId("clip"))
            : audioList;
        addClipsWithPreparedTimeline(
          [...otherTrackClips, ...resolvedPrimary, ...resolvedAudio],
          producedClips.map((clip) => clip.id),
          nextTracksForAdd,
        );
      }

      const cachedDuration = videoDurations[video.id];
      const duration =
        cachedDuration ??
        (await MediaAssetService.probeDuration(
          video.src,
          video.mediaType,
          settings.imageDuration,
        ));
      if (cachedDuration == null) {
        setVideoDurations((prev) =>
          prev[video.id] != null ? prev : { ...prev, [video.id]: duration },
        );
      }
      const primaryClipId = videoClipId;
      const linkedIds = new Set([primaryClipId, audioClipId].filter(Boolean));
      // Post-add normalization (duration probe / overlap clamp) remains legacy for now.
      // Clip creation itself is already routed through `clip.add` above.
      setClips((prev) => {
        const placeholderClip = prev.find((c) => c.id === primaryClipId);
        if (!placeholderClip) return prev;
        const resolvedIn = hasExplicitSourceRange ? selection.inPoint : 0;
        const resolvedOut = hasExplicitSourceRange
          ? Math.min(selection.outPoint, duration)
          : duration;
        const clampedOut = Math.max(resolvedIn + MIN_CLIP_DURATION, resolvedOut);
        let updated = prev.map((c) =>
          linkedIds.has(c.id)
            ? {
                ...c,
                sourceDuration: duration,
                inPoint: resolvedIn,
                outPoint: clampedOut,
              }
            : c,
        );
        const resolveTrackAware = (clipList) => {
          const byTrack = new Map();
          clipList.forEach((c) => {
            if (!byTrack.has(c.trackId)) byTrack.set(c.trackId, []);
            byTrack.get(c.trackId).push(c);
          });
          const resolved = [];
          byTrack.forEach((trackClipList) => {
            const modified = trackClipList.find((c) => linkedIds.has(c.id));
            if (modified) {
              resolved.push(
                ...resolveOverlaps(trackClipList, modified.id, () =>
                  nextId("clip"),
                ),
              );
            } else {
              resolved.push(...trackClipList);
            }
          });
          return resolved;
        };
        if (!snapEnabled) {
          return resolveTrackAware(updated);
        }
        if (insertPoint != null) {
          const extra = clampedOut - resolvedIn - placeholderDur;
          if (Math.abs(extra) > 1e-3) {
            const insertEnd = placeholderStart + placeholderDur;
            updated = updated.map((x) => {
              if (linkedIds.has(x.id)) return x;
              if (x.trackId === targetTrackId && x.startTime >= insertEnd - 1e-3)
                return { ...x, startTime: x.startTime + extra };
              return x;
            });
          }
          return updated;
        }
        const c = updated.find((x) => x.id === primaryClipId);
        if (!c) return updated;
        const others = updated.filter(
          (x) => !linkedIds.has(x.id) && x.trackId === targetTrackId,
        );
        const maxRight = maxEndForTrimRight(c.startTime, others);
        const cEnd = c.startTime + (c.outPoint - c.inPoint);
        if (cEnd > maxRight + 1e-3) {
          const newOutPoint = Math.max(
            c.inPoint + MIN_CLIP_DURATION,
            c.inPoint + (maxRight - c.startTime),
          );
          return updated.map((x) =>
            linkedIds.has(x.id) ? { ...x, outPoint: newOutPoint } : x,
          );
        }
        return updated;
      });
    },
    [
      addClipsWithPreparedTimeline,
      clips,
      draggedTrackModeRef,
      draggedUseSourceRangeRef,
      draggedVideoIdRef,
      dropTimeFromEvent,
      getFullMediaSelection,
      getSourceSelection,
      getTrackAtClientY,
      handleFileChange,
      nextId,
      settings.imageDuration,
      setClips,
      setDragOver,
      setDragTooltip,
      setDropIndicatorTime,
      setDropTargetTrackId,
      setDropZoneTrackMode,
      setImportDragInfo,
      setProjectStatus,
      setTrackMovePreview,
      setVideoDurations,
      snapEnabled,
      sourceRanges,
      tracks,
      videoDurations,
      videos,
    ],
  );

  return {
    computeImportPreview,
    handleTimelineDragEnter,
    handleTimelineDragOver,
    handleTimelineDragLeave,
    handleTimelineDrop,
  };
}
