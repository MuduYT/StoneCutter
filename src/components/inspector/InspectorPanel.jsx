import { useState, useRef, useEffect } from "react";
import {
  InspectorCollapsible,
  InspectorDragger,
} from "./InspectorControls.jsx";
import { KeyframeStopwatch } from "./KeyframeStopwatch.jsx";
import {
  getClipPropertyTrack,
  hasKeyframeAt,
  KEYFRAME_INTERPOLATIONS,
  sampleClipProperty,
} from "../../lib/keyframes.js";
import { MixerPanel } from "../app/MixerPanel.jsx";

function InspectorPlaceholder({ inspectorTab }) {
  return (
    <div className="inspector-placeholder">
      <p className="inspector-placeholder-title">
        {inspectorTab === "effects" ? "Effects" : inspectorTab === "mixer" ? "Mixer" : "History"}
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
      {["Inspector", "Mixer", "Effects", "History"].map((tab) => (
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

const TEXT_FONT_OPTIONS = [
  ["Arial", "Arial, Helvetica, sans-serif"],
  ["Helvetica", "Helvetica, Arial, sans-serif"],
  ["Verdana", "Verdana, Geneva, sans-serif"],
  ["Tahoma", "Tahoma, Geneva, sans-serif"],
  ["Trebuchet MS", "'Trebuchet MS', Arial, sans-serif"],
  ["Segoe UI", "'Segoe UI', Arial, sans-serif"],
  ["Inter", "Inter, 'Segoe UI', Arial, sans-serif"],
  ["Roboto", "Roboto, Arial, sans-serif"],
  ["Open Sans", "'Open Sans', Arial, sans-serif"],
  ["Montserrat", "Montserrat, Arial, sans-serif"],
  ["Poppins", "Poppins, Arial, sans-serif"],
  ["Lato", "Lato, Arial, sans-serif"],
  ["Source Sans Pro", "'Source Sans Pro', Arial, sans-serif"],
  ["Noto Sans", "'Noto Sans', Arial, sans-serif"],
  ["Times New Roman", "'Times New Roman', Times, serif"],
  ["Georgia", "Georgia, 'Times New Roman', serif"],
  ["Garamond", "Garamond, Georgia, serif"],
  ["Cambria", "Cambria, Georgia, serif"],
  ["Baskerville", "Baskerville, Georgia, serif"],
  ["Courier New", "'Courier New', Courier, monospace"],
  ["Consolas", "Consolas, 'Courier New', monospace"],
  ["Monaco", "Monaco, Consolas, monospace"],
  ["Fira Code", "'Fira Code', Consolas, monospace"],
  ["Impact", "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif"],
  ["Arial Black", "'Arial Black', Arial, sans-serif"],
  ["Bebas Neue", "'Bebas Neue', Impact, sans-serif"],
  ["Oswald", "Oswald, Arial, sans-serif"],
  ["Playfair Display", "'Playfair Display', Georgia, serif"],
  ["Merriweather", "Merriweather, Georgia, serif"],
  ["Comic Sans MS", "'Comic Sans MS', 'Comic Sans', cursive"],
].map(([label, value]) => ({ label, value }));

const KEYFRAMABLE_KEYS = new Set([
  "positionX",
  "positionY",
  "scaleX",
  "scaleY",
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
  "fontSize",
  "letterSpacing",
  "lineHeight",
  "outlineWidth",
  "shadowOpacity",
  "shadowBlur",
  "bgOpacity",
]);

function FontPreviewSelect({ value, options, disabled, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = options.find((o) => o.value === value) || { label: value, value };
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div
      ref={ref}
      className={`font-preview-select inspector-field${disabled ? " disabled" : ""}`}
      style={{ position: "relative", cursor: disabled ? "not-allowed" : "pointer", userSelect: "none" }}
    >
      <div
        className="font-preview-trigger"
        style={{ fontFamily: selected.value, padding: "2px 4px", display: "flex", alignItems: "center", justifyContent: "space-between" }}
        onClick={() => { if (!disabled) setOpen((v) => !v); }}
      >
        <span>{selected.label}</span>
        <span style={{ fontSize: 9, opacity: 0.6, marginLeft: 4 }}>▾</span>
      </div>
      {open && (
        <div
          className="font-preview-dropdown"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 999,
            background: "var(--bg-elevated, #1c1638)",
            border: "1px solid var(--border-strong, rgba(124,58,237,0.4))",
            borderRadius: 6,
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          {options.map((opt) => (
            <div
              key={opt.value}
              className={`font-preview-option${opt.value === value ? " selected" : ""}`}
              style={{
                fontFamily: opt.value,
                padding: "6px 10px",
                cursor: "pointer",
                background: opt.value === value ? "var(--bg-hover, #2a1f4a)" : "transparent",
                fontSize: 13,
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(opt.value);
                setOpen(false);
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
  onUpdateKeyframeInterpolation,
  onJumpToKeyframeTime,
  selectedKeyframe,
  selectedClipCount = 1,
  timelineTime = 0,
  tracks = [],
  clips = [],
  volume = 1,
  muted = false,
  tracksById,
  vidClip,
  onUpdateTrack,
  onSetVolume,
  onSetMuted,
  getAudioNode,
  getTrackPeak,
  Icon,
}) {
  const previousFontWeightRef = useRef(new Map());
  useEffect(() => {
    if (!activeClipId || !activeClip) return;
    const style = activeClip.content?.style || {};
    const weight = typeof style.fontWeight === "string" && style.fontWeight ? style.fontWeight : "600";
    if (weight !== "700") {
      previousFontWeightRef.current.set(activeClipId, weight);
    }
  }, [activeClipId, activeClip]);

  const renderMixer = () => (
    <MixerPanel
      tracks={tracks}
      clips={clips}
      timelineTime={timelineTime}
      volume={volume}
      muted={muted}
      onUpdateTrack={onUpdateTrack}
      onSetVolume={onSetVolume}
      onSetMuted={onSetMuted}
      getAudioNode={getAudioNode}
      getTrackPeak={getTrackPeak}
      Icon={Icon}
    />
  );

  if (!activeClipId) {
    return (
      <div className="inspector-panel">
        <InspectorTabs inspectorTab={inspectorTab} onTabChange={onTabChange} />
        {inspectorTab === "mixer" ? (
          renderMixer()
        ) : inspectorTab === "inspector" ? (
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
  const isTextClip = activeClip?.kind === "text";
  const inspectorLocked = [activeClip, vidClip, audClip]
    .filter(Boolean)
    .some((clip) => Boolean(tracksById.get(clip.trackId)?.locked));
  const keyframesDisabled = isMulti || inspectorLocked;

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
      disabled={inspectorLocked}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (inspectorLocked) return;
        onClick?.();
      }}
    >
      <Icon.Undo />
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
  const keyframeTimes = collectKeyframeTimes(vidClip, audClip, isTextClip ? activeClip : null);
  const selectedKeyframeTrack =
    selectedKeyframe?.clipId === activeClipId
      ? getClipPropertyTrack(activeClip, selectedKeyframe.propertyKey)
      : [];
  const selectedKeyframeItem =
    selectedKeyframeTrack.find((kf) => kf.id === selectedKeyframe?.kfId) || null;
  const scaleLocked = vidClip ? vidClip.scaleLocked !== false : true;
  const scaleBase = vidValue("scale") ?? 100;
  const scaleXValue = vidValue("scaleX") ?? scaleBase;
  const scaleYValue = vidValue("scaleY") ?? scaleBase;
  const updateScalePair = (nextScaleX, nextScaleY, nextLocked = scaleLocked) => {
    if (inspectorLocked) return;
    const nextScale = Math.round((Number(nextScaleX) + Number(nextScaleY)) / 2);
    onUpdateClip?.(vidClip.id, {
      scaleX: nextScaleX,
      scaleY: nextScaleY,
      scale: nextLocked ? nextScaleX : nextScale,
      scaleLocked: nextLocked,
    });
  };
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
  const textStyle = activeClip?.content?.style || {};
  const currentFontFamily = textStyle.fontFamily || "Inter, 'Segoe UI', Arial, sans-serif";
  const currentFontWeight = typeof textStyle.fontWeight === "string" && textStyle.fontWeight
    ? textStyle.fontWeight
    : "600";
  const currentFontStyle = textStyle.fontStyle || "normal";
  const currentTextDecoration = textStyle.textDecoration || "none";
  const fontOptions = TEXT_FONT_OPTIONS.some((option) => option.value === currentFontFamily)
    ? TEXT_FONT_OPTIONS
    : [{ label: "Custom (" + currentFontFamily + ")", value: currentFontFamily }, ...TEXT_FONT_OPTIONS];

  const textValue = (key, fallback) =>
    isTextClip ? sampleClipProperty(activeClip, key, timelineTime) ?? fallback : fallback;
  const updateTextContent = (text) => {
    if (inspectorLocked) return;
    onUpdateClip?.(activeClip.id, {
      name: text || "Text",
      content: {
        ...(activeClip.content || {}),
        text,
        style: textStyle,
      },
    });
  };
  const updateTextStyle = (patch) => {
    if (inspectorLocked) return;
    onUpdateClip?.(activeClip.id, {
      content: {
        ...(activeClip.content || {}),
        text: activeClip.content?.text ?? activeClip.name ?? "Text",
        style: {
          fontSize: 48,
          color: "#ffffff",
          fontFamily: "Inter, 'Segoe UI', Arial, sans-serif",
          fontWeight: "600",
          fontStyle: "normal",
          textDecoration: "none",
          align: "center",
          outlineColor: "#000000",
          outlineWidth: 0,
          shadowOpacity: 0,
          shadowBlur: 0,
          ...textStyle,
          ...patch,
        },
      },
    });
  };
  const setBold = (nextBold) => {
    if (inspectorLocked) return;
    if (nextBold) {
      if (currentFontWeight !== "700") {
        previousFontWeightRef.current.set(activeClipId, currentFontWeight);
      }
      updateTextStyle({ fontWeight: "700" });
      return;
    }
    const restoreWeight = previousFontWeightRef.current.get(activeClipId) || "600";
    updateTextStyle({ fontWeight: restoreWeight });
  };
  const toggleItalic = () => {
    if (inspectorLocked) return;
    updateTextStyle({ fontStyle: currentFontStyle === "italic" ? "normal" : "italic" });
  };
  const toggleUnderline = () => {
    if (inspectorLocked) return;
    updateTextStyle({
      textDecoration: currentTextDecoration === "underline" ? "none" : "underline",
    });
  };

  return (
    <div className="inspector-panel">
      <InspectorTabs inspectorTab={inspectorTab} onTabChange={onTabChange} />
      <div className="inspector-header">
        <div className="inspector-title">
          {isTextClip ? "Text" : vidClip ? "Video" : "Audio"}
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
          {selectedKeyframeItem && (
            <select
              className="inspector-keyframe-interpolation"
              value={selectedKeyframeItem.interpolation || "linear"}
              title="Keyframe-Interpolation"
              disabled={inspectorLocked}
              onChange={(event) =>
                onUpdateKeyframeInterpolation?.(
                  selectedKeyframe.clipId,
                  selectedKeyframe.propertyKey,
                  selectedKeyframe.kfId,
                  event.target.value,
                )
              }
            >
              {KEYFRAME_INTERPOLATIONS.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="insp-reset-mini"
            title="Vorheriger Keyframe"
            onClick={() => jumpToKeyframe(-1)}
            disabled={keyframeTimes.length === 0 || inspectorLocked}
          >
            <Icon.StepBack />
          </button>
          <button
            type="button"
            className="insp-reset-mini"
            title="Naechster Keyframe"
            onClick={() => jumpToKeyframe(1)}
            disabled={keyframeTimes.length === 0 || inspectorLocked}
          >
            <Icon.StepFwd />
          </button>
        </div>
        <div className="inspector-clip-name" title={displayName}>
          {displayName}
        </div>
      </div>
      <div className="inspector-body">
        {inspectorLocked && (
          <div className="inspector-locked-banner">Spur gesperrt - Bearbeitung deaktiviert</div>
        )}
        {inspectorTab === "mixer" ? (
          renderMixer()
        ) : inspectorTab !== "inspector" ? (
          <InspectorPlaceholder inspectorTab={inspectorTab} />
        ) : (
          <>
            {isTextClip && (
              <InspectorCollapsible title="Text" icon>
                <div className="idf-row">
                  <span className="idf-label">Inhalt</span>
                  <input
                    className="inspector-field"
                    type="text"
                    value={activeClip.content?.text ?? activeClip.name ?? "Text"}
                    onChange={(event) => updateTextContent(event.target.value)}
                    disabled={inspectorLocked}
                  />
                </div>
                <div className="idf-row">
                  <span className="idf-label">Schrift</span>
                  <FontPreviewSelect
                    value={currentFontFamily}
                    options={fontOptions}
                    disabled={inspectorLocked}
                    onChange={(value) => updateTextStyle({ fontFamily: value })}
                  />
                </div>
                <div className="idf-row">
                  <span className="idf-label">Style</span>
                  <div className="insp-flip-group">
                    <button
                      type="button"
                      className={`insp-flip-btn ${currentFontWeight === "700" ? "active" : ""}`}
                      onClick={() => setBold(currentFontWeight !== "700")}
                      disabled={inspectorLocked}
                      title="Bold"
                      aria-pressed={currentFontWeight === "700"}
                      style={{ fontWeight: 700 }}
                    >
                      B
                    </button>
                    <button
                      type="button"
                      className={`insp-flip-btn ${currentFontStyle === "italic" ? "active" : ""}`}
                      onClick={toggleItalic}
                      disabled={inspectorLocked}
                      title="Italic"
                      aria-pressed={currentFontStyle === "italic"}
                      style={{ fontStyle: "italic" }}
                    >
                      I
                    </button>
                    <button
                      type="button"
                      className={`insp-flip-btn ${currentTextDecoration === "underline" ? "active" : ""}`}
                      onClick={toggleUnderline}
                      disabled={inspectorLocked}
                      title="Underline"
                      aria-pressed={currentTextDecoration === "underline"}
                      style={{ textDecoration: "underline" }}
                    >
                      U
                    </button>
                  </div>
                </div>
                <InspectorDragger
                  label="Font Size"
                  disabled={inspectorLocked}
                  value={textValue("fontSize", 48)}
                  onChange={(value) => updateTextStyle({ fontSize: value })}
                  min={8}
                  max={240}
                  step={1}
                  unit="px"
                  stopwatch={renderStopwatch(activeClip, "fontSize")}
                />
                <InspectorDragger
                  label="Tracking"
                  disabled={inspectorLocked}
                  value={textValue("letterSpacing", 0)}
                  onChange={(value) => updateTextStyle({ letterSpacing: value })}
                  min={-10}
                  max={50}
                  step={0.5}
                  unit="px"
                  decimals={1}
                  stopwatch={renderStopwatch(activeClip, "letterSpacing")}
                />
                <InspectorDragger
                  label="Line Spacing"
                  disabled={inspectorLocked}
                  value={textValue("lineHeight", 1.15)}
                  onChange={(value) => updateTextStyle({ lineHeight: value })}
                  min={0.5}
                  max={3}
                  step={0.05}
                  decimals={2}
                  stopwatch={renderStopwatch(activeClip, "lineHeight")}
                />
                <div className="idf-row">
                  <span className="idf-label">Color</span>
                  <input
                    className="inspector-field"
                    type="color"
                    value={textStyle.color || "#ffffff"}
                    onChange={(event) =>
                      updateTextStyle({ color: event.target.value })
                    }
                    disabled={inspectorLocked}
                  />
                </div>
                <div className="inspector-divider" />
                <div className="inspector-section-subtitle">Appearance</div>
                <InspectorDragger
                  label="Outline Width"
                  disabled={inspectorLocked}
                  value={textValue("outlineWidth", 0)}
                  onChange={(value) => updateTextStyle({ outlineWidth: value })}
                  min={0}
                  max={20}
                  step={0.5}
                  unit="px"
                  decimals={1}
                  stopwatch={renderStopwatch(activeClip, "outlineWidth")}
                />
                <div className="idf-row">
                  <span className="idf-label">Outline Color</span>
                  <input
                    className="inspector-field"
                    type="color"
                    value={textStyle.outlineColor || "#000000"}
                    onChange={(event) =>
                      updateTextStyle({ outlineColor: event.target.value })
                    }
                    disabled={inspectorLocked}
                  />
                </div>
                <InspectorDragger
                  label="Shadow Opacity"
                  disabled={inspectorLocked}
                  value={textValue("shadowOpacity", 0)}
                  onChange={(value) => updateTextStyle({ shadowOpacity: value })}
                  min={0}
                  max={100}
                  step={1}
                  unit="%"
                  stopwatch={renderStopwatch(activeClip, "shadowOpacity")}
                />
                <InspectorDragger
                  label="Shadow Blur"
                  disabled={inspectorLocked}
                  value={textValue("shadowBlur", 0)}
                  onChange={(value) => updateTextStyle({ shadowBlur: value })}
                  min={0}
                  max={50}
                  step={1}
                  unit="px"
                  stopwatch={renderStopwatch(activeClip, "shadowBlur")}
                />
                <InspectorDragger
                  label="Background"
                  disabled={inspectorLocked}
                  value={textValue("bgOpacity", 0)}
                  onChange={(value) => updateTextStyle({ bgOpacity: value })}
                  min={0}
                  max={100}
                  step={1}
                  unit="%"
                  stopwatch={renderStopwatch(activeClip, "bgOpacity")}
                />
                <div className="idf-row">
                  <span className="idf-label">Weight</span>
                  <select
                    className="inspector-field"
                    value={currentFontWeight}
                    onChange={(event) =>
                      updateTextStyle({ fontWeight: event.target.value })
                    }
                    disabled={inspectorLocked}
                  >
                    <option value="400">Regular</option>
                    <option value="500">Medium</option>
                    <option value="600">Semibold</option>
                    <option value="700">Bold</option>
                    <option value="800">Extra Bold</option>
                  </select>
                </div>
                <div className="idf-row">
                  <span className="idf-label">Align</span>
                  <select
                    className="inspector-field"
                    value={textStyle.align || "center"}
                    onChange={(event) =>
                      updateTextStyle({ align: event.target.value })
                    }
                    disabled={inspectorLocked}
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </div>
              </InspectorCollapsible>
            )}

            {vidClip && (
              <InspectorCollapsible
                title="Transform"
                icon
                headerSlot={renderGroupActions(
                  vidClip,
                  "transform",
                  [
                    "positionX",
                    "positionY",
                    "scaleX",
                    "scaleY",
                    "scale",
                    "rotation",
                    "opacity",
                  ],
                  "Transform zuruecksetzen",
                  () =>
                    onUpdateClip(vidClip.id, {
                      positionX: 0,
                      positionY: 0,
                      scaleX: 100,
                      scaleY: 100,
                      scale: 100,
                      scaleLocked: true,
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
                  dragResistance={1.1}
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
                  dragResistance={1.1}
                  stopwatch={renderStopwatch(vidClip, "positionY")}
                  resetButton={renderResetButton("Pos Y zuruecksetzen", () =>
                    onUpdateClip(vidClip.id, { positionY: 0 }),
                  )}
                />
                <InspectorDragger
                  label="Scale X"
                  value={scaleXValue}
                  onChange={(value) =>
                    updateScalePair(value, scaleLocked ? value : scaleYValue)
                  }
                  step={1}
                  unit="%"
                  dragResistance={1.1}
                  stopwatch={renderStopwatch(vidClip, "scaleX")}
                  resetButton={renderResetButton("Scale X zuruecksetzen", () =>
                    updateScalePair(100, scaleLocked ? 100 : scaleYValue),
                  )}
                />
                <InspectorDragger
                  label="Scale Y"
                  value={scaleYValue}
                  onChange={(value) =>
                    updateScalePair(scaleLocked ? value : scaleXValue, value)
                  }
                  step={1}
                  unit="%"
                  dragResistance={1.1}
                  stopwatch={renderStopwatch(vidClip, "scaleY")}
                  disabled={inspectorLocked || scaleLocked}
                  resetButton={renderResetButton("Scale Y zuruecksetzen", () =>
                    updateScalePair(scaleLocked ? 100 : scaleXValue, 100),
                  )}
                />
                <div className="idf-row">
                  <span className="idf-label">Scale Link</span>
                  <button
                    type="button"
                    className={`insp-scale-lock-btn ${scaleLocked ? "active" : ""}`}
                    onClick={() => {
                      const aligned = Math.round((scaleXValue + scaleYValue) / 2);
                      if (scaleLocked) {
                        onUpdateClip(vidClip.id, { scaleLocked: false });
                      } else {
                        onUpdateClip(vidClip.id, {
                          scaleLocked: true,
                          scaleX: aligned,
                          scaleY: aligned,
                          scale: aligned,
                        });
                      }
                    }}
                    title={scaleLocked ? "Skalierung entkoppeln" : "Skalierung koppeln"}
                  >
                    {scaleLocked ? <Icon.Lock /> : <Icon.Unlock />}
                  </button>
                </div>
                <InspectorDragger
                  label="Rotation"
                  value={vidValue("rotation") ?? 0}
                  onChange={(value) =>
                    onUpdateClip(vidClip.id, { rotation: value })
                  }
                  step={1}
                  unit="deg"
                  dragResistance={1.3}
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

            {vidClip && !isTextClip && (
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

            {vidClip && !isTextClip && (
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
