import { createContext, useContext, useMemo, useState } from "react";

// eslint-disable-next-line react-refresh/only-export-components
export const MediaContext = createContext(null);

export function MediaProvider({ children, value }) {
  const [videos, setVideos] = useState([]);
  const [folders, setFolders] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [selectedMediaIds, setSelectedMediaIds] = useState(() => new Set());
  const [mediaSearch, setMediaSearch] = useState("");
  const [mediaTypeFilter, setMediaTypeFilter] = useState("all");
  const [mediaSort, setMediaSort] = useState("importedAt");
  const [thumbsMap, setThumbsMap] = useState({});
  const [videoDurations, setVideoDurations] = useState({});
  const [offlineMediaIds, setOfflineMediaIds] = useState(() => new Set());

  const internalValue = useMemo(
    () => ({
      videos,
      setVideos,
      folders,
      setFolders,
      selectedFolderId,
      setSelectedFolderId,
      selectedMediaIds,
      setSelectedMediaIds,
      mediaSearch,
      setMediaSearch,
      mediaTypeFilter,
      setMediaTypeFilter,
      mediaSort,
      setMediaSort,
      thumbsMap,
      setThumbsMap,
      videoDurations,
      setVideoDurations,
      offlineMediaIds,
      setOfflineMediaIds,
    }),
    [
      folders,
      mediaSearch,
      mediaSort,
      mediaTypeFilter,
      offlineMediaIds,
      selectedFolderId,
      selectedMediaIds,
      thumbsMap,
      videoDurations,
      videos,
    ],
  );

  return (
    <MediaContext.Provider value={value || internalValue}>
      {children}
    </MediaContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMediaContext() {
  const context = useContext(MediaContext);
  if (!context) {
    throw new Error("useMediaManagement must be used within MediaProvider");
  }
  return context;
}
