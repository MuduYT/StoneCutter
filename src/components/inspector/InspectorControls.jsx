import { useState } from "react";

export function InspectorCollapsible({
  title,
  icon,
  children,
  defaultOpen = true,
  headerSlot,
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="inspector-section">
      <div
        className="inspector-section-header"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="inspector-section-label">
          {icon && <span className="section-dot" />}
          {title}
        </span>
        <span className="inspector-section-header-actions">
          {headerSlot && (
            <span
              className="inspector-section-header-slot"
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {headerSlot}
            </span>
          )}
          <span
            className={`inspector-section-chevron ${open ? "" : "collapsed"}`}
          >
            v
          </span>
        </span>
      </div>
      <div
        className={`inspector-section-content ${open ? "" : "collapsed"}`}
        style={open ? {} : { maxHeight: 0 }}
      >
        {children}
      </div>
    </div>
  );
}

export function InspectorDragger({
  label,
  value,
  onChange,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  unit = "",
  decimals,
  stopwatch,
  resetButton,
  disabled = false,
}) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState("");
  const dec = decimals != null ? decimals : step < 1 ? 1 : 0;
  const clamp = (nextValue) => {
    let clamped = nextValue;
    if (Number.isFinite(min)) clamped = Math.max(min, clamped);
    if (Number.isFinite(max)) clamped = Math.min(max, clamped);
    return clamped;
  };
  const displayValue = Number(value ?? 0).toFixed(dec);
  const hasFiniteRange = Number.isFinite(min) && Number.isFinite(max) && max > min;
  const pct =
    hasFiniteRange
      ? Math.max(0, Math.min(100, (((value ?? 0) - min) / (max - min)) * 100))
      : 0;

  const beginDrag = (event) => {
    if (editing || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startVal = value ?? 0;
    const range = hasFiniteRange ? Math.max(0.001, max - min) : null;
    const pxFull = 220;
    let moved = false;

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      if (!moved) return;
      const delta = hasFiniteRange
        ? (dx / pxFull) * range
        : (dx / 8) * Math.max(step, 0.001);
      const snapped = Math.round((startVal + delta) / step) * step;
      onChange(clamp(snapped));
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (!moved) {
        setEditVal(displayValue);
        setEditing(true);
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const onWheel = (event) => {
    if (disabled) return;
    event.stopPropagation();
    const direction = event.deltaY > 0 ? -1 : 1;
    onChange(clamp(Math.round(((value ?? 0) + direction * step) / step) * step));
  };

  const commitEdit = (rawValue) => {
    const parsed = parseFloat(rawValue ?? editVal);
    if (!Number.isNaN(parsed)) onChange(clamp(parsed));
    setEditing(false);
  };

  return (
    <div className={`idf-row ${disabled ? "disabled" : ""}`} onWheel={onWheel}>
      <span
        className="idf-label"
        onMouseDown={beginDrag}
        title="Ziehen zum Aendern - Scrollen zum Anpassen"
      >
        {label}
      </span>
      <div className="idf-scrub" onMouseDown={beginDrag}>
        {editing ? (
          <input
            className="idf-input"
            type="number"
            id={`idf-input-${label.replace(/\s+/g, "-").toLowerCase()}`}
            value={editVal}
            step={step}
            autoFocus
            onChange={(event) => setEditVal(event.target.value)}
            onBlur={(event) => commitEdit(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitEdit(event.target.value);
              if (event.key === "Escape") setEditing(false);
            }}
            onMouseDown={(event) => event.stopPropagation()}
          />
        ) : (
          <div className="idf-value">
            {displayValue}
            {unit}
          </div>
        )}
        <div className="idf-progress">
          <div className="idf-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {stopwatch && <span className="idf-stopwatch">{stopwatch}</span>}
      {resetButton && <span className="idf-reset">{resetButton}</span>}
    </div>
  );
}
