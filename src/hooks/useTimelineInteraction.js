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
  unlinkClipGroup,
} from "../lib/timeline.js";
import { getTopVisibleTimelineClip } from "../lib/playback.js";
import { FOCUS_TIMELINE } from "../lib/sourceMonitor.js";
import {
  computePreviewResizeTransform,
  smoothPreviewMove,
} from "../lib/previewTransform.js";
import { shiftKeyframeMap } from "../lib/keyframes.js";
import { nextId } from "../lib/utils.js";

/**
 * useTimelineInteraction — encapsulates all timeline mouse-interaction logic.
 *
 * Handles: seeking, clip move/trim, marquee selection, preview-transform,
 * snap-to-grid, context menus, and the global mousemove/mouseup effect.
 *
 * @param {Object} config
 * @returns {Object} handler functions
 */
export function useTimelineInteraction({
  // --- state ---
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
  setTimelineTime,
  isPlaying,
  interaction,
  setInteraction,
  pxPerSec,
  snapEnabled,
  videos,

  // --- setters for UI state ---
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
  setProjectStatus,

  // --- refs ---
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

  // --- callbacks defined in App ---
  updateTimelinePlayheadPosition,
  stopPlayback,
  pauseTimelinePreviewMedia,
  commitClips,
  pushHistory,
  createHistorySnapshot,
  getMoveTrackPlan,
  applyTrackMovePlan,
  updateTrackMovePreview,
  updateTrackMovePreviewFromClips,
  placeLinkedSyncClips,
  startClipPlayback,
  startTimelineGapPlayback,
  duplicateClip,

  // --- memoised lookups ---
  timelinePlaybackLookups,
}) {
  // --- seeking ---
  const seekToTime = useCallback(
    (t) => {
      t = Math.max(0, t);
      setSourceMonitorId(null);
      setEditorFocus(FOCUS_TIMELINE);
      timelineTimeRef.current = t;
      updateTimelinePlayheadPosition(t);
      setTimelineTime(t);
      const clip = getTopVisibleTimelineClip({
        time: t,
        clips,
        lookups: timelinePlaybackLookups,
      });
      if (clip) {
        playingClipIdRef.current = clip.id;
        setActiveClipId(clip.id);
        setActiveId(clip.videoId);
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
      setTimelineTime,
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

  // --- mouse interactions ---
  // Pause helper: pauses if playing and remembers state for resume on mouseup
  const beginScrub = () => {
    const v = videoRef.current;
    const wasPlaying = playbackModeRef.current === "timeline" && isPlaying;
    if (wasPlaying && v && !v.paused) v.pause();
    if (wasPlaying) pauseTimelinePreviewMedia();
    return wasPlaying;
  };

  const handleTracksMouseDown = (e) => {
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
    // Click on the time-ruler keeps classic seek/scrub behavior.
    if (e.target.closest(".time-ruler")) {
      const wasPlaying = beginScrub();
      seekToTime(t);
      const i = { type: "seek", wasPlaying };
      interactionRef.current = i;
      setInteraction(i);
      return;
    }
    // Click on track area: detect gap, otherwise prepare for marquee/deselect.
    const gap = findGapAtTime(t, clips);
    const rect = tracksContentRef.current?.getBoundingClientRect();
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

    // Alt-drag → duplicate the clip(s) and drag the copies (Premiere/Filmora-style)
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
      setActiveId(clip.videoId);
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
        historyBefore: createHistorySnapshot(preCloneSnapshot, tracks), // undo restores to pre-clone state
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
        setActiveId(clip.videoId);
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
    setActiveId(clip.videoId);

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
    setEditorFocus(FOCUS_TIMELINE);
    setSourceMonitorId(null);
    if (playbackModeRef.current === "source") stopPlayback();
    setActiveClipId(clip.id);
    setActiveId(clip.videoId);
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
      stopPlayback();
      const rect = timelinePreviewRef.current?.getBoundingClientRect();
      if (!rect) return;
      const selected = expandWithLinkedPartners(clips, [clip.id]);
      setSelectedClipIds(selected);
      setActiveClipId(clip.id);
      setActiveId(clip.videoId);
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
    [clips, stopPlayback, setEditorFocus, setSourceMonitorId, timelinePreviewRef, setSelectedClipIds, setActiveClipId, setActiveId, interactionRef, setInteraction, setPreviewSnapGuides],
  );

  // snap helper (now returns {value, snapped}). Pass `sourceList` to use snapshot
  // edges instead of live (important during ripple-insert so snap targets stay stable).
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

  // global mouse move/up
  useEffect(() => {
    if (!interaction) return;
    const onMove = (ev) => {
      const x = getXInTracks(ev.clientX);
      const it = interactionRef.current;
      if (!it) return;
      // Shift temporarily disables snapping during this move.
      const effSnap = snapEnabled && !ev.shiftKey;
      // Auto-scroll near viewport edges while dragging
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
        setScrubTooltip({ x, time: t });
        return;
      }

      // Pending click on empty track area: become a marquee on enough drag
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
        const tStart = x1 / pxPerSec,
          tEnd = x2 / pxPerSec;
        const hits = new Set(
          it.additive ? Array.from(it.initialSelection) : [],
        );
        for (const c of clips) {
          const cS = c.startTime,
            cE = c.startTime + (c.outPoint - c.inPoint);
          if (cE > tStart + 1e-3 && cS < tEnd - 1e-3) hits.add(c.id);
        }
        setSelectedClipIds(hits);
        return;
      }

      if (it.type === "preview-transform") {
        const orig = it.originalClip;
        if (!orig) return;
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
          const baseRotation = Number(orig.rotation ?? 0);
          const nextRotation =
            baseRotation + ((currentAngle - it.startAngle) * 180) / Math.PI;
          next = { rotation: nextRotation };
        }
        setPreviewSnapGuides(guides);
        setClips((prev) =>
          prev.map((clip) =>
            clip.id === it.clipId ? { ...clip, ...next } : clip,
          ),
        );
        it.moved = true;
        return;
      }

      // movement threshold
      const movedX = Math.abs(x - it.startX);
      const movedY = Math.abs(ev.clientY - (it.startClientY ?? ev.clientY));
      if (!it.moved && movedX < MOVE_THRESHOLD_PX && movedY < MOVE_THRESHOLD_PX)
        return;
      const orig = it.originalClip;
      if (!orig) return;
      const deltaSec = (x - it.startX) / pxPerSec;

      // Multi-clip move: shift the whole group uniformly, with snap-on ripple-insert support
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

        // ── Snap-ON ripple-insert: if the group's projected center is over a non-selected clip
        // (or falls in a too-small gap), push everything aside and drop the entire group there.
        if (effSnap) {
          const proposedLeftmost = leftmostStart + deltaSec;
          const proposedCenter = proposedLeftmost + groupDur / 2;
          // Track-aware: only consider clips on the same track as the primary clip
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
                return { ...ms, keyframes: shiftKeyframeMap(c.keyframes, kfDelta) };
              }
              // Non-selected clips at-or-after the insert point get pushed right by the group span
              if (
                c.trackId === primaryTargetTrackId &&
                c.startTime >= ins.insertPoint - 1e-3
              )
                return { ...c, startTime: c.startTime + groupDur };
              return c;
            });
            updateTrackMovePreviewFromClips(movedSnaps, movePlan, it);
            setSnapIndicatorTime(ins.insertPoint);
            setClips(moved);
            it.moved = true;
            return;
          }
        }

        // ── Otherwise: clamped uniform shift (no insert)
        let delta = deltaSec;
        if (effSnap) {
          // Track-aware: only consider clips on the same track as the group
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
        // Track-aware: filter snapshot to only clips on the target track
        const trackSnapshot = it.snapshotBefore.filter(
          (c) => c.id !== orig.id && c.trackId === targetTrackIdForMove,
        );
        if (effSnap) {
          // Ripple-insert mode: when the dragged clip's center sits over another clip,
          // or in a gap too small for it, push the rest of the timeline aside (Filmora-style).
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
            // Merge rippled track back with other tracks
            setClips(
              it.snapshotBefore
                .filter(
                  (c) => c.id !== orig.id && c.trackId !== targetTrackIdForMove,
                )
                .concat(rippledTrack, {
                  ...movedOrig,
                  startTime: ins.insertPoint,
                  keyframes: shiftKeyframeMap(orig.keyframes, rippleDelta),
                }),
            );
            setSnapIndicatorTime(ins.insertPoint);
            it.moved = true;
            return;
          }
          // Otherwise: edge-snap to snapshot positions, then constrain to non-overlap
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
          // Restore other clips to snapshot positions (in case a previous frame rippled them)
          setSnapIndicatorTime(snappedAt);
          setClips(
            it.snapshotBefore.map((c) =>
              c.id === orig.id
                ? { ...movedOrig, startTime: newStart, keyframes: shiftKeyframeMap(orig.keyframes, snapMoveDelta) }
                : c,
            ),
          );
          it.moved = true;
        } else {
          // Snap-off: free move; snap-off snap is no-op anyway
          if (newStart < 0) newStart = 0;
          const freeMoveDelta = newStart - orig.startTime;
          setSnapIndicatorTime(null);
          setClips((prev) =>
            prev.map((c) =>
              c.id === orig.id
                ? { ...movedOrig, startTime: newStart, keyframes: shiftKeyframeMap(orig.keyframes, freeMoveDelta) }
                : c,
            ),
          );
          it.moved = true;
        }
      } else if (it.type === "trim-left") {
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
        // Snap-on: prevent overlap with left neighbor
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
          orig.mediaType === "image" ? Number.MAX_SAFE_INTEGER : (orig.sourceDuration || Number.MAX_SAFE_INTEGER);
        let newOutPoint = Math.max(
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
        // Snap-on: prevent overlap with right neighbor
        if (effSnap) {
          const origTrackId = orig.trackId;
          const others = clips.filter(
            (c) => c.id !== orig.id && c.trackId === origTrackId,
          );
          const maxRight = maxEndForTrimRight(orig.startTime, others);
          if (rightOnTimeline > maxRight + 1e-3) {
            const delta = rightOnTimeline - maxRight;
            newOutPoint = Math.max(
              orig.inPoint + MIN_CLIP_DURATION,
              newOutPoint - delta,
            );
            snappedAt = null;
          }
        }
        setSnapIndicatorTime(snappedAt);
        setClips((prev) =>
          applyGroupTrimRight(prev, orig.id, { outPoint: newOutPoint }),
        );
        it.moved = true;
      }
    };
    const onUp = () => {
      const it = interactionRef.current;
      if (it && it.type === "select-pending") {
        // Pure click: select gap, or deselect everything
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
        // Selection already updated during drag; just clear the box
        setMarqueeBox(null);
      } else if (it && it.type === "preview-transform" && it.moved && it.snapshotBefore) {
        pushHistory(createHistorySnapshot(it.snapshotBefore, tracks));
      } else if (it && it.type === "move" && !it.moved) {
        // Click without drag: collapse multi-selection to just the clicked clip
        setSelectedClipIds(new Set([it.clipId]));
      } else if (it && it.moved && it.snapshotBefore) {
        // Alt-drag stores a separate pre-clone snapshot so undo restores to before duplication.
        pushHistory(
          it.historyBefore ||
            createHistorySnapshot(it.snapshotBefore, it.tracksBefore || tracks),
        );
        const pendingAutoTracks =
          it.pendingAutoTracks || it.trackMovePlan?.autoTracks || [];
        if (it.type === "move" && pendingAutoTracks.length > 0) {
          setTracks(
            (prev) =>
              applyTrackMovePlan({
                tracks: prev,
                clips: [],
                plan: { autoTracks: pendingAutoTracks },
              }).tracks,
          );
        }
        // Snap-off: cut overlapping neighbors (Filmora overwrite)
        if (!snapEnabled) {
          const isMultiMove =
            it.type === "move" &&
            it.selectedSnaps &&
            it.selectedSnaps.length > 1;
          if (isMultiMove) {
            const ids = new Set(it.selectedSnaps.map((s) => s.id));
            // Track-aware: resolve overlaps per track
            setClips((prev) => {
              const byTrack = new Map();
              prev.forEach((c) => {
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
            // Track-aware: resolve overlaps only within the clip's track
            setClips((prev) => {
              const orig = prev.find((c) => c.id === it.clipId);
              if (!orig) return prev;
              const trackId = orig.trackId;
              const trackClips = prev.filter((c) => c.trackId === trackId);
              const otherTracks = prev.filter((c) => c.trackId !== trackId);
              const resolvedTrack = resolveOverlaps(trackClips, it.clipId, () =>
                nextId("clip"),
              );
              return [...otherTracks, ...resolvedTrack];
            });
          }
        }
      }
      // Resume timeline playback at the scrubbed position, including empty gaps.
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
  }, [interaction, clips, timelineTime, activeClipId, pxPerSec, snapEnabled]);

  // ---- Clip actions ----

  const handleClipContextMenu = (e, clip) => {
    e.preventDefault();
    e.stopPropagation();
    setEditorFocus(FOCUS_TIMELINE);
    setSourceMonitorId(null);
    setActiveClipId(clip.id);
    setActiveId(clip.videoId);
    setContextMenu({ x: e.clientX, y: e.clientY, clipId: clip.id });
  };

  // Context menu handlers (to avoid ESLint ref access warnings)
  const handleContextMenuDuplicate = (clipId) => {
    duplicateClip(clipId);
    setContextMenu(null);
  };

  const handleContextMenuDelete = (clipId) => {
    const toRemove = expandWithLinkedPartners(clips, [clipId]);
    commitClips(clips.filter((c) => !toRemove.has(c.id)));
    setActiveClipId(null);
    setContextMenu(null);
  };

  const handleContextMenuUnlink = (clipId) => {
    commitClips(unlinkClipGroup(clips, clipId));
    setContextMenu(null);
    setProjectStatus({ ok: true, msg: "Link aufgehoben." });
  };

  return {
    seekToTime,
    getXInTracks,
    handleTracksMouseDown,
    handlePlayheadMouseDown,
    handleClipMouseDown,
    handleTrimMouseDown,
    handlePreviewClipMouseDown,
    snapValue,
    handleClipContextMenu,
    handleContextMenuDuplicate,
    handleContextMenuDelete,
    handleContextMenuUnlink,
  };
}
