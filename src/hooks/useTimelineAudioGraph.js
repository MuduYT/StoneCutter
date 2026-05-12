import { useCallback, useEffect, useRef } from "react";

/**
 * useTimelineAudioGraph — Web Audio API graph for per-track and per-clip gain.
 *
 * Architecture:
 *   <audio> -> MediaElementSource -> ClipGainNode -> TrackGainNode -> AnalyserNode -> MasterGainNode -> Destination
 *
 * This allows:
 *   - Track gain > 1.0 (HTMLMediaElement.volume is capped at 1)
 *   - Per-clip fade envelopes without affecting other clips on the same track
 *   - Centralised mute via the master gain node
 *   - Real peak metering per track via AnalyserNode
 */
export function useTimelineAudioGraph({ tracks, masterVolume = 1, masterMuted = false }) {
  const ctxRef = useRef(null);
  const masterGainRef = useRef(null);
  const trackGainsRef = useRef(new Map()); // trackId -> GainNode
  const trackAnalysersRef = useRef(new Map()); // trackId -> AnalyserNode
  const clipGainsRef = useRef(new Map()); // clipId -> { sourceNode, clipNode, trackId }
  const clipStateRef = useRef(new Map()); // clipId -> { intendedGain: number, muted: boolean }
  const trackNodesConnectedRef = useRef(new Set()); // trackId -> whether connected to master

  const ensureCtx = useCallback(() => {
    if (!ctxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctxRef.current = new AC();
      masterGainRef.current = ctxRef.current.createGain();
      masterGainRef.current.connect(ctxRef.current.destination);
    }
    if (ctxRef.current.state === "suspended") {
      ctxRef.current.resume().catch(() => {});
    }
    return ctxRef.current;
  }, []);

  const getTrackNodes = useCallback(
    (trackId) => {
      const ctx = ensureCtx();
      if (!ctx) return null;

      let gainNode = trackGainsRef.current.get(trackId);
      let analyser = trackAnalysersRef.current.get(trackId);

      const gainNodeWasNull = !gainNode;
      const analyserWasNull = !analyser;

      if (!gainNode) {
        gainNode = ctx.createGain();
        gainNode.gain.value = 1;
        trackGainsRef.current.set(trackId, gainNode);
      }

      if (!analyser) {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.3;
        trackAnalysersRef.current.set(trackId, analyser);
      }

      // Ensure wiring: TrackGain -> Analyser -> MasterGain
      // Always connect gainNode->analyser (idempotent, safe)
      // Only connect analyser->master once per track to avoid additive connections
      if (masterGainRef.current) {
        gainNode.connect(analyser);
        if (!trackNodesConnectedRef.current.has(trackId)) {
          analyser.connect(masterGainRef.current);
          trackNodesConnectedRef.current.add(trackId);
        }
      }

      return { gainNode, analyser };
    },
    [ensureCtx],
  );

  const applyClipGain = useCallback((clipId) => {
    const entry = clipGainsRef.current.get(clipId);
    const state = clipStateRef.current.get(clipId);
    if (!entry?.clipNode || !state) return;
    const effective = state.muted ? 0 : Math.max(0, state.intendedGain);
    entry.clipNode.gain.value = effective;
  }, []);

  const connectAudioElement = useCallback(
    (clipId, audioElement, trackId) => {
      const ctx = ensureCtx();
      if (!ctx) return;

      const existing = clipGainsRef.current.get(clipId);
      // Reuse existing connection if same element and track
      if (existing && existing.trackId === trackId && existing.audioElement === audioElement) {
        return;
      }

      // Disconnect existing connection if element or track changed
      if (existing) {
        try {
          existing.sourceNode.disconnect();
          existing.clipNode.disconnect();
        } catch {
          /* ignore */
        }
        clipGainsRef.current.delete(clipId);
      }

      try {
        const sourceNode = ctx.createMediaElementSource(audioElement);
        const clipNode = ctx.createGain();
        clipNode.gain.value = 1;

        const trackNodes = getTrackNodes(trackId);
        if (!trackNodes) return;

        sourceNode.connect(clipNode);
        clipNode.connect(trackNodes.gainNode);

        clipGainsRef.current.set(clipId, { sourceNode, clipNode, trackId, audioElement });
        if (!clipStateRef.current.has(clipId)) {
          clipStateRef.current.set(clipId, { intendedGain: 1, muted: false });
        }
      } catch (err) {
        // createMediaElementSource throws if the element is already connected.
        // In that case the audio will still play through the browser's default
        // path (volume capped at 1) — acceptable fallback.
        console.warn("[useTimelineAudioGraph] connect failed:", err?.message || err);
      }
    },
    [ensureCtx, getTrackNodes],
  );

  const disconnectAudioElement = useCallback((clipId) => {
    const entry = clipGainsRef.current.get(clipId);
    if (!entry) return;
    try {
      entry.sourceNode.disconnect();
      entry.clipNode.disconnect();
    } catch {
      /* ignore already-disconnected nodes */
    }
    clipGainsRef.current.delete(clipId);
    clipStateRef.current.delete(clipId);
  }, []);

  const setClipGain = useCallback(
    (clipId, gain) => {
      const state = clipStateRef.current.get(clipId);
      if (state) {
        state.intendedGain = gain;
      } else {
        clipStateRef.current.set(clipId, { intendedGain: gain, muted: false });
      }
      applyClipGain(clipId);
    },
    [applyClipGain],
  );

  const setClipMuted = useCallback(
    (clipId, muted) => {
      const state = clipStateRef.current.get(clipId);
      if (state) {
        state.muted = muted;
      } else {
        clipStateRef.current.set(clipId, { intendedGain: 1, muted });
      }
      applyClipGain(clipId);
    },
    [applyClipGain],
  );

  const setTrackGain = useCallback((trackId, gain) => {
    const node = trackGainsRef.current.get(trackId);
    if (node) node.gain.value = Math.max(0, gain);
  }, []);

  const getTrackPeak = useCallback((trackId) => {
    const analyser = trackAnalysersRef.current.get(trackId);
    if (!analyser) return 0;

    const buffer = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buffer);

    let peak = 0;
    for (let i = 0; i < buffer.length; i++) {
      const abs = Math.abs(buffer[i]);
      if (abs > peak) peak = abs;
    }
    return peak;
  }, []);

  // Update master gain whenever volume or mute changes
  useEffect(() => {
    if (masterGainRef.current) {
      masterGainRef.current.gain.value = masterMuted ? 0 : Math.max(0, masterVolume);
    }
  }, [masterVolume, masterMuted]);

  // Clean up stale track nodes when tracks are removed
  useEffect(() => {
    const activeTrackIds = new Set((tracks || []).map((t) => t.id));
    for (const [trackId, node] of trackGainsRef.current.entries()) {
      if (!activeTrackIds.has(trackId)) {
        try {
          node.disconnect();
        } catch {
          /* ignore */
        }
        trackGainsRef.current.delete(trackId);
        trackNodesConnectedRef.current.delete(trackId);
      }
    }
    for (const [trackId, node] of trackAnalysersRef.current.entries()) {
      if (!activeTrackIds.has(trackId)) {
        try {
          node.disconnect();
        } catch {
          /* ignore */
        }
        trackAnalysersRef.current.delete(trackId);
      }
    }
  }, [tracks]);

  // Cleanup everything on unmount
  useEffect(() => {
    const clipGains = clipGainsRef.current;
    const clipStates = clipStateRef.current;
    const trackGains = trackGainsRef.current;
    const trackAnalysers = trackAnalysersRef.current;
    const trackNodesConnected = trackNodesConnectedRef.current;
    return () => {
      for (const entry of clipGains.values()) {
        try {
          entry.sourceNode.disconnect();
          entry.clipNode.disconnect();
        } catch {
          /* ignore */
        }
      }
      clipGains.clear();
      clipStates.clear();
      for (const node of trackGains.values()) {
        try {
          node.disconnect();
        } catch {
          /* ignore */
        }
      }
      trackGains.clear();
      for (const node of trackAnalysers.values()) {
        try {
          node.disconnect();
        } catch {
          /* ignore */
        }
      }
      trackAnalysers.clear();
      trackNodesConnected.clear();
      if (masterGainRef.current) {
        try {
          masterGainRef.current.disconnect();
        } catch {
          /* ignore */
        }
      }
      if (ctxRef.current) {
        ctxRef.current.close().catch(() => {});
      }
    };
  }, []);

  return {
    connectAudioElement,
    disconnectAudioElement,
    setClipGain,
    setClipMuted,
    setTrackGain,
    getTrackPeak,
  };
}
