import { useState } from "react";
import { InspectorPanel } from "../inspector/InspectorPanel.jsx";

export function AppOverlays({
  showExport,
  exportStatus,
  exportProgress,
  totalEnd,
  aspectRatio,
  exportQuality,
  showSettings,
  settings,
  volTooltip,
  editorFocus,
  focusTimeline,
  activeClip,
  activeClipId,
  activeTrack,
  audClip,
  displayName,
  formatTC,
  inspectorTab,
  isLinked,
  tracksById,
  tracks,
  vidClip,
  contextMenu,
  clips,
  timelineTime,
  volume,
  muted,
  selectedClipCount,
  setShowExport,
  setExportStatus,
  setExportQuality,
  handleCancelExport,
  handleExport,
  setShowSettings,
  setSettings,
  onTabChange,
  onUpdateClip,
  onToggleKeyframe,
  onToggleGroupKeyframe,
  onUpdateKeyframeInterpolation,
  onJumpToKeyframeTime,
  onUpdateTrack,
  onSetVolume,
  onSetMuted,
  getAudioNode,
  selectedKeyframe,
  splitAtPlayhead,
  handleContextMenuDuplicate,
  restoreTrim,
  handleContextMenuUnlink,
  handleContextMenuLink,
  handleContextMenuDelete,
  setContextMenu,
  selectedClipIds,
  Icon,
}) {
  const [designExpanded, setDesignExpanded] = useState(false);

  return (
    <>
      {showExport && (
        <div
          className="settings-overlay"
          onClick={() => {
            if (exportStatus !== "running") setShowExport(false);
          }}
        >
          <div
            className="settings-panel export-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="settings-header">
              <h3>
                <Icon.Export /> Video exportieren
              </h3>
              {exportStatus !== "running" && (
                <button
                  className="settings-close"
                  onClick={() => setShowExport(false)}
                >
                  x
                </button>
              )}
            </div>
            <div className="settings-body">
              {exportStatus === "running" ? (
                <div className="export-running">
                  <div className="export-spinner" />
                  <p>FFmpeg laeuft. Das kann bei langen Videos einige Minuten dauern.</p>
                  <div className="export-progress-shell" aria-label="Export-Fortschritt">
                    <div
                      className="export-progress-bar"
                      style={{ width: `${Math.round(exportProgress.progress * 100)}%` }}
                    />
                  </div>
                  <div className="export-progress-meta">
                    <span>{Math.round(exportProgress.progress * 100)}%</span>
                    <span>
                      {formatTC(exportProgress.seconds)} / {formatTC(totalEnd)}
                    </span>
                  </div>
                  <button
                    className="export-action-btn danger"
                    onClick={handleCancelExport}
                  >
                    Export abbrechen
                  </button>
                </div>
              ) : exportStatus?.ok != null ? (
                <div className={`export-result ${exportStatus.ok ? "ok" : "err"}`}>
                  <p>{exportStatus.msg}</p>
                  <button
                    className="export-action-btn"
                    onClick={() => {
                      setExportStatus(null);
                      if (exportStatus.ok) setShowExport(false);
                    }}
                  >
                    {exportStatus.ok ? "Schliessen" : "Erneut versuchen"}
                  </button>
                </div>
              ) : (
                <>
                  <div className="settings-section">
                    <h4>Format</h4>
                    <div className="export-info-row">
                      <span>Aufloesung</span>
                      <strong>
                        {aspectRatio === "9:16"
                          ? "1080 x 1920 (9:16)"
                          : "1920 x 1080 (16:9)"}
                      </strong>
                    </div>
                    <div className="export-info-row">
                      <span>Container</span>
                      <strong>MP4 (H.264 + AAC)</strong>
                    </div>
                    <div className="export-info-row">
                      <span>Timeline-Dauer</span>
                      <strong>{formatTC(totalEnd)}</strong>
                    </div>
                  </div>

                  <div className="settings-section">
                    <h4>Qualitaet</h4>
                    <div className="export-quality-group">
                      {[
                        {
                          val: "low",
                          label: "Niedrig",
                          crf: 28,
                          preset: "veryfast",
                          hint: "~2-4 Mbit/s",
                          desc: "Kleinste Datei, sichtbare Artefakte",
                        },
                        {
                          val: "medium",
                          label: "Mittel",
                          crf: 23,
                          preset: "fast",
                          hint: "~6-10 Mbit/s",
                          desc: "Empfohlen - gute Qualitaet & Groesse",
                        },
                        {
                          val: "high",
                          label: "Hoch",
                          crf: 18,
                          preset: "slow",
                          hint: "~15-30 Mbit/s",
                          desc: "Maximale Qualitaet, grosse Datei",
                        },
                      ].map(({ val, label, crf, preset, hint, desc }) => (
                        <label
                          key={val}
                          className={`export-quality-btn ${exportQuality === val ? "active" : ""}`}
                        >
                          <input
                            type="radio"
                            name="quality"
                            value={val}
                            checked={exportQuality === val}
                            onChange={() => setExportQuality(val)}
                          />
                          <span className="eq-label">{label}</span>
                          <span className="eq-hint">{hint}</span>
                          <span className="eq-desc">{desc}</span>
                          <span className="eq-tech">
                            CRF {crf} - {preset}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <button className="export-start-btn" onClick={handleExport}>
                    <Icon.Export /> Speicherort waehlen & Exportieren
                  </button>
                  <p className="settings-hint">
                    Benoetigt FFmpeg im System-PATH. Export rendert Mehrspur-Video,
                    Bild-Overlays, Audio-Mix, Clip-Volume, Audio- und Video-Fades
                    sowie Position, Scale, Rotation und Opacity.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="settings-overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <div className="settings-header">
              <h3>
                <Icon.Settings /> Einstellungen
              </h3>
              <button className="settings-close" onClick={() => setShowSettings(false)}>
                x
              </button>
            </div>
            <div className="settings-body">
              <div className="settings-section">
                <h4>Bilder</h4>
                <label className="settings-row">
                  <span>Standard-Bildlaenge</span>
                  <div className="settings-input-group">
                    <input
                      id="image-duration"
                      type="number"
                      min="0.1"
                      max="60"
                      step="0.1"
                      value={settings.imageDuration}
                      onChange={(e) => {
                        const nextValue = parseFloat(e.target.value);
                        if (nextValue > 0) {
                          setSettings((prev) => ({
                            ...prev,
                            imageDuration: nextValue,
                          }));
                        }
                      }}
                      className="settings-number"
                    />
                    <span className="settings-unit">s</span>
                  </div>
                </label>
                <p className="settings-hint">
                  Wird fuer neu importierte Bilder verwendet.
                </p>
              </div>
              <div className="settings-section">
                <h4>Playback</h4>
                <label className="settings-row">
                  <span>Preview Quality</span>
                  <select
                    value={settings.previewQuality || "half"}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        previewQuality: e.target.value,
                      }))
                    }
                    aria-label="Preview Quality"
                  >
                    <option value="full">Full</option>
                    <option value="half">1/2</option>
                    <option value="quarter">1/4</option>
                    <option value="eighth">1/8</option>
                  </select>
                </label>
                <p className="settings-hint">
                  Timeline-Playback nutzt Proxies, wenn vorhanden. Export nutzt weiterhin Originaldateien.
                </p>
                <label className="settings-row">
                  <span>Audio-Scrubbing</span>
                  <input
                    type="checkbox"
                    checked={settings.audioScrubbing !== false}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        audioScrubbing: e.target.checked,
                      }))
                    }
                    aria-label="Audio-Scrubbing"
                  />
                </label>
              </div>
              <div className="settings-section">
                <h4 className="settings-section-header" onClick={() => setDesignExpanded(!designExpanded)}>
                  Design
                  <span className="settings-section-arrow" style={{transform: designExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease', display: 'inline-block', fontSize: '10px'}}>▶</span>
                </h4>
                {designExpanded && (
                <>
                <label className="settings-row">
                  <span>Primary Color</span>
                  <input
                    type="color"
                    value={settings.primaryColor || "#8b5cf6"}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        primaryColor: e.target.value,
                      }))
                    }
                    className="settings-color"
                  />
                </label>
                <label className="settings-row">
                  <span>Secondary Color</span>
                  <input
                    type="color"
                    value={settings.secondaryColor || "#06b6d4"}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        secondaryColor: e.target.value,
                      }))
                    }
                    className="settings-color"
                  />
                </label>
                <label className="settings-row">
                  <span>Tertiary Color</span>
                  <input
                    type="color"
                    value={settings.tertiaryColor || "#f97316"}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        tertiaryColor: e.target.value,
                      }))
                    }
                    className="settings-color"
                  />
                </label>
                <label className="settings-row">
                  <span>Background Base</span>
                  <input
                    type="color"
                    value={settings.bgBase || "#0d0a1a"}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        bgBase: e.target.value,
                      }))
                    }
                    className="settings-color"
                  />
                </label>
                <label className="settings-row">
                  <span>Background Panel</span>
                  <input
                    type="color"
                    value={settings.bgPanel || "#15102a"}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        bgPanel: e.target.value,
                      }))
                    }
                    className="settings-color"
                  />
                </label>
                <label className="settings-row">
                  <span>Text Color</span>
                  <input
                    type="color"
                    value={settings.textColor || "#e9e3f5"}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSettings((prev) => ({
                        ...prev,
                        textColor: val === "#e9e3f5" ? null : val,
                      }));
                    }}
                    className="settings-color"
                  />
                  <span className="settings-color-value">{settings.textColor || "Auto"}</span>
                </label>
                <label className="settings-row">
                  <span>Success Color</span>
                  <input
                    type="color"
                    value={settings.successColor || "#10b981"}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        successColor: e.target.value,
                      }))
                    }
                    className="settings-color"
                  />
                </label>
                <label className="settings-row">
                  <span>Warning Color</span>
                  <input
                    type="color"
                    value={settings.warnColor || "#f59e0b"}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        warnColor: e.target.value,
                      }))
                    }
                    className="settings-color"
                  />
                </label>
                <label className="settings-row">
                  <span>Danger Color</span>
                  <input
                    type="color"
                    value={settings.dangerColor || "#ef4444"}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        dangerColor: e.target.value,
                      }))
                    }
                    className="settings-color"
                  />
                </label>
                <button
                  className="settings-reset-btn"
                  onClick={() => {
                    setSettings((prev) => ({
                      ...prev,
                      primaryColor: "#8b5cf6",
                      secondaryColor: "#06b6d4",
                      tertiaryColor: "#f97316",
                      bgBase: "#0d0a1a",
                      bgPanel: "#15102a",
                      bgElevated: "#1c1638",
                      textColor: null,
                      textMuted: null,
                      dangerColor: "#ef4444",
                      successColor: "#10b981",
                      warnColor: "#f59e0b",
                    }));
                  }}
                >
                  Standardfarben wiederherstellen
                </button>
                </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {volTooltip && (
        <div
          className="vol-drag-tooltip"
          style={{ left: volTooltip.x + 14, top: volTooltip.y - 28 }}
        >
          Volume: {Math.round(volTooltip.vol * 100)}%
        </div>
      )}

      {editorFocus === focusTimeline && (
        <InspectorPanel
          activeClip={activeClip}
          activeClipId={activeClipId}
          activeTrack={activeTrack}
          audClip={audClip}
          displayName={displayName}
          formatTC={formatTC}
          inspectorTab={inspectorTab}
          isLinked={isLinked}
          onTabChange={onTabChange}
          onUpdateClip={onUpdateClip}
          onToggleKeyframe={onToggleKeyframe}
          onToggleGroupKeyframe={onToggleGroupKeyframe}
          onUpdateKeyframeInterpolation={onUpdateKeyframeInterpolation}
          onJumpToKeyframeTime={onJumpToKeyframeTime}
          selectedKeyframe={selectedKeyframe}
          selectedClipCount={selectedClipCount}
          timelineTime={timelineTime}
          tracks={tracks}
          clips={clips}
          volume={volume}
          muted={muted}
          tracksById={tracksById}
          vidClip={vidClip}
          onUpdateTrack={onUpdateTrack}
          onSetVolume={onSetVolume}
          onSetMuted={onSetMuted}
          getAudioNode={getAudioNode}
          Icon={Icon}
        />
      )}

      {contextMenu &&
        (() => {
          const clip = clips.find((item) => item.id === contextMenu.clipId);
          if (!clip) return null;
          const isTrimmed =
            clip.inPoint > 0.01 ||
            Math.abs(clip.outPoint - clip.sourceDuration) > 0.01;
          return (
            <div
              className="context-menu"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                className="cm-item"
                onClick={() => {
                  splitAtPlayhead();
                  setContextMenu(null);
                }}
                disabled={
                  !(
                    timelineTime > clip.startTime &&
                    timelineTime < clip.startTime + (clip.outPoint - clip.inPoint)
                  )
                }
              >
                <Icon.Cut /> Am Playhead teilen{" "}
                <span className="cm-shortcut">S</span>
              </button>
              <button
                className="cm-item"
                onClick={() => handleContextMenuDuplicate(clip.id)}
              >
                <Icon.Plus /> Duplizieren{" "}
                <span className="cm-shortcut">Strg+D</span>
              </button>
              <button
                className="cm-item"
                onClick={() => {
                  restoreTrim(clip.id);
                  setContextMenu(null);
                }}
                disabled={!isTrimmed}
              >
                <Icon.Undo /> Trim zuruecksetzen
              </button>
              {selectedClipIds && selectedClipIds.size >= 2 && !clip.linkGroupId && (
                <button
                  className="cm-item"
                  onClick={() => handleContextMenuLink(selectedClipIds)}
                >
                  ⛓ Clips verknüpfen{" "}
                  <span className="cm-shortcut">Strg+Shift+L</span>
                </button>
              )}
              {clip.linkGroupId && (
                <button
                  className="cm-item"
                  onClick={() => handleContextMenuUnlink(clip.id)}
                >
                  Verknüpfung lösen{" "}
                  <span className="cm-shortcut">Strg+Shift+L</span>
                </button>
              )}
              <div className="cm-divider" />
              <button
                className="cm-item danger"
                onClick={() => handleContextMenuDelete(clip.id)}
              >
                <Icon.Trash /> Loeschen <span className="cm-shortcut">Del</span>
              </button>
            </div>
          );
        })()}
    </>
  );
}
