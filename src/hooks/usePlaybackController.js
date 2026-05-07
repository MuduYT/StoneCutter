import { useCallback, useEffect } from "react";
import {
  findClipAtTime,
  getTimelineAudibleClips,
  getTimelineContentEnd,
  getTimelineVisualClips,
  getVirtualTimelinePlaybackTime,
} from "../lib/playback.js";
import { resolveAnimatedClip } from "../lib/keyframes.js";

export function usePlaybackController({
  activeClipId,
  activeId,
  videos,
  clips,
  muted,
  volume,
  timelinePlaybackLookups,
  isPlaying,
  timelineTime,
  topTimelineClip,
  playbackMode,
  isTimelineMonitorActive,
  timelineVisualLayers,
  timelineAudioLayers,
  getNextTimelineLayerBoundary,
  updateTimelinePlayheadPosition,
  setPlaybackMode,
  setEditorFocus,
  setSourceMonitorId,
  setActiveId,
  dispatchEngineCommand,
  setIsPlaying,
  videoRef,
  timelineVisualRefs,
  timelineAudioRefs,
  pendingSeekRef,
  pendingPlayRef,
  playbackRef,
  playbackModeRef,
  playingClipIdRef,
  imagePlaybackRef,
  timelinePlaybackRef,
  timelinePlaybackStartTokenRef,
  timelineSeekPlayEpochRef,
  sourcePauseLockUntilRef,
  timelineSeekGraceUntilRef,
  timelineMediaSeekPromisesRef,
  timelineTimeRef,
  activeTimelineLayersRef,
  timelineLastStateUpdateRef,
  interactionRef,
  /** Subscribed so the media-sync effect re-runs when scrub ends (ref updates do not re-render). */
  interaction,
  focusTimeline,
  sourcePlayLockMs,
  timelineMediaSeekGraceMs,
  timelineMediaSeekTimeoutMs,
  timelinePlayingVideoDriftTolerance,
  timelinePlayingAudioDriftTolerance,
  timelinePausedDriftTolerance,
  timelineStateFps,
  timelineLayerBoundaryEpsilon,
}) {
  const dispatchPlayheadCommand = useCallback(
    (time) => {
      dispatchEngineCommand({
        type: "timeline.setPlayhead",
        payload: { time },
      });
    },
    [dispatchEngineCommand],
  );

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const pauseTimelinePreviewMedia = useCallback(() => {
    timelineVisualRefs.current.forEach((node) => {
      if (node && !node.paused) node.pause();
    });
    timelineAudioRefs.current.forEach((node) => {
      if (node && !node.paused) node.pause();
    });
  }, [timelineAudioRefs, timelineVisualRefs]);

  const getTimelineClipSourceTime = useCallback((clip, time) => {
    const offset = Math.max(0, time - clip.startTime);
    return Math.max(
      clip.inPoint,
      Math.min(clip.outPoint, clip.inPoint + offset),
    );
  }, []);

  const waitForTimelineMediaSeek = useCallback(
    (node, sourceTime) => {
      if (!node || !Number.isFinite(sourceTime)) return Promise.resolve();
      const currentTime = Number.isFinite(node.currentTime) ? node.currentTime : 0;
      if (Math.abs(currentTime - sourceTime) <= 0.01 && !node.seeking) {
        return Promise.resolve();
      }
      const existing = timelineMediaSeekPromisesRef.current.get(node);
      if (existing) return existing;
      timelineSeekGraceUntilRef.current = Math.max(
        timelineSeekGraceUntilRef.current,
        performance.now() + timelineMediaSeekGraceMs,
      );
      let promise;
      promise = new Promise((resolve) => {
        let done = false;
        let timeoutId = 0;
        const finish = () => {
          if (done) return;
          done = true;
          window.clearTimeout(timeoutId);
          node.removeEventListener("seeked", finish);
          resolve();
        };
        node.addEventListener("seeked", finish, { once: true });
        timeoutId = window.setTimeout(finish, timelineMediaSeekTimeoutMs);
        try {
          node.currentTime = sourceTime;
        } catch {
          finish();
        }
        if (
          !node.seeking &&
          Math.abs((node.currentTime || 0) - sourceTime) <= 0.01
        ) {
          window.setTimeout(finish, 0);
        }
      }).finally(() => {
        if (timelineMediaSeekPromisesRef.current.get(node) === promise) {
          timelineMediaSeekPromisesRef.current.delete(node);
        }
      });
      timelineMediaSeekPromisesRef.current.set(node, promise);
      return promise;
    },
    [
      timelineMediaSeekPromisesRef,
      timelineMediaSeekTimeoutMs,
      timelineSeekGraceUntilRef,
      timelineMediaSeekGraceMs,
    ],
  );

  /* eslint-disable react-hooks/preserve-manual-memoization */
  const primeTimelinePlayback = useCallback(
    async (time) => {
      const visualLayers = getTimelineVisualClips({
        time,
        clips,
        lookups: timelinePlaybackLookups,
      });
      const audioLayers = getTimelineAudibleClips({
        time,
        clips,
        lookups: timelinePlaybackLookups,
      });
      const seekPromises = [];

      for (const { clip } of visualLayers) {
        const node = timelineVisualRefs.current.get(clip.id);
        if (!node) continue;
        const sourceTime = getTimelineClipSourceTime(clip, time);
        node.muted = true;
        node.volume = 0;
        seekPromises.push(waitForTimelineMediaSeek(node, sourceTime));
      }

      for (const { clip } of audioLayers) {
        const node = timelineAudioRefs.current.get(clip.id);
        if (!node) continue;
        const sourceTime = getTimelineClipSourceTime(clip, time);
        const clipVolume = clip.volume ?? 1;
        const clipDurAudio = clip.outPoint - clip.inPoint;
        const fadeInAudio = clip.fadeIn ?? 0;
        const fadeOutAudio = clip.fadeOut ?? 0;
        const timeInClipAudio = Math.max(0, time - clip.startTime);
        let fadeGain = 1;
        if (fadeInAudio > 0 && timeInClipAudio < fadeInAudio) {
          fadeGain = timeInClipAudio / fadeInAudio;
        }
        const timeToEndAudio = clipDurAudio - timeInClipAudio;
        if (fadeOutAudio > 0 && timeToEndAudio < fadeOutAudio) {
          fadeGain = Math.min(fadeGain, timeToEndAudio / fadeOutAudio);
        }
        const effectiveVolume = Math.max(
          0,
          Math.min(2, volume * clipVolume * fadeGain),
        );
        node.volume = Math.min(1, effectiveVolume);
        node.muted = muted || effectiveVolume <= 0 || !!clip.clipMuted;
        seekPromises.push(waitForTimelineMediaSeek(node, sourceTime));
      }
      await Promise.all(seekPromises);
    },
    [
      clips,
      getTimelineClipSourceTime,
      muted,
      timelineAudioRefs,
      timelinePlaybackLookups,
      timelineVisualRefs,
      volume,
      waitForTimelineMediaSeek,
    ],
  );
  /* eslint-enable react-hooks/preserve-manual-memoization */

  const startTimelinePlayback = useCallback(
    async (startAtTime, target = null) => {
      if (videoRef.current && !videoRef.current.paused) videoRef.current.pause();
      const startToken = timelinePlaybackStartTokenRef.current + 1;
      timelinePlaybackStartTokenRef.current = startToken;
      playbackModeRef.current = "timeline";
      playbackRef.current = {
        ...playbackRef.current,
        isPlaying: true,
        timelineTime: Math.max(0, startAtTime),
      };
      setPlaybackMode("timeline");
      setEditorFocus(focusTimeline);
      setSourceMonitorId(null);
      const timelineStart = Math.max(0, startAtTime);
      playingClipIdRef.current = target?.id || null;
      imagePlaybackRef.current = null;
      pendingSeekRef.current = null;
      pendingPlayRef.current = false;
      timelinePlaybackRef.current = null;
      if (target?.videoId) setActiveId(target.videoId);
      timelineTimeRef.current = timelineStart;
      updateTimelinePlayheadPosition(timelineStart);
      dispatchPlayheadCommand(timelineStart);
      await primeTimelinePlayback(timelineStart);
      if (timelinePlaybackStartTokenRef.current !== startToken) return;
      timelineSeekGraceUntilRef.current = Math.max(
        timelineSeekGraceUntilRef.current,
        performance.now() + timelineMediaSeekGraceMs,
      );
      timelinePlaybackRef.current = {
        startedAtMs: performance.now(),
        timelineStart,
      };
      playbackRef.current = {
        ...playbackRef.current,
        isPlaying: true,
        timelineTime: timelineStart,
      };
      setIsPlaying(true);
    },
    [
      focusTimeline,
      imagePlaybackRef,
      pendingPlayRef,
      pendingSeekRef,
      playbackModeRef,
      playbackRef,
      playingClipIdRef,
      primeTimelinePlayback,
      setActiveId,
      dispatchPlayheadCommand,
      setEditorFocus,
      setIsPlaying,
      setPlaybackMode,
      setSourceMonitorId,
      timelineMediaSeekGraceMs,
      timelinePlaybackRef,
      timelinePlaybackStartTokenRef,
      timelineSeekGraceUntilRef,
      timelineTimeRef,
      updateTimelinePlayheadPosition,
      videoRef,
    ],
  );

  const startClipPlayback = useCallback(
    (target, startAtTime) => {
      startTimelinePlayback(startAtTime, target);
    },
    [startTimelinePlayback],
  );

  const startTimelineGapPlayback = useCallback(
    (startAtTime) => {
      startTimelinePlayback(startAtTime, null);
    },
    [startTimelinePlayback],
  );

  const stopPlayback = useCallback(() => {
    sourcePauseLockUntilRef.current = performance.now() + sourcePlayLockMs;
    timelinePlaybackStartTokenRef.current += 1;
    timelineSeekPlayEpochRef.current += 1;
    playbackModeRef.current = null;
    const videoEl = videoRef.current;
    if (videoEl && !videoEl.paused) {
      videoEl.pause();
      requestAnimationFrame(() => {
        if (videoRef.current && !videoRef.current.paused) {
          videoRef.current.pause();
        }
      });
    }
    pauseTimelinePreviewMedia();
    imagePlaybackRef.current = null;
    timelinePlaybackRef.current = null;
    pendingPlayRef.current = false;
    playbackRef.current = {
      ...playbackRef.current,
      isPlaying: false,
      timelineTime: timelineTimeRef.current,
    };
    dispatchPlayheadCommand(timelineTimeRef.current);
    setPlaybackMode(null);
    setIsPlaying(false);
  }, [
    dispatchPlayheadCommand,
    imagePlaybackRef,
    pauseTimelinePreviewMedia,
    pendingPlayRef,
    playbackModeRef,
    playbackRef,
    setIsPlaying,
    setPlaybackMode,
    sourcePlayLockMs,
    sourcePauseLockUntilRef,
    timelinePlaybackRef,
    timelinePlaybackStartTokenRef,
    timelineSeekPlayEpochRef,
    timelineTimeRef,
    videoRef,
  ]);

  const handleTimelinePlay = useCallback(() => {
    setEditorFocus(focusTimeline);
    setSourceMonitorId(null);
    if (
      playingClipIdRef.current &&
      !clips.some((clip) => clip.id === playingClipIdRef.current)
    ) {
      playingClipIdRef.current = null;
      imagePlaybackRef.current = null;
      pendingPlayRef.current = false;
    }
    const timelineIsPlaying =
      playbackModeRef.current === "timeline" &&
      (isPlaying || playbackRef.current.isPlaying || timelinePlaybackRef.current);
    if (timelineIsPlaying) {
      stopPlayback();
      return;
    }

    if (clips.length === 0) {
      stopPlayback();
      return;
    }

    const target = topTimelineClip || findClipAtTime(timelineTime, clips);
    if (target) {
      startClipPlayback(target, timelineTime);
    } else {
      startTimelineGapPlayback(timelineTime);
    }
  }, [
    clips,
    focusTimeline,
    imagePlaybackRef,
    isPlaying,
    pendingPlayRef,
    playbackModeRef,
    playbackRef,
    playingClipIdRef,
    setEditorFocus,
    setSourceMonitorId,
    startClipPlayback,
    startTimelineGapPlayback,
    stopPlayback,
    timelinePlaybackRef,
    timelineTime,
    topTimelineClip,
  ]);

  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = muted;
      if (pendingSeekRef.current != null) {
        try {
          videoRef.current.currentTime = pendingSeekRef.current;
        } catch {
          /* ignored */
        }
        pendingSeekRef.current = null;
      }
      if (pendingPlayRef.current) {
        pendingPlayRef.current = false;
        videoRef.current
          .play()
          .catch((err) => console.error("Video play error:", err));
      }
    }
  }, [muted, pendingPlayRef, pendingSeekRef, videoRef, volume]);

  useEffect(() => {
    if (!isTimelineMonitorActive) {
      pauseTimelinePreviewMedia();
      return;
    }

    const shouldPlay = playbackMode === "timeline" && isPlaying;
    const timelineSeekDragActive = interaction?.type === "seek";
    const activeVisualIds = new Set(
      timelineVisualLayers.map(({ clip }) => clip.id),
    );
    const activeAudioIds = new Set(
      timelineAudioLayers.map(({ clip }) => clip.id),
    );

    timelineVisualRefs.current.forEach((node, clipId) => {
      if (!activeVisualIds.has(clipId)) {
        if (!node.paused) node.pause();
      }
    });
    timelineAudioRefs.current.forEach((node, clipId) => {
      if (!activeAudioIds.has(clipId)) {
        if (!node.paused) node.pause();
      }
    });

    for (const { clip } of timelineVisualLayers) {
      const node = timelineVisualRefs.current.get(clip.id);
      if (!node) continue;
      const sourceTime = getTimelineClipSourceTime(clip, timelineTime);
      const drift = Math.abs((node.currentTime || 0) - sourceTime);
      const driftTolerance = shouldPlay
        ? timelinePlayingVideoDriftTolerance
        : timelinePausedDriftTolerance;
      node.muted = true;
      node.volume = 0;
      if (drift > driftTolerance) {
        const seekEpoch = timelineSeekPlayEpochRef.current;
        waitForTimelineMediaSeek(node, sourceTime).then(() => {
          const epochOk =
            timelineSeekPlayEpochRef.current === seekEpoch;
          const ok =
            epochOk &&
            playbackModeRef.current === "timeline" &&
            playbackRef.current.isPlaying &&
            interactionRef.current?.type !== "seek";
          if (ok) {
            node
              .play()
              .catch((err) =>
                console.error("Timeline visual play error after seek:", err),
              );
          }
        });
        continue;
      }
      if (
        shouldPlay &&
        !timelineSeekDragActive &&
        !node.seeking &&
        performance.now() >= timelineSeekGraceUntilRef.current
      ) {
        node
          .play()
          .catch((err) => console.error("Timeline visual play error:", err));
      } else if (!node.paused) {
        node.pause();
      }
    }

    for (const { clip: rawAudioClip } of timelineAudioLayers) {
      const clip = resolveAnimatedClip(rawAudioClip, timelineTime);
      const node = timelineAudioRefs.current.get(clip.id);
      if (!node) continue;
      const sourceTime = getTimelineClipSourceTime(clip, timelineTime);
      const drift = Math.abs((node.currentTime || 0) - sourceTime);
      const driftTolerance = shouldPlay
        ? timelinePlayingAudioDriftTolerance
        : timelinePausedDriftTolerance;
      const clipVolume = clip.volume ?? 1;
      const clipDurAudio = clip.outPoint - clip.inPoint;
      const fadeInAudio = clip.fadeIn ?? 0;
      const fadeOutAudio = clip.fadeOut ?? 0;
      const timeInClipAudio = Math.max(0, timelineTime - clip.startTime);
      let fadeGain = 1;
      if (fadeInAudio > 0 && timeInClipAudio < fadeInAudio)
        fadeGain = timeInClipAudio / fadeInAudio;
      const timeToEndAudio = clipDurAudio - timeInClipAudio;
      if (fadeOutAudio > 0 && timeToEndAudio < fadeOutAudio)
        fadeGain = Math.min(fadeGain, timeToEndAudio / fadeOutAudio);
      const effectiveVolume = Math.max(
        0,
        Math.min(2, volume * clipVolume * fadeGain),
      );
      node.volume = Math.min(1, effectiveVolume);
      node.muted = muted || effectiveVolume <= 0 || !!clip.clipMuted;
      if (drift > driftTolerance) {
        const seekEpoch = timelineSeekPlayEpochRef.current;
        waitForTimelineMediaSeek(node, sourceTime).then(() => {
          const epochOk =
            timelineSeekPlayEpochRef.current === seekEpoch;
          const ok =
            epochOk &&
            playbackModeRef.current === "timeline" &&
            playbackRef.current.isPlaying &&
            !node.muted &&
            interactionRef.current?.type !== "seek";
          if (ok) {
            node
              .play()
              .catch((err) =>
                console.error("Timeline audio play error after seek:", err),
              );
          }
        });
        continue;
      }
      if (
        shouldPlay &&
        !timelineSeekDragActive &&
        !node.muted &&
        !node.seeking &&
        performance.now() >= timelineSeekGraceUntilRef.current
      ) {
        node
          .play()
          .catch((err) => console.error("Timeline audio play error:", err));
      } else if (!node.paused) {
        node.pause();
      }
    }
  }, [
    getTimelineClipSourceTime,
    interaction,
    isPlaying,
    isTimelineMonitorActive,
    muted,
    pauseTimelinePreviewMedia,
    playbackMode,
    playbackModeRef,
    playbackRef,
    interactionRef,
    timelineAudioLayers,
    timelineAudioRefs,
    timelinePausedDriftTolerance,
    timelinePlayingAudioDriftTolerance,
    timelinePlayingVideoDriftTolerance,
    timelineSeekGraceUntilRef,
    timelineTime,
    timelineVisualLayers,
    timelineVisualRefs,
    volume,
    waitForTimelineMediaSeek,
  ]);

  useEffect(() => {
    activeTimelineLayersRef.current = {
      key: [
        ...timelineVisualLayers.map(({ clip }) => `v:${clip.id}`),
        ...timelineAudioLayers.map(({ clip }) => `a:${clip.id}`),
      ].join("|"),
      visualLayers: timelineVisualLayers,
      audioLayers: timelineAudioLayers,
      nextBoundary: getNextTimelineLayerBoundary(timelineTime),
    };
  }, [
    activeTimelineLayersRef,
    getNextTimelineLayerBoundary,
    timelineAudioLayers,
    timelineTime,
    timelineVisualLayers,
  ]);

  useEffect(() => {
    playbackRef.current = {
      clips,
      activeClipId,
      activeId,
      isPlaying,
      videos,
      timelineTime,
    };
  }, [activeClipId, activeId, clips, isPlaying, playbackRef, timelineTime, videos]);

  useEffect(() => {
    if (!isPlaying || playbackMode !== "timeline") return;
    if (!timelinePlaybackRef.current) {
      timelinePlaybackRef.current = {
        startedAtMs: performance.now(),
        timelineStart: timelineTimeRef.current,
      };
    }
    let raf = 0;
    const tick = () => {
      if (playbackModeRef.current !== "timeline") return;
      const state = playbackRef.current;
      const nowMs = performance.now();
      if (interactionRef.current?.type === "seek") {
        raf = requestAnimationFrame(tick);
        return;
      }
      if (nowMs < timelineSeekGraceUntilRef.current) {
        if (timelinePlaybackRef.current) {
          timelinePlaybackRef.current = {
            startedAtMs: nowMs,
            timelineStart: timelineTimeRef.current,
          };
        }
        raf = requestAnimationFrame(tick);
        return;
      }
      const timelineState = getVirtualTimelinePlaybackTime({
        timelinePlayback: timelinePlaybackRef.current,
        nowMs,
        fallbackTimelineTime: timelineTimeRef.current,
      });
      const nextTime = timelineState.timelineTime;
      const contentEnd = getTimelineContentEnd(state.clips);
      if (contentEnd <= 0 || nextTime >= contentEnd) {
        const finalTime = Math.max(0, contentEnd);
        timelinePlaybackStartTokenRef.current += 1;
        timelineSeekPlayEpochRef.current += 1;
        playbackModeRef.current = null;
        playingClipIdRef.current = null;
        imagePlaybackRef.current = null;
        timelinePlaybackRef.current = null;
        pendingPlayRef.current = false;
        playbackRef.current = {
          ...playbackRef.current,
          isPlaying: false,
          timelineTime: finalTime,
        };
        pauseTimelinePreviewMedia();
        timelineTimeRef.current = finalTime;
        updateTimelinePlayheadPosition(finalTime);
        dispatchPlayheadCommand(finalTime);
        setPlaybackMode(null);
        setIsPlaying(false);
        return;
      }
      timelineTimeRef.current = nextTime;
      updateTimelinePlayheadPosition(nextTime);
      dispatchPlayheadCommand(nextTime);
      const shouldSyncState =
        nowMs - timelineLastStateUpdateRef.current >= 1000 / timelineStateFps;
      const shouldCheckLayers =
        shouldSyncState ||
        nextTime >=
          activeTimelineLayersRef.current.nextBoundary -
            timelineLayerBoundaryEpsilon;
      if (!shouldCheckLayers) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const visualLayers = getTimelineVisualClips({
        time: nextTime,
        clips: state.clips,
        lookups: timelinePlaybackLookups,
      });
      const audioLayers = getTimelineAudibleClips({
        time: nextTime,
        clips: state.clips,
        lookups: timelinePlaybackLookups,
      });
      const layerKey = [
        ...visualLayers.map(({ clip }) => `v:${clip.id}`),
        ...audioLayers.map(({ clip }) => `a:${clip.id}`),
      ].join("|");
      const shouldSyncLayers = layerKey !== activeTimelineLayersRef.current.key;
      const activePlaybackClip =
        visualLayers.at(-1)?.clip ||
        (audioLayers.length > 0 ? audioLayers[0]?.clip : null) ||
        null;
      playingClipIdRef.current = activePlaybackClip?.id || null;
      if (shouldSyncState) {
        timelineLastStateUpdateRef.current = nowMs;
      }
      if (shouldSyncState || shouldSyncLayers) {
        activeTimelineLayersRef.current = {
          key: layerKey,
          visualLayers,
          audioLayers,
          nextBoundary: getNextTimelineLayerBoundary(nextTime, state.clips),
        };
        dispatchPlayheadCommand(nextTime);
      } else {
        activeTimelineLayersRef.current = {
          ...activeTimelineLayersRef.current,
          nextBoundary: getNextTimelineLayerBoundary(nextTime, state.clips),
        };
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [
    activeTimelineLayersRef,
    dispatchPlayheadCommand,
    getNextTimelineLayerBoundary,
    imagePlaybackRef,
    interactionRef,
    isPlaying,
    pauseTimelinePreviewMedia,
    pendingPlayRef,
    playbackMode,
    playbackModeRef,
    playbackRef,
    playingClipIdRef,
    setIsPlaying,
    setPlaybackMode,
    timelineLayerBoundaryEpsilon,
    timelineLastStateUpdateRef,
    timelinePlaybackLookups,
    timelinePlaybackRef,
    timelinePlaybackStartTokenRef,
    timelineSeekPlayEpochRef,
    timelineSeekGraceUntilRef,
    timelineStateFps,
    timelineTimeRef,
    updateTimelinePlayheadPosition,
  ]);

  return {
    primeTimelinePlayback,
    handleTimelinePlay,
    handleLoadedMetadata,
    stopPlayback,
    startClipPlayback,
    startTimelineGapPlayback,
    pauseTimelinePreviewMedia,
  };
}
