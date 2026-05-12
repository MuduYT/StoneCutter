import { useEffect } from "react";
import { MediaAssetService } from "../lib/services/MediaAssetService.js";
import { useMediaWorker } from "./useMediaWorker.js";

export function useMediaAnalysis({
  videos,
  clips,
  mediaAnalysisRef,
  setPeaksMap,
  setThumbsMap,
}) {
  const { generateThumbnails, generateWaveform } = useMediaWorker();

  useEffect(() => {
    let cancelled = false;
    const audioJobs = videos.filter(
      (v) =>
        v.mediaType === "audio" &&
        !mediaAnalysisRef.current.waveformStarted.has(v.id),
    );
    if (audioJobs.length === 0) return undefined;
    audioJobs.forEach((v) => {
      mediaAnalysisRef.current.waveformStarted.add(v.id);
      setPeaksMap((prev) =>
        prev[v.id] != null ? prev : { ...prev, [v.id]: null },
      );
    });
    Promise.all(
      audioJobs.map(async (video) => {
        try {
          const peaks = await generateWaveform(video.src);
          if (!cancelled) {
            setPeaksMap((prev) => ({ ...prev, [video.id]: peaks || [] }));
          }
        } catch (err) {
          console.error("Audio waveform generation error:", err);
          if (!cancelled) {
            setPeaksMap((prev) => ({ ...prev, [video.id]: [] }));
          }
        }
      }),
    ).catch((err) =>
      console.error("Audio waveform generation error:", err),
    );
    return () => { cancelled = true; };
  }, [generateWaveform, mediaAnalysisRef, setPeaksMap, videos]);

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
    Promise.all(
      jobs.map(async (video) => {
        try {
          const peaks = await generateWaveform(video.src);
          if (!cancelled) {
            setPeaksMap((prev) =>
              videoById.has(video.id) ? { ...prev, [video.id]: peaks || [] } : prev,
            );
          }
        } catch (err) {
          console.error("Waveform generation error:", err);
          if (!cancelled) {
            setPeaksMap((prev) =>
              videoById.has(video.id) ? { ...prev, [video.id]: [] } : prev,
            );
          }
        }
      }),
    ).catch((err) =>
      console.error("Waveform generation error:", err),
    );
    return () => {
      cancelled = true;
    };
  }, [clips, generateWaveform, mediaAnalysisRef, setPeaksMap, videos]);

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
    Promise.all(
      jobs.map(async (video) => {
        try {
          const genFn =
            video.mediaType === "image"
              ? MediaAssetService.generateImageThumbnails
              : video.mediaType === "audio"
                ? async () => []
                : generateThumbnails;
          const thumbs = await genFn(video.src);
          if (!cancelled) {
            setThumbsMap((prev) =>
              videoById.has(video.id) ? { ...prev, [video.id]: thumbs || [] } : prev,
            );
          }
        } catch (err) {
          console.error("Thumbnail generation error:", err);
          if (!cancelled) {
            setThumbsMap((prev) =>
              videoById.has(video.id) ? { ...prev, [video.id]: [] } : prev,
            );
          }
        }
      }),
    ).catch((err) =>
      console.error("Thumbnail generation error:", err),
    );
    return () => {
      cancelled = true;
    };
  }, [generateThumbnails, mediaAnalysisRef, setThumbsMap, videos]);
}
