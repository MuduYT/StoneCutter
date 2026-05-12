import { useCallback, useEffect, useRef } from "react";
import { MediaAssetService } from "../lib/services/MediaAssetService.js";

const makeJobId = () => `job-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function useMediaWorker() {
  const workerRef = useRef(null);
  const jobsRef = useRef(new Map());

  useEffect(() => {
    if (typeof Worker === "undefined") return undefined;
    const worker = new Worker(
      new URL("../workers/mediaAnalysis.worker.js", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;
    worker.onmessage = (event) => {
      const message = event.data || {};
      const job = jobsRef.current.get(message.id);
      if (!job) return;
      jobsRef.current.delete(message.id);
      if (message.type === "thumbnailsComplete" || message.type === "waveformComplete") {
        job.resolve(message.thumbs || message.peaks || []);
        return;
      }
      if (message.type === "thumbnailsError" || message.type === "waveformError") {
        job.reject(new Error(message.error || "Media worker error"));
      }
    };
    worker.onerror = (error) => {
      console.error("Worker error:", error);
      jobsRef.current.forEach(({ reject }) => reject(new Error("Media worker crashed")));
      jobsRef.current.clear();
    };
    worker.onmessageerror = (error) => {
      console.error("Worker message error:", error);
    };
    const jobs = jobsRef.current;
    return () => {
      worker.terminate();
      workerRef.current = null;
      jobs.forEach(({ reject }) => reject(new Error("Media worker terminated")));
      jobs.clear();
    };
  }, []);

  const postJob = useCallback((message, fallback) => {
    const worker = workerRef.current;
    if (!worker) {
      return fallback();
    }
    const id = makeJobId();
    return new Promise((resolve, reject) => {
      jobsRef.current.set(id, { resolve, reject });
      worker.postMessage({ ...message, id });
    });
  }, []);

  const generateThumbnails = useCallback(
    (src, count = 12) =>
      postJob(
        { type: "generateThumbnails", src, count },
        () => MediaAssetService.generateThumbnails(src, count),
      ).then((thumbs) => {
        if (thumbs && thumbs.length > 0) return thumbs;
        return MediaAssetService.generateThumbnails(src, count);
      }).catch(() => MediaAssetService.generateThumbnails(src, count)),
    [postJob],
  );

  const generateWaveform = useCallback(
    (src, samples = 200) =>
      postJob(
        { type: "generateWaveform", src, samples },
        () => MediaAssetService.generateWaveform(src, samples),
      ),
    [postJob],
  );

  return { generateThumbnails, generateWaveform };
}
