import { useCallback, useEffect, useRef } from "react";
import {
  findClipAtTime,
  getTimelineAudibleClips,
  getTimelineContentEnd,
  getTimelineVisualClips,
  getVirtualTimelinePlaybackTime,
} from "../lib/playback.js";
import {
  isTimelineTransportPlaying,
  shouldPlayTimelineMediaAfterSeek,
  shouldPlayTimelineMediaNow,
  shouldSkipTimelinePlayheadTick,
} from "../lib/playbackGuards.js";
import { resolveAnimatedClip } from "../lib/keyframes.js";

const getConstantPowerFadeGain = (clip, time) => {
  const fadeIn = Math.max(0, clip.fadeIn ?? 0);
  const fadeOut = Math.max(0, clip.fadeOut ?? 0);
  const clipDuration = Math.max(0.001, clip.outPoint - clip.inPoint);
  const timeInClip = Math.max(0, time - clip.startTime);
  const timeToEnd = clipDuration - timeInClip;
  let gain = 1;

  if (fadeIn > 0 && timeInClip < fadeIn) {
    const progress = Math.max(0, Math.min(1, timeInClip / fadeIn));
    gain *= Math.sin((Math.PI / 2) * progress);
  }

  if (fadeOut > 0 && timeToEnd < fadeOut) {
    const progress = Math.max(0, Math.min(1, (fadeOut - timeToEnd) / fadeOut));
    gain *= Math.cos((Math.PI / 2) * progress);
  }

  return Math.max(0, Math.min(1, gain));
};

export function usePlaybackController({
  activeClipId,
  activeId,
  videos,
  clips,
  muted,
  volume,
  audioScrubbingEnabled = true,
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
  setTimelineAudioClipGain,
  setTimelineAudioClipMuted,
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
  const scrubAudioRef = useRef({
    isScrubbing: false,
    lastScrubTime: 0,
    lastPlayheadTime: Number.NEGATIVE_INFINITY,
    clipLastScrubTimes: new Map(),
    pauseTimers: new Map(),
  });

  const dispatchPlayheadCommand = useCallback(
    (time, options = {}) => {
      dispatchEngineCommand({
        type: "timeline.setPlayhead",
        payload: { time, force: options.force },
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

  const beginScrubAudio = useCallback(() => {
    scrubAudioRef.current.isScrubbing = true;
    scrubAudioRef.current.lastScrubTime = 0;
    scrubAudioRef.current.lastPlayheadTime = Number.NEGATIVE_INFINITY;
  }, []);

  const endScrubAudio = () => {
    scrubAudioRef.current.isScrubbing = false;
    scrubAudioRef.current.pauseTimers.forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    scrubAudioRef.current.pauseTimers.clear();
    timelineAudioRefs.current.forEach((node) => {
      if (node && !node.paused) node.pause();
    });
  };

  const triggerScrubAudio = useCallback(
    (timelineScrubTime) => {
      if (
        !audioScrubbingEnabled ||
        muted ||
        volume <= 0 ||
        isPlaying ||
        playbackModeRef.current === "timeline" ||
        playbackRef.current.isPlaying ||
        timelinePlaybackRef.current ||
        !scrubAudioRef.current.isScrubbing
      ) {
        return;
      }

      const time = Number(timelineScrubTime);
      if (!Number.isFinite(time)) return;
      if (Math.abs(time - scrubAudioRef.current.lastPlayheadTime) < 0.05) {
        return;
      }

      const nowMs = performance.now();
      const audioLayers = getTimelineAudibleClips({
        time,
        clips,
        lookups: timelinePlaybackLookups,
      });
      if (audioLayers.length === 0) return;

      scrubAudioRef.current.lastScrubTime = nowMs;
      scrubAudioRef.current.lastPlayheadTime = time;

      for (const { clip: rawClip, track } of audioLayers) {
        const clip = resolveAnimatedClip(rawClip, time);
        const node = timelineAudioRefs.current.get(clip.id);
        if (!node) continue;

        const lastClipScrubTime =
          scrubAudioRef.current.clipLastScrubTimes.get(clip.id) ??
          Number.NEGATIVE_INFINITY;
        if (nowMs - lastClipScrubTime < 150) continue;
        scrubAudioRef.current.clipLastScrubTimes.set(clip.id, nowMs);

        const sourceTime = getTimelineClipSourceTime(clip, time);
        const clipVolume = clip.volume ?? 1;
        const fadeGain = getConstantPowerFadeGain(clip, time);
        const trackGain = track?.gain ?? 1;
        const effectiveVolume = Math.max(
          0,
          Math.min(2, volume * clipVolume * fadeGain * trackGain),
        );
        setTimelineAudioClipGain(clip.id, effectiveVolume);
        const isMuted = muted || effectiveVolume <= 0 || !!clip.clipMuted;
        setTimelineAudioClipMuted(clip.id, isMuted);
        if (isMuted) continue;

        const existingTimer = scrubAudioRef.current.pauseTimers.get(clip.id);
        if (existingTimer) window.clearTimeout(existingTimer);

        try {
          node.currentTime = sourceTime;
          node
            .play()
            .catch(() => {
              // Scrub snippets are opportunistic; browser autoplay/seek races are harmless here.
            });
        } catch {
          continue;
        }

        const pauseTimer = window.setTimeout(() => {
          if (!node.paused) node.pause();
          if (scrubAudioRef.current.pauseTimers.get(clip.id) === pauseTimer) {
            scrubAudioRef.current.pauseTimers.delete(clip.id);
          }
        }, 80);
        scrubAudioRef.current.pauseTimers.set(clip.id, pauseTimer);
      }
    },
    [
      audioScrubbingEnabled,
      clips,
      getTimelineClipSourceTime,
      isPlaying,
      muted,
      playbackModeRef,
      playbackRef,
      timelineAudioRefs,
      setTimelineAudioClipGain,
      setTimelineAudioClipMuted,
      timelinePlaybackLookups,
      timelinePlaybackRef,
      volume,
    ],
  );

  const waitForTimelineMediaSeek = useCallback(
    (node, sourceTime) => {
      if (!node || !Number.isFinite(sourceTime)) return Promise.resolve();
      // node kann zwischenzeitlich entfernt werden – daher optional chain verwenden
      const currentTime = Number.isFinite(node?.currentTime) ? node.currentTime : 0;
      if (Math.abs(currentTime - sourceTime) <= 0.01 && !node.seeking) {
        return Promise.resolve();
      }
      const existing = timelineMediaSeekPromisesRef.current.get(node);
      if (existing) {
        if (Math.abs(existing.targetTime - sourceTime) > 1e-6) {
          // Different target time, mark old promise as cancelled and create new one
          existing.cancelled = true;
        } else {
          return existing.promise;
        }
      }
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
          const cached = timelineMediaSeekPromisesRef.current.get(node);
          if (cached?.cancelled) {
            // This promise was cancelled due to a newer seek, cleanup and resolve
            done = true;
            window.clearTimeout(timeoutId);
            if (node) node.removeEventListener("seeked", finish);
            resolve(); // Resolve to avoid pending promise
            return;
          }
          done = true;
          window.clearTimeout(timeoutId);
          if (node) node.removeEventListener("seeked", finish);
          resolve();
        };
        if (node) node.addEventListener("seeked", finish, { once: true });
        timeoutId = window.setTimeout(finish, timelineMediaSeekTimeoutMs);
        if (node) {
          try { node.currentTime = sourceTime; } catch { finish(); }
        } else {
          finish();
        }
        if (
          node &&
          !node.seeking &&
          Math.abs((node.currentTime || 0) - sourceTime) <= 0.01
        ) {
          window.setTimeout(finish, 0);
        }
      }).finally(() => {
        if (timelineMediaSeekPromisesRef.current.get(node)?.promise === promise) {
          timelineMediaSeekPromisesRef.current.delete(node);
        }
      });
      timelineMediaSeekPromisesRef.current.set(node, { promise, targetTime: sourceTime, cancelled: false });
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

      for (const { clip, track } of audioLayers) {
        const node = timelineAudioRefs.current.get(clip.id);
        if (!node) continue;
        const sourceTime = getTimelineClipSourceTime(clip, time);
        const clipVolume = clip.volume ?? 1;
        const fadeGain = getConstantPowerFadeGain(clip, time);
        const trackGain = track?.gain ?? 1;
        const effectiveVolume = Math.max(
          0,
          Math.min(2, volume * clipVolume * fadeGain * trackGain),
        );
        setTimelineAudioClipGain(clip.id, effectiveVolume);
        setTimelineAudioClipMuted(clip.id, muted || effectiveVolume <= 0 || !!clip.clipMuted);
        seekPromises.push(waitForTimelineMediaSeek(node, sourceTime));
      }
      await Promise.all(seekPromises);
    },
    [
      clips,
      getTimelineClipSourceTime,
      muted,
      timelineAudioRefs,
      setTimelineAudioClipGain,
      setTimelineAudioClipMuted,
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
      dispatchPlayheadCommand(timelineStart, { force: true });
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
    requestAnimationFrame(() => {
      pauseTimelinePreviewMedia();
    });
    imagePlaybackRef.current = null;
    timelinePlaybackRef.current = null;
    pendingPlayRef.current = false;
    playbackRef.current = {
      ...playbackRef.current,
      isPlaying: false,
      timelineTime: timelineTimeRef.current,
    };
    dispatchPlayheadCommand(timelineTimeRef.current, { force: true });
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
    const timelineIsPlaying = isTimelineTransportPlaying({
      playbackMode: playbackModeRef.current,
      isPlaying,
      isPlaybackRefPlaying: playbackRef.current.isPlaying,
      hasTimelinePlaybackClock: Boolean(timelinePlaybackRef.current),
    });
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
        if (node && !node.paused) node.pause();
      }
    });
    timelineAudioRefs.current.forEach((node, clipId) => {
      if (!activeAudioIds.has(clipId)) {
        if (node && !node.paused) node.pause();
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
          const ok = shouldPlayTimelineMediaAfterSeek({
            seekEpochAtStart: seekEpoch,
            currentSeekEpoch: timelineSeekPlayEpochRef.current,
            playbackMode: playbackModeRef.current,
            isPlaybackRefPlaying: playbackRef.current.isPlaying,
            interactionType: interactionRef.current?.type,
          });
          if (ok && node) {
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
        shouldPlayTimelineMediaNow({
          shouldPlay,
          playbackMode: playbackModeRef.current,
          isPlaybackRefPlaying: playbackRef.current.isPlaying,
          timelineSeekDragActive,
          isMediaSeeking: node.seeking,
          graceUntilMs: timelineSeekGraceUntilRef.current,
        })
      ) {
        node
          .play()
          .catch((err) => console.error("Timeline visual play error:", err));
      } else if (!node.paused && !scrubAudioRef.current.isScrubbing) {
        node.pause();
      }
    }

    for (const { clip: rawAudioClip, track } of timelineAudioLayers) {
      const clip = resolveAnimatedClip(rawAudioClip, timelineTime);
      const node = timelineAudioRefs.current.get(clip.id);
      if (!node) continue;
      const sourceTime = getTimelineClipSourceTime(clip, timelineTime);
      const drift = Math.abs((node.currentTime || 0) - sourceTime);
      const driftTolerance = shouldPlay
        ? timelinePlayingAudioDriftTolerance
        : timelinePausedDriftTolerance;
      const clipVolume = clip.volume ?? 1;
      const fadeGain = getConstantPowerFadeGain(clip, timelineTime);
      const trackGain = track?.gain ?? 1;
      const effectiveVolume = Math.max(
        0,
        Math.min(2, volume * clipVolume * fadeGain * trackGain),
      );
      setTimelineAudioClipGain(clip.id, effectiveVolume);
      const isMuted = muted || effectiveVolume <= 0 || !!clip.clipMuted;
      setTimelineAudioClipMuted(clip.id, isMuted);
      if (drift > driftTolerance) {
        const seekEpoch = timelineSeekPlayEpochRef.current;
        waitForTimelineMediaSeek(node, sourceTime).then(() => {
          const ok = shouldPlayTimelineMediaAfterSeek({
            seekEpochAtStart: seekEpoch,
            currentSeekEpoch: timelineSeekPlayEpochRef.current,
            playbackMode: playbackModeRef.current,
            isPlaybackRefPlaying: playbackRef.current.isPlaying,
            interactionType: interactionRef.current?.type,
          });
          if (ok && node && !isMuted) {
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
        shouldPlayTimelineMediaNow({
          shouldPlay,
          playbackMode: playbackModeRef.current,
          isPlaybackRefPlaying: playbackRef.current.isPlaying,
          timelineSeekDragActive,
          isMediaSeeking: node.seeking,
          graceUntilMs: timelineSeekGraceUntilRef.current,
        }) &&
        !isMuted
      ) {
        node
          .play()
          .catch((err) => console.error("Timeline audio play error:", err));
      } else if (!node.paused && !scrubAudioRef.current.isScrubbing) {
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
    setTimelineAudioClipGain,
    setTimelineAudioClipMuted,
    timelinePausedDriftTolerance,
    timelinePlayingAudioDriftTolerance,
    timelinePlayingVideoDriftTolerance,
    timelineSeekGraceUntilRef,
    timelineSeekPlayEpochRef,
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
      if (shouldSkipTimelinePlayheadTick({ interactionType: interactionRef.current?.type })) {
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
        dispatchPlayheadCommand(finalTime, { force: true });
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
        // Force sync on layer/clip changes to prevent black frames or audio glitches
        dispatchPlayheadCommand(nextTime, { force: shouldSyncLayers });
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
    beginScrubAudio,
    triggerScrubAudio,
    endScrubAudio,
  };
}
