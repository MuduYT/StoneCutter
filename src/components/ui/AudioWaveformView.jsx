import { useRef, useEffect, useCallback } from "react";

const WAVEFORM_COLOR_INACTIVE = "rgba(120, 120, 160, 0.45)";
const WAVEFORM_COLOR_ACTIVE = "rgba(139, 92, 246, 0.85)";
const WAVEFORM_COLOR_ACTIVE_BRIGHT = "rgba(6, 182, 212, 0.90)";
const PLAYHEAD_COLOR = "#f87171";
const HANDLE_COLOR_IN = "rgba(139, 92, 246, 0.95)";
const HANDLE_COLOR_OUT = "rgba(6, 182, 212, 0.95)";
const HANDLE_WIDTH = 3;

function drawWaveform(canvas, { peaks, duration, inPoint, outPoint, currentTime, isLoading }) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  if (!width || !height) return;

  const safeDuration = Math.max(0.001, duration);
  const barCount = Math.max(4, Math.floor(width / 3));
  const barWidth = width / barCount;

  const inRatio = Math.max(0, Math.min(1, inPoint / safeDuration));
  const outRatio = Math.max(0, Math.min(1, outPoint / safeDuration));
  const inPx = inRatio * width;
  const outPx = outRatio * width;

  if (isLoading || !peaks || peaks.length === 0) {
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < barCount; i++) {
      const ratio = i / barCount;
      const inRegion = ratio >= inRatio && ratio <= outRatio;
      const h = Math.max(4, (0.2 + Math.abs(Math.sin(i * 0.7)) * 0.3) * height * 0.85);
      ctx.fillStyle = inRegion ? WAVEFORM_COLOR_ACTIVE : WAVEFORM_COLOR_INACTIVE;
      const x = i * barWidth + barWidth * 0.2;
      const w = Math.max(1, barWidth * 0.6);
      ctx.fillRect(x, (height - h) / 2, w, h);
    }
    ctx.globalAlpha = 1;
    if (isLoading) {
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Waveform wird geladen…", width / 2, height / 2 + 4);
    }
    return;
  }

  for (let i = 0; i < barCount; i++) {
    const ratio = i / barCount;
    const peakIdx = Math.min(peaks.length - 1, Math.floor(ratio * peaks.length));
    const amplitude = peaks[peakIdx] || 0;
    const h = Math.max(2, amplitude * height * 0.85);
    const x = i * barWidth + barWidth * 0.15;
    const w = Math.max(1, barWidth * 0.7);
    const inRegion = ratio >= inRatio && ratio <= outRatio;

    if (inRegion) {
      const grad = ctx.createLinearGradient(x, 0, x + w, 0);
      grad.addColorStop(0, WAVEFORM_COLOR_ACTIVE);
      grad.addColorStop(1, WAVEFORM_COLOR_ACTIVE_BRIGHT);
      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.92;
    } else {
      ctx.fillStyle = WAVEFORM_COLOR_INACTIVE;
      ctx.globalAlpha = 0.55;
    }
    ctx.fillRect(x, (height - h) / 2, w, h);
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = "rgba(139, 92, 246, 0.18)";
  ctx.fillRect(inPx, 0, Math.max(0, outPx - inPx), height);

  ctx.fillStyle = HANDLE_COLOR_IN;
  ctx.fillRect(inPx - 1, 0, HANDLE_WIDTH, height);

  ctx.fillStyle = HANDLE_COLOR_OUT;
  ctx.fillRect(outPx - HANDLE_WIDTH + 1, 0, HANDLE_WIDTH, height);

  const playPx = Math.max(0, Math.min(width, (currentTime / safeDuration) * width));
  ctx.fillStyle = PLAYHEAD_COLOR;
  ctx.globalAlpha = 0.92;
  ctx.fillRect(playPx - 1, 0, 2, height);
  ctx.globalAlpha = 1;

  ctx.shadowBlur = 6;
  ctx.shadowColor = PLAYHEAD_COLOR;
  ctx.fillStyle = PLAYHEAD_COLOR;
  ctx.fillRect(playPx - 1, 0, 2, height);
  ctx.shadowBlur = 0;
}

export function AudioWaveformView({
  peaks,
  duration,
  inPoint,
  outPoint,
  currentTime,
  onSeek,
  onInDrag,
  onOutDrag,
  isLoading,
  className = "",
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const dragStateRef = useRef(null);
  const sizeRef = useRef({ width: 0, height: 0 });

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawWaveform(canvas, {
      peaks,
      duration,
      inPoint: inPoint ?? 0,
      outPoint: outPoint ?? (duration ?? 0),
      currentTime: currentTime ?? 0,
      isLoading: Boolean(isLoading),
    });
  }, [peaks, duration, inPoint, outPoint, currentTime, isLoading]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);
      sizeRef.current = { width, height };
      redraw();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [redraw]);

  const HANDLE_HIT_PX = 12;

  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    const safeDuration = Math.max(0.001, duration ?? 0);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickTime = Math.max(0, Math.min(safeDuration, ((e.clientX - rect.left) / rect.width) * safeDuration));
    const inPx = ((inPoint ?? 0) / safeDuration) * rect.width;
    const outPx = ((outPoint ?? safeDuration) / safeDuration) * rect.width;
    const xInCanvas = e.clientX - rect.left;

    if (Math.abs(xInCanvas - inPx) <= HANDLE_HIT_PX) {
      dragStateRef.current = { type: "in", rect, safeDuration };
      onInDrag?.(clickTime);
    } else if (Math.abs(xInCanvas - outPx) <= HANDLE_HIT_PX) {
      dragStateRef.current = { type: "out", rect, safeDuration };
      onOutDrag?.(clickTime);
    } else {
      dragStateRef.current = { type: "seek", rect, safeDuration };
      onSeek?.(clickTime);
    }
  }, [duration, inPoint, outPoint, onSeek, onInDrag, onOutDrag]);

  useEffect(() => {
    const onMove = (e) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const { rect, safeDuration } = drag;
      const t = Math.max(0, Math.min(safeDuration, ((e.clientX - rect.left) / rect.width) * safeDuration));
      if (drag.type === "in") onInDrag?.(t);
      else if (drag.type === "out") onOutDrag?.(t);
      else onSeek?.(t);
    };
    const onUp = () => { dragStateRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onSeek, onInDrag, onOutDrag]);

  return (
    <div
      ref={containerRef}
      className={`audio-waveform-view ${className}`}
      style={{ width: "100%", height: "100%", position: "relative", cursor: "pointer" }}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={onMouseDown}
        style={{ display: "block", width: "100%", height: "100%" }}
        aria-label="Audio Waveform"
      />
    </div>
  );
}
