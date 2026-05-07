import { useCallback, useEffect, useRef } from "react";
import { applyCommand, createInitialEngineState } from "../lib/engine/applyCommand.js";

const toSelectionArray = (selectedClipIds) => {
  if (selectedClipIds instanceof Set) return [...selectedClipIds];
  if (Array.isArray(selectedClipIds)) return [...selectedClipIds];
  return [];
};

const toSelectionSet = (selectionClipIds) => new Set(selectionClipIds || []);

const resolveActiveClipId = (nextClips, preferredActiveClipId, fallbackPrimaryClipId) => {
  const hasPreferred = preferredActiveClipId
    ? nextClips.some((clip) => clip.id === preferredActiveClipId)
    : false;
  if (hasPreferred) return preferredActiveClipId;
  const hasPrimary = fallbackPrimaryClipId
    ? nextClips.some((clip) => clip.id === fallbackPrimaryClipId)
    : false;
  if (hasPrimary) return fallbackPrimaryClipId;
  return null;
};

const normalizeCommandForAdapter = (command) => {
  if (command?.type === "keyframe.toggle") {
    const payload = command.payload || {};
    if (!payload.property || payload.propertyKey) return command;
    return {
      ...command,
      payload: {
        ...payload,
        propertyKey: payload.property,
      },
    };
  }
  if (command?.type === "keyframe.move") {
    const payload = command.payload || {};
    if ((!payload.property || payload.propertyKey) && (payload.newTime != null || payload.time == null)) {
      return command;
    }
    return {
      ...command,
      payload: {
        ...payload,
        propertyKey: payload.propertyKey ?? payload.property,
        newTime: payload.newTime ?? payload.time,
      },
    };
  }
  if (command?.type === "clip.split") {
    const payload = command.payload || {};
    if (payload.timelineTime != null || payload.time == null) return command;
    return {
      ...command,
      payload: {
        ...payload,
        timelineTime: payload.time,
      },
    };
  }
  if (command?.type === "clip.add") {
    const payload = command.payload || {};
    if (!payload.clip || payload.clips) return command;
    return {
      ...command,
      payload: {
        ...payload,
        clips: [payload.clip],
      },
    };
  }
  if (command?.type !== "clip.updateProps") return command;
  const payload = command.payload || {};
  if (!payload.patch || payload.props) return command;
  return {
    ...command,
    payload: {
      ...payload,
      props: payload.patch,
    },
  };
};

const applyKeyframeMoveValue = (clips, payload = {}) => {
  const value = Number(payload.value);
  const propertyKey = payload.propertyKey ?? payload.property;
  if (
    !Number.isFinite(value) ||
    !payload.clipId ||
    !propertyKey ||
    !payload.keyframeId
  ) {
    return clips;
  }

  let changed = false;
  const nextClips = clips.map((clip) => {
    if (clip.id !== payload.clipId) return clip;
    const keyframes = clip.keyframes || {};
    const track = keyframes[propertyKey];
    if (!Array.isArray(track)) return clip;

    let clipChanged = false;
    const nextTrack = track.map((keyframe) => {
      if (keyframe.id !== payload.keyframeId) return keyframe;
      clipChanged = true;
      return { ...keyframe, value };
    });
    if (!clipChanged) return clip;

    changed = true;
    return {
      ...clip,
      keyframes: {
        ...keyframes,
        [propertyKey]: nextTrack,
      },
    };
  });

  return changed ? nextClips : clips;
};

export function useEngineBridge({
  clips,
  tracks,
  timelineTime,
  selectedClipIds,
  activeClipId,
  setClips,
  setTracks,
  setTimelineTime,
  setSelectedClipIds,
  setActiveClipId,
  timelineTimeRef,
}) {
  const latestRef = useRef({
    clips,
    tracks,
    timelineTime,
    selectedClipIds,
    activeClipId,
  });

  useEffect(() => {
    latestRef.current = {
      clips,
      tracks,
      timelineTime,
      selectedClipIds,
      activeClipId,
    };
  }, [activeClipId, clips, selectedClipIds, timelineTime, tracks]);

  const dispatchEngineCommand = useCallback(
    (command, stateOverride = {}) => {
      const {
        clips: currentClips,
        tracks: currentTracks,
        timelineTime: currentTimelineTime,
        selectedClipIds: currentSelectedClipIds,
        activeClipId: currentActiveClipId,
      } = latestRef.current;
      const baseClips = stateOverride.clips ?? currentClips;
      const baseTracks = stateOverride.tracks ?? currentTracks;
      const baseTimelineTime = stateOverride.timelineTime ?? currentTimelineTime;
      const baseSelectedClipIds =
        stateOverride.selectedClipIds ?? currentSelectedClipIds;
      const baseActiveClipId =
        stateOverride.activeClipId ?? currentActiveClipId;
      const selectionClipIds = toSelectionArray(baseSelectedClipIds);
      const currentPlayhead = Number.isFinite(timelineTimeRef?.current)
        ? timelineTimeRef.current
        : baseTimelineTime;
      const engineState = createInitialEngineState({
        fps: 30,
        playhead: currentPlayhead,
        tracks: baseTracks,
        clips: baseClips,
      });

      // Keep history outside the adapter while useHistory remains source of truth.
      engineState.history = { past: [], future: [] };
      engineState.selection = {
        clipIds: selectionClipIds,
        primaryClipId: baseActiveClipId ?? selectionClipIds[0] ?? null,
      };

      const adapterCommand = normalizeCommandForAdapter(command);
      let result = applyCommand(engineState, adapterCommand);
      let nextState = result?.state;
      if (!nextState?.timeline) return result;

      let nextClips = nextState.timeline.clips || [];
      const hasValidationError = result?.events?.some(
        (event) => event.type === "validation.error",
      );
      if (adapterCommand?.type === "keyframe.move" && !hasValidationError) {
        const movedClips = applyKeyframeMoveValue(
          nextClips,
          adapterCommand.payload,
        );
        if (movedClips !== nextClips) {
          nextClips = movedClips;
          nextState = {
            ...nextState,
            timeline: {
              ...nextState.timeline,
              clips: nextClips,
            },
          };
          result = { ...result, state: nextState };
        }
      }

      const nextTracks = nextState.timeline.tracks || [];
      const nextPlayhead = Number.isFinite(nextState.timeline.playhead)
        ? Math.max(0, nextState.timeline.playhead)
        : currentPlayhead;
      const nextSelectionArray = nextState.selection?.clipIds || [];
      const nextPrimary = nextState.selection?.primaryClipId ?? null;
      const nextActiveClipId = resolveActiveClipId(
        nextClips,
        baseActiveClipId,
        nextPrimary,
      );

      latestRef.current = {
        clips: nextClips,
        tracks: nextTracks,
        timelineTime: nextPlayhead,
        selectedClipIds: nextSelectionArray,
        activeClipId: nextActiveClipId,
      };

      if (timelineTimeRef) timelineTimeRef.current = nextPlayhead;

      if (command?.type === "timeline.setPlayhead") {
        setTimelineTime(nextPlayhead);
        return result;
      }

      setClips(nextClips);
      setTracks(nextTracks);
      setTimelineTime(nextPlayhead);
      setSelectedClipIds(toSelectionSet(nextSelectionArray));
      setActiveClipId(nextActiveClipId);

      return result;
    },
    [
      setActiveClipId,
      setClips,
      setSelectedClipIds,
      setTimelineTime,
      setTracks,
      timelineTimeRef,
    ],
  );

  return { dispatchEngineCommand };
}

