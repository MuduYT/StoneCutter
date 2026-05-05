export function KeyframeStopwatch({
  active = false,
  disabled = false,
  onClick,
  title,
  size = "sm",
}) {
  const handleClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (disabled) return;
    onClick?.(event);
  };

  const handleMouseDown = (event) => {
    event.stopPropagation();
  };

  return (
    <button
      type="button"
      className={`keyframe-stopwatch ${size === "lg" ? "lg" : ""} ${
        active ? "active" : ""
      } ${disabled ? "disabled" : ""}`}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onPointerDown={handleMouseDown}
      disabled={disabled}
      title={
        title ||
        (active
          ? "Keyframe entfernen"
          : "Keyframe an aktueller Position setzen")
      }
      aria-pressed={active}
    >
      <svg
        viewBox="0 0 16 16"
        width="12"
        height="12"
        aria-hidden="true"
        focusable="false"
      >
        <circle
          cx="8"
          cy="9"
          r="5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <line
          x1="8"
          y1="9"
          x2="8"
          y2="6"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <line
          x1="8"
          y1="9"
          x2="10.5"
          y2="9"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <line
          x1="6.5"
          y1="2.5"
          x2="9.5"
          y2="2.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <line
          x1="8"
          y1="2.5"
          x2="8"
          y2="3.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
