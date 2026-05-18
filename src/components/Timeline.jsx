import { useMemo } from "react";
import {
  buildThumbnailItems,
  buildWaveformBars,
} from "../lib/timelineRender.js";
import {
  clampFadeValues,
  DEFAULT_TIMELINE_RULER_HEIGHT,
  findAdjacentAudioClipPairs,
} from "../lib/timeline.js";
import { buildSeparatedLayout } from "../lib/timelineLayout.js";
import { ClipKeyframes } from "./timeline/ClipKeyframes.jsx";
import { VolumeCurve } from "./timeline/VolumeCurve.jsx";
import {
  FADE_IN_POLYGON,
  FADE_IN_POLYLINE,
  FADE_OUT_POLYGON,
  FADE_OUT_POLYLINE,
} from "../lib/fadeCurves.js";

export const Timeline = ({
  tracks,
  clips,
  clipsByTrack: visibleClipsByTrack,
  pxPerSec,
  totalWidth,
  totalEnd,
  interaction,
  activeClipId,
  selectedClipIds,
  draggingIds,
  dropTargetTrackId,
  trackMoveTargetIds,
  trackMovePreview,
  thumbsMap,
  peaksMap,
  editingTrackId,
  dragOver,
  dropZoneTrackMode,
  dropTargetInvalid = false,
  formatTime,
  formatTC,
  scrubTooltip,
  selectedKeyframe,
  onSelectKeyframe,
  onBeginKeyframeDrag,
  onBeginVolumeKeyframeDrag,
  onAddVolumeKeyframe,
  setTimelinePlayheadRef,
  setTracksContentRef,
  setTrackHeadersListRef,
  handleTracksMouseDown,
  handleTracksScroll,
  handlePlayheadMouseDown,
  handleClipMouseDown,
  handleClipContextMenu,
  handleTrimMouseDown,
  handleCrossfadeMouseDown,
  handleUpdateTrack,
  handleTrackResizeMouseDown,
  marqueeBox,
  snapIndicatorTime,
  setEditingTrackId,
  handleFadeMouseDown,
  volumeLineDragRef,
  createHistorySnapshot,
  DEFAULT_TRACK_HEIGHT,
  getAutoTrackZoneTop,
  Icon,
}) => {
  const allClipsByTrack = useMemo(() => {
    const map = new Map();
    for (const clip of clips) {
      if (!map.has(clip.trackId)) map.set(clip.trackId, []);
      map.get(clip.trackId).push(clip);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.startTime - b.startTime);
    }
    return map;
  }, [clips]);
  const clipsByTrack = visibleClipsByTrack || allClipsByTrack;

  const crossfadeByLeftClipId = useMemo(() => {
    const map = new Map();
    for (const pair of findAdjacentAudioClipPairs(clips, tracks)) {
      map.set(pair.leftClip.id, pair);
    }
    return map;
  }, [clips, tracks]);

  const layout = useMemo(
    () => buildSeparatedLayout(tracks, DEFAULT_TRACK_HEIGHT),
    [tracks, DEFAULT_TRACK_HEIGHT],
  );
  const {
    videoTracksLayout,
    audioTracksLayout,
    videoEdgeZone,
    audioEdgeZone,
    dividerY,
    dividerHeight,
    totalTracksHeight,
  } = layout;
  const allTracksLayout = useMemo(
    () => [...videoTracksLayout, ...audioTracksLayout],
    [videoTracksLayout, audioTracksLayout],
  );
  const showVideoDropEdge = dropZoneTrackMode !== "audio";
  const showAudioDropEdge = dropZoneTrackMode !== "video";
  const laneDropClass = (trackId) => {
    const isTarget =
      dropTargetTrackId === trackId || trackMoveTargetIds.has(trackId);
    if (!isTarget) return "";
    return dropTargetInvalid ? "drop-target drop-target-invalid" : "drop-target";
  };

  return (
    <div className="timeline-tracks">
      {/* Fixed track headers column */}
      <div className="track-headers">
        <div className="track-header time-header" />
        <div className="track-headers-list" ref={setTrackHeadersListRef}>
          <div style={{ position: "relative", height: `${totalTracksHeight}px`, flexShrink: 0 }}>
            <div
              className={`track-edge-zone-header video ${dragOver && showVideoDropEdge ? "drag-active" : ""} ${dropTargetTrackId === "__above__" ? "active" : ""} ${dropTargetInvalid && dropTargetTrackId === "__above__" ? "drop-target-invalid" : ""}`}
              style={{
                position: "absolute",
                top: `${videoEdgeZone.top}px`,
                left: 0,
                right: 0,
                height: `${videoEdgeZone.height}px`,
              }}
              aria-hidden={!(dragOver && showVideoDropEdge)}
            >
              {dragOver && showVideoDropEdge && <span>+ Video-Spur</span>}
            </div>
            <div
              className="track-section-divider track-header-divider"
              style={{
                position: "absolute",
                top: `${dividerY}px`,
                left: 0,
                right: 0,
                height: `${dividerHeight}px`,
              }}
            />
          {allTracksLayout.map(({ track, height, top }) => {
            const sameTypeTracks = tracks.filter(t => t.type === track.type);
            const typeIndex = sameTypeTracks.indexOf(track) + 1;
            const typeLabel = `${track.type === "video" ? "V" : "A"}${typeIndex}`;
            return (
              <div
                key={track.id}
                className={`track-header-row ${track.type === "video" ? "video" : "audio"} ${track.hidden ? "hidden" : ""} ${laneDropClass(track.id)}`}
                style={{
                  position: "absolute",
                  top: `${top}px`,
                  left: 0,
                  right: 0,
                  height: `${height}px`,
                }}
              >
                <div className="track-header-left">
                  <span className="track-type-label">
                    {typeLabel}
                  </span>
                  {editingTrackId === track.id ? (
                    <input
                      className="track-name-input"
                      defaultValue={track.name}
                      autoFocus
                      onBlur={(e) => {
                        handleUpdateTrack(track.id, { name: e.target.value });
                        setEditingTrackId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleUpdateTrack(track.id, {
                            name: e.currentTarget.value,
                          });
                          setEditingTrackId(null);
                        }
                        if (e.key === "Escape") setEditingTrackId(null);
                      }}
                    />
                  ) : (
                    <span
                      className="track-name"
                      onDoubleClick={() => setEditingTrackId(track.id)}
                      title="Doppelklick zum Bearbeiten"
                    >
                      {track.name}
                    </span>
                  )}
                </div>
                <div
                  className="track-resize-handle"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    handleTrackResizeMouseDown(e, track.id, height);
                  }}
                  title="Spurhöhe ziehen"
                />
                <div className="track-header-controls">
                  <button
                    className={`track-btn visibility ${track.hidden ? "hidden" : ""}`}
                    onClick={() =>
                      handleUpdateTrack(track.id, { hidden: !track.hidden })
                    }
                    title={track.hidden ? "Spur einblenden" : "Spur ausblenden"}
                  >
                    {track.hidden ? <Icon.EyeOff /> : <Icon.Eye />}
                  </button>
                  {track.type === "audio" && (
                    <>
                      <button
                        className={`track-btn mute ${track.muted ? "active" : ""}`}
                        onClick={() =>
                          handleUpdateTrack(track.id, { muted: !track.muted })
                        }
                        title={track.muted ? "Stumm aus" : "Stumm"}
                      >
                        M
                      </button>
                      <button
                        className={`track-btn solo ${track.solo ? "active" : ""}`}
                        onClick={() =>
                          handleUpdateTrack(track.id, { solo: !track.solo })
                        }
                        title={track.solo ? "Solo aus" : "Solo"}
                      >
                        S
                      </button>
                    </>
                  )}
                  <button
                    className={`track-btn lock ${track.locked ? "active" : ""}`}
                    onClick={() =>
                      handleUpdateTrack(track.id, { locked: !track.locked })
                    }
                    title={track.locked ? "Entsperren" : "Sperren"}
                  >
                    <Icon.Lock />
                  </button>
                </div>
              </div>
            );
          })}
            <div
              className={`track-edge-zone-header audio ${dragOver && showAudioDropEdge ? "drag-active" : ""} ${dropTargetTrackId === "__below__" ? "active" : ""} ${dropTargetInvalid && dropTargetTrackId === "__below__" ? "drop-target-invalid" : ""}`}
              style={{
                position: "absolute",
                top: `${audioEdgeZone.top}px`,
                left: 0,
                right: 0,
                height: `${audioEdgeZone.height}px`,
              }}
              aria-hidden={!(dragOver && showAudioDropEdge)}
            >
              {dragOver && showAudioDropEdge && <span>+ Audio-Spur</span>}
            </div>
          </div>
        </div>
      </div>

      <div
        className={`tracks-content${interaction?.type === "middle-pan" ? " panning" : ""}`}
        ref={setTracksContentRef}
        onMouseDown={handleTracksMouseDown}
        onAuxClick={(e) => {
          if (e.button === 1) e.preventDefault();
        }}
        onScroll={handleTracksScroll}
      >
        <div
          className="tracks-inner"
          style={{
            width: `${totalWidth}px`,
            height: `${DEFAULT_TIMELINE_RULER_HEIGHT + totalTracksHeight}px`,
          }}
        >
          {/* Time ruler */}
          <div className="time-ruler" style={{ width: `${totalWidth}px` }}>
            {Array.from({
              length: Math.max(20, Math.ceil(totalEnd) + 5),
            }).map((_, i) => (
              <div
                key={i}
                className={`tick ${i % 5 === 0 ? "major" : ""}`}
                style={{ left: `${i * pxPerSec}px` }}
              >
                {i % 5 === 0 && (
                  <span className="tick-label">{formatTime(i)}</span>
                )}
              </div>
            ))}
            {/* Playhead handle lives inside the sticky ruler so it stays visible while scrolling. */}
            <div
              className={`playhead-handle ruler-handle ${interaction?.type === "seek" ? "dragging" : ""}`}
              ref={setTimelinePlayheadRef(0)}
              onMouseDown={handlePlayheadMouseDown}
              title="Ziehen zum Spulen"
            />
            {/* Scrub tooltip inside the ruler so it remains visible while scrolling */}
            {scrubTooltip && (
              <div
                className="scrub-tooltip"
                style={{ left: `${scrubTooltip.x}px` }}
              >
                {formatTC(scrubTooltip.time)}
              </div>
            )}
          </div>

          {/* Playhead line */}
          <div
            className="playhead"
            ref={setTimelinePlayheadRef(1)}
            aria-hidden="true"
          >
            <div className="playhead-line" />
          </div>
          {snapIndicatorTime != null && (
            <div
              className="snap-indicator"
              style={{ left: `${snapIndicatorTime * pxPerSec}px` }}
              aria-hidden="true"
            />
          )}
          {marqueeBox && (
            <div
              className="marquee-box"
              style={{
                left: `${marqueeBox.x1}px`,
                top: `${marqueeBox.y1}px`,
                width: `${Math.max(0, marqueeBox.x2 - marqueeBox.x1)}px`,
                height: `${Math.max(0, marqueeBox.y2 - marqueeBox.y1)}px`,
              }}
              aria-hidden="true"
            />
          )}

          {/* Video/Audio section divider lane */}
          <div
            className="track-section-divider track-lane-divider"
            style={{
              position: "absolute",
              top: `${DEFAULT_TIMELINE_RULER_HEIGHT + dividerY}px`,
              left: 0,
              right: 0,
              height: `${dividerHeight}px`,
            }}
          />

          <div
            className={`track-edge-zone-lane video ${dragOver && showVideoDropEdge ? "drag-active" : ""} ${dropTargetTrackId === "__above__" ? "active" : ""} ${dropTargetInvalid && dropTargetTrackId === "__above__" ? "drop-target-invalid" : ""}`}
            style={{
              position: "absolute",
              top: `${DEFAULT_TIMELINE_RULER_HEIGHT + videoEdgeZone.top}px`,
              left: 0,
              right: 0,
              height: `${videoEdgeZone.height}px`,
            }}
            aria-hidden="true"
          />
          <div
            className={`track-edge-zone-lane audio ${dragOver && showAudioDropEdge ? "drag-active" : ""} ${dropTargetTrackId === "__below__" ? "active" : ""} ${dropTargetInvalid && dropTargetTrackId === "__below__" ? "drop-target-invalid" : ""}`}
            style={{
              position: "absolute",
              top: `${DEFAULT_TIMELINE_RULER_HEIGHT + audioEdgeZone.top}px`,
              left: 0,
              right: 0,
              height: `${audioEdgeZone.height}px`,
            }}
            aria-hidden="true"
          />

          {/* Track lanes */}
          {allTracksLayout.map(({ track, height, top }) => (
            <div
              key={track.id}
              className={`track-lane ${track.type} ${track.hidden ? "hidden" : ""} ${laneDropClass(track.id)} ${track.locked ? "locked" : ""}`}
              style={{
                position: "absolute",
                top: `${DEFAULT_TIMELINE_RULER_HEIGHT + top}px`,
                left: 0,
                right: 0,
                height: `${height}px`,
              }}
              data-track-id={track.id}
            >
              {(clipsByTrack.get(track.id) || []).map((clip) => {
                const dur = clip.outPoint - clip.inPoint;
                const left = clip.startTime * pxPerSec;
                const width = Math.max(20, dur * pxPerSec);
                const isVideo = track.type === "video";
                const isText = clip.kind === "text";
                const trimmedLeft = clip.inPoint > 0.01;
                const trimmedRight =
                  !isText && clip.outPoint < clip.sourceDuration - 0.01;
                const {
                  fadeIn: visibleFadeIn,
                  fadeOut: visibleFadeOut,
                } = clampFadeValues({
                  duration: dur,
                  fadeIn: clip.fadeIn ?? 0,
                  fadeOut: clip.fadeOut ?? 0,
                });
                const fadeHandleW = 10;
                const fadeHandleH = 13;
                const fadeInPx = Math.min(
                  width,
                  (visibleFadeIn / Math.max(0.001, dur)) * width,
                );
                const fadeOutPx = Math.min(
                  width,
                  (visibleFadeOut / Math.max(0.001, dur)) * width,
                );
                const fadeInHandleLeft = Math.max(
                  2,
                  Math.min(
                    width - fadeHandleW,
                    fadeInPx > 0.001 ? fadeInPx - fadeHandleW : 2,
                  ),
                );
                const fadeOutHandleLeft =
                  fadeOutPx > 0.001
                    ? Math.max(
                        2,
                        Math.min(width - fadeHandleW, width - fadeOutPx),
                      )
                    : null;
                return (
                  <div
                    key={clip.id}
                    className={`clip ${isVideo ? "video-clip" : "audio-clip"} ${isText ? "text-clip" : ""} ${activeClipId === clip.id ? "active" : ""} ${selectedClipIds.has(clip.id) ? "selected" : ""} ${draggingIds?.has(clip.id) ? "dragging" : ""} ${track.locked ? "track-locked" : ""} ${track.hidden ? "hidden-track" : ""} ${clip.linkGroupId ? "linked" : ""}`}
                    style={{ left: `${left}px`, width: `${width}px` }}
                    onMouseDown={(e) => handleClipMouseDown(e, clip)}
                    onContextMenu={(e) => handleClipContextMenu(e, clip)}
                    title={`${clip.name}\nIn: ${formatTime(clip.inPoint)} · Out: ${formatTime(clip.outPoint)} · Dauer: ${formatTime(dur)}${clip.linkGroupId ? "\nVerknüpft mit Video/Audio-Partner" : ""}`}
                  >
                    {clip.linkGroupId && (
                      <span
                        className="clip-link-badge"
                        aria-hidden="true"
                        title="Verknüpft mit V+A-Partner"
                      >
                        ⛓
                      </span>
                    )}
                    <div
                      className={`trim-handle left ${trimmedLeft ? "trimmed" : ""}`}
                      onMouseDown={(e) => {
                        if (track.locked) return;
                        handleTrimMouseDown(e, clip, "left");
                      }}
                      title="Links trimmen"
                    />
                    {isText ? (
                      <div className="clip-content">
                        <span className="clip-kind-label">Text</span>
                        <span className="clip-name">
                          {clip.content?.text || clip.name}
                        </span>
                        <span className="clip-duration">
                          {formatTime(dur)}
                        </span>
                      </div>
                    ) : isVideo ? (
                      <>
                        {(() => {
                          const thumbs = thumbsMap[clip.videoId];
                          if (thumbs && thumbs.length > 0) {
                            const visible = buildThumbnailItems({
                              width,
                              thumbs,
                              inPoint: clip.inPoint,
                              outPoint: clip.outPoint,
                              sourceDuration: clip.sourceDuration,
                            });
                            return (
                              <div className="video-thumb-strip">
                                {visible.map((item) =>
                                  item.url ? (
                                    <div
                                      key={item.sourceIndex}
                                      className="video-thumb"
                                      style={{
                                        backgroundImage: `url(${item.url})`,
                                      }}
                                    />
                                  ) : (
                                    <div
                                      key={item.sourceIndex}
                                      className="video-thumb empty"
                                    />
                                  ),
                                )}
                              </div>
                            );
                          }
                          return (
                            <div
                              className={`video-thumb-strip ${thumbs === null ? "loading" : ""}`}
                            />
                          );
                        })()}
                        <div className="clip-content">
                          <span className="clip-name">{clip.name}</span>
                          <span className="clip-duration">
                            {formatTime(dur)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="waveform-shell">
                          {(() => {
                            const peaks = peaksMap[clip.videoId];
                            const bars = buildWaveformBars({
                              width,
                              peaks,
                              inPoint: clip.inPoint,
                              outPoint: clip.outPoint,
                              sourceDuration: clip.sourceDuration,
                              volume: clip.volume ?? 1,
                              fadeIn: visibleFadeIn,
                              fadeOut: visibleFadeOut,
                              seed: clip.id.length,
                            });
                            if (peaks && peaks.length > 0) {
                              return (
                                <div className="waveform">
                                  {bars.map((bar, i) => (
                                    <span
                                      key={i}
                                      className="wave-bar"
                                      style={{ height: `${bar.height}%` }}
                                    />
                                  ))}
                                </div>
                              );
                            }
                            return (
                              <div
                                className={`waveform ${peaks === null ? "loading" : ""}`}
                              >
                                {bars.map((bar, i) => (
                                  <span
                                    key={i}
                                    className="wave-bar placeholder"
                                    style={{ height: `${bar.height}%` }}
                                  />
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                        <VolumeCurve
                          clip={clip}
                          pxPerSec={pxPerSec}
                          selectedKeyframe={selectedKeyframe}
                          onBeginVolumeKeyframeDrag={onBeginVolumeKeyframeDrag}
                          onAddVolumeKeyframe={onAddVolumeKeyframe}
                          onBeginVolumeLineDrag={(event, targetClip, segment) => {
                            if (track.locked) return;
                            event.stopPropagation();
                            const shellEl = event.currentTarget
                              .closest(".clip")
                              ?.querySelector(".waveform-shell");
                            const shellHeight = shellEl
                              ? shellEl.offsetHeight
                              : 48;
                            const hasVolumeKeyframes =
                              Array.isArray(targetClip?.keyframes?.volume) &&
                              targetClip.keyframes.volume.length > 0;
                            volumeLineDragRef.current = {
                              clipId: targetClip.id,
                              startY: event.clientY,
                              startVolume: targetClip.volume ?? 1,
                              mode:
                                hasVolumeKeyframes && segment
                                  ? "volume-segment"
                                  : "clip-volume",
                              segment,
                              trackHeight: shellHeight,
                              historyBefore: createHistorySnapshot(),
                              historyPushed: false,
                            };
                          }}
                        />
                        <span className="clip-name">{clip.name}</span>
                      </>
                    )}
                    {/* Fade overlays */}
                    {visibleFadeIn > 0 && (
                      <div
                        className="fade-in-overlay"
                        style={{
                          width: `${fadeInPx}px`,
                        }}
                      >
                        <svg
                          className="fade-svg"
                          preserveAspectRatio="none"
                          viewBox="0 0 100 100"
                        >
                          <polygon points={FADE_IN_POLYGON} className="fade-poly" />
                          <polyline points={FADE_IN_POLYLINE} className="fade-envelope-line" />
                        </svg>
                      </div>
                    )}
                    {visibleFadeOut > 0 && (
                      <div
                        className="fade-out-overlay"
                        style={{
                          width: `${fadeOutPx}px`,
                        }}
                      >
                        <svg
                          className="fade-svg"
                          preserveAspectRatio="none"
                          viewBox="0 0 100 100"
                        >
                          <polygon points={FADE_OUT_POLYGON} className="fade-poly" />
                          <polyline points={FADE_OUT_POLYLINE} className="fade-envelope-line" />
                        </svg>
                      </div>
                    )}
                    {/* Fade handles (follow fade boundary along diagonal) */}
                    <button
                      type="button"
                      className="fade-handle-in"
                      style={{
                        left: `${fadeInHandleLeft}px`,
                        top: "2px",
                      }}
                      onMouseDown={(e) => {
                        if (track.locked) return;
                        handleFadeMouseDown?.(e, clip, "in");
                      }}
                      title={`Fade-In: ${visibleFadeIn.toFixed(1)}s`}
                      aria-label="Fade-In anpassen"
                    />
                    <button
                      type="button"
                      className="fade-handle-out"
                      style={
                        fadeOutHandleLeft != null
                          ? { left: `${fadeOutHandleLeft}px`, top: "2px" }
                          : { right: "2px", top: "2px" }
                      }
                      onMouseDown={(e) => {
                        if (track.locked) return;
                        handleFadeMouseDown?.(e, clip, "out");
                      }}
                      title={`Fade-Out: ${visibleFadeOut.toFixed(1)}s`}
                      aria-label="Fade-Out anpassen"
                    />
                    {!isVideo &&
                      !isText &&
                      handleCrossfadeMouseDown &&
                      crossfadeByLeftClipId.has(clip.id) &&
                      (() => {
                        const { rightClip, handleOffsetSec } =
                          crossfadeByLeftClipId.get(clip.id);
                        const handleLeft = Math.max(
                          6,
                          Math.min(width - 6, handleOffsetSec * pxPerSec),
                        );
                        return (
                          <button
                            type="button"
                            className="crossfade-handle"
                            style={{ left: `${handleLeft}px` }}
                            onMouseDown={(e) => {
                              if (track.locked) return;
                              handleCrossfadeMouseDown(e, clip, rightClip);
                            }}
                            title="Crossfade zum nächsten Clip"
                            aria-label="Crossfade zum nächsten Clip"
                          />
                        );
                      })()}
                    <div
                      className={`trim-handle right ${trimmedRight ? "trimmed" : ""}`}
                      onMouseDown={(e) => {
                        if (track.locked) return;
                        handleTrimMouseDown(e, clip, "right");
                      }}
                      title="Rechts trimmen"
                    />
                    {isVideo && (
                      <ClipKeyframes
                        clip={clip}
                        pxPerSec={pxPerSec}
                        selectedKeyframe={selectedKeyframe}
                        onSelectKeyframe={onSelectKeyframe}
                        onBeginKeyframeDrag={onBeginKeyframeDrag}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {/* Track move preview */}
          {trackMovePreview?.autoTracks?.map((track) => {
            const zoneTop = getAutoTrackZoneTop(
              track.type,
              track.edge || "end",
            );
            const isVideo = track.type === "video";
            const zoneClips = clipsByTrack.get(track.id) || [];
            return (
              <div
                key={track.id}
                className={`track-auto-zone-lane ${track.type} active`}
                style={{ top: `${zoneTop}px` }}
              >
                <span className="track-auto-zone-label">
                  + {track.type === "audio" ? "Audio-Spur" : "Video-Spur"}
                </span>
                {zoneClips.map((clip) => {
                  const dur = clip.outPoint - clip.inPoint;
                  const left = clip.startTime * pxPerSec;
                  const width = Math.max(20, dur * pxPerSec);
                  return (
                    <div
                      key={clip.id}
                      className={`clip ghost-clip track-move-ghost ${isVideo ? "video-clip" : "audio-clip"} dragging`}
                      style={{ left: `${left}px`, width: `${width}px` }}
                    >
                      <span className="clip-name">{clip.name}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
