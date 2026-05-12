import { useState, useRef, useCallback, useEffect } from "react";
import { useMediaWorker } from "../../hooks/useMediaWorker.js";
import { AudioWaveformView } from "../ui/AudioWaveformView.jsx";

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
  updateAudioSourceRange,
  onAudioDragStart,
  onDragEnd,
  Icon,
  formatTime,
}) {
  const [activeCategory, setActiveCategory] = useState("music");
  const [selectedFolderIds, setSelectedFolderIds] = useState({
    music: null,
    sfx: null,
  });
  const [contextMenu, setContextMenu] = useState(null); // { x, y, itemId }
  const [expandedItemId, setExpandedItemId] = useState(null);
  const [peaksCache, setPeaksCache] = useState({}); // itemId -> peaks[] | null
  const [playbackState, setPlaybackState] = useState({}); // itemId -> { time, playing }
  const audioRefs = useRef({}); // itemId -> <audio> element
  const fileInputRef = useRef(null);
  const { generateWaveform } = useMediaWorker();
  const selectedFolderId = selectedFolderIds[activeCategory] ?? null;

  const getDraggedAudioId = useCallback((e) =>
    e.dataTransfer.getData("application/x-stonecutter-audio-library-id") ||
    e.dataTransfer.getData("application/x-stonecutter-media-id") ||
    e.dataTransfer.getData("text/plain") ||
    e.dataTransfer.getData("text"), []);

  const getAudioRef = useCallback((itemId) => (el) => {
    if (el) audioRefs.current[itemId] = el;
    else delete audioRefs.current[itemId];
  }, []);

  const ensurePeaks = useCallback(async (item) => {
    if (peaksCache[item.id] !== undefined) return;
    setPeaksCache((prev) => ({ ...prev, [item.id]: null }));
    try {
      const peaks = await generateWaveform(item.src);
      setPeaksCache((prev) => ({ ...prev, [item.id]: peaks || [] }));
    } catch {
      setPeaksCache((prev) => ({ ...prev, [item.id]: [] }));
    }
  }, [generateWaveform, peaksCache]);

  const handleItemClick = useCallback((item) => {
    const next = expandedItemId === item.id ? null : item.id;
    setExpandedItemId(next);
    if (next) ensurePeaks(item);
  }, [expandedItemId, ensurePeaks]);

  const getItemDuration = useCallback((item) => {
    const audio = audioRefs.current[item.id];
    return audio?.duration && isFinite(audio.duration) ? audio.duration : null;
  }, []);

  const updatePlaybackState = useCallback((itemId, patch) => {
    setPlaybackState((prev) => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        ...patch,
      },
    }));
  }, []);

  const handlePlayPause = useCallback((item) => {
    const audio = audioRefs.current[item.id];
    if (!audio) return;
    if (audio.paused) {
      const inPoint = item.inPoint ?? 0;
      const dur = audio.duration || 0;
      const curTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      if (curTime >= dur - 0.05 || curTime < (inPoint - 0.05)) {
        try { audio.currentTime = inPoint; } catch { /* ignored */ }
      }
      updatePlaybackState(item.id, {
        playing: true,
        time: Number.isFinite(audio.currentTime) ? audio.currentTime : inPoint,
      });
      audio.play().catch(() => {
        updatePlaybackState(item.id, { playing: false });
      });
    } else {
      audio.pause();
      updatePlaybackState(item.id, {
        playing: false,
        time: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
      });
    }
  }, [updatePlaybackState]);

  const handleAudioTimeUpdate = useCallback((itemId, e) => {
    updatePlaybackState(itemId, {
      time: e.currentTarget?.currentTime ?? 0,
    });
  }, [updatePlaybackState]);

  const handleAudioPlay = useCallback((itemId) => {
    const audio = audioRefs.current[itemId];
    updatePlaybackState(itemId, {
      playing: true,
      time: Number.isFinite(audio?.currentTime) ? audio.currentTime : 0,
    });
  }, [updatePlaybackState]);

  const handleAudioPause = useCallback((itemId) => {
    const audio = audioRefs.current[itemId];
    updatePlaybackState(itemId, {
      playing: false,
      time: Number.isFinite(audio?.currentTime) ? audio.currentTime : 0,
    });
  }, [updatePlaybackState]);

  const handleAudioEnded = useCallback((itemId) => {
    const audio = audioRefs.current[itemId];
    updatePlaybackState(itemId, {
      playing: false,
      time: Number.isFinite(audio?.duration) ? audio.duration : (Number.isFinite(audio?.currentTime) ? audio.currentTime : 0),
    });
  }, [updatePlaybackState]);

  const handleSeek = useCallback((item, t) => {
    const audio = audioRefs.current[item.id];
    if (audio) { try { audio.currentTime = t; } catch { /* ignored */ } }
    updatePlaybackState(item.id, { time: t });
  }, [updatePlaybackState]);

  const handleInDrag = useCallback((item, t) => {
    const dur = getItemDuration(item);
    const safeDur = dur ?? 999;
    const nextIn = Math.max(0, Math.min(t, (item.outPoint ?? safeDur) - 0.1));
    updateAudioSourceRange(item.id, nextIn, item.outPoint ?? safeDur);
  }, [getItemDuration, updateAudioSourceRange]);

  const handleOutDrag = useCallback((item, t) => {
    const dur = getItemDuration(item);
    const safeDur = dur ?? 999;
    const nextOut = Math.max((item.inPoint ?? 0) + 0.1, Math.min(t, safeDur));
    updateAudioSourceRange(item.id, item.inPoint ?? 0, nextOut);
  }, [getItemDuration, updateAudioSourceRange]);

  const handleSetIn = useCallback((item) => {
    const cur = playbackState[item.id]?.time ?? 0;
    const dur = getItemDuration(item) ?? 999;
    const nextIn = Math.max(0, Math.min(cur, (item.outPoint ?? dur) - 0.1));
    updateAudioSourceRange(item.id, nextIn, item.outPoint ?? dur);
  }, [getItemDuration, playbackState, updateAudioSourceRange]);

  const handleSetOut = useCallback((item) => {
    const cur = playbackState[item.id]?.time ?? 0;
    const dur = getItemDuration(item) ?? 999;
    const nextOut = Math.max((item.inPoint ?? 0) + 0.1, Math.min(cur, dur));
    updateAudioSourceRange(item.id, item.inPoint ?? 0, nextOut);
  }, [getItemDuration, playbackState, updateAudioSourceRange]);

  useEffect(() => {
    const refs = audioRefs.current;
    return () => {
      Object.values(refs).forEach((audio) => { try { audio.pause(); } catch { /* ignored */ } });
    };
  }, []);

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
      setSelectedFolderIds((prev) => {
        if (prev[folder.category] !== folder.id) return prev;
        return { ...prev, [folder.category]: null };
      });
      deleteAudioFolder(folder.id);
    }
  };

  const handleCategoryChange = (cat) => {
    setActiveCategory(cat);
  };

  const handleSelectFolder = useCallback((folderId) => {
    setSelectedFolderIds((prev) => ({
      ...prev,
      [activeCategory]: folderId,
    }));
  }, [activeCategory]);

  const handleFolderDrop = useCallback((e, folderId) => {
    e.preventDefault();
    e.stopPropagation();
    const audioId = getDraggedAudioId(e);
    if (!audioId) return;
    moveAudioToFolder(audioId, folderId);
  }, [getDraggedAudioId, moveAudioToFolder]);

  useEffect(() => {
    if (!selectedFolderId) return;
    const folderExists = categoryFolders.some((folder) => folder.id === selectedFolderId);
    if (!folderExists) {
      queueMicrotask(() => {
        setSelectedFolderIds((prev) => ({ ...prev, [activeCategory]: null }));
      });
    }
  }, [activeCategory, categoryFolders, selectedFolderId]);

  const handleClearRange = (item) => {
    updateAudioSourceRange(item.id, null, null);
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
          <div className="folder-chip-row">
            <button
              className={`folder-chip ${!selectedFolderId ? "active" : ""}`}
              onClick={() => handleSelectFolder(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => handleFolderDrop(e, null)}
              title="Alle Dateien anzeigen oder hierher ziehen, um den Ordner zu entfernen"
            >
              Alle
            </button>
          </div>
          {categoryFolders.map((f) => (
            <div key={f.id} className="folder-chip-row">
              <button
                className={`folder-chip ${selectedFolderId === f.id ? "active" : ""}`}
                onClick={() =>
                  handleSelectFolder(f.id === selectedFolderId ? null : f.id)
                }
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleFolderDrop(e, f.id)}
                title={`${f.name} - hierher ziehen zum Verschieben`}
              >
                <Icon.Folder /> {f.name}
              </button>
              <button
                className="folder-chip-delete"
                onClick={() => handleDeleteFolder(f)}
                title={`${f.name} loeschen`}
                aria-label={`${f.name} loeschen`}
              >
                <Icon.Trash />
              </button>
            </div>
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
        {categoryItems.map((item) => {
          const isExpanded = expandedItemId === item.id;
          const pb = playbackState[item.id] || {};
          const peaks = peaksCache[item.id];
          const itemDur = item.duration && isFinite(item.duration) ? item.duration : null;
          const inPt = item.inPoint ?? 0;
          const outPt = item.outPoint ?? (itemDur ?? 0);
          return (
            <div key={item.id}>
              <audio
                ref={getAudioRef(item.id)}
                src={item.src}
                preload="metadata"
                onTimeUpdate={(e) => handleAudioTimeUpdate(item.id, e)}
                onPlay={() => handleAudioPlay(item.id)}
                onPause={() => handleAudioPause(item.id)}
                onEnded={() => handleAudioEnded(item.id)}
                style={{ display: "none" }}
              />
              <div
                className={`audio-item video-item${isExpanded ? " expanded-item" : ""}`}
                draggable
                onDragStart={(e) => onAudioDragStart && onAudioDragStart(item, e)}
                onDragEnd={onDragEnd}
                onClick={() => handleItemClick(item)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (categoryFolders.length > 0) {
                    setContextMenu({ x: e.clientX, y: e.clientY, itemId: item.id });
                  }
                }}
                title={`${item.name}\nKlick = Vorschau · Ziehen = auf Timeline`}
              >
                <div className="video-icon">
                  <Icon.AudioTrack />
                </div>
                <div className="video-info">
                  <div className="video-name">{item.name}</div>
                  <div className="media-meta-row">
                    <span>{activeCategory === "music" ? "Musik" : "SFX"}</span>
                    {item.inPoint != null && item.outPoint != null && (
                      <span>
                        {formatTime(item.inPoint)} – {formatTime(item.outPoint)}
                      </span>
                    )}
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
              {isExpanded && (
                <div className="audio-item-expanded">
                  <div className="audio-item-waveform-wrap">
                    <AudioWaveformView
                      peaks={peaks}
                      duration={itemDur ?? 60}
                      inPoint={inPt}
                      outPoint={outPt}
                      currentTime={pb.time ?? 0}
                      isLoading={peaks === null}
                      onSeek={(t) => handleSeek(item, t)}
                      onInDrag={(t) => handleInDrag(item, t)}
                      onOutDrag={(t) => handleOutDrag(item, t)}
                    />
                  </div>
                  <div className="audio-item-controls">
                    <button
                      className="audio-item-play-btn"
                      onClick={(e) => { e.stopPropagation(); handlePlayPause(item); }}
                      title={pb.playing ? "Pause" : "Play"}
                    >
                      {pb.playing ? <Icon.Pause /> : <Icon.Play />}
                    </button>
                    <span className="audio-item-time">
                      {formatTime(pb.time ?? 0)}{itemDur ? ` / ${formatTime(itemDur)}` : ""}
                    </span>
                  </div>
                  <div className="audio-item-range-row">
                    <button
                      className="audio-item-in-out-btn"
                      onClick={(e) => { e.stopPropagation(); handleSetIn(item); }}
                      title="In-Punkt auf aktuelle Position setzen"
                    >
                      In
                    </button>
                    <button
                      className="audio-item-in-out-btn"
                      onClick={(e) => { e.stopPropagation(); handleSetOut(item); }}
                      title="Out-Punkt auf aktuelle Position setzen"
                    >
                      Out
                    </button>
                    <span className="audio-item-range-display">
                      {item.inPoint != null && item.outPoint != null
                        ? `${formatTime(item.inPoint)} – ${formatTime(item.outPoint)} (${formatTime(item.outPoint - item.inPoint)})`
                        : "Kein In/Out gesetzt"}
                    </span>
                    {(item.inPoint != null || item.outPoint != null) && (
                      <button
                        className="audio-item-clear-btn"
                        onClick={(e) => { e.stopPropagation(); handleClearRange(item); }}
                        title="In/Out löschen"
                      >
                        <Icon.X />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
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
