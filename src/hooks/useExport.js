import { useState, useEffect } from "react";
import { buildExportSegments } from "../lib/exportSegments.js";

const isTauri = "__TAURI_INTERNALS__" in window;

export function useExport({ clips, videos, tracks, totalEnd, aspectRatio }) {
  const [showExport, setShowExport] = useState(false);
  const [exportQuality, setExportQuality] = useState("medium");
  const [exportStatus, setExportStatus] = useState(null);
  const [exportProgress, setExportProgress] = useState({
    progress: 0,
    seconds: 0,
    phase: "render",
  });

  useEffect(() => {
    if (!isTauri) return undefined;
    let unlisten = null;
    let disposed = false;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("export-progress", (event) => {
          if (disposed || !event.payload) return;
          const payload = event.payload;
          setExportProgress({
            progress: Math.max(0, Math.min(1, Number(payload.progress) || 0)),
            seconds: Math.max(0, Number(payload.seconds) || 0),
            phase: String(payload.phase || "render"),
          });
        }),
      )
      .then((cleanup) => {
        unlisten = cleanup;
      })
      .catch(console.error);
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);

  const handleExport = async () => {
    if (!isTauri) return;
    const exportPlan = buildExportSegments({ clips, videos, tracks });
    if (!exportPlan.ok) {
      setExportStatus({ ok: false, msg: exportPlan.error });
      return;
    }
    const { segments } = exportPlan;

    const qualityMap = {
      low: { crf: 28, preset: "veryfast" },
      medium: { crf: 23, preset: "fast" },
      high: { crf: 18, preset: "slow" },
    };
    const { crf, preset } = qualityMap[exportQuality];
    const [w, h] = aspectRatio === "9:16" ? [1080, 1920] : [1920, 1080];

    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const outputPath = await save({
        defaultPath: "export.mp4",
        filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
      });
      if (!outputPath) return;

      setExportProgress({ progress: 0, seconds: 0, phase: "render_audio_video" });
      setExportStatus("running");
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke("export_video_progress", {
        segments,
        outputPath,
        width: w,
        height: h,
        crf,
        preset,
      });

      const noAudio =
        typeof result === "string" && result.includes("|no_audio");
      setExportStatus({
        ok: true,
        msg: noAudio
          ? "Export erfolgreich (kein Audiotrack in den Quellen – stilles Video)."
          : "Export erfolgreich!",
      });
      setExportProgress({ progress: 1, seconds: totalEnd, phase: "done" });
    } catch (err) {
      setExportStatus({ ok: false, msg: String(err) });
    }
  };

  const handleCancelExport = async () => {
    if (!isTauri) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("cancel_export");
    } catch (err) {
      setExportStatus({ ok: false, msg: String(err) });
    }
  };

  return {
    showExport,
    setShowExport,
    exportQuality,
    setExportQuality,
    exportStatus,
    setExportStatus,
    exportProgress,
    setExportProgress,
    handleExport,
    handleCancelExport,
  };
}
