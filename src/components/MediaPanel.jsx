export const MediaPanel = ({
  videos,
  visibleVideos,
  activeId,
  thumbsMap,
  videoDurations,
  handleDragStart,
  handleDragEnd,
  handleSelectMedia,
  handleDoubleClickMedia,
  handleRemoveMedia,
  handleFileChange,
  isImportableMediaFile,
  Icon,
  formatTime,
}) => {
  return (
    <div
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
      {visibleVideos.map((v) => (
        <div
          key={v.id}
          className={`video-item ${v.id === activeId ? "active" : ""}`}
          draggable
          onDragStart={(e) => handleDragStart(e, v)}
          onDragEnd={handleDragEnd}
          onClick={() => handleSelectMedia(v.id)}
          onDoubleClick={() => handleDoubleClickMedia(v.id)}
          title={`${v.path}\nDoppelklick = Vorschau · Ziehen = auf Timeline`}
        >
          {(() => {
            const firstThumb = thumbsMap[v.id]?.find?.((t) => !!t);
            if (firstThumb) {
              return (
                <div
                  className="video-thumb-preview"
                  style={{ backgroundImage: `url(${firstThumb})` }}
                  aria-hidden="true"
                />
              );
            }
            return (
              <div className="video-icon">
                {v.mediaType === "image" ? (
                  <Icon.Image />
                ) : v.mediaType === "audio" ? (
                  <Icon.AudioTrack />
                ) : (
                  <Icon.Play />
                )}
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
      ))}
    </div>
  );
};
