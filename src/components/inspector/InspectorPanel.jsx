import {
  InspectorCollapsible,
  InspectorDragger,
} from "./InspectorControls.jsx";
import { KeyframeStopwatch } from "./KeyframeStopwatch.jsx";
import {
  getClipPropertyTrack,
  hasKeyframeAt,
  sampleClipProperty,
} from "../../lib/keyframes.js";

function InspectorPlaceholder({ inspectorTab }) {
  return (
    <div className="inspector-placeholder">
      <p className="inspector-placeholder-title">
        {inspectorTab === "effects" ? "Effects" : "History"}
      </p>
      <p className="inspector-placeholder-hint">
        Hier wird diese Funktion verfuegbar sein.
      </p>
    </div>
  );
}

function InspectorTabs({ inspectorTab, onTabChange }) {
  return (
    <div className="inspector-tabs">
      {["Inspector", "Effects", "History"].map((tab) => (
        <button
          key={tab}
          className={`inspector-tab ${inspectorTab === tab.toLowerCase() ? "active" : ""}`}
          onClick={() => onTabChange(tab.toLowerCase())}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

const KEYFRAMABLE_KEYS = new Set([
  "positionX",
  "positionY",
  "scale",
  "rotation",
  "opacity",
  "brightness",
  "contrast",
  "saturation",
  "temperature",
  "speed",
  "volume",
  "pan",
]);

const groupHasAnyKeyframe = (clip, groupKeys, time) => {
  if (!clip) return false;
  for (const key of groupKeys) {
    if (hasKeyframeAt(getClipPropertyTrack(clip, key), time)) return true;
  }
  return false;
};

export function InspectorPanel({
  activeClip,
  activeClipId,
  activeTrack,
  audClip,
  displayName,
  formatTC,
  inspectorTab,
  isLinked,
  onTabChange,
  onUpdateClip,
  onToggleKeyframe,
  onToggleGroupKeyframe,
  onJumpToKeyframeTime,
  selectedClipCount = 1,
  timelineTime = 0,
  tracksById,
  vidClip,
}) {
  if (!activeClipId) {
    return (
      <div className="inspector-panel">
        <InspectorTabs inspectorTab={inspectorTab} onTabChange={onTabChange} />
        {inspectorTab === "inspector" ? (
          <div className="inspector-empty">Kein Clip ausgewaehlt</div>
        ) : (
          <InspectorPlaceholder inspectorTab={inspectorTab} />
        )}
      </div>
    );
  }

  if (!activeClip) return null;

  const infoClip = vidClip || audClip;
  const infoTrack = infoClip ? tracksById.get(infoClip.trackId) : null;
  const infoDur = infoClip ? infoClip.outPoint - infoClip.inPoint : 0;
  const videoDuration = vidClip ? vidClip.outPoint - vidClip.inPoint : 0;
  const audioDuration = audClip ? audClip.outPoint - audClip.inPoint : 0;

  const isMulti = selectedClipCount > 1;
  const keyframesDisabled = false;

  // Sampled values for video clip (live-update as the playhead moves).
  const vidValue = (key) =>
    vidClip ? sampleClipProperty(vidClip, key, timelineTime) : undefined;

  // Sampled values for audio clip (live-update as the playhead moves).
  const audValue = (key) =>
    audClip ? sampleClipProperty(audClip, key, timelineTime) : undefined;

  const renderStopwatch = (clip, key) => {
    if (!clip || !KEYFRAMABLE_KEYS.has(key)) return null;
    const track = getClipPropertyTrack(clip, key);
    const active = hasKeyframeAt(track, timelineTime);
    return (
      <KeyframeStopwatch
        active={active}
        disabled={keyframesDisabled}
        onClick={() => onToggleKeyframe?.(clip.id, key)}
        title={
          keyframesDisabled
            ? "Keyframes deaktiviert (mehrere Clips ausgewaehlt)"
            : active
            ? "Keyframe entfernen"
            : "Keyframe an aktueller Position setzen"
        }
      />
    );
  };

  const renderGroupStopwatch = (clip, groupId, groupKeys) => {
    if (!clip) return null;
    const active = groupHasAnyKeyframe(clip, groupKeys, timelineTime);
    return (
      <KeyframeStopwatch
        active={active}
        disabled={keyframesDisabled}
        size="lg"
        onClick={() => onToggleGroupKeyframe?.(clip.id, groupId)}
        title={
          keyframesDisabled
            ? "Keyframes deaktiviert (mehrere Clips ausgewaehlt)"
            : "Gruppen-Keyframe (alle veraenderten Werte)"
        }
      />
    );
  };
  const renderResetButton = (title, onClick) => (
    <button
      type="button"
      className="insp-reset-mini"
      title={title}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick?.();
      }}
    >
      ↺
    </button>
  );
  const renderGroupActions = (clip, groupId, groupKeys, resetTitle, onReset) => (
    <>
      {renderGroupStopwatch(clip, groupId, groupKeys)}
      {renderResetButton(resetTitle, onReset)}
    </>
  );
  const collectKeyframeTimes = (...clipsToScan) => {
    const frames = new Map();
    for (const clip of clipsToScan) {
      if (!clip?.keyframes) continue;
      for (const track of Object.values(clip.keyframes)) {
        if (!Array.isArray(track)) continue;
        for (const kf of track) {
          const time = Number(kf?.time);
          if (!Number.isFinite(time)) continue;
          const frameKey = Math.round(time * 30);
          if (!frames.has(frameKey)) frames.set(frameKey, frameKey / 30);
        }
      }
    }
    return [...frames.values()].sort((a, b) => a - b);
  };
  const keyframeTimes = collectKeyframeTimes(vidClip, audClip);
  const jumpToKeyframe = (direction) => {
    if (!keyframeTimes.length) return;
    if (direction < 0) {
      const prev =
        [...keyframeTimes].reverse().find((time) => time < timelineTime - 1 / 120) ??
        keyframeTimes[keyframeTimes.length - 1];
      onJumpToKeyframeTime?.(prev);
      return;
    }
    const next =
      keyframeTimes.find((time) => time > timelineTime + 1 / 120) ??
      keyframeTimes[0];
    onJumpToKeyframeTime?.(next);
  };

  return (
    <div className="inspector-panel">
      <InspectorTabs inspectorTab={inspectorTab} onTabChange={onTabChange} />
      <div className="inspector-header">
        <div className="inspector-title">
          {vidClip ? "Video" : "Audio"}
          {isLinked && <span className="inspector-linked-badge">V+A</span>}
          {isMulti && (
            <span
              className="inspector-multi-badge"
              title={`${selectedClipCount} Clips ausgewaehlt`}
            >
              Multi
            </span>
          )}
        </div>
        <div className="inspector-kf-nav">
          <button
            type="button"
            className="insp-reset-mini"
            title="Vorheriger Keyframe"
            onClick={() => jumpToKeyframe(-1)}
            disabled={keyframeTimes.length === 0}
          >
            {"<"}
          </button>
          <button
            type="button"
            className="insp-reset-mini"
            title="Naechster Keyframe"
            onClick={() => jumpToKeyframe(1)}
            disabled={keyframeTimes.length === 0}
          >
            {">"}
          </button>
        </div>
        <div className="inspector-clip-name" title={displayName}>
          {displayName}
        </div>
      </div>
      <div className="inspector-body">
        {inspectorTab !== "inspector" ? (
          <InspectorPlaceholder inspectorTab={inspectorTab} />
        ) : (
          <>
            {vidClip && (
              <InspectorCollapsible
                title="Transform"
                icon
                headerSlot={renderGroupActions(
                  vidClip,
                  "transform",
                  ["positionX", "positionY", "scale", "rotation", "opacity"],
                  "Transform zuruecksetzen",
                  () =>
                    onUpdateClip(vidClip.id, {
                      positionX: 0,
                      positionY: 0,
                      scale: 100,
                      rotation: 0,
                      opacity: 100,
                    }),
                )}
              >
                <InspectorDragger
                  label="Pos X"
                  value={vidValue("positionX") ?? 0}
                  onChange={(value) =>
                    onUpdateClip(vidClip.id, { positionX: value })
                  }
                  step={1}
                  stopwatch={renderStopwatch(vidClip, "positionX")}
                  resetButton={renderResetButton("Pos X zuruecksetzen", () =>
                    onUpdateClip(vidClip.id, { positionX: 0 }),
                  )}
                />
                <InspectorDragger
                  label="Pos Y"
                  value={vidValue("positionY") ?? 0}
                  onChange={(value) =>
                    onUpdateClip(vidClip.id, { positionY: value })
                  }
                  step={1}
                  stopwatch={renderStopwatch(vidClip, "positionY")}
                  resetButton={renderResetButton("Pos Y zuruecksetzen", () =>
                    onUpdateClip(vidClip.id, { positionY: 0 }),
                  )}
                />
                <InspectorDragger
                  label="Scale"
                  value={vidValue("scale") ?? 100}
                  onChange={(value) => onUpdateClip(vidClip.id, { scale: value })}
                  step={1}
                  unit="%"
                  stopwatch={renderStopwatch(vidClip, "scale")}
                  resetButton={renderResetButton("Scale zuruecksetzen", () =>
                    onUpdateClip(vidClip.id, { scale: 100 }),
                  )}
                />
                <InspectorDragger
                  label="Rotation"
                  value={vidValue("rotation") ?? 0}
                  onChange={(value) =>
                    onUpdateClip(vidClip.id, { rotation: value })
                  }
                  step={1}
                  unit="deg"
                  stopwatch={renderStopwatch(vidClip, "rotation")}
                  resetButton={renderResetButton("Rotation zuruecksetzen", () =>
                    onUpdateClip(vidClip.id, { rotation: 0 }),
                  )}
                />
                <InspectorDragger
                  label="Opacity"
                  value={vidValue("opacity") ?? 100}
                  onChange={(value) =>
                    onUpdateClip(vidClip.id, { opacity: value })
                  }
                  min={0}
                  max={100}
                  step={1}
                  unit="%"
                  stopwatch={renderStopwatch(vidClip, "opacity")}
                  resetButton={renderResetButton("Opacity zuruecksetzen", () =>
                    onUpdateClip(vidClip.id, { opacity: 100 }),
                  )}
                />
                <div className="idf-row">
                  <span className="idf-label">Flip</span>
                  <div className="insp-flip-group">
                    <button
                      className={`insp-flip-btn ${vidClip.flipH ? "active" : ""}`}
                      onClick={() =>
                        onUpdateClip(vidClip.id, { flipH: !vidClip.flipH })
                      }
                      title="Horizontal spiegeln"
                    >
                      H
                    </button>
                    <button
                      className={`insp-flip-btn ${vidClip.flipV ? "active" : ""}`}
                      onClick={() =>
                        onUpdateClip(vidClip.id, { flipV: !vidClip.flipV })
                      }
                      title="Vertikal spiegeln"
                    >
                      V
                    </button>
                  </div>
                </div>
                <div className="inspector-divider" />
                <div className="inspector-section-subtitle">Video Fade</div>
                <InspectorDragger
                  label="Fade In"
                  value={vidClip.fadeIn ?? 0}
                  onChange={(value) =>
                    onUpdateClip(vidClip.id, {
                      fadeIn: Math.min(value, videoDuration * 0.95),
                    })
                  }
                  min={0}
                  max={Math.max(0.1, videoDuration)}
                  step={0.1}
                  unit="s"
                  decimals={1}
                />
                <InspectorDragger
                  label="Fade Out"
                  value={vidClip.fadeOut ?? 0}
                  onChange={(value) =>
                    onUpdateClip(vidClip.id, {
                      fadeOut: Math.min(value, videoDuration * 0.95),
                    })
                  }
                  min={0}
                  max={Math.max(0.1, videoDuration)}
                  step={0.1}
                  unit="s"
                  decimals={1}
                />
              </InspectorCollapsible>
            )}

            {vidClip && (
              <InspectorCollapsible
                title="Color"
                icon
                headerSlot={renderGroupActions(
                  vidClip,
                  "color",
                  ["brightness", "contrast", "saturation", "temperature"],
                  "Color zuruecksetzen",
                  () =>
                    onUpdateClip(vidClip.id, {
                      brightness: 0,
                      contrast: 0,
                      saturation: 0,
                      temperature: 0,
                    }),
                )}
              >
                <InspectorDragger
                  label="Brightness"
                  value={vidValue("brightness") ?? 0}
                  onChange={(value) =>
                    onUpdateClip(vidClip.id, { brightness: value })
                  }
                  min={-100}
                  max={100}
                  step={1}
                  stopwatch={renderStopwatch(vidClip, "brightness")}
                  resetButton={renderResetButton("Brightness zuruecksetzen", () =>
                    onUpdateClip(vidClip.id, { brightness: 0 }),
                  )}
                />
                <InspectorDragger
                  label="Contrast"
                  value={vidValue("contrast") ?? 0}
                  onChange={(value) =>
                    onUpdateClip(vidClip.id, { contrast: value })
                  }
                  min={-100}
                  max={100}
                  step={1}
                  stopwatch={renderStopwatch(vidClip, "contrast")}
                  resetButton={renderResetButton("Contrast zuruecksetzen", () =>
                    onUpdateClip(vidClip.id, { contrast: 0 }),
                  )}
                />
                <InspectorDragger
                  label="Saturation"
                  value={vidValue("saturation") ?? 0}
                  onChange={(value) =>
                    onUpdateClip(vidClip.id, { saturation: value })
                  }
                  min={-100}
                  max={100}
                  step={1}
                  stopwatch={renderStopwatch(vidClip, "saturation")}
                  resetButton={renderResetButton("Saturation zuruecksetzen", () =>
                    onUpdateClip(vidClip.id, { saturation: 0 }),
                  )}
                />
                <InspectorDragger
                  label="Temperature"
                  value={vidValue("temperature") ?? 0}
                  onChange={(value) =>
                    onUpdateClip(vidClip.id, { temperature: value })
                  }
                  min={-100}
                  max={100}
                  step={1}
                  stopwatch={renderStopwatch(vidClip, "temperature")}
                  resetButton={renderResetButton("Temperature zuruecksetzen", () =>
                    onUpdateClip(vidClip.id, { temperature: 0 }),
                  )}
                />
              </InspectorCollapsible>
            )}

            {vidClip && (
              <InspectorCollapsible
                title="Speed"
                icon
                headerSlot={renderGroupActions(
                  vidClip,
                  "speed",
                  ["speed"],
                  "Speed zuruecksetzen",
                  () => onUpdateClip(vidClip.id, { speed: 100 }),
                )}
              >
                <InspectorDragger
                  label="Speed"
                  value={vidValue("speed") ?? 100}
                  onChange={(value) => onUpdateClip(vidClip.id, { speed: value })}
                  min={10}
                  max={400}
                  step={1}
                  unit="%"
                  stopwatch={renderStopwatch(vidClip, "speed")}
                  resetButton={renderResetButton("Speed zuruecksetzen", () =>
                    onUpdateClip(vidClip.id, { speed: 100 }),
                  )}
                />
              </InspectorCollapsible>
            )}

            {audClip && (
              <InspectorCollapsible title="Audio" icon
                headerSlot={renderGroupActions(
                  audClip,
                  "audio",
                  ["volume", "pan"],
                  "Audio-Werte zuruecksetzen",
                  () => onUpdateClip(audClip.id, { volume: 1, pan: 0 }),
                )}
              >
                <InspectorDragger
                  label="Volume"
                  value={Math.round((audValue("volume") ?? audClip.volume ?? 1) * 100)}
                  onChange={(value) =>
                    onUpdateClip(audClip.id, { volume: value / 100 })
                  }
                  min={0}
                  max={200}
                  step={1}
                  unit="%"
                  stopwatch={renderStopwatch(audClip, "volume")}
                  resetButton={renderResetButton("Volume zuruecksetzen", () =>
                    onUpdateClip(audClip.id, { volume: 1 }),
                  )}
                />
                <InspectorDragger
                  label="Pan"
                  value={audValue("pan") ?? audClip.pan ?? 0}
                  onChange={(value) => onUpdateClip(audClip.id, { pan: value })}
                  min={-100}
                  max={100}
                  step={1}
                  stopwatch={renderStopwatch(audClip, "pan")}
                  resetButton={renderResetButton("Pan zuruecksetzen", () =>
                    onUpdateClip(audClip.id, { pan: 0 }),
                  )}
                />
                <div className="idf-row">
                  <span className="idf-label">Mute</span>
                  <button
                    className={`insp-toggle-btn ${audClip.clipMuted ? "active danger" : ""}`}
                    onClick={() =>
                      onUpdateClip(audClip.id, {
                        clipMuted: !audClip.clipMuted,
                      })
                    }
                    title={
                      audClip.clipMuted
                        ? "Stummschaltung aufheben"
                        : "Clip stummschalten"
                    }
                  >
                    {audClip.clipMuted ? "Muted" : "Unmuted"}
                  </button>
                </div>
                <div className="inspector-divider" />
                <div className="inspector-section-subtitle">Audio Fade</div>
                <InspectorDragger
                  label="Fade In"
                  value={audClip.fadeIn ?? 0}
                  onChange={(value) =>
                    onUpdateClip(audClip.id, {
                      fadeIn: Math.min(value, audioDuration * 0.95),
                    })
                  }
                  min={0}
                  max={Math.max(0.1, audioDuration)}
                  step={0.1}
                  unit="s"
                  decimals={1}
                />
                <InspectorDragger
                  label="Fade Out"
                  value={audClip.fadeOut ?? 0}
                  onChange={(value) =>
                    onUpdateClip(audClip.id, {
                      fadeOut: Math.min(value, audioDuration * 0.95),
                    })
                  }
                  min={0}
                  max={Math.max(0.1, audioDuration)}
                  step={0.1}
                  unit="s"
                  decimals={1}
                />
              </InspectorCollapsible>
            )}

            {infoClip && (
              <InspectorCollapsible title="Clip Info" icon defaultOpen={false}>
                <div className="insp-info-row">
                  <span>Name</span>
                  <span title={infoClip.name}>{infoClip.name}</span>
                </div>
                <div className="insp-info-row">
                  <span>Type</span>
                  <span>{infoTrack?.type ?? activeTrack?.type ?? "-"}</span>
                </div>
                <div className="insp-info-row">
                  <span>Start</span>
                  <span>{formatTC(infoClip.startTime)}</span>
                </div>
                <div className="insp-info-row">
                  <span>End</span>
                  <span>{formatTC(infoClip.startTime + infoDur)}</span>
                </div>
                <div className="insp-info-row">
                  <span>Duration</span>
                  <span>{formatTC(infoDur)}</span>
                </div>
                <div className="insp-info-row">
                  <span>Linked</span>
                  <span>{isLinked ? "Yes, V+A" : "-"}</span>
                </div>
              </InspectorCollapsible>
            )}
          </>
        )}
      </div>
    </div>
  );
}
