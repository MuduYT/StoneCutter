import { useMemo, useState } from "react";
import {
  getClipPropertyTrack,
  sampleClipProperty,
} from "../../lib/keyframes.js";

const clampVolume = (value) => Math.max(0, Math.min(2, Number(value) || 0));

export function VolumeCurve({
  clip,
  pxPerSec,
  selectedKeyframe,
  onBeginVolumeKeyframeDrag,
  onAddVolumeKeyframe,
  onBeginVolumeLineDrag,
}) {
  const [isLineHot, setIsLineHot] = useState(false);
  const track = getClipPropertyTrack(clip, "volume");
  const duration = Math.max(0.001, clip.outPoint - clip.inPoint);
  const width = Math.max(1, duration * pxPerSec);
  const height = 52;

  const points = useMemo(() => {
    const sorted = [...track].sort((a, b) => a.time - b.time);
    const base = [
      {
        time: clip.startTime,
        value: sampleClipProperty(clip, "volume", clip.startTime),
        edge: true,
      },
      ...sorted,
      {
        time: clip.startTime + duration,
        value: sampleClipProperty(clip, "volume", clip.startTime + duration),
        edge: true,
      },
    ];
    return base.map((point) => {
      const x = Math.max(0, Math.min(width, (point.time - clip.startTime) * pxPerSec));
      const y = Math.max(4, Math.min(height - 4, (1 - clampVolume(point.value) / 2) * height));
      return { ...point, x, y };
    });
  }, [clip, duration, height, pxPerSec, track, width]);

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
  const fillPath = `${linePath} L ${width.toFixed(2)} ${height} L 0 ${height} Z`;
  const sortedTrack = [...track].sort((a, b) => a.time - b.time);
  const anchors = [
    {
      id: null,
      edge: true,
      time: clip.startTime,
      value: sampleClipProperty(clip, "volume", clip.startTime),
    },
    ...sortedTrack.map((kf) => ({
      id: kf.id,
      edge: false,
      time: kf.time,
      value: kf.value,
    })),
    {
      id: null,
      edge: true,
      time: clip.startTime + duration,
      value: sampleClipProperty(clip, "volume", clip.startTime + duration),
    },
  ];
  const isNearCurveLine = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const localY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    const time = clip.startTime + (localX / Math.max(1, rect.width)) * duration;
    const sampled = clampVolume(sampleClipProperty(clip, "volume", time));
    const lineY = Math.max(4, Math.min(height - 4, (1 - sampled / 2) * height));
    return Math.abs(localY - lineY) <= 6;
  };
  const resolveSegmentAtEvent = (event) => {
    if (anchors.length < 2) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const time = clip.startTime + (localX / Math.max(1, rect.width)) * duration;
    let segmentIndex = anchors.length - 2;
    for (let i = 0; i < anchors.length - 1; i += 1) {
      const left = anchors[i];
      const right = anchors[i + 1];
      if (time >= left.time && time <= right.time) {
        segmentIndex = i;
        break;
      }
    }
    const leftAnchor = anchors[segmentIndex];
    const rightAnchor = anchors[segmentIndex + 1];
    return {
      leftId: leftAnchor?.id ?? null,
      rightId: rightAnchor?.id ?? null,
      leftValue: clampVolume(leftAnchor?.value),
      rightValue: clampVolume(rightAnchor?.value),
    };
  };

  return (
    <svg
      className={`volume-curve ${isLineHot ? "line-hot" : ""}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      onMouseMove={(event) => setIsLineHot(isNearCurveLine(event))}
      onMouseLeave={() => setIsLineHot(false)}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        if (event.target instanceof SVGCircleElement) return;
        if (!isNearCurveLine(event)) return;
        onBeginVolumeLineDrag?.(event, clip, resolveSegmentAtEvent(event));
      }}
      onDoubleClick={(event) => onAddVolumeKeyframe?.(event, clip)}
    >
      <path className="volume-curve-fill" d={fillPath} />
      <path className="volume-curve-line" d={linePath} />
      {track.map((kf) => {
        const x = Math.max(0, Math.min(width, (kf.time - clip.startTime) * pxPerSec));
        const y = Math.max(4, Math.min(height - 4, (1 - clampVolume(kf.value) / 2) * height));
        const selected =
          selectedKeyframe?.clipId === clip.id &&
          selectedKeyframe?.propertyKey === "volume" &&
          selectedKeyframe?.kfId === kf.id;
        return (
          <circle
            key={kf.id}
            className={`volume-curve-dot ${selected ? "selected" : ""}`}
            cx={x}
            cy={y}
            r="4"
            onMouseDown={(event) => {
              event.stopPropagation();
              if (event.button !== 0) return;
              onBeginVolumeKeyframeDrag?.(event, {
                clipId: clip.id,
                kfId: kf.id,
                pxPerSec,
              });
            }}
          />
        );
      })}
    </svg>
  );
}
