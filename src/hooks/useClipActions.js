import { useCallback } from "react";
import {
  MIN_CLIP_DURATION,
  duplicateClipsAfterSelection,
  resolveOverlaps,
  expandWithLinkedPartners,
  unlinkClipGroup,
  linkClipGroup,
} from "../lib/timeline.js";
import { nextId } from "../lib/utils.js";

export function useClipActions({
  clips,
  snapEnabled,
  timelineTime,
  selectedClipIds,
  activeClipId,
  commitClips,
  createHistorySnapshot,
  pushHistory,
  dispatchEngineCommand,
  setActiveClipId,
  setSelectedClipIds,
  setContextMenu,
  setProjectStatus,
}) {
  const duplicateClip = useCallback(
    (clipId) => {
      const targetIds =
        selectedClipIds.size > 0 && (!clipId || selectedClipIds.has(clipId))
          ? selectedClipIds
          : new Set([clipId]);
      const { duplicatedClips, duplicatedClipIds, idMap } =
        duplicateClipsAfterSelection({
          clips,
          clipIds: targetIds,
          makeId: () => nextId("clip"),
        });
      if (duplicatedClips.length === 0) return;
      pushHistory(createHistorySnapshot());
      dispatchEngineCommand({
        type: "clip.add",
        payload: { clips: duplicatedClips, ripple: false },
      });
      const nextSelection = new Set(duplicatedClipIds);
      setSelectedClipIds(nextSelection);
      setActiveClipId(idMap.get(clipId) || duplicatedClipIds[0] || null);
    },
    [
      clips,
      createHistorySnapshot,
      dispatchEngineCommand,
      pushHistory,
      selectedClipIds,
      setActiveClipId,
      setSelectedClipIds,
    ],
  );

  const restoreTrim = useCallback(
    (clipId) => {
      const clip = clips.find((c) => c.id === clipId);
      if (!clip) return;
      const others = clips.filter((c) => c.id !== clipId);
      const fullStart = clip.startTime - clip.inPoint;
      const proposedStart = Math.max(0, fullStart);
      const proposedEnd = fullStart + clip.sourceDuration;
      if (snapEnabled) {
        let leftLimit = 0;
        for (const o of others) {
          const oE = o.startTime + (o.outPoint - o.inPoint);
          if (oE <= clip.startTime + 1e-3 && oE > leftLimit) leftLimit = oE;
        }
        const oldRight = clip.startTime + (clip.outPoint - clip.inPoint);
        let rightLimit = Number.MAX_SAFE_INTEGER;
        for (const o of others) {
          if (o.startTime >= oldRight - 1e-3 && o.startTime < rightLimit)
            rightLimit = o.startTime;
        }
        const newStart = Math.max(proposedStart, leftLimit);
        const newEnd = Math.min(proposedEnd, rightLimit);
        if (newEnd - newStart < MIN_CLIP_DURATION) return;
        const newInPoint = newStart - fullStart;
        const newOutPoint = newEnd - fullStart;
        commitClips(
          clips.map((c) =>
            c.id === clipId
              ? {
                  ...c,
                  inPoint: newInPoint,
                  outPoint: newOutPoint,
                  startTime: newStart,
                }
              : c,
          ),
        );
      } else {
        const restored = clips.map((c) =>
          c.id === clipId
            ? {
                ...c,
                inPoint: 0,
                outPoint: c.sourceDuration,
                startTime: proposedStart,
              }
            : c,
        );
        commitClips(resolveOverlaps(restored, clipId, () => nextId("clip")));
      }
    },
    [clips, commitClips, snapEnabled],
  );

  const splitAtPlayhead = useCallback(() => {
    const candidates = clips.filter((c) => {
      const dur = c.outPoint - c.inPoint;
      return (
        timelineTime > c.startTime + MIN_CLIP_DURATION &&
        timelineTime < c.startTime + dur - MIN_CLIP_DURATION
      );
    });
    if (candidates.length === 0) return;

    const selectedCandidates = candidates.filter((c) => selectedClipIds.has(c.id));
    let splitTargets;
    if (selectedClipIds.size > 0) {
      splitTargets =
        selectedCandidates.length > 0
          ? selectedCandidates
          : [candidates.find((c) => c.id === activeClipId) || candidates[0]].filter(
              Boolean,
            );
    } else {
      splitTargets = [
        candidates.find((c) => c.id === activeClipId) || candidates[0],
      ].filter(Boolean);
    }

    let newClips = clips;
    const doneGroups = new Set();
    const allNewRightIds = [];
    let historyPushed = false;

    for (const target of splitTargets) {
      const linkedGroup = target.linkGroupId
        ? clips.filter((clip) => clip.linkGroupId === target.linkGroupId)
        : [];
      const selectedLinkedGroup = linkedGroup.filter((clip) =>
        selectedClipIds.has(clip.id),
      );
      const splitTogether =
        target.linkGroupId &&
        linkedGroup.length > 1 &&
        selectedLinkedGroup.length === linkedGroup.length;
      if (splitTogether && doneGroups.has(target.linkGroupId)) continue;
      if (splitTogether) doneGroups.add(target.linkGroupId);
      const before = newClips;
      const result = dispatchEngineCommand({
        type: "clip.split",
        payload: {
          clipId: target.id,
          time: timelineTime,
          linked: Boolean(splitTogether),
        },
      });
      const resultClips = result?.state?.timeline?.clips || before;
      const freshIds = resultClips
        .filter((c) => !before.some((p) => p.id === c.id))
        .map((c) => c.id);
      if (freshIds.length > 0) {
        if (!historyPushed) {
          pushHistory(createHistorySnapshot(clips));
          historyPushed = true;
        }
        newClips = resultClips;
        allNewRightIds.push(...freshIds);
      }
    }

    if (!historyPushed) return;

    if (allNewRightIds.length > 0) setActiveClipId(allNewRightIds[0]);
    const nextSel = new Set(selectedClipIds);
    if (nextSel.size > 0) {
      for (const id of allNewRightIds) nextSel.add(id);
      setSelectedClipIds(expandWithLinkedPartners(newClips, nextSel));
    }
  }, [
    activeClipId,
    clips,
    createHistorySnapshot,
    dispatchEngineCommand,
    pushHistory,
    selectedClipIds,
    setActiveClipId,
    setSelectedClipIds,
    timelineTime,
  ]);

  const handleContextMenuDuplicate = useCallback(
    (clipId) => {
      duplicateClip(clipId);
      setContextMenu(null);
    },
    [duplicateClip, setContextMenu],
  );

  const handleContextMenuDelete = useCallback(
    (clipId) => {
      pushHistory(createHistorySnapshot());
      dispatchEngineCommand({
        type: "clip.delete",
        payload: { clipIds: [clipId] },
      });
      setActiveClipId(null);
      setContextMenu(null);
    },
    [
      createHistorySnapshot,
      dispatchEngineCommand,
      pushHistory,
      setActiveClipId,
      setContextMenu,
    ],
  );

  const handleContextMenuUnlink = useCallback(
    (clipId) => {
      commitClips(unlinkClipGroup(clips, clipId));
      setContextMenu(null);
      setProjectStatus({ ok: true, msg: "Link aufgehoben." });
    },
    [clips, commitClips, setContextMenu, setProjectStatus],
  );

  const handleContextMenuLink = useCallback(
    (clipIds) => {
      const ids = clipIds instanceof Set ? clipIds : new Set(clipIds || []);
      if (ids.size < 2) return;
      commitClips(linkClipGroup(clips, ids));
      setContextMenu(null);
      setProjectStatus({ ok: true, msg: "Clips verkn\u00fcpft." });
    },
    [clips, commitClips, setContextMenu, setProjectStatus],
  );

  return {
    duplicateClip,
    restoreTrim,
    splitAtPlayhead,
    handleContextMenuDuplicate,
    handleContextMenuDelete,
    handleContextMenuUnlink,
    handleContextMenuLink,
  };
}
