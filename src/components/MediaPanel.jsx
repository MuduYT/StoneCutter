import { useRef } from "react";
import { formatPreviewQualityLabel } from "../lib/proxyGenerator.js";
import { useMediaManagement } from "../hooks/useMediaManagement.js";
import { useVirtualList } from "../hooks/useVirtualList.js";

const getProxyBadgeLabel = (media) => {
  if (media?.mediaType !== "video") return null;
  const proxies = media.previewProxies || {};
  const proxyKeys = Object.keys(proxies);
  const quality =
    media.proxyQuality && (proxies[media.proxyQuality] || media.proxySrc)
      ? media.proxyQuality
      : proxyKeys[0];
  if (!quality) return null;
  if (!proxies[quality]?.proxySrc && !(media.proxyQuality === quality && media.proxySrc)) {
    return null;
  }
  return formatPreviewQualityLabel(quality);
};

export const MediaPanel = ({
  onMediaContextMenu,
  Icon,
  formatTime,
}) => {
  const containerRef = useRef(null);
  const {
    videos,
    visibleVideos,
    activeId,
    selectedMediaIds,
    offlineMediaIds,
    thumbsMap,
    videoDurations,
    handleDragStart,
    handleDragEnd,
    handleSelectMedia,
    handleDoubleClickMedia,
    handleRemoveMedia,
    handleFileChange,
    isImportableMediaFile,
  } = useMediaManagement();
  const { virtualItems, totalHeight } = useVirtualList({
    items: visibleVideos,
    itemHeight: 44,
    overscan: 5,
    containerRef,
  });

  return (
    <div
      ref={containerRef}
      className="media-list"
      onDragOver={(e) => e.preventDefault()}
      onDrop={async (e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files).filter(
          isImportableMediaFile,
        );
        if (files.length === 0) return;
        await handleFileChange({ target: { files } });
      }}
    >
      {videos.length === 0 ? (
        <div className="empty-list">
          <p>Keine Medien importiert.</p>
          <p className="hint">
            Klicke "+ Import" oder ziehe Dateien hierher.
          </p>
        </div>
      ) : visibleVideos.length === 0 ? (
        <div className="empty-list">
          <p>Keine Treffer.</p>
          <p className="hint">Passe Suche oder Filter an.</p>
        </div>
      ) : null}
      {visibleVideos.length > 0 && (
        <div
          className="virtual-list-container"
          style={{ height: `${totalHeight}px` }}
        >
          {virtualItems.map(({ item: v, index, style }) => {
            const proxyBadgeLabel = getProxyBadgeLabel(v);
            const isOffline = offlineMediaIds?.has?.(v.id);
            return (
              <div
                key={v.id}
                className={`video-item ${v.id === activeId ? "active" : ""}${selectedMediaIds?.has?.(v.id) ? " selected" : ""}${isOffline ? " offline" : ""}`}
                style={style}
                draggable
                onDragStart={(e) => handleDragStart(e, v)}
                onDragEnd={handleDragEnd}
                onClick={(e) =>
                  handleSelectMedia(v.id, {
                    ctrlKey: e.ctrlKey || e.metaKey,
                    shiftKey: e.shiftKey,
                  })
                }
                onDoubleClick={() => handleDoubleClickMedia(v.id)}
                onContextMenu={onMediaContextMenu ? (e) => onMediaContextMenu(e, v.id) : undefined}
                title={isOffline ? "Datei nicht gefunden" : `${v.path}\nDoppelklick = Auswaehlen - Ziehen = auf Timeline`}
                data-index={index}
              >
                {(() => {
                const firstThumb = thumbsMap[v.id]?.find?.((t) => !!t);
                if (firstThumb) {
                  return (
                    <div className="media-thumb-wrap">
                      <div
                        className="video-thumb-preview"
                        style={{ backgroundImage: `url(${firstThumb})` }}
                        aria-hidden="true"
                      />
                      {proxyBadgeLabel && (
                        <span className="proxy-badge">{proxyBadgeLabel}</span>
                      )}
                      {isOffline && <span className="offline-dot" aria-hidden="true" />}
                    </div>
                  );
                }
                return (
                  <div className="media-thumb-wrap compact">
                    <div className="video-icon">
                      {v.mediaType === "image" ? (
                        <Icon.Image />
                      ) : v.mediaType === "audio" ? (
                        <Icon.AudioTrack />
                      ) : (
                        <Icon.Play />
                      )}
                    </div>
                    {proxyBadgeLabel && (
                      <span className="proxy-badge">{proxyBadgeLabel}</span>
                    )}
                    {isOffline && <span className="offline-dot" aria-hidden="true" />}
                  </div>
                );
                })()}
                <div className="video-info">
                  <div className="video-name">{v.name}</div>
                  <div className="media-meta-row">
                    <span>
                      {v.mediaType === "image"
                        ? "Bild"
                        : v.mediaType === "audio"
                          ? "Audio"
                          : "Video"}
                    </span>
                    {videoDurations[v.id] ? (
                      <span>{formatTime(videoDurations[v.id])}</span>
                    ) : null}
                  </div>
                </div>
                <button
                  className="remove-btn"
                  onClick={(e) => handleRemoveMedia(v.id, e)}
                  title="Aus Mediathek entfernen"
                >
                  <Icon.Trash />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
