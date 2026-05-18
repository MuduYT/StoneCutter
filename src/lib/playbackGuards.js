/**
 * Pure guards for timeline playback race conditions (seek callbacks, scrub drag, pause).
 */

/** After seek→play() resolves: only start media if epoch and mode still match. */
export const shouldPlayTimelineMediaAfterSeek = ({
  seekEpochAtStart,
  currentSeekEpoch,
  playbackMode,
  isPlaybackRefPlaying,
  interactionType,
}) =>
  currentSeekEpoch === seekEpochAtStart &&
  playbackMode === "timeline" &&
  isPlaybackRefPlaying &&
  interactionType !== "seek";

/** Immediate play() during timeline sync (not inside seek callback). */
export const shouldPlayTimelineMediaNow = ({
  shouldPlay,
  playbackMode,
  isPlaybackRefPlaying,
  timelineSeekDragActive,
  isMediaSeeking,
  graceUntilMs,
  nowMs = performance.now(),
}) =>
  shouldPlay &&
  playbackMode === "timeline" &&
  isPlaybackRefPlaying &&
  !timelineSeekDragActive &&
  !isMediaSeeking &&
  nowMs >= graceUntilMs;

/** RAF playhead tick: skip advancement while user scrubs the playhead. */
export const shouldSkipTimelinePlayheadTick = ({ interactionType }) =>
  interactionType === "seek";

/** Timeline transport considers playback active (toggle pause). */
export const isTimelineTransportPlaying = ({
  playbackMode,
  isPlaying,
  isPlaybackRefPlaying,
  hasTimelinePlaybackClock,
}) =>
  playbackMode === "timeline" &&
  (isPlaying || isPlaybackRefPlaying || hasTimelinePlaybackClock);
