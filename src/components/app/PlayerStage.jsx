import { resolveAnimatedClip } from "../../lib/keyframes.js";
import { getPreviewMediaSrc } from "../../lib/proxyGenerator.js";
import { useRef, useEffect, useState } from "react";

export function PlayerStage({
  mainContentClassName,
  aspectRatio,
  isTimelineMonitorActive,
  isSourceMonitorActive,
  timelineVisualLayers,
  timelineAudioLayers,
  topTimelineClip,
  timelineTime,
  videoSrc,
  activeVideo,
  activeSourceSelection,
  previewTime,
  videoRef,
  playbackModeRef,
  playingClipIdRef,
  imagePlaybackRef,
  timelinePlaybackRef,
  setAspectRatio,
  setIsPlaying,
  handleSourceVideoPlay,
  setTimelineVisualRef,
  setTimelineAudioRef,
  handleLoadedMetadata,
  handlePreviewTimeUpdate,
  beginSourcePreviewSeek,
  beginSourceTimelineDrag,
  setSourcePointAtPreviewTime,
  handleSourceDragStart,
  handleDragEnd,
  settings,
  setSettings,
  perfStats,
  previewTargetClipId,
  onPreviewClipMouseDown,
  interaction,
  previewSnapGuides,
  timelinePreviewRef,
  formatTime,
  formatTC,
  Icon,
  timelineVisualRefs,
}) {
  const [previewChromeHover, setPreviewChromeHover] = useState(false);
  const transformChromeActive =
    previewChromeHover || interaction?.type === "preview-transform";
  const prevQualityRef = useRef(settings.previewQuality);
  const getPreviewTransform = (clip) => {
    const scaleBase = clip.scale ?? 100;
    const scaleXValue = clip.scaleX ?? scaleBase;
    const scaleYValue = clip.scaleY ?? scaleBase;
    const scaleX = (scaleXValue / 100) * (clip.flipH ? -1 : 1);
    const scaleY = (scaleYValue / 100) * (clip.flipV ? -1 : 1);
    return `translate(${clip.positionX ?? 0}px, ${clip.positionY ?? 0}px) rotate(${clip.rotation ?? 0}deg) scale(${scaleX}, ${scaleY})`;
  };
  const getTextClipStyle = (clip) => {
    const style = clip.content?.style || {};
    const fontSize = Number(style.fontSize);
    const align = ["left", "center", "right"].includes(style.align)
      ? style.align
      : "center";
    return {
      color: typeof style.color === "string" && style.color ? style.color : "#ffffff",
      fontFamily: typeof style.fontFamily === "string" && style.fontFamily
        ? style.fontFamily
        : "Inter",
      fontSize: `${Number.isFinite(fontSize) ? Math.max(1, fontSize) : 48}px`,
      fontWeight: typeof style.fontWeight === "string" && style.fontWeight
        ? style.fontWeight
        : "600",
      textAlign: align,
      justifySelf:
        align === "left" ? "start" : align === "right" ? "end" : "center",
    };
  };
  const previewTransformClip =
    isTimelineMonitorActive && previewTargetClipId
      ? timelineVisualLayers
          .map(({ clip }) => resolveAnimatedClip(clip, timelineTime))
          .find((clip) => clip.id === previewTargetClipId) || null
      : null;
  const renderPreviewHandle = (mode, className, title) => (
    <button
      type="button"
      className={`timeline-preview-handle ${className}`}
      onMouseDown={(event) =>
        onPreviewClipMouseDown?.(event, previewTransformClip, mode)
      }
      title={title}
      aria-label={title}
    />
  );

  useEffect(() => {
    if (prevQualityRef.current !== settings.previewQuality) {
      prevQualityRef.current = settings.previewQuality;
      timelineVisualRefs.current.forEach((node) => {
        if (node) {
          const currentTime = node.currentTime;
          node.load();
          node.currentTime = currentTime;
        }
      });
    }
  }, [settings.previewQuality, timelineVisualRefs]);
  return (
    <main className={mainContentClassName}>
      <div
        className={`player-wrapper ${aspectRatio === "9:16" ? "ar-portrait" : "ar-landscape"}`}
      >
        <div className="preview-meta-row">
          <select
            className="preview-quality-select"
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
          {perfStats && <span>FPS {perfStats.fps}</span>}
          {perfStats && <span>V {perfStats.visualNodes}</span>}
          {perfStats && <span>A {perfStats.audioNodes}</span>}
          {perfStats?.memory != null && <span>{perfStats.memory} MB</span>}
        </div>
        <div className="ar-switcher">
          {["16:9", "9:16"].map((ar) => (
            <button
              key={ar}
              className={`ar-btn ${aspectRatio === ar ? "active" : ""}`}
              onClick={() => setAspectRatio(ar)}
              title={ar === "16:9" ? "Querformat (16:9)" : "Hochformat (9:16)"}
            >
              <span className={`ar-icon ar-icon-${ar.replace(":", "-")}`} />
              {ar}
            </button>
          ))}
        </div>

        <div className="video-container">
          {isTimelineMonitorActive ? (
            <div
              className="timeline-composite-preview"
              ref={timelinePreviewRef}
              onMouseEnter={() => setPreviewChromeHover(true)}
              onMouseLeave={() => setPreviewChromeHover(false)}
            >
              <div className="preview-grid-overlay" aria-hidden="true" />
              {timelineVisualLayers.length > 0 ? (
                timelineVisualLayers.map(({ clip: rawClip, media }, index) => {
                  const clip = resolveAnimatedClip(rawClip, timelineTime);
                  const isPreviewTarget = clip.id === previewTargetClipId;
                  const isTextClip = clip.kind === "text";
                  const mediaType = media?.mediaType || "video";
                  const previewSrc = getPreviewMediaSrc(
                    media,
                    settings.previewQuality,
                  ) || clip.src;
                  const clipDuration = clip.outPoint - clip.inPoint;
                  const fadeIn = clip.fadeIn ?? 0;
                  const fadeOut = clip.fadeOut ?? 0;
                  const timeInClip = Math.max(0, timelineTime - clip.startTime);
                  let fadeOpacity = 1;
                  if (fadeIn > 0 && timeInClip < fadeIn) {
                    fadeOpacity = timeInClip / fadeIn;
                  }
                  const timeToEnd = clipDuration - timeInClip;
                  if (fadeOut > 0 && timeToEnd < fadeOut) {
                    fadeOpacity = Math.min(fadeOpacity, timeToEnd / fadeOut);
                  }
                  const opacity = fadeOpacity * ((clip.opacity ?? 100) / 100);
                  const brightness = clip.brightness ?? 0;
                  const contrast = clip.contrast ?? 0;
                  const saturation = clip.saturation ?? 0;
                  const cssFilters = [
                    brightness !== 0
                      ? `brightness(${Math.max(0, 1 + brightness / 100).toFixed(2)})`
                      : "",
                    contrast !== 0
                      ? `contrast(${Math.max(0, 1 + contrast / 100).toFixed(2)})`
                      : "",
                    saturation !== 0
                      ? `saturate(${Math.max(0, 1 + saturation / 100).toFixed(2)})`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <div
                      key={`${clip.id}-${settings.previewQuality}`}
                      className={`timeline-preview-layer ${isPreviewTarget ? "selected" : ""}`}
                      onMouseDown={
                        onPreviewClipMouseDown
                          ? (event) => onPreviewClipMouseDown(event, clip, "move")
                          : undefined
                      }
                      style={{
                        zIndex: index + 1,
                        opacity,
                        transform: getPreviewTransform(clip),
                        filter: cssFilters || undefined,
                      }}
                    >
                      {isTextClip ? (
                        <div
                          className="timeline-preview-text"
                          style={getTextClipStyle(clip)}
                        >
                          {clip.content?.text || clip.name || "Text"}
                        </div>
                      ) : mediaType === "image" ? (
                          <img
                            src={previewSrc}
                          className="timeline-preview-media"
                          alt={clip.name}
                          draggable={false}
                          key={previewSrc}
                        />
                      ) : (
                          <video
                            ref={setTimelineVisualRef(clip.id)}
                            className="timeline-preview-media"
                            src={previewSrc}
                            key={previewSrc}
                          muted
                          playsInline
                          preload="auto"
                          draggable={false}
                        />
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="empty-overlay timeline-empty-preview">
                  <p>Keine Videoebene am Playhead</p>
                </div>
              )}
              {previewTransformClip && onPreviewClipMouseDown && (
                <div
                  className={`timeline-preview-transform-overlay ${
                    transformChromeActive ? "is-active" : ""
                  }`}
                  onMouseDown={(event) =>
                    onPreviewClipMouseDown(event, previewTransformClip, "move")
                  }
                  style={{
                    transform: getPreviewTransform(previewTransformClip),
                  }}
                >
                  <div className="timeline-preview-frame" />
                  <div className="timeline-preview-center" aria-hidden="true" />
                  {renderPreviewHandle("resize-nw", "resize-nw", "Oben links skalieren")}
                  {renderPreviewHandle("resize-ne", "resize-ne", "Oben rechts skalieren")}
                  {renderPreviewHandle("resize-se", "resize-se", "Unten rechts skalieren")}
                  {renderPreviewHandle("resize-sw", "resize-sw", "Unten links skalieren")}
                  {renderPreviewHandle("resize-top", "resize-top", "Hoehe oben skalieren")}
                  {renderPreviewHandle("resize-right", "resize-right", "Breite rechts skalieren")}
                  {renderPreviewHandle("resize-bottom", "resize-bottom", "Hoehe unten skalieren")}
                  {renderPreviewHandle("resize-left", "resize-left", "Breite links skalieren")}
                  {renderPreviewHandle("rotate", "rotate", "Rotieren")}
                </div>
              )}
              {previewSnapGuides && (
                <div className="preview-snap-guides" aria-hidden="true">
                  {Number.isFinite(previewSnapGuides.x) && (
                    <span
                      className="preview-snap-guide vertical"
                      style={{ left: `${previewSnapGuides.x}px` }}
                    />
                  )}
                  {Number.isFinite(previewSnapGuides.y) && (
                    <span
                      className="preview-snap-guide horizontal"
                      style={{ top: `${previewSnapGuides.y}px` }}
                    />
                  )}
                </div>
              )}
              <div className="timeline-audio-bus" aria-hidden="true">
                {timelineAudioLayers.map(({ clip, media }) => (
                  <audio
                    key={clip.id}
                    ref={setTimelineAudioRef(clip.id)}
                    src={media?.src || clip.src}
                    preload="auto"
                  />
                ))}
              </div>
            </div>
          ) : videoSrc && activeVideo?.mediaType === "image" ? (
            <img
              key={videoSrc}
              src={videoSrc}
              className="video player-image"
              alt={activeVideo?.name}
              draggable={false}
            />
          ) : videoSrc ? (
            <video
              ref={videoRef}
              key={videoSrc}
              className="video"
              onPlay={handleSourceVideoPlay || (() => setIsPlaying(true))}
              onPause={() => {
                if (
                  playbackModeRef.current === "timeline" &&
                  playingClipIdRef.current
                ) {
                  return;
                }
                if (!imagePlaybackRef.current && !timelinePlaybackRef.current) {
                  setIsPlaying(false);
                }
              }}
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handlePreviewTimeUpdate}
              src={videoSrc}
            />
          ) : (
            <div className="empty-overlay">
              <p>Waehle ein Medium aus der Mediathek</p>
              <p className="hint">Auswaehlen - Ziehen auf die Timeline</p>
            </div>
          )}
          {isSourceMonitorActive && (
            <div className="preview-player-bar">
              <span className="preview-player-time">{formatTC(previewTime)}</span>
              <div className="preview-player-progress" aria-hidden="true">
                <div
                  className="preview-player-progress-fill"
                  style={{
                    width: `${Math.min(100, Math.max(0, (previewTime / activeSourceSelection.duration) * 100))}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {isTimelineMonitorActive ? (
          <div className="video-title-bar">
            <span className="title-name">
              Timeline-Komposition
              {topTimelineClip ? ` - ${topTimelineClip.name}` : ""}
            </span>
            <span className="media-type-badge">
              {timelineVisualLayers.length} Video - {timelineAudioLayers.length} Audio
            </span>
          </div>
        ) : (
          activeVideo && (
            <div className="video-title-bar">
              <span className="title-name">{activeVideo.name}</span>
              {activeVideo.mediaType === "image" && (
                <span className="media-type-badge">
                  Bild - {settings.imageDuration}s
                </span>
              )}
              {activeVideo.mediaType === "audio" && (
                <span className="media-type-badge">Audio</span>
              )}
            </div>
          )
        )}

        {isSourceMonitorActive && (
          <div className="source-trim-panel">
            <div className="source-trim-header">
              <span>Source In/Out</span>
              <strong>
                {formatTC(activeSourceSelection.inPoint)} -{" "}
                {formatTC(activeSourceSelection.outPoint)} (
                {formatTime(activeSourceSelection.clipDuration)})
              </strong>
              <div className="source-point-actions">
                <button
                  type="button"
                  onClick={() => setSourcePointAtPreviewTime("inPoint")}
                  title="In auf aktuelle Vorschauposition setzen"
                >
                  In
                </button>
                <button
                  type="button"
                  onClick={() => setSourcePointAtPreviewTime("outPoint")}
                  title="Out auf aktuelle Vorschauposition setzen"
                >
                  Out
                </button>
              </div>
            </div>
            <div
              className="source-preview-timeline"
              onMouseDown={beginSourcePreviewSeek}
              title="Vorschauposition setzen; In/Out-Handles ziehen"
            >
              <div
                className="source-preview-window"
                style={{
                  left: `${(activeSourceSelection.inPoint / activeSourceSelection.duration) * 100}%`,
                  width: `${(activeSourceSelection.clipDuration / activeSourceSelection.duration) * 100}%`,
                }}
              />
              <div
                className="source-preview-playhead"
                style={{
                  left: `${Math.min(100, Math.max(0, (previewTime / activeSourceSelection.duration) * 100))}%`,
                }}
              />
              <button
                type="button"
                className="source-preview-handle in"
                style={{
                  left: `${(activeSourceSelection.inPoint / activeSourceSelection.duration) * 100}%`,
                }}
                onMouseDown={(e) => beginSourceTimelineDrag(e, "inPoint")}
                aria-label="Source In setzen"
                title="In ziehen"
              />
              <button
                type="button"
                className="source-preview-handle out"
                style={{
                  left: `${(activeSourceSelection.outPoint / activeSourceSelection.duration) * 100}%`,
                }}
                onMouseDown={(e) => beginSourceTimelineDrag(e, "outPoint")}
                aria-label="Source Out setzen"
                title="Out ziehen"
              />
            </div>
            <div className="source-drag-actions">
              <button
                type="button"
                className="source-drag-btn video-source"
                draggable
                onDragStart={(e) => handleSourceDragStart(e, "av")}
                onDragEnd={handleDragEnd}
                aria-label={
                  activeVideo.mediaType === "image"
                    ? "Bildauswahl in die Timeline ziehen"
                    : "Auswahl als Video mit Audio in die Timeline ziehen"
                }
                title={
                  activeVideo.mediaType === "image"
                    ? "Bildauswahl in die Timeline ziehen"
                    : "Auswahl als Video mit Audio in die Timeline ziehen"
                }
              >
                <Icon.VideoTrack />{" "}
                {activeVideo.mediaType === "image" ? "Bild" : "Video + Audio"}
              </button>
              {activeVideo.mediaType === "video" && (
                <button
                  type="button"
                  className="source-drag-btn audio-source"
                  draggable
                  onDragStart={(e) => handleSourceDragStart(e, "audio")}
                  onDragEnd={handleDragEnd}
                  aria-label="Nur Audio der Auswahl in die Timeline ziehen"
                  title="Nur Audio der Auswahl in die Timeline ziehen"
                >
                  <Icon.AudioTrack /> Nur Audio
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
