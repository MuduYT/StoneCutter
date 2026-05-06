import { useEffect } from "react";
import { MediaAssetService } from "../lib/services/MediaAssetService.js";

export function useMediaAnalysis({
  videos,
  clips,
  mediaAnalysisRef,
  setPeaksMap,
  setThumbsMap,
}) {
  useEffect(() => {
    let cancelled = false;
    const videoById = new Map(videos.map((video) => [video.id, video]));
    const jobs = [...new Set(clips.map((clip) => clip.videoId))]
      .map((videoId) => videoById.get(videoId))
      .filter(
        (video) =>
          video && !mediaAnalysisRef.current.waveformStarted.has(video.id),
      );
    if (jobs.length === 0) return undefined;
    jobs.forEach((video) => {
      mediaAnalysisRef.current.waveformStarted.add(video.id);
      setPeaksMap((prev) =>
        prev[video.id] != null ? prev : { ...prev, [video.id]: null },
      );
    });
    let cursor = 0;
    const runNext = async () => {
      if (cancelled) return;
      const video = jobs[cursor];
      cursor += 1;
      if (!video) return;
      const peaks = await MediaAssetService.generateWaveform(video.src);
      if (!cancelled) {
        setPeaksMap((prev) =>
          videoById.has(video.id) ? { ...prev, [video.id]: peaks || [] } : prev,
        );
      }
      await runNext();
    };
    const workers = Array.from({ length: Math.min(2, jobs.length) }, runNext);
    Promise.all(workers).catch((err) =>
      console.error("Waveform generation error:", err),
    );
    return () => {
      cancelled = true;
    };
  }, [clips, mediaAnalysisRef, setPeaksMap, videos]);

  useEffect(() => {
    let cancelled = false;
    const videoById = new Map(videos.map((video) => [video.id, video]));
    const jobs = videos.filter(
      (video) => !mediaAnalysisRef.current.thumbnailStarted.has(video.id),
    );
    if (jobs.length === 0) return undefined;
    jobs.forEach((video) => {
      mediaAnalysisRef.current.thumbnailStarted.add(video.id);
      setThumbsMap((prev) =>
        prev[video.id] != null ? prev : { ...prev, [video.id]: null },
      );
    });
    let cursor = 0;
    const runNext = async () => {
      if (cancelled) return;
      const video = jobs[cursor];
      cursor += 1;
      if (!video) return;
      const genFn =
        video.mediaType === "image"
          ? MediaAssetService.generateImageThumbnails
          : video.mediaType === "audio"
            ? async () => []
            : MediaAssetService.generateThumbnails;
      const thumbs = await genFn(video.src);
      if (!cancelled) {
        setThumbsMap((prev) =>
          videoById.has(video.id) ? { ...prev, [video.id]: thumbs || [] } : prev,
        );
      }
      await runNext();
    };
    const workers = Array.from({ length: Math.min(2, jobs.length) }, runNext);
    Promise.all(workers).catch((err) =>
      console.error("Thumbnail generation error:", err),
    );
    return () => {
      cancelled = true;
    };
  }, [mediaAnalysisRef, setThumbsMap, videos]);
}
