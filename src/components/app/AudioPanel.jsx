import { useState, useRef } from "react";

const AUDIO_ACCEPT = ".mp3,.wav,.ogg,.flac,.aac,.m4a,.opus,.wma";

export function AudioPanel({
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
  onDragEnd,
  Icon,
}) {
  const [activeCategory, setActiveCategory] = useState("music");
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, itemId }
  const fileInputRef = useRef(null);

  const categoryFolders = audioFolders.filter((f) => f.category === activeCategory);
  const categoryItems = audioItems.filter(
    (item) =>
      item.category === activeCategory &&
      (selectedFolderId ? item.folderId === selectedFolderId : true),
  );

  const handleImport = async () => {
    if (isTauri) {
      await importAudioDialog(activeCategory, selectedFolderId);
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleFileInputChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      importAudioFromFiles(files, activeCategory, selectedFolderId);
    }
    e.target.value = "";
  };

  const handleCreateFolder = () => {
    const name = prompt("Ordnername:");
    if (name?.trim()) {
      createAudioFolder(name, activeCategory);
    }
  };

  const handleDeleteFolder = (folder) => {
    if (confirm(`Ordner "${folder.name}" wirklich löschen? Inhalte bleiben erhalten.`)) {
      if (selectedFolderId === folder.id) setSelectedFolderId(null);
      deleteAudioFolder(folder.id);
    }
  };

  const handleCategoryChange = (cat) => {
    setActiveCategory(cat);
    setSelectedFolderId(null);
  };

  const closeContextMenu = () => setContextMenu(null);

  return (
    <div className="audio-panel" onClick={() => contextMenu && closeContextMenu()}>
      <div className="audio-category-tabs">
        <button
          className={`audio-cat-btn ${activeCategory === "music" ? "active" : ""}`}
          onClick={() => handleCategoryChange("music")}
        >
          <Icon.Music /> Musik
        </button>
        <button
          className={`audio-cat-btn ${activeCategory === "sfx" ? "active" : ""}`}
          onClick={() => handleCategoryChange("sfx")}
        >
          <Icon.Sfx /> Soundeffekte
        </button>
      </div>

      <div className="audio-panel-toolbar">
        <button className="import-btn" onClick={handleImport}>
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

      {categoryFolders.length > 0 && (
        <div className="folder-nav">
          <button
            className={`folder-chip ${!selectedFolderId ? "active" : ""}`}
            onClick={() => setSelectedFolderId(null)}
          >
            Alle
          </button>
          {categoryFolders.map((f) => (
            <button
              key={f.id}
              className={`folder-chip ${selectedFolderId === f.id ? "active" : ""}`}
              onClick={() =>
                setSelectedFolderId(f.id === selectedFolderId ? null : f.id)
              }
              onContextMenu={(e) => {
                e.preventDefault();
                handleDeleteFolder(f);
              }}
              title={`${f.name} (Rechtsklick zum Löschen)`}
            >
              <Icon.Folder /> {f.name}
            </button>
          ))}
        </div>
      )}

      <div
        className="audio-item-list"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const files = Array.from(e.dataTransfer.files).filter((f) =>
            /\.(mp3|wav|ogg|flac|aac|m4a|opus|wma)$/i.test(f.name),
          );
          if (files.length > 0)
            importAudioFromFiles(files, activeCategory, selectedFolderId);
        }}
      >
        {categoryItems.length === 0 && (
          <div className="empty-list">
            <p>
              Keine {activeCategory === "music" ? "Musik" : "Soundeffekte"}{" "}
              importiert.
            </p>
            <p className="hint">Klicke "+ Import" oder ziehe Dateien hierher.</p>
          </div>
        )}
        {categoryItems.map((item) => (
          <div
            key={item.id}
            className="audio-item video-item"
            draggable
            onDragStart={(e) => onAudioDragStart && onAudioDragStart(item, e)}
            onDragEnd={onDragEnd}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (categoryFolders.length > 0) {
                setContextMenu({ x: e.clientX, y: e.clientY, itemId: item.id });
              }
            }}
            title={`${item.name}\nZiehen = auf Timeline`}
          >
            <div className="video-icon">
              <Icon.AudioTrack />
            </div>
            <div className="video-info">
              <div className="video-name">{item.name}</div>
              <div className="media-meta-row">
                <span>{activeCategory === "music" ? "Musik" : "SFX"}</span>
              </div>
            </div>
            <button
              className="remove-btn"
              onClick={(e) => {
                e.stopPropagation();
                removeAudioItem(item.id);
              }}
              title="Aus Bibliothek entfernen"
            >
              <Icon.Trash />
            </button>
          </div>
        ))}
      </div>

      {contextMenu && (
        <div
          className="context-menu"
          style={{ position: "fixed", left: contextMenu.x, top: contextMenu.y }}
          onMouseLeave={closeContextMenu}
        >
          <div className="context-menu-label">In Ordner verschieben</div>
          {categoryFolders.map((f) => (
            <button
              key={f.id}
              className="context-menu-item"
              onClick={() => {
                moveAudioToFolder(contextMenu.itemId, f.id);
                closeContextMenu();
              }}
            >
              <Icon.Folder /> {f.name}
            </button>
          ))}
          <button
            className="context-menu-item"
            onClick={() => {
              moveAudioToFolder(contextMenu.itemId, null);
              closeContextMenu();
            }}
          >
            Aus Ordner entfernen
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={AUDIO_ACCEPT}
        multiple
        style={{ display: "none" }}
        onChange={handleFileInputChange}
      />
    </div>
  );
}
