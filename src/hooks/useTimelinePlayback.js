import { useEffect, useRef, useCallback, useState } from "react";
import {
  buildTimelinePlaybackLookups,
  findClipAtTime,
  getTopVisibleTimelineClip,
  getTimelineAudibleClips,
  getTimelineContentEnd,
  getTimelineVisualClips,
  getVirtualTimelinePlaybackTime,
  shouldStartNextClipFromGap,
  shouldLeaveClipPlayback,
  getClipPlaybackPosition,
  getImagePlaybackTimelineTime,
} from "../lib/playback.js";
import { MIN_CLIP_DURATION, clipEnd } from "../lib/timeline.js";

export const TIMELINE_MEDIA_SEEK_GRACE_MS = 50;
export const TIMELINE_MEDIA_SEEK_TIMEOUT_MS = 350;
export const TIMELINE_STATE_FPS = 60;
export const TIMELINE_LAYER_BOUNDARY_EPSILON = 0.015;
export const TIMELINE_PLAYING_VIDEO_DRIFT_TOLERANCE = 0.22;
export const TIMELINE_PLAYING_AUDIO_DRIFT_TOLERANCE = 0.05;
export const TIMELINE_PAUSED_DRIFT_TOLERANCE = 0.02;

export const useTimelinePlayback = ({
  clips,
  tracks,
  videos,
  videoRef,
  timelineVisualRefs,
  timelineAudioRefs,
  volume,
  muted,
  isPlaying,
  playbackMode,
  setPlaybackMode,
  setIsPlaying,
  setTimelineTime,
  setActiveId,
  setEditorFocus,
  setSourceMonitorId,
  FOCUS_TIMELINE,
  FOCUS_SOURCE,
}) => {
  const timelineTimeRef = useRef(0);
  const timelinePlaybackRef = useRef(null);
  const imagePlaybackRef = useRef(null);
  const pendingSeekRef = useRef(null);
  const pendingPlayRef = useRef(false);
  const timelinePlaybackStartTokenRef = useRef(0);
  const playbackModeRef = useRef(null);
  const timelineSeekGraceUntilRef = useRef(0);
  const timelineLastStateUpdateRef = useRef(0);
  const timelineMediaSeekPromisesRef = useRef(new Map());
  const activeTimelineLayersRef = useRef({
    key: "",
    visualLayers: [],
    audioLayers: [],
    nextBoundary: Number.MAX_SAFE_INTEGER,
  });
  const playbackRef = useRef(null);
  const playingClipIdRef = useRef(null);

  const getTimelineClipSourceTime = useCallback((clip, time) => {
    const offset = Math.max(0, time - clip.startTime);
    return Math.max(
      clip.inPoint,
      Math.min(clip.outPoint, clip.inPoint + offset),
    );
  }, []);

  const waitForTimelineMediaSeek = useCallback((node, sourceTime) => {
    if (!node || !Number.isFinite(sourceTime)) return Promise.resolve();
    const currentTime = Number.isFinite(node.currentTime)
      ? node.currentTime
      : 0;
    if (Math.abs(currentTime - sourceTime) <= 0.01 && !node.seeking) {
      return Promise.resolve();
    }
    const existing = timelineMediaSeekPromisesRef.current.get(node);
    if (existing) return existing;
    timelineSeekGraceUntilRef.current = Math.max(
      timelineSeekGraceUntilRef.current,
      performance.now() + TIMELINE_MEDIA_SEEK_GRACE_MS,
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
      timeoutId = window.setTimeout(finish, TIMELINE_MEDIA_SEEK_TIMEOUT_MS);
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
  }, []);

  const pauseTimelinePreviewMedia = useCallback(() => {
    timelineVisualRefs.current.forEach((node) => {
      if (node && !node.paused) node.pause();
    });
    timelineAudioRefs.current.forEach((node) => {
      if (node && !node.paused) node.pause();
    });
  }, [timelineVisualRefs, timelineAudioRefs]);

  const timelinePlaybackLookups = useMemo(
    () => buildTimelinePlaybackLookups({ tracks, videos }),
    [tracks, videos],
  );

  const timelineVisualLayers = useMemo(
    () =>
      getTimelineVisualClips({
        time: timelineTimeRef.current,
        clips,
        lookups: timelinePlaybackLookups,
      }),
    [clips, timelinePlaybackLookups],
  );

  const timelineAudioLayers = useMemo(
    () =>
      getTimelineAudibleClips({
        time: timelineTimeRef.current,
        clips,
        lookups: timelinePlaybackLookups,
      }),
    [clips, timelinePlaybackLookups],
  );

  const totalEnd = useMemo(
    () => getTimelineContentEnd(clips),
    [clips],
  );

  const topTimelineClip = useMemo(
    () =>
      getTopVisibleTimelineClip({
        time: timelineTimeRef.current,
        clips,
        tracks,
        videos,
        lookups: timelinePlaybackLookups,
      }),
    [clips, tracks, videos, timelinePlaybackLookups],
  );

  const getNextTimelineLayerBoundary = useCallback((time, clipList = clips) => {
    let boundary = Number.MAX_SAFE_INTEGER;
    for (const clip of clipList) {
      const end = clip.startTime + (clip.outPoint - clip.inPoint);
      if (clip.startTime > time + TIMELINE_LAYER_BOUNDARY_EPSILON) {
        boundary = Math.min(boundary, clip.startTime);
      }
      if (end > time + TIMELINE_LAYER_BOUNDARY_EPSILON) {
        boundary = Math.min(boundary, end);
      }
    }
    return Number.isFinite(boundary) ? boundary : Number.MAX_SAFE_INTEGER;
  }, [clips]);

  const updateTimelinePlayheadPosition = useCallback((time) => {
    const x = Math.max(0, time) * 60; // pxPerSec default
    // Would need pxPerSec from parent
  }, []);

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
      timelinePlaybackLookups,
      volume,
      waitForTimelineMediaSeek,
    ],
  );

  const startTimelinePlayback = useCallback(async (startAtTime, target = null) => {
    if (videoRef.current && !videoRef.current.paused) videoRef.current.pause();
    const startToken = timelinePlaybackStartTokenRef.current + 1;
    timelinePlaybackStartTokenRef.current = startToken;
    setPlaybackMode("timeline");
    setEditorFocus(FOCUS_TIMELINE);
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
    setTimelineTime(timelineStart);
    await primeTimelinePlayback(timelineStart);
    if (timelinePlaybackStartTokenRef.current !== startToken) return;
    timelineSeekGraceUntilRef.current = Math.max(
      timelineSeekGraceUntilRef.current,
      performance.now() + TIMELINE_MEDIA_SEEK_GRACE_MS,
    );
    timelinePlaybackRef.current = {
      startedAtMs: performance.now(),
      timelineStart,
    };
    setIsPlaying(true);
  }, [primeTimelinePlayback, updateTimelinePlayheadPosition, setActiveId, setEditorFocus, setPlaybackMode, setSourceMonitorId, setIsPlaying, setTimelineTime, videoRef, FOCUS_TIMELINE]);

  const stopPlayback = useCallback(() => {
    timelinePlaybackStartTokenRef.current += 1;
    playbackModeRef.current = null;
    const videoEl = videoRef.current;
    if (videoEl && !videoEl.paused) videoEl.pause();
    pauseTimelinePreviewMedia();
    imagePlaybackRef.current = null;
    timelinePlaybackRef.current = null;
    pendingPlayRef.current = false;
    setTimelineTime(timelineTimeRef.current);
    setPlaybackMode(null);
    setIsPlaying(false);
  }, [pauseTimelinePreviewMedia, setPlaybackMode, setIsPlaying, setTimelineTime, videoRef]);

  // rAF loop for smooth playback
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
      const state = playbackRef.current;
      const nowMs = performance.now();
      const timelineState = getVirtualTimelinePlaybackTime({
        timelinePlayback: timelinePlaybackRef.current,
        nowMs,
        fallbackTimelineTime: timelineTimeRef.current,
      });
      const nextTime = timelineState.timelineTime;
      timelineTimeRef.current = nextTime;
      updateTimelinePlayheadPosition(nextTime);
      setTimelineTime(nextTime);
      const shouldSyncState =
        nowMs - timelineLastStateUpdateRef.current >= 1000 / TIMELINE_STATE_FPS;
      const shouldCheckLayers =
        shouldSyncState ||
        nextTime >=
          activeTimelineLayersRef.current.nextBoundary -
            TIMELINE_LAYER_BOUNDARY_EPSILON;
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
        visualLayers.at(-1)?.clip || (audioLayers.length > 0 ? audioLayers[0]?.clip : null) || null;
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
    getNextTimelineLayerBoundary,
    isPlaying,
    playbackMode,
    timelinePlaybackLookups,
    updateTimelinePlayheadPosition,
    setTimelineTime,
  ]);

  // Keep playbackRef synced
  useEffect(() => {
    playbackRef.current = {
      clips,
      activeClipId: null,
      activeId: null,
      isPlaying,
      videos,
      timelineTime: timelineTimeRef.current,
    };
  }, [clips, isPlaying, videos]);

  // Sync media elements with timeline state
  useEffect(() => {
    const shouldPlay = isPlaying && playbackMode === "timeline";
    for (const { clip } of timelineVisualLayers) {
      const node = timelineVisualRefs.current.get(clip.id);
      if (!node) continue;
      const sourceTime = getTimelineClipSourceTime(clip, timelineTimeRef.current);
      const drift = Math.abs((node.currentTime || 0) - sourceTime);
      node.muted = true;
      node.volume = 0;
      if (drift > (shouldPlay ? 0.05 : 0.02)) {
        try {
          node.currentTime = sourceTime;
        } catch {
          /* ignored */
        }
      }
      if (shouldPlay) {
        node.play().catch(() => {});
      } else if (!node.paused) {
        node.pause();
      }
    }

    for (const { clip } of timelineAudioLayers) {
      const node = timelineAudioRefs.current.get(clip.id);
      if (!node) continue;
      const sourceTime = getTimelineClipSourceTime(clip, timelineTimeRef.current);
      const drift = Math.abs((node.currentTime || 0) - sourceTime);
      const driftTolerance = shouldPlay
        ? TIMELINE_PLAYING_AUDIO_DRIFT_TOLERANCE
        : TIMELINE_PAUSED_DRIFT_TOLERANCE;
      const clipVolume = clip.volume ?? 1;
      const clipDurAudio = clip.outPoint - clip.inPoint;
      const fadeInAudio = clip.fadeIn ?? 0;
      const fadeOutAudio = clip.fadeOut ?? 0;
      const timeInClipAudio = Math.max(0, timelineTimeRef.current - clip.startTime);
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
        waitForTimelineMediaSeek(node, sourceTime).then(() => {
          if (
            playbackModeRef.current === "timeline" &&
            playbackRef.current.isPlaying &&
            !node.muted
          ) {
            node.play().catch((err) => console.error('Timeline audio play error after seek:', err));
          }
        });
        continue;
      }
      if (
        shouldPlay &&
        !node.muted &&
        !node.seeking &&
        performance.now() >= timelineSeekGraceUntilRef.current
      ) {
        node.play().catch((err) => console.error('Timeline audio play error:', err));
      } else if (!node.paused) {
        node.pause();
      }
    }
  }, [
    getTimelineClipSourceTime,
    isPlaying,
    muted,
    pauseTimelinePreviewMedia,
    playbackMode,
    timelineAudioLayers,
    timelineVisualLayers,
    volume,
    waitForTimelineMediaSeek,
  ]);

  return {
    timelineTime: timelineTimeRef.current,
    timelineVisualLayers,
    timelineAudioLayers,
    totalEnd,
    topTimelineClip,
    startTimelinePlayback,
    stopPlayback,
    playingClipId: playingClipIdRef.current,
  };
};
