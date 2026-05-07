import { useEffect, useRef, useState } from "react";

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
            aria-hidden="true"
          />
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
  dragResistance = 1,
}) {
  const scrubRef = useRef(null);
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
    const resistance = Math.max(0.1, Number(dragResistance) || 1);
    const pxFull = 220 * resistance;
    let moved = false;

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      if (!moved) return;
      const delta = hasFiniteRange
        ? (dx / pxFull) * range
        : (dx / (8 * resistance)) * Math.max(step, 0.001);
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

  useEffect(() => {
    const el = scrubRef.current;
    if (!el || disabled) return;
    const onWheelNative = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const base = Number(step);
      const safeStep = Number.isFinite(base) && base > 0 ? base : 1;
      const micro = Math.max(safeStep * 0.1, 1e-6);
      const wheelStep = event.shiftKey
        ? micro
        : event.ctrlKey || event.metaKey
          ? safeStep * 5
          : safeStep;
      let deltaPx = event.deltaY;
      if (event.deltaMode === 1) deltaPx *= 16;
      else if (event.deltaMode === 2) deltaPx *= 120;
      const direction = deltaPx > 0 ? -1 : 1;
      const increments = Math.max(1, Math.round(Math.abs(deltaPx) / 40));
      const bump = direction * increments * wheelStep;
      const nextRounded = Math.round(((value ?? 0) + bump) / wheelStep) * wheelStep;
      let clamped = nextRounded;
      if (Number.isFinite(min)) clamped = Math.max(min, clamped);
      if (Number.isFinite(max)) clamped = Math.min(max, clamped);
      onChange(clamped);
    };
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, [disabled, max, min, onChange, step, value]);

  const commitEdit = (rawValue) => {
    const parsed = parseFloat(rawValue ?? editVal);
    if (!Number.isNaN(parsed)) onChange(clamp(parsed));
    setEditing(false);
  };

  return (
    <div className={`idf-row ${disabled ? "disabled" : ""}`}>
      <span
        className="idf-label"
        onMouseDown={beginDrag}
        title="Ziehen: Wert aendern · Mausrad: schrittweise (Shift: feiner, Ctrl: groesser), scrollt die Seite nicht mit"
      >
        {label}
      </span>
      <div
        ref={scrubRef}
        className="idf-scrub"
        onMouseDown={beginDrag}
      >
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
