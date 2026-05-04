import {
  InspectorCollapsible,
  InspectorDragger,
} from "./InspectorControls.jsx";

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

  return (
    <div className="inspector-panel">
      <InspectorTabs inspectorTab={inspectorTab} onTabChange={onTabChange} />
      <div className="inspector-header">
        <div className="inspector-title">
          {vidClip ? "Video" : "Audio"}
          {isLinked && <span className="inspector-linked-badge">V+A</span>}
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
              <InspectorCollapsible title="Transform" icon>
                <InspectorDragger
                  label="Pos X"
                  value={vidClip.positionX ?? 0}
                  onChange={(value) =>
                    onUpdateClip(vidClip.id, { positionX: value })
                  }
                  min={-960}
                  max={960}
                  step={1}
                />
                <InspectorDragger
                  label="Pos Y"
                  value={vidClip.positionY ?? 0}
                  onChange={(value) =>
                    onUpdateClip(vidClip.id, { positionY: value })
                  }
                  min={-540}
                  max={540}
                  step={1}
                />
                <InspectorDragger
                  label="Scale"
                  value={vidClip.scale ?? 100}
                  onChange={(value) => onUpdateClip(vidClip.id, { scale: value })}
                  min={0}
                  max={400}
                  step={1}
                  unit="%"
                />
                <InspectorDragger
                  label="Rotation"
                  value={vidClip.rotation ?? 0}
                  onChange={(value) =>
                    onUpdateClip(vidClip.id, { rotation: value })
                  }
                  min={-180}
                  max={180}
                  step={1}
                  unit="deg"
                />
                <InspectorDragger
                  label="Opacity"
                  value={vidClip.opacity ?? 100}
                  onChange={(value) =>
                    onUpdateClip(vidClip.id, { opacity: value })
                  }
                  min={0}
                  max={100}
                  step={1}
                  unit="%"
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
              <InspectorCollapsible title="Color" icon>
                <InspectorDragger
                  label="Brightness"
                  value={vidClip.brightness ?? 0}
                  onChange={(value) =>
                    onUpdateClip(vidClip.id, { brightness: value })
                  }
                  min={-100}
                  max={100}
                  step={1}
                />
                <InspectorDragger
                  label="Contrast"
                  value={vidClip.contrast ?? 0}
                  onChange={(value) =>
                    onUpdateClip(vidClip.id, { contrast: value })
                  }
                  min={-100}
                  max={100}
                  step={1}
                />
                <InspectorDragger
                  label="Saturation"
                  value={vidClip.saturation ?? 0}
                  onChange={(value) =>
                    onUpdateClip(vidClip.id, { saturation: value })
                  }
                  min={-100}
                  max={100}
                  step={1}
                />
                <InspectorDragger
                  label="Temperature"
                  value={vidClip.temperature ?? 0}
                  onChange={(value) =>
                    onUpdateClip(vidClip.id, { temperature: value })
                  }
                  min={-100}
                  max={100}
                  step={1}
                />
                {vidClip.brightness ||
                vidClip.contrast ||
                vidClip.saturation ||
                vidClip.temperature ? (
                  <button
                    className="insp-reset-btn"
                    onClick={() =>
                      onUpdateClip(vidClip.id, {
                        brightness: 0,
                        contrast: 0,
                        saturation: 0,
                        temperature: 0,
                      })
                    }
                  >
                    Reset Color
                  </button>
                ) : null}
              </InspectorCollapsible>
            )}

            {vidClip && (
              <InspectorCollapsible title="Speed" icon>
                <InspectorDragger
                  label="Speed"
                  value={vidClip.speed ?? 100}
                  onChange={(value) => onUpdateClip(vidClip.id, { speed: value })}
                  min={10}
                  max={400}
                  step={1}
                  unit="%"
                />
              </InspectorCollapsible>
            )}

            {audClip && (
              <InspectorCollapsible title="Audio" icon>
                <InspectorDragger
                  label="Volume"
                  value={Math.round((audClip.volume ?? 1) * 100)}
                  onChange={(value) =>
                    onUpdateClip(audClip.id, { volume: value / 100 })
                  }
                  min={0}
                  max={200}
                  step={1}
                  unit="%"
                />
                <InspectorDragger
                  label="Pan"
                  value={audClip.pan ?? 0}
                  onChange={(value) => onUpdateClip(audClip.id, { pan: value })}
                  min={-100}
                  max={100}
                  step={1}
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
