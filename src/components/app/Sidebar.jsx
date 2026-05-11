import { useState } from "react";
import { MediaPanel } from "../MediaPanel.jsx";
import { AudioPanel } from "./AudioPanel.jsx";

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
  folders,
  selectedFolderId,
  setSelectedFolderId,
  handleCreateFolder,
  handleDeleteFolder,
  handleMoveMediaToFolder,
  audioItems,
  audioFolders,
  isTauri,
  importAudioDialog,
  importAudioFromFiles,
  removeAudioItem,
  createAudioFolder,
  deleteAudioFolder,
  moveAudioToFolder,
  onAudioDragStart,
  Icon,
  formatTime,
}) {
  const [mediaContextMenu, setMediaContextMenu] = useState(null); // { x, y, mediaId }

  const handleMediaContextMenu = (e, mediaId) => {
    e.preventDefault();
    e.stopPropagation();
    setMediaContextMenu({ x: e.clientX, y: e.clientY, mediaId });
  };

  const closeMediaContextMenu = () => setMediaContextMenu(null);

  const handleMoveToFolder = (folderId) => {
    if (mediaContextMenu) {
      handleMoveMediaToFolder(mediaContextMenu.mediaId, folderId);
      closeMediaContextMenu();
    }
  };

  const handleTextDragStart = (event) => {
    event.dataTransfer.setData("application/x-stonecutter-asset-kind", "text");
    event.dataTransfer.setData("application/x-stonecutter-text-preset", "standard");
    event.dataTransfer.setData("application/x-stonecutter-track-mode", "video");
    event.dataTransfer.setData("text/plain", "stonecutter:text:standard");
    event.dataTransfer.effectAllowed = "copy";
  };

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
        onClick={() => mediaContextMenu && closeMediaContextMenu()}
      >
        {sidebarTab === "media" ? (
          <>
            <div className="sidebar-header">
              <h2 className="sidebar-title">Project Media</h2>
              <button
                className={`import-btn ${videos.length === 0 ? "pulse" : ""}`}
                onClick={handleImport}
                title="Medien importieren"
              >
                <Icon.Plus /> Import
              </button>
              <button
                className="folder-new-btn"
                onClick={handleCreateFolder}
                title="Neuen Ordner erstellen"
              >
                <Icon.Folder /> +
              </button>
            </div>

            {folders && folders.length > 0 && (
              <div className="folder-nav">
                <button
                  className={`folder-chip ${!selectedFolderId ? "active" : ""}`}
                  onClick={() => setSelectedFolderId(null)}
                >
                  Alle
                </button>
                {folders.map((f) => (
                  <button
                    key={f.id}
                    className={`folder-chip ${selectedFolderId === f.id ? "active" : ""}`}
                    onClick={() =>
                      setSelectedFolderId(f.id === selectedFolderId ? null : f.id)
                    }
                    onContextMenu={(e) => {
                      e.preventDefault();
                      handleDeleteFolder(f.id);
                    }}
                    title={`${f.name} (Rechtsklick zum Löschen)`}
                  >
                    <Icon.Folder /> {f.name}
                  </button>
                ))}
              </div>
            )}

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
                onMediaContextMenu={folders && folders.length > 0 ? handleMediaContextMenu : undefined}
                Icon={Icon}
                formatTime={formatTime}
              />
            </div>

            {mediaContextMenu && (
              <div
                className="context-menu"
                style={{
                  position: "fixed",
                  left: mediaContextMenu.x,
                  top: mediaContextMenu.y,
                }}
                onMouseLeave={closeMediaContextMenu}
              >
                {folders && folders.length > 0 && (
                  <>
                    <div className="context-menu-label">In Ordner verschieben</div>
                    {folders.map((f) => (
                      <button
                        key={f.id}
                        className="context-menu-item"
                        onClick={() => handleMoveToFolder(f.id)}
                      >
                        <Icon.Folder /> {f.name}
                      </button>
                    ))}
                    <button
                      className="context-menu-item"
                      onClick={() => handleMoveToFolder(null)}
                    >
                      Aus Ordner entfernen
                    </button>
                    <div className="context-menu-divider" />
                  </>
                )}
                <button
                  className="context-menu-item danger"
                  onClick={() => {
                    handleRemoveMedia(mediaContextMenu.mediaId);
                    closeMediaContextMenu();
                  }}
                >
                  <Icon.Trash /> Löschen
                </button>
              </div>
            )}
          </>
        ) : sidebarTab === "audio" ? (
          <AudioPanel
            audioItems={audioItems}
            audioFolders={audioFolders}
            isTauri={isTauri}
            importAudioDialog={importAudioDialog}
            importAudioFromFiles={importAudioFromFiles}
            removeAudioItem={removeAudioItem}
            createAudioFolder={createAudioFolder}
            deleteAudioFolder={deleteAudioFolder}
            moveAudioToFolder={moveAudioToFolder}
            onAudioDragStart={onAudioDragStart}
            onDragEnd={handleDragEnd}
            Icon={Icon}
          />
        ) : sidebarTab === "text" ? (
          <>
            <div className="sidebar-header">
              <h2 className="sidebar-title">Text</h2>
            </div>
            <div className="media-list">
              <div
                className="video-item"
                draggable
                onDragStart={handleTextDragStart}
                onDragEnd={handleDragEnd}
                title="Auf die Timeline ziehen"
              >
                <div className="video-icon">
                  <span aria-hidden="true">T</span>
                </div>
                <div className="video-info">
                  <div className="video-name">Standard Text</div>
                  <div className="media-meta-row">
                    <span>Text</span>
                    <span>5s</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="sidebar-placeholder">
            <div className="sidebar-placeholder-icon">
              {sidebarTab === "effects" && "Effects"}
              {sidebarTab === "transitions" && "Trans"}
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
