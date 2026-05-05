import { MediaPanel } from "../MediaPanel.jsx";

export function Sidebar({
  sidebarTab,
  sidebarItems,
  editorFocus,
  focusSource,
  videos,
  visibleVideos,
  activeId,
  thumbsMap,
  videoDurations,
  mediaSearch,
  mediaTypeFilter,
  mediaSort,
  handleImport,
  handleDragStart,
  handleDragEnd,
  handleSelectMedia,
  handleDoubleClickMedia,
  handleRemoveMedia,
  handleFileChange,
  isImportableMediaFile,
  onSidebarTabChange,
  onMediaSearchChange,
  onMediaTypeFilterChange,
  onMediaSortChange,
  Icon,
  formatTime,
}) {
  return (
    <>
      <div className="sidebar-tabs-strip">
        {sidebarItems.map(({ id, label, icon: TabIcon }) => (
          <button
            key={id}
            className={`sidebar-tab-btn ${sidebarTab === id ? "active" : ""}`}
            onClick={() => onSidebarTabChange(id)}
            title={label}
          >
            <TabIcon />
            {label}
          </button>
        ))}
      </div>

      <aside
        className={`sidebar ${editorFocus === focusSource ? "focus-source" : ""}`}
      >
        {sidebarTab === "media" ? (
          <>
            <div className="sidebar-header">
              <h2 className="sidebar-title">Project Media</h2>
              <button
                className={`import-btn ${videos.length === 0 ? "pulse" : ""}`}
                onClick={handleImport}
                title="Videos importieren"
              >
                <Icon.Plus /> Import
              </button>
            </div>
            <div className="media-bin-controls">
              <input
                className="media-search-input"
                value={mediaSearch}
                onChange={(e) => onMediaSearchChange(e.target.value)}
                placeholder="Medien suchen..."
                aria-label="Medien suchen"
              />
              <div className="media-filter-row">
                <select
                  value={mediaTypeFilter}
                  onChange={(e) => onMediaTypeFilterChange(e.target.value)}
                  aria-label="Medientyp filtern"
                >
                  <option value="all">Alle Typen</option>
                  <option value="video">Video</option>
                  <option value="audio">Audio</option>
                  <option value="image">Bild</option>
                </select>
                <select
                  value={mediaSort}
                  onChange={(e) => onMediaSortChange(e.target.value)}
                  aria-label="Mediathek sortieren"
                >
                  <option value="importedAt">Neueste</option>
                  <option value="name">Name</option>
                  <option value="duration">Dauer</option>
                  <option value="type">Typ</option>
                </select>
              </div>
            </div>
            <div
              className="video-list"
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "copy";
              }}
              onDrop={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const files = Array.from(e.dataTransfer.files).filter(
                  isImportableMediaFile,
                );
                if (files.length === 0) return;
                await handleFileChange({ target: { files } });
              }}
            >
              <MediaPanel
                videos={videos}
                visibleVideos={visibleVideos}
                activeId={activeId}
                thumbsMap={thumbsMap}
                videoDurations={videoDurations}
                handleDragStart={handleDragStart}
                handleDragEnd={handleDragEnd}
                handleSelectMedia={handleSelectMedia}
                handleDoubleClickMedia={handleDoubleClickMedia}
                handleRemoveMedia={handleRemoveMedia}
                handleFileChange={handleFileChange}
                isImportableMediaFile={isImportableMediaFile}
                Icon={Icon}
                formatTime={formatTime}
              />
            </div>
          </>
        ) : (
          <div className="sidebar-placeholder">
            <div className="sidebar-placeholder-icon">
              {sidebarTab === "effects" && "Effects"}
              {sidebarTab === "transitions" && "Trans"}
              {sidebarTab === "text" && "Text"}
              {sidebarTab === "audio" && "Audio"}
              {sidebarTab === "elements" && "Elem"}
            </div>
            <p className="sidebar-placeholder-title">
              {sidebarItems.find((item) => item.id === sidebarTab)?.label}
            </p>
            <p className="sidebar-placeholder-hint">
              Hier wird diese Funktion verfuegbar sein.
            </p>
          </div>
        )}
      </aside>
    </>
  );
}
