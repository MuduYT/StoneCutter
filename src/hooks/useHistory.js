import { useCallback } from "react";

export function useHistory({
  clips,
  tracks,
  historyRef,
  setClips,
  setTracks,
  setActiveClipId,
  setHistorySizes,
}) {
  const syncHistorySizes = useCallback(() => {
    setHistorySizes({
      past: historyRef.current.past.length,
      future: historyRef.current.future.length,
    });
  }, [historyRef, setHistorySizes]);

  const createHistorySnapshot = useCallback(
    (clipState = clips, trackState = tracks) => ({
      clips: clipState.map((c) => ({ ...c })),
      tracks: trackState.map((t) => ({ ...t })),
    }),
    [clips, tracks],
  );

  const normalizeHistorySnapshot = useCallback(
    (snapshot) =>
      Array.isArray(snapshot)
        ? { clips: snapshot.map((c) => ({ ...c })), tracks: null }
        : {
            clips: (snapshot?.clips || []).map((c) => ({ ...c })),
            tracks: snapshot?.tracks
              ? snapshot.tracks.map((t) => ({ ...t }))
              : null,
          },
    [],
  );

  const pushHistory = useCallback(
    (snapshot) => {
      historyRef.current.past.push(normalizeHistorySnapshot(snapshot));
      if (historyRef.current.past.length > 50) historyRef.current.past.shift();
      historyRef.current.future = [];
      syncHistorySizes();
    },
    [historyRef, normalizeHistorySnapshot, syncHistorySizes],
  );

  const undo = useCallback(() => {
    const past = historyRef.current.past;
    if (past.length === 0) return;
    const prev = normalizeHistorySnapshot(past.pop());
    historyRef.current.future.push(createHistorySnapshot());
    setClips(prev.clips);
    if (prev.tracks) setTracks(prev.tracks);
    syncHistorySizes();
    setActiveClipId((aid) =>
      aid && prev.clips.some((c) => c.id === aid) ? aid : null,
    );
  }, [
    createHistorySnapshot,
    historyRef,
    normalizeHistorySnapshot,
    setActiveClipId,
    setClips,
    setTracks,
    syncHistorySizes,
  ]);

  const redo = useCallback(() => {
    const fut = historyRef.current.future;
    if (fut.length === 0) return;
    const next = normalizeHistorySnapshot(fut.pop());
    historyRef.current.past.push(createHistorySnapshot());
    setClips(next.clips);
    if (next.tracks) setTracks(next.tracks);
    syncHistorySizes();
    setActiveClipId((aid) =>
      aid && next.clips.some((c) => c.id === aid) ? aid : null,
    );
  }, [
    createHistorySnapshot,
    historyRef,
    normalizeHistorySnapshot,
    setActiveClipId,
    setClips,
    setTracks,
    syncHistorySizes,
  ]);

  return {
    createHistorySnapshot,
    pushHistory,
    undo,
    redo,
  };
}
