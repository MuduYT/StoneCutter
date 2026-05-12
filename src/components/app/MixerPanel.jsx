import { useEffect, useMemo, useRef, useState } from "react";

const formatGain = (gain) => Number(gain ?? 1).toFixed(2);

export function MixerPanel({
  tracks,
  clips = [],
  timelineTime = 0,
  volume,
  muted,
  onUpdateTrack,
  onSetVolume,
  onSetMuted,
  getAudioNode,
  getTrackPeak,
  Icon,
}) {
  const audioTracks = useMemo(
    () => (tracks || []).filter((track) => track.type === "audio"),
    [tracks],
  );
  const audioClipsByTrack = useMemo(() => {
    const map = new Map();
    for (const clip of clips || []) {
      if (!clip?.trackId) continue;
      if (!map.has(clip.trackId)) map.set(clip.trackId, []);
      map.get(clip.trackId).push(clip);
    }
    return map;
  }, [clips]);
  const [levels, setLevels] = useState({});
  const levelsRef = useRef({});
  const timelineTimeRef = useRef(timelineTime);

  useEffect(() => {
    timelineTimeRef.current = timelineTime;
  }, [timelineTime]);

  useEffect(() => {
    let raf = 0;
    let lastSampleAt = 0;
    const tick = (now) => {
      if (now - lastSampleAt >= 50) {
        lastSampleAt = now;
        const nextLevels = {};
        for (const track of audioTracks) {
          const rawPeak = getTrackPeak?.(track.id) ?? 0;
          const previous = levelsRef.current[track.id] || 0;
          nextLevels[track.id] = rawPeak > previous ? rawPeak : previous * 0.92;
        }
        levelsRef.current = nextLevels;
        setLevels(nextLevels);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [audioClipsByTrack, audioTracks, getAudioNode, getTrackPeak]);

  const renderMeter = (level) => (
    <div className="mixer-meter" aria-hidden="true">
      <div className="mixer-meter-zones" />
      <div
        className="mixer-meter-fill"
        style={{ height: `${Math.max(0, Math.min(1, level || 0)) * 100}%` }}
      />
    </div>
  );

  return (
    <div className="mixer-panel">
      <div className="mixer-strip mixer-master-strip">
        <div className="mixer-track-name" title="Master">
          Master
        </div>
        <button
          type="button"
          className={`mixer-btn ${muted ? "active" : ""}`}
          onClick={() => onSetMuted?.(!muted)}
          title={muted ? "Master stumm aus" : "Master stumm"}
        >
          {Icon?.Mute ? <Icon.Mute /> : "M"}
        </button>
        {renderMeter(muted ? 0 : volume)}
        <input
          className="mixer-fader"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={muted ? 0 : volume}
          onChange={(event) => {
            const next = Number(event.target.value);
            onSetVolume?.(next);
            if (next > 0) onSetMuted?.(false);
          }}
          aria-label="Master Volume"
        />
        <div className="mixer-readout">{muted ? "0.00" : formatGain(volume)}</div>
      </div>

      {audioTracks.length === 0 ? (
        <div className="mixer-empty">Keine Audio-Spuren</div>
      ) : (
        audioTracks.map((track) => {
          const gain = track.gain ?? 1;
          return (
            <div key={track.id} className="mixer-strip">
              <div className="mixer-track-name" title={track.name}>
                {track.name}
              </div>
              <div className="mixer-button-row">
                <button
                  type="button"
                  className={`mixer-btn ${track.muted ? "active" : ""}`}
                  onClick={() => onUpdateTrack?.(track.id, { muted: !track.muted })}
                  title={track.muted ? "Stumm aus" : "Stumm"}
                >
                  M
                </button>
                <button
                  type="button"
                  className={`mixer-btn ${track.solo ? "active" : ""}`}
                  onClick={() => onUpdateTrack?.(track.id, { solo: !track.solo })}
                  title={track.solo ? "Solo aus" : "Solo"}
                >
                  S
                </button>
                <button
                  type="button"
                  className={`mixer-btn ${track.locked ? "active" : ""}`}
                  onClick={() => onUpdateTrack?.(track.id, { locked: !track.locked })}
                  title={track.locked ? "Entsperren" : "Sperren"}
                >
                  {Icon?.Lock ? <Icon.Lock /> : "L"}
                </button>
              </div>
              {renderMeter(levels[track.id] || 0)}
              <input
                className="mixer-fader"
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={gain}
                onChange={(event) =>
                  onUpdateTrack?.(track.id, { gain: Number(event.target.value) })
                }
                aria-label={`${track.name} Gain`}
              />
              <div className="mixer-readout">{formatGain(gain)}</div>
            </div>
          );
        })
      )}
    </div>
  );
}
