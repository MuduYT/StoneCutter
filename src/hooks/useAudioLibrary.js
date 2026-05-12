import { useState, useCallback, useEffect } from "react";
import { nextId } from "../lib/utils.js";

const STORAGE_KEY = "stonecutter.audioLibrary";

function loadLibrary() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { items: [], folders: [] };
    const data = JSON.parse(raw);
    return {
      items: Array.isArray(data.items) ? data.items : [],
      folders: Array.isArray(data.folders) ? data.folders : [],
    };
  } catch {
    return { items: [], folders: [] };
  }
}

export function useAudioLibrary({ isTauri }) {
  const [audioItems, setAudioItems] = useState(() => loadLibrary().items);
  const [audioFolders, setAudioFolders] = useState(() => loadLibrary().folders);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ items: audioItems, folders: audioFolders }),
      );
    } catch {
      /* ignored */
    }
  }, [audioItems, audioFolders]);

  const importAudioDialog = useCallback(
    async (category, folderId = null) => {
      if (!isTauri) return null;
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({
          multiple: true,
          filters: [
            {
              name: "Audio",
              extensions: ["mp3", "wav", "ogg", "flac", "aac", "m4a", "opus", "wma"],
            },
          ],
        });
        if (!selected) return null;
        const { convertFileSrc } = await import("@tauri-apps/api/core");
        const paths = Array.isArray(selected) ? selected : [selected];
        const newItems = paths.map((path) => ({
          id: nextId("aud"),
          name: path.split(/[\\/]/).pop(),
          path,
          src: convertFileSrc(path),
          category,
          importedAt: new Date().toISOString(),
          folderId: folderId || null,
          inPoint: null,
          outPoint: null,
        }));
        setAudioItems((prev) => [...prev, ...newItems]);
        return newItems;
      } catch (err) {
        console.error("Audio import failed:", err);
        return null;
      }
    },
    [isTauri],
  );

  const importAudioFromFiles = useCallback((files, category, folderId = null) => {
    const newItems = Array.from(files).map((f) => ({
      id: nextId("aud"),
      name: f.name,
      path: f.name,
      src: URL.createObjectURL(f),
      category,
      importedAt: new Date().toISOString(),
      folderId: folderId || null,
      inPoint: null,
      outPoint: null,
    }));
    setAudioItems((prev) => [...prev, ...newItems]);
    return newItems;
  }, []);

  const removeAudioItem = useCallback((id) => {
    setAudioItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const createAudioFolder = useCallback((name, category) => {
    const folder = {
      id: nextId("afld"),
      name: name.trim(),
      category,
      createdAt: Date.now(),
    };
    setAudioFolders((prev) => [...prev, folder]);
    return folder;
  }, []);

  const deleteAudioFolder = useCallback((folderId) => {
    setAudioFolders((prev) => prev.filter((f) => f.id !== folderId));
    setAudioItems((prev) =>
      prev.map((item) =>
        item.folderId === folderId ? { ...item, folderId: null } : item,
      ),
    );
  }, []);

  const moveAudioToFolder = useCallback((itemId, folderId) => {
    setAudioItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, folderId: folderId || null } : item,
      ),
    );
  }, []);

  const updateAudioSourceRange = useCallback((itemId, inPoint, outPoint) => {
    setAudioItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? { ...item, inPoint: inPoint ?? null, outPoint: outPoint ?? null }
          : item,
      ),
    );
  }, []);

  return {
    audioItems,
    audioFolders,
    importAudioDialog,
    importAudioFromFiles,
    removeAudioItem,
    createAudioFolder,
    deleteAudioFolder,
    moveAudioToFolder,
    updateAudioSourceRange,
  };
}
