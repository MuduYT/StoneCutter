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
  scheduleInspectorHistoryCommit,
  dispatchEngineCommand,
  snapTimeToFrame,
  createGroupKeyframes,
  getClipPropertyTrack,
  addOrUpdateKeyframe,
  setClipPropertyTrack,
  projectFps,
}) {
  const toggleKeyframeAtPlayhead = useCallback(
    (clipId, propertyKey) => {
      const time = snapTimeToFrame(timelineTimeRef.current ?? 0);
      const clip = clips.find((c) => c.id === clipId);
      if (!clip) return;
      scheduleInspectorHistoryCommit();
      dispatchEngineCommand({
        type: "keyframe.toggle",
        payload: {
          clipId,
          propertyKey,
          time,
          value: clip[propertyKey],
        },
      });
    },
    [
      clips,
      dispatchEngineCommand,
      scheduleInspectorHistoryCommit,
      snapTimeToFrame,
      timelineTimeRef,
    ],
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
      const clip = clips.find((item) => item.id === clipId);
      const keyframeValue = (entryPropertyKey, entryKeyframeId) =>
        getClipPropertyTrack(clip, entryPropertyKey).find(
          (keyframe) => keyframe.id === entryKeyframeId,
        )?.value;
      const dragEntries =
        Array.isArray(entries) && entries.length > 0
          ? entries.map((entry) => {
              const entryKeyframeId = entry.id ?? entry.kfId;
              return {
                propertyKey: entry.propertyKey,
                kfId: entryKeyframeId,
                value: keyframeValue(entry.propertyKey, entryKeyframeId),
              };
            })
          : [
              {
                propertyKey,
                kfId,
                value: keyframeValue(propertyKey, kfId),
              },
            ];
      keyframeDragRef.current = {
        clipId,
        propertyKey,
        kfId,
        entries: dragEntries,
        startTime,
        startClientX: event.clientX,
        pxPerSec: dragPxPerSec || pxPerSec,
        historyBefore: createHistorySnapshot(),
        historyPushed: false,
        moved: false,
      };
      setSelectedKeyframe({ clipId, propertyKey, kfId });
    },
    [
      clips,
      createHistorySnapshot,
      getClipPropertyTrack,
      keyframeDragRef,
      pxPerSec,
      setSelectedKeyframe,
    ],
  );

  const beginVolumeKeyframeDrag = useCallback(
    (event, { clipId, kfId, pxPerSec: dragPxPerSec }) => {
      event.preventDefault();
      event.stopPropagation();
      const clipRect = event.currentTarget
        .closest(".clip")
        ?.getBoundingClientRect();
      if (!clipRect) return;
      const clip = clips.find((item) => item.id === clipId);
      if (!clip) return;
      const startValue = getClipPropertyTrack(clip, "volume").find(
        (keyframe) => keyframe.id === kfId,
      )?.value;
      keyframeDragRef.current = {
        type: "volume",
        clipId,
        propertyKey: "volume",
        kfId,
        clipStartTime: clip.startTime,
        value: startValue,
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
    [
      clips,
      createHistorySnapshot,
      getClipPropertyTrack,
      keyframeDragRef,
      pxPerSec,
      setSelectedKeyframe,
    ],
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
        const nextTime = snapTimeToFrame(
          (drag.clipStartTime ?? 0) + localX / Math.max(1, drag.pxPerSec),
          projectFps,
        );
        dispatchEngineCommand({
          type: "keyframe.move",
          payload: {
            clipId: drag.clipId,
            property: "volume",
            keyframeId: drag.kfId,
            time: nextTime,
            value: nextValue,
          },
        });
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
      for (const entry of drag.entries || []) {
        if (!entry.propertyKey || !entry.kfId) continue;
        dispatchEngineCommand({
          type: "keyframe.move",
          payload: {
            clipId: drag.clipId,
            property: entry.propertyKey,
            keyframeId: entry.kfId,
            time: nextTime,
            value: entry.value,
          },
        });
      }
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
    dispatchEngineCommand,
    keyframeDragRef,
    projectFps,
    pushHistory,
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
