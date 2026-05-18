import { useMemo } from "react";
import { getVisibleMergedKeyframeMarkers } from "../../lib/keyframes.js";

const DOT_RADIUS = 4;

export function ClipKeyframes({
  clip,
  pxPerSec,
  selectedKeyframe,
  onSelectKeyframe,
  onBeginKeyframeDrag,
}) {
  const markers = useMemo(() => getVisibleMergedKeyframeMarkers(clip), [clip]);

  if (!markers || markers.length === 0) return null;

  const clipDuration = Math.max(0.001, clip.outPoint - clip.inPoint);
  const clipWidth = clipDuration * pxPerSec;

  const positionFor = (time) => (time - clip.startTime) * pxPerSec;

  const isSelectedMarker = (marker) =>
    selectedKeyframe &&
    selectedKeyframe.clipId === clip.id &&
    marker.ids.some((entry) => entry.id === selectedKeyframe.kfId);

  return (
    <div
      className="clip-keyframes"
      style={{ width: `${clipWidth}px` }}
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {markers.length > 1 && (
        <div className="clip-keyframes-arrows" aria-hidden="true">
          {markers.slice(0, -1).map((marker, index) => {
            const next = markers[index + 1];
            const left = positionFor(marker.time);
            const width = Math.max(0, positionFor(next.time) - left);
            return (
              <span
                key={`${marker.time}-${next.time}`}
                className="clip-keyframes-arrow"
                style={{ left: `${left}px`, width: `${width}px` }}
              />
            );
          })}
        </div>
      )}
      {markers.map((marker) => {
        const left = positionFor(marker.time);
        const selected = isSelectedMarker(marker);
        // Use the first property/id pair as the canonical handle for the
        // dot (a marker may represent grouped keyframes across properties).
        const primary = marker.ids[0];
        return (
          <button
            key={`${marker.time}-${primary?.propertyKey}`}
            type="button"
            className={`clip-keyframe-dot ${selected ? "selected" : ""}`}
            style={{
              left: `${left - DOT_RADIUS}px`,
              width: `${DOT_RADIUS * 2}px`,
              height: `${DOT_RADIUS * 2}px`,
            }}
            title={
              marker.properties.length > 1
                ? `Keyframe (${marker.properties.length} Werte)`
                : `Keyframe: ${marker.properties[0]}`
            }
            onMouseDown={(event) => {
              event.stopPropagation();
              if (event.button !== 0) return;
              onSelectKeyframe?.(
                clip.id,
                primary.propertyKey,
                primary.id,
                marker.time,
              );
              onBeginKeyframeDrag?.(event, {
                clipId: clip.id,
                propertyKey: primary.propertyKey,
                kfId: primary.id,
                entries: marker.ids,
                startTime: marker.time,
                pxPerSec,
              });
            }}
            onClick={(event) => event.stopPropagation()}
          />
        );
      })}
    </div>
  );
}
