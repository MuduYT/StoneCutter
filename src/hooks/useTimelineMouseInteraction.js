import { useEffect, useCallback } from "react";
import {
  SNAP_THRESHOLD_PX,
  MOVE_THRESHOLD_PX,
  MIN_CLIP_DURATION,
  constrainMoveStart,
  minStartForTrimLeft,
  maxEndForTrimRight,
  detectInsertPoint,
  applyRippleInsert,
  findGapAtTime,
  resolveOverlaps,
  resolveOverlapsMulti,
  expandWithLinkedPartners,
  applyGroupTrimLeft,
  applyGroupTrimRight,
  getMarqueeSelectedClipIds,
  getMiddlePanScroll,
  isTimelineTrimHotspot,
  isClipTrackLocked,
} from "../lib/timeline.js";
import { getTopVisibleTimelineClip } from "../lib/playback.js";
import { FOCUS_TIMELINE } from "../lib/sourceMonitor.js";
import {
  computePreviewResizeTransform,
  smoothPreviewMove,
} from "../lib/previewTransform.js";
import { shiftKeyframeMap } from "../lib/keyframes.js";
import { nextId } from "../lib/utils.js";

const TIMELINE_COMMIT_EPSILON = 1e-6;
const isTextClip = (clip) => clip?.kind === "text";
const getClipMediaId = (clip) => (isTextClip(clip) ? null : clip?.videoId);

const unwrapSignedAngleDelta = (fromRad, toRad) => {
  let d = toRad - fromRad;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

const getClipMoveIds = (interactionState) =>
  interactionState?.selectedSnaps && interactionState.selectedSnaps.length > 1
    ? interactionState.selectedSnaps.map((clip) => clip.id)
    : [interactionState.clipId];

const hasTimelineMoveChange = (beforeClip, afterClip) =>
  Math.abs((beforeClip?.startTime ?? 0) - (afterClip?.startTime ?? 0)) >
    TIMELINE_COMMIT_EPSILON ||
  beforeClip?.trackId !== afterClip?.trackId ||
  Math.abs((beforeClip?.inPoint ?? 0) - (afterClip?.inPoint ?? 0)) >
    TIMELINE_COMMIT_EPSILON ||
  Math.abs((beforeClip?.outPoint ?? 0) - (afterClip?.outPoint ?? 0)) >
    TIMELINE_COMMIT_EPSILON;

const buildEngineMoveCommit = (interactionState, finalClips) => {
  if (
    !interactionState ||
    interactionState.type !== "move" ||
    !interactionState.moved ||
    !interactionState.snapshotBefore
  ) {
    return null;
  }

  const moveIds = getClipMoveIds(interactionState).filter(Boolean);
  if (moveIds.length === 0) return null;

  const moveIdSet = new Set(moveIds);
  const beforeById = new Map(
    interactionState.snapshotBefore.map((clip) => [clip.id, clip]),
  );
  const finalById = new Map(finalClips.map((clip) => [clip.id, clip]));

  for (const clip of interactionState.snapshotBefore) {
    const finalClip = finalById.get(clip.id);
    if (!finalClip) return null;
    if (!moveIdSet.has(clip.id) && hasTimelineMoveChange(clip, finalClip)) {
      return null;
    }
  }

  const movedPairs = moveIds.map((id) => ({
    before: beforeById.get(id),
    after: finalById.get(id),
  }));
  if (movedPairs.some(({ before, after }) => !before || !after)) return null;

  const deltaTime = movedPairs[0].after.startTime - movedPairs[0].before.startTime;
  if (
    movedPairs.some(
      ({ before, after }) =>
        Math.abs(after.startTime - before.startTime - deltaTime) >
        TIMELINE_COMMIT_EPSILON,
    )
  ) {
    return null;
  }

  const finalTrackIds = new Set(movedPairs.map(({ after }) => after.trackId));
  const trackChanged = movedPairs.some(
    ({ before, after }) => before.trackId !== after.trackId,
  );
  if (trackChanged && finalTrackIds.size !== 1) return null;

  const [targetTrackId] = finalTrackIds;
  return {
    type: "clip.move",
    payload: {
      clipIds: moveIds,
      deltaTime,
      ...(trackChanged || moveIds.length === 1 ? { targetTrackId } : {}),
      ripple: false,
      resolveOverlaps: true,
    },
  };
};

const buildEngineTrimCommit = (interactionState, finalClips) => {
  if (
    !interactionState ||
    !interactionState.moved ||
    !interactionState.snapshotBefore ||
    (interactionState.type !== "trim-left" &&
      interactionState.type !== "trim-right")
  ) {
    return null;
  }

  const finalClip = finalClips.find(
    (clip) => clip.id === interactionState.clipId,
  );
  if (!finalClip) return null;

  const time =
    interactionState.type === "trim-left"
      ? finalClip.startTime
      : finalClip.startTime + (finalClip.outPoint - finalClip.inPoint);
  if (!Number.isFinite(time)) return null;

  return {
    type:
      interactionState.type === "trim-left"
        ? "clip.trimLeft"
        : "clip.trimRight",
    payload: {
      clipId: interactionState.clipId,
      time,
      ripple: false,
    },
  };
};

export function useTimelineMouseInteraction({
  clips,
  setClips,
  tracks,
  setTracks,
  selectedClipIds,
  setSelectedClipIds,
  activeClipId,
  setActiveClipId,
  setActiveId,
  timelineTime,
  dispatchEngineCommand,
  isPlaying,
  interaction,
  setInteraction,
  pxPerSec,
  snapEnabled,
  videos,
  setEditorFocus,
  setSourceMonitorId,
  setScrubTooltip,
  setMarqueeBox,
  setSnapIndicatorTime,
  setPreviewSnapGuides,
  setSelectedGap,
  setDropTargetTrackId,
  setTrackMovePreview,
  setContextMenu,
  interactionRef,
  tracksContentRef,
  timelineTimeRef,
  videoRef,
  timelinePreviewRef,
  playingClipIdRef,
  imagePlaybackRef,
  pendingSeekRef,
  pendingPlayRef,
  playbackModeRef,
  timelinePlaybackRef,
  playbackRef,
  updateTimelinePlayheadPosition,
  stopPlayback,
  pauseTimelinePreviewMedia,
  beginScrubAudio,
  triggerScrubAudio,
  endScrubAudio,
  pushHistory,
  createHistorySnapshot,
  getMoveTrackPlan,
  applyTrackMovePlan,
  updateTrackMovePreview,
  updateTrackMovePreviewFromClips,
  placeLinkedSyncClips,
  startClipPlayback,
  startTimelineGapPlayback,
  timelinePlaybackLookups,
}) {
  const handleCrossfadeMouseDown = useCallback(
    (e, leftClip, rightClip) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      if (!leftClip || !rightClip) return;
      setEditorFocus(FOCUS_TIMELINE);
      setSourceMonitorId(null);
      if (playbackModeRef.current === "source") stopPlayback();
      if (isClipTrackLocked(leftClip, tracks) || isClipTrackLocked(rightClip, tracks)) {
        return;
      }
      const leftDuration = Math.max(
        MIN_CLIP_DURATION,
        leftClip.outPoint - leftClip.inPoint,
      );
      const rightDuration = Math.max(
        MIN_CLIP_DURATION,
        rightClip.outPoint - rightClip.inPoint,
      );
      const leftEnd = leftClip.startTime + leftDuration;
      const gapBetweenClips = rightClip.startTime - leftEnd;
      const maxDuration = Math.max(
        0.05,
        Math.min(
          leftDuration * 0.5,
          rightDuration * 0.5,
          gapBetweenClips + Math.min(leftDuration, rightDuration) * 0.5,
        ),
      );
      const i = {
        type: "crossfade-drag",
        leftClipId: leftClip.id,
        rightClipId: rightClip.id,
        startClientX: e.clientX,
        initialFadeOut: leftClip.fadeOut ?? 0,
        initialFadeIn: rightClip.fadeIn ?? 0,
        leftDuration,
        rightDuration,
        gapBetweenClips,
        maxDuration,
        pxPerSec,
        snapshotBefore: clips.map((c) => ({ ...c })),
        moved: false,
      };
      setSelectedClipIds(new Set([leftClip.id, rightClip.id]));
      setActiveClipId(leftClip.id);
      setActiveId(getClipMediaId(leftClip));
      interactionRef.current = i;
      setInteraction(i);
    },
    [
      clips,
      interactionRef,
      playbackModeRef,
      pxPerSec,
      setActiveClipId,
      setActiveId,
      setEditorFocus,
      setInteraction,
      setSelectedClipIds,
      setSourceMonitorId,
      stopPlayback,
      tracks,
    ],
  );

  const seekToTime = useCallback(
    (t, options = {}) => {
      t = Math.max(0, t);
      setSourceMonitorId(null);
      setEditorFocus(FOCUS_TIMELINE);
      timelineTimeRef.current = t;
      updateTimelinePlayheadPosition(t);
      // During scrubbing, use throttled updates (no force) to avoid excessive re-renders
      // Force sync is only applied when explicitly requested (e.g., on scrub-end)
      dispatchEngineCommand({
        type: "timeline.setPlayhead",
        payload: { time: t, force: options.force },
      });
      const clip = getTopVisibleTimelineClip({
        time: t,
        clips,
        lookups: timelinePlaybackLookups,
      });
      if (clip) {
        playingClipIdRef.current = clip.id;
        setActiveClipId(clip.id);
        setActiveId(getClipMediaId(clip));
        imagePlaybackRef.current = null;
        pendingSeekRef.current = null;
        pendingPlayRef.current = false;
      } else {
        playingClipIdRef.current = null;
        imagePlaybackRef.current = null;
        pendingSeekRef.current = null;
        pendingPlayRef.current = false;
      }
      if (playbackModeRef.current === "timeline" && isPlaying) {
        timelinePlaybackRef.current = {
          startedAtMs: performance.now(),
          timelineStart: t,
        };
      } else {
        timelinePlaybackRef.current = null;
      }
    },
    [
      clips,
      isPlaying,
      timelinePlaybackLookups,
      updateTimelinePlayheadPosition,
      setSourceMonitorId,
      setEditorFocus,
      timelineTimeRef,
      dispatchEngineCommand,
      playingClipIdRef,
      setActiveClipId,
      setActiveId,
      imagePlaybackRef,
      pendingSeekRef,
      pendingPlayRef,
      playbackModeRef,
      timelinePlaybackRef,
    ],
  );

  const getXInTracks = (clientX) => {
    if (!tracksContentRef.current) return 0;
    const rect = tracksContentRef.current.getBoundingClientRect();
    return clientX - rect.left + tracksContentRef.current.scrollLeft;
  };

  const beginScrub = () => {
    const v = videoRef.current;
    const wasPlaying = playbackModeRef.current === "timeline" && isPlaying;
    if (wasPlaying && v && !v.paused) v.pause();
    if (wasPlaying) pauseTimelinePreviewMedia();
    return wasPlaying;
  };

  const handleTracksMouseDown = (e) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      const scrollStartLeft = tracksContentRef.current?.scrollLeft ?? 0;
      const scrollStartTop = tracksContentRef.current?.scrollTop ?? 0;
      const i = {
        type: "middle-pan",
        startClientX: e.clientX,
        startClientY: e.clientY,
        scrollStartLeft,
        scrollStartTop,
      };
      interactionRef.current = i;
      setInteraction(i);
      return;
    }
    const clipUnderPointer = Array.from(
      tracksContentRef.current?.querySelectorAll(".clip") || [],
    ).some((node) => {
      const rect = node.getBoundingClientRect();
      return (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      );
    });
    if (
      e.target.closest(".clip") ||
      clipUnderPointer ||
      e.target.closest(".playhead-handle")
    )
      return;
    if (e.button !== 0) return;
    e.preventDefault();
    setEditorFocus(FOCUS_TIMELINE);
    setSourceMonitorId(null);
    if (playbackModeRef.current === "source") stopPlayback();
    const x = getXInTracks(e.clientX);
    const t = Math.max(0, x / pxPerSec);
    if (e.target.closest(".time-ruler")) {
      const wasPlaying = beginScrub();
      beginScrubAudio?.();
      seekToTime(t);
      triggerScrubAudio?.(t);
      const i = { type: "seek", wasPlaying };
      interactionRef.current = i;
      setInteraction(i);
      return;
    }
    const gap = findGapAtTime(t, clips);
    const rect = tracksContentRef.current?.getBoundingClientRect();
    const rulerEl = tracksContentRef.current?.querySelector(".time-ruler");
    const rulerHeight = rulerEl ? rulerEl.getBoundingClientRect().height : 30;
    const startY = rect
      ? e.clientY - rect.top + (tracksContentRef.current.scrollTop || 0)
      : 0;
    const i = {
      type: "select-pending",
      startX: x,
      startY,
      startClientX: e.clientX,
      startClientY: e.clientY,
      pendingGap: gap,
      rulerHeight,
      additive: e.shiftKey || e.ctrlKey || e.metaKey,
      initialSelection: new Set(selectedClipIds),
    };
    interactionRef.current = i;
    setInteraction(i);
  };

  const handlePlayheadMouseDown = (e) => {
    e.stopPropagation();
    e.preventDefault();
    setEditorFocus(FOCUS_TIMELINE);
    setSourceMonitorId(null);
    if (playbackModeRef.current === "source") stopPlayback();
    const wasPlaying = beginScrub();
    beginScrubAudio?.();
    const i = { type: "seek", wasPlaying, startX: e.clientX };
    interactionRef.current = i;
    setInteraction(i);
  };

  const handleClipMouseDown = (e, clip) => {
    if (e.target.closest(".trim-handle")) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setEditorFocus(FOCUS_TIMELINE);
    setSourceMonitorId(null);
    if (playbackModeRef.current === "source") stopPlayback();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    setSelectedGap(null);

    if (isClipTrackLocked(clip, tracks)) {
      if (additive) {
        const next = new Set(selectedClipIds);
        if (next.has(clip.id)) next.delete(clip.id);
        else next.add(clip.id);
        setSelectedClipIds(next);
      } else {
        setSelectedClipIds(new Set([clip.id]));
      }
      setActiveClipId(clip.id);
      setActiveId(getClipMediaId(clip));
      return;
    }

    if (e.altKey) {
      const idsToClone =
        selectedClipIds.has(clip.id) && selectedClipIds.size > 1
          ? Array.from(selectedClipIds)
          : [clip.id];
      const idMap = new Map();
      const clones = [];
      for (const oldId of idsToClone) {
        const c = clips.find((x) => x.id === oldId);
        if (!c) continue;
        const newId = nextId("clip");
        idMap.set(oldId, newId);
        clones.push({ ...c, id: newId });
      }
      if (clones.length === 0) return;
      const preCloneSnapshot = clips.map((c) => ({ ...c }));
      const newClips = [...clips, ...clones];
      setClips(newClips);
      const newPrimaryId = idMap.get(clip.id);
      const newSelected = new Set(idMap.values());
      setSelectedClipIds(newSelected);
      setActiveClipId(newPrimaryId);
      setActiveId(getClipMediaId(clip));
      const x = getXInTracks(e.clientX);
      const i = {
        type: "move",
        clipId: newPrimaryId,
        startX: x,
        startClientY: e.clientY,
        originalClip: clones.find((c) => c.id === newPrimaryId),
        selectedSnaps: clones.length > 1 ? clones.map((c) => ({ ...c })) : null,
        trackMoveClipIds: Array.from(newSelected),
        snapshotBefore: newClips.map((c) => ({ ...c })),
        tracksBefore: tracks.map((track) => ({ ...track })),
        historyBefore: createHistorySnapshot(preCloneSnapshot, tracks),
        moved: true,
      };
      interactionRef.current = i;
      setInteraction(i);
      return;
    }

    let selectedIds;
    let explicitSelectedIds;
    if (additive) {
      const next = new Set(selectedClipIds);
      const wasSelected = next.has(clip.id);
      if (wasSelected) {
        next.delete(clip.id);
      } else {
        next.add(clip.id);
      }
      setSelectedClipIds(next);
      if (!wasSelected) {
        setActiveClipId(clip.id);
        setActiveId(getClipMediaId(clip));
      } else if (activeClipId === clip.id) {
        setActiveClipId(next.size > 0 ? next.values().next().value : null);
      }
      return;
    }
    if (selectedClipIds.has(clip.id) && selectedClipIds.size > 1) {
      explicitSelectedIds = new Set(selectedClipIds);
      selectedIds = expandWithLinkedPartners(clips, explicitSelectedIds);
    } else {
      explicitSelectedIds = new Set([clip.id]);
      selectedIds = expandWithLinkedPartners(clips, explicitSelectedIds);
      setSelectedClipIds(explicitSelectedIds);
    }
    setActiveClipId(clip.id);
    setActiveId(getClipMediaId(clip));

    const x = getXInTracks(e.clientX);
    const selectedSnaps = clips
      .filter((c) => selectedIds.has(c.id))
      .map((c) => ({ ...c }));
    const i = {
      type: "move",
      clipId: clip.id,
      startX: x,
      startClientY: e.clientY,
      originalClip: { ...clip },
      selectedSnaps,
      trackMoveClipIds: Array.from(explicitSelectedIds),
      snapshotBefore: clips.map((c) => ({ ...c })),
      tracksBefore: tracks.map((track) => ({ ...track })),
      moved: false,
    };
    interactionRef.current = i;
    setInteraction(i);
  };

  const handleTrimMouseDown = (e, clip, side) => {
    e.stopPropagation();
    e.preventDefault();
    const clipRect = e.currentTarget.closest(".clip")?.getBoundingClientRect();
    if (
      !isTimelineTrimHotspot({
        clientX: e.clientX,
        clientY: e.clientY,
        clipRect,
        side,
      })
    ) {
      return;
    }
    setEditorFocus(FOCUS_TIMELINE);
    setSourceMonitorId(null);
    if (playbackModeRef.current === "source") stopPlayback();
    setActiveClipId(clip.id);
    setActiveId(getClipMediaId(clip));
    if (isClipTrackLocked(clip, tracks)) {
      setSelectedClipIds(new Set([clip.id]));
      return;
    }
    const media = videos.find((v) => v.id === clip.videoId) || null;
    const x = getXInTracks(e.clientX);
    const i = {
      type: side === "left" ? "trim-left" : "trim-right",
      clipId: clip.id,
      startX: x,
      originalClip: { ...clip, mediaType: media?.mediaType || "video" },
      snapshotBefore: clips.map((c) => ({ ...c })),
      moved: false,
    };
    interactionRef.current = i;
    setInteraction(i);
  };

  const handlePreviewClipMouseDown = useCallback(
    (e, clip, mode = "move") => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      setEditorFocus(FOCUS_TIMELINE);
      setSourceMonitorId(null);
      const selected = expandWithLinkedPartners(clips, [clip.id]);
      setSelectedClipIds(selected);
      setActiveClipId(clip.id);
      setActiveId(getClipMediaId(clip));
      if (isClipTrackLocked(clip, tracks)) return;
      stopPlayback();
      const rect = timelinePreviewRef.current?.getBoundingClientRect();
      if (!rect) return;
      const previewCenterX = rect.left + rect.width / 2;
      const previewCenterY = rect.top + rect.height / 2;
      const centerX = previewCenterX + (clip.positionX ?? 0);
      const centerY = previewCenterY + (clip.positionY ?? 0);
      const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
      const snapshotBefore = clips.map((c) => ({ ...c }));
      const originalClip = {
        ...clip,
        scaleX: clip.scaleX ?? clip.scale ?? 100,
        scaleY: clip.scaleY ?? clip.scale ?? 100,
      };
      const i = {
        type: "preview-transform",
        clipId: clip.id,
        mode,
        startClientX: e.clientX,
        startClientY: e.clientY,
        previewRect: { width: rect.width, height: rect.height },
        previewCenterX,
        previewCenterY,
        startAngle,
        originalClip,
        snapshotBefore,
        moved: false,
      };
      interactionRef.current = i;
      setInteraction(i);
      setPreviewSnapGuides(null);
    },
    [
      clips,
      tracks,
      stopPlayback,
      setEditorFocus,
      setSourceMonitorId,
      timelinePreviewRef,
      setSelectedClipIds,
      setActiveClipId,
      setActiveId,
      interactionRef,
      setInteraction,
      setPreviewSnapGuides,
    ],
  );

  const snapValue = (value, excludeClipId, sourceList = clips) => {
    if (!snapEnabled) return { value, snapped: false };
    const points = [0, timelineTime];
    for (const c of sourceList) {
      if (c.id === excludeClipId) continue;
      points.push(c.startTime);
      points.push(c.startTime + (c.outPoint - c.inPoint));
    }
    let best = value;
    let bestDistPx = SNAP_THRESHOLD_PX;
    let didSnap = false;
    for (const p of points) {
      const dPx = Math.abs(p - value) * pxPerSec;
      if (dPx < bestDistPx) {
        bestDistPx = dPx;
        best = p;
        didSnap = true;
      }
    }
    return { value: best, snapped: didSnap, snappedTo: didSnap ? best : null };
  };

  useEffect(() => {
    if (!interaction) return;
    const onMove = (ev) => {
      const x = getXInTracks(ev.clientX);
      const it = interactionRef.current;
      if (!it) return;
      if (it.type === "middle-pan") {
        ev.preventDefault();
        if (tracksContentRef.current) {
          const nextScroll = getMiddlePanScroll({
            startClientX: it.startClientX,
            startClientY: it.startClientY,
            scrollStartLeft: it.scrollStartLeft,
            scrollStartTop: it.scrollStartTop,
            clientX: ev.clientX,
            clientY: ev.clientY,
            maxScrollLeft:
              tracksContentRef.current.scrollWidth -
              tracksContentRef.current.clientWidth,
            maxScrollTop:
              tracksContentRef.current.scrollHeight -
              tracksContentRef.current.clientHeight,
          });
          tracksContentRef.current.scrollLeft = nextScroll.left;
          tracksContentRef.current.scrollTop = nextScroll.top;
        }
        return;
      }

      const effSnap = snapEnabled && !ev.shiftKey;
      const tcEl = tracksContentRef.current;
      if (tcEl) {
        const tcRect = tcEl.getBoundingClientRect();
        const edge = 50;
        if (ev.clientX < tcRect.left + edge) tcEl.scrollLeft -= 12;
        else if (ev.clientX > tcRect.right - edge) tcEl.scrollLeft += 12;
      }

      if (it.type === "seek") {
        const t = Math.max(0, x / pxPerSec);
        seekToTime(t);
        triggerScrubAudio?.(t);
        setScrubTooltip({ x, time: t });
        return;
      }

      if (it.type === "crossfade-drag") {
        ev.preventDefault();
        const deltaSec =
          Math.abs(ev.clientX - it.startClientX) /
          Math.max(0.001, it.pxPerSec || pxPerSec);
        const crossfadeDuration = Math.max(
          0.05,
          Math.min(it.maxDuration, deltaSec),
        );
        setClips((prev) =>
          prev.map((clip) => {
            if (clip.id === it.leftClipId) {
              return { ...clip, fadeOut: crossfadeDuration };
            }
            if (clip.id === it.rightClipId) {
              return { ...clip, fadeIn: crossfadeDuration };
            }
            return clip;
          }),
        );
        it.moved = true;
        it.lastCrossfadeDuration = crossfadeDuration;
        return;
      }

      if (it.type === "select-pending") {
        const dx = ev.clientX - it.startClientX;
        const dy = ev.clientY - it.startClientY;
        if (
          Math.abs(dx) < MOVE_THRESHOLD_PX &&
          Math.abs(dy) < MOVE_THRESHOLD_PX
        )
          return;
        it.type = "marquee";
      }
      if (it.type === "marquee") {
        const rect = tracksContentRef.current?.getBoundingClientRect();
        if (!rect) return;
        const curX =
          ev.clientX - rect.left + tracksContentRef.current.scrollLeft;
        const curY = ev.clientY - rect.top + tracksContentRef.current.scrollTop;
        const x1 = Math.min(it.startX, curX),
          x2 = Math.max(it.startX, curX);
        const y1 = Math.min(it.startY, curY),
          y2 = Math.max(it.startY, curY);
        setMarqueeBox({ x1, y1, x2, y2 });
        const hits = getMarqueeSelectedClipIds({
          clips,
          tracks,
          pxPerSec,
          rect: { x1, y1, x2, y2 },
          additive: it.additive,
          initialSelection: it.initialSelection,
          trackTopOffset: it.rulerHeight ?? 30,
        });
        setSelectedClipIds(hits);
        return;
      }

      if (it.type === "preview-transform") {
        const orig = it.originalClip;
        if (!orig || isClipTrackLocked(orig, tracks)) return;
        const rect = it.previewRect || { width: 1, height: 1 };
        const dx = ev.clientX - it.startClientX;
        const dy = ev.clientY - it.startClientY;
        const clampScale = (value) => Math.max(0, Math.min(400, value));
        let guides = null;
        let next = {};
        if (it.mode === "move") {
          const rawX = (orig.positionX ?? 0) + dx;
          const rawY = (orig.positionY ?? 0) + dy;
          const smoothed = smoothPreviewMove(rawX, rawY, rect, effSnap);
          next = {
            positionX: smoothed.positionX,
            positionY: smoothed.positionY,
          };
          guides = smoothed.guides;
        } else if (it.mode === "resize") {
          const baseScaleX = Number(orig.scaleX ?? orig.scale ?? 100);
          const baseScaleY = Number(orig.scaleY ?? orig.scale ?? 100);
          const locked = orig.scaleLocked !== false;
          let nextScaleX;
          let nextScaleY;
          if (locked) {
            const delta =
              ((dx / Math.max(1, rect.width)) +
                (dy / Math.max(1, rect.height))) *
              50;
            const uniform = baseScaleX + delta;
            nextScaleX = uniform;
            nextScaleY = uniform;
          } else {
            nextScaleX = baseScaleX + (dx / Math.max(1, rect.width)) * 100;
            nextScaleY = baseScaleY + (dy / Math.max(1, rect.height)) * 100;
          }
          next = {
            scaleX: clampScale(nextScaleX),
            scaleY: clampScale(nextScaleY),
            scale: clampScale(
              orig.scaleLocked !== false
                ? nextScaleX
                : (nextScaleX + nextScaleY) / 2,
            ),
            scaleLocked: orig.scaleLocked !== false,
          };
        } else if (it.mode.startsWith("resize-")) {
          next = computePreviewResizeTransform({
            mode: it.mode,
            rect,
            dx,
            dy,
            clip: orig,
            altKey: ev.altKey,
          });
        } else if (it.mode === "rotate") {
          const currentAngle = Math.atan2(
            ev.clientY - it.previewCenterY,
            ev.clientX - it.previewCenterX,
          );
          if (it.rotateLastRad == null) {
            it.rotateLastRad = it.startAngle;
            it.rotateAccumRad = 0;
          }
          const step = unwrapSignedAngleDelta(it.rotateLastRad, currentAngle);
          it.rotateLastRad = currentAngle;
          it.rotateAccumRad += step;
          const baseRotation = Number(orig.rotation ?? 0);
          const nextRotation =
            baseRotation + (it.rotateAccumRad * 180) / Math.PI;
          next = { rotation: nextRotation };
        }
        setPreviewSnapGuides(guides);
        dispatchEngineCommand({
          type: "clip.updateProps",
          payload: { clipId: it.clipId, patch: next },
        });
        it.moved = true;
        return;
      }

      const movedX = Math.abs(x - it.startX);
      const movedY = Math.abs(ev.clientY - (it.startClientY ?? ev.clientY));
      if (!it.moved && movedX < MOVE_THRESHOLD_PX && movedY < MOVE_THRESHOLD_PX)
        return;
      const orig = it.originalClip;
      if (!orig) return;
      const deltaSec = (x - it.startX) / pxPerSec;

      if (
        it.type === "move" &&
        it.selectedSnaps &&
        it.selectedSnaps.length > 1
      ) {
        const snaps = it.selectedSnaps;
        const selectedIdsSet = new Set(snaps.map((s) => s.id));
        const trackMoveClipIds = new Set(
          it.trackMoveClipIds || snaps.map((s) => s.id),
        );
        const trackMoveSnaps = snaps.filter((s) => trackMoveClipIds.has(s.id));
        const nonSelected = it.snapshotBefore.filter(
          (c) => !selectedIdsSet.has(c.id),
        );
        const leftmostStart = Math.min(...snaps.map((s) => s.startTime));
        const rightmostEnd = Math.max(
          ...snaps.map((s) => s.startTime + (s.outPoint - s.inPoint)),
        );
        const groupDur = rightmostEnd - leftmostStart;
        const primarySnap = snaps.find((s) => s.id === it.clipId) || snaps[0];
        const movePlan = getMoveTrackPlan(
          trackMoveSnaps.length > 0 ? trackMoveSnaps : [primarySnap],
          it.clipId,
          ev.clientY,
          it,
        );
        const primaryTargetTrackId =
          movePlan.primaryTargetTrackId || primarySnap.trackId;
        const trackMovedSnaps = applyTrackMovePlan(trackMoveSnaps, movePlan);
        const trackMovedMap = new Map(trackMovedSnaps.map((s) => [s.id, s]));
        const remappedSnaps = snaps.map((s) => trackMovedMap.get(s.id) || s);

        if (effSnap) {
          const proposedLeftmost = leftmostStart + deltaSec;
          const proposedCenter = proposedLeftmost + groupDur / 2;
          const trackNonSelected = nonSelected.filter(
            (c) => c.trackId === primaryTargetTrackId,
          );
          const ins = detectInsertPoint(
            "__group__",
            proposedCenter,
            groupDur,
            trackNonSelected,
          );
          if (ins) {
            const groupShift = ins.insertPoint - leftmostStart;
            const movedSnaps = placeLinkedSyncClips(
              remappedSnaps.map((snap) => ({
                ...snap,
                startTime: snap.startTime + groupShift,
              })),
              trackMoveClipIds,
              it,
            );
            const movedSnapMap = new Map(
              movedSnaps.map((snap) => [snap.id, snap]),
            );
            const moved = it.snapshotBefore.map((c) => {
              if (selectedIdsSet.has(c.id)) {
                const ms = movedSnapMap.get(c.id) || c;
                const kfDelta = ms.startTime - c.startTime;
                return {
                  ...ms,
                  keyframes: shiftKeyframeMap(c.keyframes, kfDelta),
                };
              }
              if (
                c.trackId === primaryTargetTrackId &&
                c.startTime >= ins.insertPoint - 1e-3
              )
                return { ...c, startTime: c.startTime + groupDur };
              return c;
            });
            updateTrackMovePreviewFromClips(movedSnaps, movePlan, it);
            setSnapIndicatorTime(ins.insertPoint);
            it.lastPreviewClips = moved;
            setClips(moved);
            it.moved = true;
            return;
          }
        }

        let delta = deltaSec;
        if (effSnap) {
          const targetTrackSnaps = remappedSnaps.filter(
            (s) => s.trackId === primaryTargetTrackId,
          );
          const trackNonSelected = nonSelected.filter(
            (c) => c.trackId === primaryTargetTrackId,
          );
          let maxRightShift = Number.MAX_SAFE_INTEGER,
            maxLeftShift = Number.MAX_SAFE_INTEGER;
          for (const s of targetTrackSnaps) {
            const sE = s.startTime + (s.outPoint - s.inPoint);
            for (const n of trackNonSelected) {
              const nS = n.startTime,
                nE = n.startTime + (n.outPoint - n.inPoint);
              if (nS >= sE - 1e-3 && nS - sE < maxRightShift)
                maxRightShift = nS - sE;
              if (nE <= s.startTime + 1e-3 && s.startTime - nE < maxLeftShift)
                maxLeftShift = s.startTime - nE;
            }
          }
          delta = Math.max(-maxLeftShift, Math.min(maxRightShift, delta));
        }
        delta = Math.max(-leftmostStart, delta);
        const movedSnaps = placeLinkedSyncClips(
          remappedSnaps.map((snap) => ({
            ...snap,
            startTime: snap.startTime + delta,
          })),
          trackMoveClipIds,
          it,
        );
        const movedSnapMap = new Map(movedSnaps.map((snap) => [snap.id, snap]));
        const moved = it.snapshotBefore.map((c) => {
          const s = movedSnapMap.get(c.id);
          if (!s) return c;
          const kfDelta = s.startTime - c.startTime;
          return { ...s, keyframes: shiftKeyframeMap(c.keyframes, kfDelta) };
        });
        updateTrackMovePreviewFromClips(movedSnaps, movePlan, it);
        setSnapIndicatorTime(null);
        it.lastPreviewClips = moved;
        setClips(moved);
        it.moved = true;
        return;
      }

      if (it.type === "move") {
        const dur = orig.outPoint - orig.inPoint;
        let newStart = Math.max(0, orig.startTime + deltaSec);
        const movePlan = getMoveTrackPlan([orig], orig.id, ev.clientY, it);
        const movedOrig = applyTrackMovePlan([orig], movePlan)[0] || orig;
        const targetTrackIdForMove = movedOrig.trackId;
        updateTrackMovePreview(movePlan);
        const trackSnapshot = it.snapshotBefore.filter(
          (c) => c.id !== orig.id && c.trackId === targetTrackIdForMove,
        );
        if (effSnap) {
          const center = newStart + dur / 2;
          const ins = detectInsertPoint(orig.id, center, dur, trackSnapshot);
          if (ins) {
            const rippledTrack = applyRippleInsert(
              trackSnapshot,
              orig.id,
              ins.insertPoint,
              dur,
            );
            const rippleDelta = ins.insertPoint - orig.startTime;
            const nextPreviewClips = it.snapshotBefore
              .filter(
                (c) => c.id !== orig.id && c.trackId !== targetTrackIdForMove,
              )
              .concat(rippledTrack, {
                ...movedOrig,
                startTime: ins.insertPoint,
                keyframes: shiftKeyframeMap(orig.keyframes, rippleDelta),
              });
            it.lastPreviewClips = nextPreviewClips;
            setClips(nextPreviewClips);
            setSnapIndicatorTime(ins.insertPoint);
            it.moved = true;
            return;
          }
          const sStart = snapValue(newStart, orig.id, trackSnapshot);
          const sEnd = snapValue(newStart + dur, orig.id, trackSnapshot);
          const distStart = Math.abs(sStart.value - newStart);
          const distEnd = Math.abs(sEnd.value - (newStart + dur));
          let snappedAt = null;
          if (
            sStart.snapped &&
            (!sEnd.snapped || distStart * pxPerSec <= distEnd * pxPerSec)
          ) {
            newStart = sStart.value;
            snappedAt = sStart.value;
          } else if (sEnd.snapped) {
            newStart = sEnd.value - dur;
            snappedAt = sEnd.value;
          }
          if (newStart < 0) {
            newStart = 0;
            snappedAt = 0;
          }
          const others = trackSnapshot.filter((c) => c.id !== orig.id);
          const constrained = constrainMoveStart(newStart, dur, others);
          if (Math.abs(constrained - newStart) > 1e-3) snappedAt = null;
          newStart = constrained;
          const snapMoveDelta = newStart - orig.startTime;
          setSnapIndicatorTime(snappedAt);
          const nextPreviewClips = it.snapshotBefore.map((c) =>
            c.id === orig.id
              ? {
                  ...movedOrig,
                  startTime: newStart,
                  keyframes: shiftKeyframeMap(orig.keyframes, snapMoveDelta),
                }
              : c,
          );
          it.lastPreviewClips = nextPreviewClips;
          setClips(nextPreviewClips);
          it.moved = true;
        } else {
          if (newStart < 0) newStart = 0;
          const freeMoveDelta = newStart - orig.startTime;
          setSnapIndicatorTime(null);
          const nextPreviewClips = it.snapshotBefore.map((c) =>
            c.id === orig.id
              ? {
                  ...movedOrig,
                  startTime: newStart,
                  keyframes: shiftKeyframeMap(orig.keyframes, freeMoveDelta),
                }
              : c,
          );
          it.lastPreviewClips = nextPreviewClips;
          setClips(nextPreviewClips);
          it.moved = true;
        }
      } else if (it.type === "trim-left") {
        if (isTextClip(orig)) {
          const fixedRight = orig.startTime + (orig.outPoint - orig.inPoint);
          let finalStart = Math.max(
            0,
            Math.min(fixedRight - MIN_CLIP_DURATION, orig.startTime + deltaSec),
          );
          const s = snapValue(finalStart, orig.id);
          let snappedAt = null;
          if (s.snapped) {
            const snappedStart = Math.max(
              0,
              Math.min(fixedRight - MIN_CLIP_DURATION, s.value),
            );
            finalStart = snappedStart;
            snappedAt = snappedStart;
          }
          if (effSnap) {
            const others = clips.filter(
              (c) => c.id !== orig.id && c.trackId === orig.trackId,
            );
            const minLeft = minStartForTrimLeft(fixedRight, others);
            if (finalStart < minLeft - 1e-3) {
              finalStart = Math.min(fixedRight - MIN_CLIP_DURATION, minLeft);
              snappedAt = null;
            }
          }
          setSnapIndicatorTime(snappedAt);
          setClips((prev) =>
            prev.map((clip) =>
              clip.id === orig.id
                ? {
                    ...clip,
                    startTime: finalStart,
                    inPoint: 0,
                    outPoint: Math.max(MIN_CLIP_DURATION, fixedRight - finalStart),
                  }
                : clip,
            ),
          );
          it.moved = true;
          return;
        }
        const minNewIn = Math.max(0, orig.inPoint - orig.startTime);
        let newInPoint = Math.max(
          minNewIn,
          Math.min(orig.outPoint - MIN_CLIP_DURATION, orig.inPoint + deltaSec),
        );
        let finalStart = Math.max(
          0,
          orig.startTime + (newInPoint - orig.inPoint),
        );
        const s = snapValue(finalStart, orig.id);
        let snappedAt = null;
        if (s.snapped) {
          const adjustedIn = newInPoint + (s.value - finalStart);
          if (
            adjustedIn >= minNewIn &&
            adjustedIn < orig.outPoint - MIN_CLIP_DURATION
          ) {
            newInPoint = adjustedIn;
            finalStart = orig.startTime + (newInPoint - orig.inPoint);
            snappedAt = s.value;
          }
        }
        if (effSnap) {
          const origTrackId = orig.trackId;
          const others = clips.filter(
            (c) => c.id !== orig.id && c.trackId === origTrackId,
          );
          const fixedRight = orig.startTime + (orig.outPoint - orig.inPoint);
          const minLeft = minStartForTrimLeft(fixedRight, others);
          if (finalStart < minLeft - 1e-3) {
            const delta = minLeft - finalStart;
            newInPoint = Math.min(
              orig.outPoint - MIN_CLIP_DURATION,
              newInPoint + delta,
            );
            finalStart = orig.startTime + (newInPoint - orig.inPoint);
            snappedAt = null;
          }
        }
        setSnapIndicatorTime(snappedAt);
        setClips((prev) =>
          applyGroupTrimLeft(prev, orig.id, {
            inPoint: newInPoint,
            startTime: finalStart,
          }),
        );
        it.moved = true;
      } else if (it.type === "trim-right") {
        const maxOutPoint =
          isTextClip(orig) || orig.mediaType === "image"
            ? Number.MAX_SAFE_INTEGER
            : (orig.sourceDuration || Number.MAX_SAFE_INTEGER);
        let newOutPoint = isTextClip(orig)
          ? Math.max(MIN_CLIP_DURATION, Math.min(maxOutPoint, orig.outPoint + deltaSec))
          : Math.max(
              orig.inPoint + MIN_CLIP_DURATION,
              Math.min(maxOutPoint, orig.outPoint + deltaSec),
            );
        let rightOnTimeline = orig.startTime + (newOutPoint - orig.inPoint);
        const s = snapValue(rightOnTimeline, orig.id);
        let snappedAt = null;
        if (s.snapped) {
          const adjustedOut = newOutPoint + (s.value - rightOnTimeline);
          if (
            adjustedOut > orig.inPoint + MIN_CLIP_DURATION &&
            adjustedOut <= maxOutPoint
          ) {
            newOutPoint = adjustedOut;
            rightOnTimeline = orig.startTime + (newOutPoint - orig.inPoint);
            snappedAt = s.value;
          }
        }
        if (effSnap) {
          const origTrackId = orig.trackId;
          const others = clips.filter(
            (c) => c.id !== orig.id && c.trackId === origTrackId,
          );
          const maxRight = maxEndForTrimRight(orig.startTime, others);
          if (rightOnTimeline > maxRight + 1e-3) {
            const delta = rightOnTimeline - maxRight;
            newOutPoint = Math.max(
              isTextClip(orig) ? MIN_CLIP_DURATION : orig.inPoint + MIN_CLIP_DURATION,
              newOutPoint - delta,
            );
            snappedAt = null;
          }
        }
        setSnapIndicatorTime(snappedAt);
        setClips((prev) =>
          isTextClip(orig)
            ? prev.map((clip) =>
                clip.id === orig.id
                  ? { ...clip, inPoint: 0, outPoint: newOutPoint }
                  : clip,
              )
            : applyGroupTrimRight(prev, orig.id, { outPoint: newOutPoint }),
        );
        it.moved = true;
      }
    };
    const onUp = () => {
      const it = interactionRef.current;
      if (it && it.type === "select-pending") {
        if (it.pendingGap) {
          setSelectedGap(it.pendingGap);
          if (!it.additive) setSelectedClipIds(new Set());
          setActiveClipId(null);
        } else if (!it.additive) {
          setSelectedClipIds(new Set());
          setSelectedGap(null);
          setActiveClipId(null);
        }
      } else if (it && it.type === "marquee") {
        setMarqueeBox(null);
      } else if (
        it &&
        it.type === "preview-transform" &&
        it.moved &&
        it.snapshotBefore
      ) {
        pushHistory(createHistorySnapshot(it.snapshotBefore, tracks));
      } else if (
        it &&
        it.type === "crossfade-drag" &&
        it.moved &&
        it.snapshotBefore
      ) {
        pushHistory(createHistorySnapshot(it.snapshotBefore, tracks));
      } else if (it && it.type === "move" && !it.moved) {
        setSelectedClipIds(new Set([it.clipId]));
      } else if (it && it.moved && it.snapshotBefore) {
        const finalPreviewClips = it.lastPreviewClips || clips;
        pushHistory(
          it.historyBefore ||
            createHistorySnapshot(it.snapshotBefore, it.tracksBefore || tracks),
        );
        const pendingAutoTracks =
          it.pendingAutoTracks || it.trackMovePlan?.autoTracks || [];
        let movedViaEngine = false;
        if (it.type === "move" && pendingAutoTracks.length > 0) {
          setTracks(
            (prev) =>
              applyTrackMovePlan({
                tracks: prev,
                clips: [],
                plan: { autoTracks: pendingAutoTracks },
              }).tracks,
          );
          if (it.lastPreviewClips) {
            setClips(it.lastPreviewClips);
          }
        }
        if (it.type === "move" && pendingAutoTracks.length === 0) {
          const moveCommand = buildEngineMoveCommit(it, finalPreviewClips);
          if (moveCommand) {
            dispatchEngineCommand(moveCommand, {
              clips: it.snapshotBefore,
              tracks: it.tracksBefore || tracks,
              selectedClipIds: new Set(it.trackMoveClipIds || [it.clipId]),
              activeClipId: it.clipId,
            });
            movedViaEngine = true;
          }
        }
        if (it.type === "trim-left" || it.type === "trim-right") {
          const trimCommand = buildEngineTrimCommit(it, clips);
          if (trimCommand) {
            dispatchEngineCommand(trimCommand, {
              clips: it.snapshotBefore,
              tracks: it.tracksBefore || tracks,
              selectedClipIds,
              activeClipId: it.clipId,
            });
          }
        }
        if (!movedViaEngine && !snapEnabled) {
          const isMultiMove =
            it.type === "move" &&
            it.selectedSnaps &&
            it.selectedSnaps.length > 1;
          if (isMultiMove) {
            const ids = new Set(it.selectedSnaps.map((s) => s.id));
            setClips(() => {
              const byTrack = new Map();
              finalPreviewClips.forEach((c) => {
                if (!byTrack.has(c.trackId)) byTrack.set(c.trackId, []);
                byTrack.get(c.trackId).push(c);
              });
              const resolved = [];
              byTrack.forEach((trackClipList) => {
                const modified = trackClipList.filter((c) => ids.has(c.id));
                if (modified.length > 0) {
                  const modifierIds = modified.map((c) => c.id);
                  resolved.push(
                    ...resolveOverlapsMulti(trackClipList, modifierIds, () =>
                      nextId("clip"),
                    ),
                  );
                } else {
                  resolved.push(...trackClipList);
                }
              });
              return resolved;
            });
          } else if (
            it.type === "move" ||
            it.type === "trim-left" ||
            it.type === "trim-right"
          ) {
            setClips(() => {
              const orig = finalPreviewClips.find((c) => c.id === it.clipId);
              if (!orig) return finalPreviewClips;
              const trackId = orig.trackId;
              const trackClips = finalPreviewClips.filter((c) => c.trackId === trackId);
              const otherTracks = finalPreviewClips.filter((c) => c.trackId !== trackId);
              const resolvedTrack = resolveOverlaps(trackClips, it.clipId, () =>
                nextId("clip"),
              );
              return [...otherTracks, ...resolvedTrack];
            });
          }
        }
      }
      if (it && it.type === "seek") {
        endScrubAudio?.();
        // Force sync final position on scrub-end to ensure UI is immediately updated
        dispatchEngineCommand({
          type: "timeline.setPlayhead",
          payload: { time: timelineTimeRef.current, force: true },
        });
      }
      if (it && it.type === "seek" && it.wasPlaying) {
        const resumeTime = timelineTimeRef.current;
        const resumeClip = getTopVisibleTimelineClip({
          time: resumeTime,
          clips: playbackRef.current.clips,
          lookups: timelinePlaybackLookups,
        });
        if (resumeClip) startClipPlayback(resumeClip, resumeTime);
        else startTimelineGapPlayback(resumeTime);
      }
      interactionRef.current = null;
      setInteraction(null);
      setSnapIndicatorTime(null);
      setScrubTooltip(null);
      setPreviewSnapGuides(null);
      setDropTargetTrackId(null);
      setTrackMovePreview(null);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interaction, clips, tracks, timelineTime, activeClipId, pxPerSec, snapEnabled]);

  const handleClipContextMenu = (e, clip) => {
    e.preventDefault();
    e.stopPropagation();
    setEditorFocus(FOCUS_TIMELINE);
    setSourceMonitorId(null);
    setActiveClipId(clip.id);
    setActiveId(getClipMediaId(clip));
    setContextMenu({ x: e.clientX, y: e.clientY, clipId: clip.id });
  };

  return {
    seekToTime,
    getXInTracks,
    beginScrub,
    handleTracksMouseDown,
    handlePlayheadMouseDown,
    handleClipMouseDown,
    handleTrimMouseDown,
    handlePreviewClipMouseDown,
    handleCrossfadeMouseDown,
    snapValue,
    handleClipContextMenu,
  };
}
