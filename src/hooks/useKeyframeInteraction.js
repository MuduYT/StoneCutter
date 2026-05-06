import { useCallback, useEffect } from "react";

export function useKeyframeInteraction({
  clips,
  pxPerSec,
  timelineTimeRef,
  seekToTime,
  setClips,
  setActiveClipId,
  setSelectedKeyframe,
  keyframeDragRef,
  createHistorySnapshot,
  pushHistory,
  updateInspectorClip,
  snapTimeToFrame,
  toggleClipKeyframeAt,
  createGroupKeyframes,
  getClipPropertyTrack,
  addOrUpdateKeyframe,
  setClipPropertyTrack,
  moveKeyframe,
  projectFps,
}) {
  const toggleKeyframeAtPlayhead = useCallback(
    (clipId, propertyKey) => {
      const time = snapTimeToFrame(timelineTimeRef.current ?? 0);
      const clip = clips.find((c) => c.id === clipId);
      if (!clip) return;
      const nextMap = toggleClipKeyframeAt({ clip, propertyKey, time });
      updateInspectorClip(clipId, { keyframes: nextMap });
    },
    [clips, snapTimeToFrame, timelineTimeRef, toggleClipKeyframeAt, updateInspectorClip],
  );

  const toggleGroupKeyframeAtPlayhead = useCallback(
    (clipId, groupId) => {
      const time = snapTimeToFrame(timelineTimeRef.current ?? 0);
      const clip = clips.find((c) => c.id === clipId);
      if (!clip) return;
      const nextMap = createGroupKeyframes({ clip, groupId, time });
      updateInspectorClip(clipId, { keyframes: nextMap });
    },
    [clips, createGroupKeyframes, snapTimeToFrame, timelineTimeRef, updateInspectorClip],
  );

  const selectKeyframeAndSeek = useCallback(
    (clipId, propertyKey, kfId, time) => {
      setSelectedKeyframe({ clipId, propertyKey, kfId });
      setActiveClipId(clipId);
      seekToTime(snapTimeToFrame(time));
    },
    [seekToTime, setActiveClipId, setSelectedKeyframe, snapTimeToFrame],
  );

  const beginKeyframeDrag = useCallback(
    (
      event,
      { clipId, propertyKey, kfId, entries, startTime, pxPerSec: dragPxPerSec },
    ) => {
      event.preventDefault();
      event.stopPropagation();
      keyframeDragRef.current = {
        clipId,
        propertyKey,
        kfId,
        entries:
          Array.isArray(entries) && entries.length > 0
            ? entries.map((entry) => ({
                propertyKey: entry.propertyKey,
                kfId: entry.id,
              }))
            : [{ propertyKey, kfId }],
        startTime,
        startClientX: event.clientX,
        pxPerSec: dragPxPerSec || pxPerSec,
        historyBefore: createHistorySnapshot(),
        historyPushed: false,
        moved: false,
      };
      setSelectedKeyframe({ clipId, propertyKey, kfId });
    },
    [createHistorySnapshot, keyframeDragRef, pxPerSec, setSelectedKeyframe],
  );

  const beginVolumeKeyframeDrag = useCallback(
    (event, { clipId, kfId, pxPerSec: dragPxPerSec }) => {
      event.preventDefault();
      event.stopPropagation();
      const clipRect = event.currentTarget
        .closest(".clip")
        ?.getBoundingClientRect();
      if (!clipRect) return;
      keyframeDragRef.current = {
        type: "volume",
        clipId,
        propertyKey: "volume",
        kfId,
        clipLeft: clipRect.left,
        clipTop: clipRect.top,
        clipHeight: Math.max(1, clipRect.height),
        pxPerSec: dragPxPerSec || pxPerSec,
        historyBefore: createHistorySnapshot(),
        historyPushed: false,
        moved: false,
      };
      setSelectedKeyframe({ clipId, propertyKey: "volume", kfId });
    },
    [createHistorySnapshot, keyframeDragRef, pxPerSec, setSelectedKeyframe],
  );

  const addVolumeKeyframeFromCurve = useCallback(
    (event, clip) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      const localX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      const localY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      const time = snapTimeToFrame(
        clip.startTime + localX / pxPerSec,
        projectFps,
      );
      const value = Math.max(0, Math.min(2, (1 - localY / rect.height) * 2));
      const track = getClipPropertyTrack(clip, "volume");
      const nextTrack = addOrUpdateKeyframe(track, { time, value });
      const nextMap = setClipPropertyTrack(clip, "volume", nextTrack);
      const nextKf = nextTrack.find(
        (kf) => Math.abs(kf.time - time) < 1 / projectFps,
      );
      pushHistory(createHistorySnapshot());
      setClips((prev) =>
        prev.map((item) =>
          item.id === clip.id ? { ...item, keyframes: nextMap } : item,
        ),
      );
      if (nextKf) {
        setSelectedKeyframe({
          clipId: clip.id,
          propertyKey: "volume",
          kfId: nextKf.id,
        });
      }
    },
    [
      addOrUpdateKeyframe,
      createHistorySnapshot,
      getClipPropertyTrack,
      projectFps,
      pushHistory,
      pxPerSec,
      setClipPropertyTrack,
      setClips,
      setSelectedKeyframe,
      snapTimeToFrame,
    ],
  );

  useEffect(() => {
    const onMove = (event) => {
      const drag = keyframeDragRef.current;
      if (!drag) return;
      if (drag.type === "volume") {
        const localX = Math.max(0, event.clientX - drag.clipLeft);
        const localY = Math.max(
          0,
          Math.min(drag.clipHeight, event.clientY - drag.clipTop),
        );
        if (
          !drag.moved &&
          Math.abs(event.movementX) + Math.abs(event.movementY) < 1
        ) {
          return;
        }
        drag.moved = true;
        const nextValue = Math.max(
          0,
          Math.min(2, (1 - localY / drag.clipHeight) * 2),
        );
        if (!drag.historyPushed) {
          pushHistory(drag.historyBefore);
          drag.historyPushed = true;
        }
        setClips((prev) =>
          prev.map((clip) => {
            if (clip.id !== drag.clipId) return clip;
            const nextTime = snapTimeToFrame(
              clip.startTime + localX / Math.max(1, drag.pxPerSec),
              projectFps,
            );
            const track = getClipPropertyTrack(clip, "volume");
            const movedTrack = moveKeyframe(track, drag.kfId, nextTime);
            const nextTrack = movedTrack.map((kf) =>
              kf.id === drag.kfId ? { ...kf, value: nextValue } : kf,
            );
            return {
              ...clip,
              keyframes: setClipPropertyTrack(clip, "volume", nextTrack),
            };
          }),
        );
        return;
      }
      const dx = event.clientX - drag.startClientX;
      if (!drag.moved && Math.abs(dx) < 2) return;
      drag.moved = true;
      const deltaSec = dx / Math.max(1, drag.pxPerSec);
      const nextTime = snapTimeToFrame(
        Math.max(0, drag.startTime + deltaSec),
        projectFps,
      );
      if (!drag.historyPushed) {
        pushHistory(drag.historyBefore);
        drag.historyPushed = true;
      }
      setClips((prev) =>
        prev.map((clip) => {
          if (clip.id !== drag.clipId) return clip;
          let nextClip = clip;
          for (const entry of drag.entries || []) {
            if (!entry.propertyKey || !entry.kfId) continue;
            const track = getClipPropertyTrack(nextClip, entry.propertyKey);
            const nextTrack = moveKeyframe(track, entry.kfId, nextTime);
            nextClip = {
              ...nextClip,
              keyframes: setClipPropertyTrack(
                nextClip,
                entry.propertyKey,
                nextTrack,
              ),
            };
          }
          return nextClip;
        }),
      );
    };
    const onUp = () => {
      keyframeDragRef.current = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [
    getClipPropertyTrack,
    keyframeDragRef,
    moveKeyframe,
    projectFps,
    pushHistory,
    setClipPropertyTrack,
    setClips,
    snapTimeToFrame,
  ]);

  return {
    toggleKeyframeAtPlayhead,
    toggleGroupKeyframeAtPlayhead,
    selectKeyframeAndSeek,
    beginKeyframeDrag,
    beginVolumeKeyframeDrag,
    addVolumeKeyframeFromCurve,
  };
}
