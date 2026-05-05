import { useRef, useMemo } from "react";
import {
  buildThumbnailItems,
  buildWaveformBars,
} from "../lib/timelineRender.js";

export const Timeline = ({
  tracks,
  clips,
  pxPerSec,
  totalWidth,
  totalEnd,
  playheadX,
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
  formatTime,
  formatTC,
  scrubTooltip,
  setTimelinePlayheadRef,
  handleTracksMouseDown,
  handleTracksScroll,
  handlePlayheadMouseDown,
  handleClipMouseDown,
  handleClipDoubleClick,
  handleClipContextMenu,
  handleClipRemove,
  handleTrimMouseDown,
  handleUpdateTrack,
  handleRemoveTrack,
  handleAddTrack,
  setEditingTrackId,
  fadeDragRef,
  volumeLineDragRef,
  createHistorySnapshot,
  DEFAULT_TRACK_HEIGHT,
  getAutoTrackZoneTop,
  Icon,
}) => {
  const trackHeadersListRef = useRef(null);
  const tracksContentRef = useRef(null);

  const clipsByTrack = useMemo(() => {
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

  const tracksHeight = useMemo(() => {
    return tracks.reduce((sum, t) => sum + (t.height || DEFAULT_TRACK_HEIGHT), 0);
  }, [tracks, DEFAULT_TRACK_HEIGHT]);

  return (
    <div className="timeline-tracks">
      {/* Fixed track headers column */}
      <div className="track-headers">
        <div className="track-header time-header" />
        <div className="track-headers-list" ref={trackHeadersListRef}>
          {tracks.map((track) => {
            const sameTypeTracks = tracks.filter(t => t.type === track.type);
            const typeIndex = sameTypeTracks.indexOf(track) + 1;
            const typeLabel = `${track.type === "video" ? "V" : "A"}${typeIndex}`;
            return (
              <div
                key={track.id}
                className={`track-header-row ${track.type === "video" ? "video" : "audio"} ${dropTargetTrackId === track.id || trackMoveTargetIds.has(track.id) ? "drop-target" : ""}`}
                style={{
                  height: `${track.height || DEFAULT_TRACK_HEIGHT}px`,
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
                <div className="track-header-controls">
                  <button
                    className={`track-btn visibility ${track.hidden ? "hidden" : ""}`}
                    onClick={() =>
                      handleUpdateTrack(track.id, { hidden: !track.hidden })
                    }
                    title={track.hidden ? "Spur einblenden" : "Spur ausblenden"}
                  >
                    {track.hidden ? "◌" : "👁"}
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
                    🔒
                  </button>
                  {tracks.length > 1 && (
                    <button
                      className="track-btn delete"
                      onClick={() => handleRemoveTrack(track.id)}
                      title="Spur löschen"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {/* Drop target below tracks */}
          {dragOver && (
            <div
              className={`track-header-row drop-target-below ${dropTargetTrackId === "__below__" ? "active" : ""}`}
            >
              <span>
                {dragOver
                  ? dropZoneTrackMode === "audio"
                    ? "+ Audio-Spur"
                    : "+ Video-Spur"
                  : "+ Neue Spur"}
              </span>
            </div>
          )}
        </div>
        {/* Add track buttons */}
        <div className="track-header-actions">
          <button
            className="add-track-btn"
            onClick={() => handleAddTrack("video")}
            title="Video-Spur hinzufügen"
          >
            + Video
          </button>
          <button
            className="add-track-btn"
            onClick={() => handleAddTrack("audio")}
            title="Audio-Spur hinzufügen"
          >
            + Audio
          </button>
        </div>
      </div>

      <div
        className="tracks-content"
        ref={tracksContentRef}
        onMouseDown={handleTracksMouseDown}
        onScroll={handleTracksScroll}
      >
        <div
          className="tracks-inner"
          style={{
            width: `${totalWidth}px`,
            minHeight: `${30 + tracksHeight + 60}px`,
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
              style={{ "--playhead-x": `${playheadX}px` }}
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

          {/* Track lanes */}
          {tracks.map((track) => (
            <div
              key={track.id}
              className={`track-lane ${track.type} ${dropTargetTrackId === track.id || trackMoveTargetIds.has(track.id) ? "drop-target" : ""} ${track.locked ? "locked" : ""}`}
              style={{
                height: `${track.height || DEFAULT_TRACK_HEIGHT}px`,
              }}
              data-track-id={track.id}
            >
              {(clipsByTrack.get(track.id) || []).map((clip) => {
                const dur = clip.outPoint - clip.inPoint;
                const left = clip.startTime * pxPerSec;
                const width = Math.max(20, dur * pxPerSec);
                const isVideo = track.type === "video";
                const trimmedLeft = clip.inPoint > 0.01;
                const trimmedRight =
                  clip.outPoint < clip.sourceDuration - 0.01;
                return (
                  <div
                    key={clip.id}
                    className={`clip ${isVideo ? "video-clip" : "audio-clip"} ${activeClipId === clip.id ? "active" : ""} ${selectedClipIds.has(clip.id) ? "selected" : ""} ${draggingIds?.has(clip.id) ? "dragging" : ""} ${track.locked ? "track-locked" : ""} ${clip.linkGroupId ? "linked" : ""}`}
                    style={{ left: `${left}px`, width: `${width}px` }}
                    onMouseDown={(e) =>
                      !track.locked && handleClipMouseDown(e, clip)
                    }
                    onDoubleClick={(e) => handleClipDoubleClick(clip, e)}
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
                      onMouseDown={(e) =>
                        !track.locked &&
                        handleTrimMouseDown(e, clip, "left")
                      }
                      title="Links trimmen"
                    />
                    {isVideo ? (
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
                              fadeIn: clip.fadeIn ?? 0,
                              fadeOut: clip.fadeOut ?? 0,
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
                        {/* Volume line */}
                        <div
                          className="vol-line-overlay"
                          style={{
                            top: `${Math.max(8, Math.min(88, (1 - Math.min(2, clip.volume ?? 1) / 2) * 100))}%`,
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            const shellEl = e.currentTarget
                              .closest(".clip")
                              ?.querySelector(".waveform-shell");
                            const shellHeight = shellEl
                              ? shellEl.offsetHeight
                              : 48;
                            volumeLineDragRef.current = {
                              clipId: clip.id,
                              startY: e.clientY,
                              startVolume: clip.volume ?? 1,
                              trackHeight: shellHeight,
                              historyBefore: createHistorySnapshot(),
                              historyPushed: false,
                            };
                          }}
                        >
                          <span className="vol-line-bar" />
                          <span className="vol-line-handle" />
                          <span className="vol-line-label">
                            {Math.round((clip.volume ?? 1) * 100)}%
                          </span>
                        </div>
                        <span className="clip-name">{clip.name}</span>
                      </>
                    )}
                    {/* Fade overlays */}
                    {(clip.fadeIn ?? 0) > 0 && (
                      <div
                        className="fade-in-overlay"
                        style={{
                          width: `${Math.min(width, ((clip.fadeIn ?? 0) / Math.max(0.001, dur)) * width)}px`,
                        }}
                      >
                        <svg
                          className="fade-svg"
                          preserveAspectRatio="none"
                          viewBox="0 0 100 100"
                        >
                          <polygon points="0,100 100,0 100,100" className="fade-poly" />
                          <polyline points="0,100 100,0" className="fade-envelope-line" />
                          <circle cx="100" cy="0" r="4" className="fade-envelope-point" />
                        </svg>
                      </div>
                    )}
                    {(clip.fadeOut ?? 0) > 0 && (
                      <div
                        className="fade-out-overlay"
                        style={{
                          width: `${Math.min(width, ((clip.fadeOut ?? 0) / Math.max(0.001, dur)) * width)}px`,
                        }}
                      >
                        <svg
                          className="fade-svg"
                          preserveAspectRatio="none"
                          viewBox="0 0 100 100"
                        >
                          <polygon points="0,0 0,100 100,100" className="fade-poly" />
                          <polyline points="0,0 100,100" className="fade-envelope-line" />
                          <circle cx="0" cy="0" r="4" className="fade-envelope-point" />
                        </svg>
                      </div>
                    )}
                    {/* Fade handles */}
                    <div
                      className="fade-handle-in"
                      style={{
                        left: `${Math.max(0, Math.min(width - 12, ((clip.fadeIn ?? 0) / Math.max(0.001, dur)) * width))}px`,
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        fadeDragRef.current = {
                          clipId: clip.id,
                          side: "in",
                          startX: e.clientX,
                          startFade: clip.fadeIn ?? 0,
                          dur,
                          pxPerSec,
                          historyBefore: createHistorySnapshot(),
                          historyPushed: false,
                        };
                      }}
                      title={`Fade-In: ${(clip.fadeIn ?? 0).toFixed(1)}s`}
                    />
                    <div
                      className="fade-handle-out"
                      style={{
                        right: `${Math.max(0, Math.min(width - 12, ((clip.fadeOut ?? 0) / Math.max(0.001, dur)) * width))}px`,
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        fadeDragRef.current = {
                          clipId: clip.id,
                          side: "out",
                          startX: e.clientX,
                          startFade: clip.fadeOut ?? 0,
                          dur,
                          pxPerSec,
                          historyBefore: createHistorySnapshot(),
                          historyPushed: false,
                        };
                      }}
                      title={`Fade-Out: ${(clip.fadeOut ?? 0).toFixed(1)}s`}
                    />
                    <button
                      className="clip-remove"
                      onClick={(e) => handleClipRemove(clip.id, e)}
                      onMouseDown={(e) => e.stopPropagation()}
                      title="Aus Timeline entfernen"
                    >
                      <Icon.Trash />
                    </button>
                    <div
                      className={`trim-handle right ${trimmedRight ? "trimmed" : ""}`}
                      onMouseDown={(e) =>
                        !track.locked &&
                        handleTrimMouseDown(e, clip, "right")
                      }
                      title="Rechts trimmen"
                    />
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
