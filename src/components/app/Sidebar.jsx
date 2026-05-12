import { useEffect, useState } from "react";
import { MediaPanel } from "../MediaPanel.jsx";
import { AudioPanel } from "./AudioPanel.jsx";
import { MediaAssetService } from "../../lib/services/MediaAssetService.js";
import { useMediaManagement } from "../../hooks/useMediaManagement.js";

export function Sidebar({
  sidebarTab,
  sidebarItems,
  editorFocus,
  focusSource,
  onSidebarTabChange,
  audioItems,
  audioFolders,
  isTauri,
  importAudioDialog,
  importAudioFromFiles,
  removeAudioItem,
  createAudioFolder,
  deleteAudioFolder,
  moveAudioToFolder,
  updateAudioSourceRange,
  onAudioDragStart,
  Icon,
  formatTime,
}) {
  const [mediaContextMenu, setMediaContextMenu] = useState(null); // { x, y, mediaId }
  const {
    videos,
    mediaSearch,
    setMediaSearch,
    mediaTypeFilter,
    setMediaTypeFilter,
    mediaSort,
    setMediaSort,
    handleImport,
    handleDragEnd,
    handleRemoveMedia,
    regenerateProxy,
    clearProxy,
    handleFileChange,
    isImportableMediaFile,
    folders,
    selectedFolderId,
    setSelectedFolderId,
    selectedMediaIds,
    handleCreateFolder,
    handleDeleteFolder,
    handleMoveMediaToFolder,
    replaceMedia,
    relinkMedia,
  } = useMediaManagement();

  const getDraggedMediaId = (e) =>
    e.dataTransfer.getData("application/x-stonecutter-media-id") ||
    e.dataTransfer.getData("text/plain") ||
    e.dataTransfer.getData("text");

  const handleMediaContextMenu = (e, mediaId) => {
    e.preventDefault();
    e.stopPropagation();
    setMediaContextMenu({ x: e.clientX, y: e.clientY, mediaId });
  };

  const closeMediaContextMenu = () => setMediaContextMenu(null);
  const contextMedia = mediaContextMenu
    ? videos.find((video) => video.id === mediaContextMenu.mediaId)
    : null;
  const contextProxyQualities =
    contextMedia?.mediaType === "video"
      ? [
          ...new Set([
            ...Object.keys(contextMedia.previewProxies || {}),
            ...(contextMedia.proxyQuality && contextMedia.proxySrc
              ? [contextMedia.proxyQuality]
              : []),
          ]),
        ]
      : [];
  const contextProxyQuality =
    contextMedia?.proxyQuality && contextProxyQualities.includes(contextMedia.proxyQuality)
      ? contextMedia.proxyQuality
      : contextProxyQualities[0];
  const showProxyActions =
    isTauri &&
    contextMedia?.mediaType === "video" &&
    Boolean(contextProxyQuality);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (!selectedMediaIds || selectedMediaIds.size === 0) return;
      const target = e.target;
      const tagName = target?.tagName?.toLowerCase?.();
      if (tagName === "input" || tagName === "textarea" || target?.isContentEditable) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      e.preventDefault();
      const count = selectedMediaIds.size;
      const label = count === 1 ? "1 ausgewähltes Medium" : `${count} ausgewählte Medien`;
      if (confirm(`${label} wirklich entfernen?`)) {
        handleRemoveMedia(new Set(selectedMediaIds));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleRemoveMedia, selectedMediaIds]);

  useEffect(() => {
    if (!selectedFolderId) return;
    const folderExists = folders?.some((folder) => folder.id === selectedFolderId);
    if (!folderExists) {
      setSelectedFolderId(null);
    }
  }, [folders, selectedFolderId, setSelectedFolderId]);

  const handleMoveToFolder = (folderId) => {
    if (mediaContextMenu) {
      handleMoveMediaToFolder(mediaContextMenu.mediaId, folderId);
      closeMediaContextMenu();
    }
  };

  const handleReplaceMedia = async () => {
    if (!isTauri || !contextMedia) return;
    const selected = await MediaAssetService.openReplacementDialog(contextMedia.mediaType);
    if (!selected || Array.isArray(selected)) return;
    await replaceMedia?.(contextMedia.id, selected);
    closeMediaContextMenu();
  };

  const handleRelinkMedia = async () => {
    if (!isTauri || !contextMedia) return;
    const selected = await MediaAssetService.openDirectoryDialog();
    if (!selected || Array.isArray(selected)) return;
    await relinkMedia?.(contextMedia.id, selected);
    closeMediaContextMenu();
  };

  const handleFolderDrop = (e, folderId) => {
    e.preventDefault();
    e.stopPropagation();
    const mediaId = getDraggedMediaId(e);
    if (!mediaId) return;
    handleMoveMediaToFolder(mediaId, folderId);
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
                <div className="folder-chip-row">
                  <button
                    className={`folder-chip ${!selectedFolderId ? "active" : ""}`}
                    onClick={() => setSelectedFolderId(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleFolderDrop(e, null)}
                    title="Alle Medien anzeigen oder hierher ziehen, um den Ordner zu entfernen"
                  >
                    Alle
                  </button>
                </div>
                {folders.map((f) => (
                  <div key={f.id} className="folder-chip-row">
                    <button
                      className={`folder-chip ${selectedFolderId === f.id ? "active" : ""}`}
                      onClick={() =>
                        setSelectedFolderId(f.id === selectedFolderId ? null : f.id)
                      }
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => handleFolderDrop(e, f.id)}
                      title={`${f.name} - hierher ziehen zum Verschieben`}
                    >
                      <Icon.Folder /> {f.name}
                    </button>
                    <button
                      className="folder-chip-delete"
                      onClick={() => handleDeleteFolder(f.id)}
                      title={`${f.name} loeschen`}
                      aria-label={`${f.name} loeschen`}
                    >
                      <Icon.Trash />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="media-bin-controls">
              <input
                className="media-search-input"
                value={mediaSearch}
                onChange={(e) => setMediaSearch(e.target.value)}
                placeholder="Medien suchen..."
                aria-label="Medien suchen"
              />
              <div className="media-filter-row">
                <select
                  value={mediaTypeFilter}
                  onChange={(e) => setMediaTypeFilter(e.target.value)}
                  aria-label="Medientyp filtern"
                >
                  <option value="all">Alle Typen</option>
                  <option value="video">Video</option>
                  <option value="audio">Audio</option>
                  <option value="image">Bild</option>
                </select>
                <select
                  value={mediaSort}
                  onChange={(e) => setMediaSort(e.target.value)}
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
                onMediaContextMenu={handleMediaContextMenu}
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
                {selectedMediaIds && selectedMediaIds.size > 1 && (
                  <div className="context-menu-label">
                    {selectedMediaIds.size} Medien ausgewählt
                  </div>
                )}
                {showProxyActions && (
                  <>
                    <div className="context-menu-label">Proxy</div>
                    <button
                      className="context-menu-item"
                      onClick={() => {
                        regenerateProxy?.(mediaContextMenu.mediaId, contextProxyQuality);
                        closeMediaContextMenu();
                      }}
                    >
                      Regenerate Proxy
                    </button>
                    <button
                      className="context-menu-item danger"
                      onClick={() => {
                        clearProxy?.(mediaContextMenu.mediaId, contextProxyQuality);
                        closeMediaContextMenu();
                      }}
                    >
                      Delete Proxy
                    </button>
                    <div className="context-menu-divider" />
                  </>
                )}
                {isTauri && contextMedia && (
                  <>
                    <div className="context-menu-label">Media</div>
                    <button
                      className="context-menu-item"
                      onClick={handleReplaceMedia}
                    >
                      Datei ersetzen...
                    </button>
                    <button
                      className="context-menu-item"
                      onClick={handleRelinkMedia}
                    >
                      Neu verknuepfen...
                    </button>
                    <div className="context-menu-divider" />
                  </>
                )}
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
                {selectedMediaIds && selectedMediaIds.size > 1 && (
                  <>
                    <button
                      className="context-menu-item"
                      onClick={() => {
                        handleRemoveMedia(new Set(selectedMediaIds));
                        closeMediaContextMenu();
                      }}
                    >
                      Ausgewählte entfernen
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
            updateAudioSourceRange={updateAudioSourceRange}
            onAudioDragStart={onAudioDragStart}
            onDragEnd={handleDragEnd}
            Icon={Icon}
            formatTime={formatTime}
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
