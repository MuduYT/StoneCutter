import { useEffect } from "react";

export function useKeyboardShortcuts({
  activeClipId,
  activeSourceSelection,
  clips,
  commitClips,
  duplicateClip,
  editorFocus,
  handlePlay,
  isPlaying,
  isSourceMonitorActive,
  playbackMode,
  previewTime,
  redo,
  saveCurrentProject,
  seekSourcePreviewTo,
  seekToTime,
  selectedClipIds,
  selectedGap,
  selectedKeyframe,
  snapEnabled,
  splitAtPlayhead,
  timelineTime,
  totalEnd,
  undo,
  createHistorySnapshot,
  pushHistory,
  // Coupled refs/setters/helpers used directly by keyboard actions.
  setClips,
  setSelectedKeyframe,
  setSelectedGap,
  setSelectedClipIds,
  setActiveClipId,
  setSnapEnabled,
  setProjectStatus,
  clipboardRef,
  videoRef,
  focusSource,
  stepSourcePreviewTime,
  getClipPropertyTrack,
  removeKeyframe,
  setClipPropertyTrack,
  closeGap,
  expandWithLinkedPartners,
  rippleDeleteClips,
  unlinkClipGroup,
  detectInsertPoint,
  applyRippleInsert,
  resolveOverlaps,
  nextId,
}) {
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveCurrentProject();
        return;
      }

      if (editorFocus === focusSource && isSourceMonitorActive) {
        if (e.code === "ArrowLeft") {
          e.preventDefault();
          seekSourcePreviewTo(
            stepSourcePreviewTime({
              keyCode: e.code,
              currentTime: previewTime,
              inPoint: activeSourceSelection.inPoint,
              outPoint: activeSourceSelection.outPoint,
              shiftKey: e.shiftKey,
            }),
          );
          return;
        }
        if (e.code === "ArrowRight") {
          e.preventDefault();
          seekSourcePreviewTo(
            stepSourcePreviewTime({
              keyCode: e.code,
              currentTime: previewTime,
              inPoint: activeSourceSelection.inPoint,
              outPoint: activeSourceSelection.outPoint,
              shiftKey: e.shiftKey,
            }),
          );
          return;
        }
        if (e.code === "Comma") {
          e.preventDefault();
          seekSourcePreviewTo(
            stepSourcePreviewTime({
              keyCode: e.code,
              currentTime: previewTime,
              inPoint: activeSourceSelection.inPoint,
              outPoint: activeSourceSelection.outPoint,
            }),
          );
          return;
        }
        if (e.code === "Period") {
          e.preventDefault();
          seekSourcePreviewTo(
            stepSourcePreviewTime({
              keyCode: e.code,
              currentTime: previewTime,
              inPoint: activeSourceSelection.inPoint,
              outPoint: activeSourceSelection.outPoint,
            }),
          );
          return;
        }
        if (e.code === "Home") {
          e.preventDefault();
          seekSourcePreviewTo(
            stepSourcePreviewTime({
              keyCode: e.code,
              currentTime: previewTime,
              inPoint: activeSourceSelection.inPoint,
              outPoint: activeSourceSelection.outPoint,
            }),
          );
          return;
        }
        if (e.code === "End") {
          e.preventDefault();
          seekSourcePreviewTo(
            stepSourcePreviewTime({
              keyCode: e.code,
              currentTime: previewTime,
              inPoint: activeSourceSelection.inPoint,
              outPoint: activeSourceSelection.outPoint,
            }),
          );
          return;
        }
        if (e.code === "KeyJ") {
          e.preventDefault();
          seekSourcePreviewTo(
            stepSourcePreviewTime({
              keyCode: e.code,
              currentTime: previewTime,
              inPoint: activeSourceSelection.inPoint,
              outPoint: activeSourceSelection.outPoint,
            }),
          );
          return;
        }
      }

      if (e.code === "Space") {
        e.preventDefault();
        if (e.repeat) return;
        handlePlay();
      } else if (e.code === "Delete" || e.code === "Backspace") {
        // Ctrl/Cmd+Delete = ripple-delete (also closes the gap left behind)
        const ripple = e.ctrlKey || e.metaKey;
        if (selectedKeyframe) {
          const ownerClip = clips.find((c) => c.id === selectedKeyframe.clipId);
          if (ownerClip) {
            const track = getClipPropertyTrack(
              ownerClip,
              selectedKeyframe.propertyKey,
            );
            const nextTrack = removeKeyframe(track, selectedKeyframe.kfId);
            if (nextTrack.length !== track.length) {
              e.preventDefault();
              const nextMap = setClipPropertyTrack(
                ownerClip,
                selectedKeyframe.propertyKey,
                nextTrack,
              );
              pushHistory(createHistorySnapshot());
              setClips((prev) =>
                prev.map((c) =>
                  c.id === ownerClip.id ? { ...c, keyframes: nextMap } : c,
                ),
              );
              setSelectedKeyframe(null);
              return;
            }
          }
        }
        if (selectedGap) {
          e.preventDefault();
          commitClips(closeGap(clips, selectedGap));
          setSelectedGap(null);
          return;
        }
        const baseIds =
          selectedClipIds.size > 0
            ? selectedClipIds
            : activeClipId
              ? new Set([activeClipId])
              : null;
        // Always delete linked partners together so V+A stays consistent
        const ids =
          baseIds && baseIds.size > 0
            ? expandWithLinkedPartners(clips, baseIds)
            : null;
        if (ids && ids.size > 0) {
          e.preventDefault();
          if (ripple) {
            commitClips(rippleDeleteClips(clips, ids));
          } else {
            commitClips(clips.filter((c) => !ids.has(c.id)));
          }
          setSelectedClipIds(new Set());
          setActiveClipId(null);
        }
      } else if (e.code === "Escape") {
        setSelectedClipIds(new Set());
        setSelectedGap(null);
        setSelectedKeyframe(null);
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "z" &&
        !e.shiftKey
      ) {
        e.preventDefault();
        undo();
      } else if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z")
      ) {
        e.preventDefault();
        redo();
      } else if (e.code === "KeyS" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        splitAtPlayhead();
      } else if (e.code === "KeyN" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setSnapEnabled((v) => !v);
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "l"
      ) {
        // Ctrl+Shift+L: unlink the current clip's link group
        e.preventDefault();
        const target =
          activeClipId ||
          (selectedClipIds.size > 0
            ? selectedClipIds.values().next().value
            : null);
        if (target) {
          commitClips(unlinkClipGroup(clips, target));
          setProjectStatus({ ok: true, msg: "Link aufgehoben." });
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (activeClipId) duplicateClip(activeClipId);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        // Copy selected clips to clipboard
        const ids =
          selectedClipIds.size > 0
            ? selectedClipIds
            : activeClipId
              ? new Set([activeClipId])
              : null;
        if (ids && ids.size > 0) {
          e.preventDefault();
          const sel = clips.filter((c) => ids.has(c.id));
          const minStart = Math.min(...sel.map((c) => c.startTime));
          clipboardRef.current = sel.map((c) => ({
            ...c,
            _relStart: c.startTime - minStart,
          }));
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") {
        const ids =
          selectedClipIds.size > 0
            ? selectedClipIds
            : activeClipId
              ? new Set([activeClipId])
              : null;
        if (ids && ids.size > 0) {
          e.preventDefault();
          const sel = clips.filter((c) => ids.has(c.id));
          const minStart = Math.min(...sel.map((c) => c.startTime));
          clipboardRef.current = sel.map((c) => ({
            ...c,
            _relStart: c.startTime - minStart,
          }));
          commitClips(clips.filter((c) => !ids.has(c.id)));
          setSelectedClipIds(new Set());
          setActiveClipId(null);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        if (clipboardRef.current && clipboardRef.current.length > 0) {
          e.preventDefault();
          const groupMinStart = Math.min(
            ...clipboardRef.current.map((c) => c._relStart || 0),
          );
          const pasteTime = timelineTime;
          const groupDur =
            Math.max(
              ...clipboardRef.current.map(
                (c) => c.outPoint - c.inPoint + (c._relStart || 0),
              ),
            ) - groupMinStart;
          let insertPoint = pasteTime;

          // Compute insert point like import drag does
          if (snapEnabled) {
            const ins = detectInsertPoint(
              "__paste__",
              pasteTime + groupDur / 2,
              groupDur,
              clips,
            );
            if (ins) insertPoint = ins.insertPoint;
          }

          const newIds = [];
          const newClips = clipboardRef.current.map((c) => {
            const newId = nextId("clip");
            newIds.push(newId);
            const { _relStart, ...rest } = c;
            return {
              ...rest,
              id: newId,
              startTime: insertPoint + ((_relStart || 0) - groupMinStart),
            };
          });

          let merged = [...clips, ...newClips];
          if (snapEnabled) {
            // Ripple insert: shift clips at/after insertPoint
            merged = applyRippleInsert(
              merged,
              "__paste__",
              insertPoint,
              groupDur,
            );
          } else {
            // Overwrite mode: cut conflicts
            for (const id of newIds)
              merged = resolveOverlaps(merged, id, () => nextId("clip"));
          }
          commitClips(merged);
          setSelectedClipIds(new Set(newIds));
          setActiveClipId(newIds.length > 0 ? newIds[0] : null);
        }
      } else if (
        e.code === "ArrowLeft" &&
        selectedClipIds.size > 0 &&
        !e.repeat
      ) {
        // Move selected clip(s) by 1 frame (or 1s with Shift). Only if a selection exists; otherwise seek.
        e.preventDefault();
        const step = e.shiftKey ? 1 : 1 / 30;
        commitClips(
          clips.map((c) =>
            selectedClipIds.has(c.id)
              ? { ...c, startTime: Math.max(0, c.startTime - step) }
              : c,
          ),
        );
      } else if (
        e.code === "ArrowRight" &&
        selectedClipIds.size > 0 &&
        !e.repeat
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 1 / 30;
        commitClips(
          clips.map((c) =>
            selectedClipIds.has(c.id)
              ? { ...c, startTime: c.startTime + step }
              : c,
          ),
        );
      } else if (e.code === "KeyJ") {
        e.preventDefault();
        if (videoRef.current) {
          videoRef.current.playbackRate = -1; // not supported in most browsers; fallback: just rewind
          videoRef.current.pause();
          seekToTime(Math.max(0, timelineTime - 0.5));
        }
      } else if (e.code === "KeyK") {
        e.preventDefault();
        handlePlay();
      } else if (e.code === "KeyL") {
        e.preventDefault();
        if (playbackMode !== "timeline" || !isPlaying) handlePlay();
      } else if (e.code === "Comma") {
        e.preventDefault();
        // frame back (~33ms = 30fps)
        seekToTime(Math.max(0, timelineTime - 0.033));
      } else if (e.code === "Period") {
        e.preventDefault();
        seekToTime(timelineTime + 0.033);
      } else if (e.code === "Home") {
        e.preventDefault();
        seekToTime(0);
      } else if (e.code === "End") {
        e.preventDefault();
        seekToTime(totalEnd);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        seekToTime(Math.max(0, timelineTime - (e.shiftKey ? 1 : 0.1)));
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        seekToTime(timelineTime + (e.shiftKey ? 1 : 0.1));
      }
    };
    const onKeyUp = (e) => {
      if (e.code === "Space") {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    activeClipId,
    activeSourceSelection,
    clips,
    commitClips,
    duplicateClip,
    editorFocus,
    handlePlay,
    isPlaying,
    isSourceMonitorActive,
    playbackMode,
    previewTime,
    redo,
    saveCurrentProject,
    seekSourcePreviewTo,
    seekToTime,
    selectedClipIds,
    selectedGap,
    selectedKeyframe,
    snapEnabled,
    splitAtPlayhead,
    timelineTime,
    totalEnd,
    undo,
    createHistorySnapshot,
    pushHistory,
    applyRippleInsert,
    closeGap,
    detectInsertPoint,
    expandWithLinkedPartners,
    focusSource,
    getClipPropertyTrack,
    nextId,
    removeKeyframe,
    resolveOverlaps,
    rippleDeleteClips,
    setActiveClipId,
    setClipPropertyTrack,
    setClips,
    setProjectStatus,
    setSelectedClipIds,
    setSelectedGap,
    setSelectedKeyframe,
    setSnapEnabled,
    stepSourcePreviewTime,
    unlinkClipGroup,
    videoRef,
    clipboardRef,
  ]);
}
