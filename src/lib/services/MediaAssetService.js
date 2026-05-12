import {
  AUDIO_EXTS,
  IMAGE_EXTS,
  VIDEO_EXTS,
  getMediaType,
} from "../timeline.js";
import {
  getPreviewResolution,
  normalizePreviewQuality,
} from "../proxyGenerator.js";

const MEDIA_EXTS = [...VIDEO_EXTS, ...AUDIO_EXTS, ...IMAGE_EXTS];

const filtersForMediaType = (mediaType) => {
  if (mediaType === "video") return [{ name: "Videos", extensions: VIDEO_EXTS }];
  if (mediaType === "audio") return [{ name: "Audio", extensions: AUDIO_EXTS }];
  if (mediaType === "image") return [{ name: "Bilder", extensions: IMAGE_EXTS }];
  return [{ name: "Medien", extensions: MEDIA_EXTS }];
};

export class MediaAssetService {
  static get mediaAccept() {
    return "video/*,audio/*,image/*";
  }

  static get mediaExtensions() {
    return MEDIA_EXTS;
  }

  static getFileMediaType(file) {
    if (file.type.startsWith("image/")) return "image";
    if (file.type.startsWith("audio/")) return "audio";
    if (file.type.startsWith("video/")) return "video";
    return getMediaType(file.name);
  }

  static isImportableMediaFile(file) {
    if (
      file.type.startsWith("video/") ||
      file.type.startsWith("audio/") ||
      file.type.startsWith("image/")
    ) {
      return true;
    }
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    return MEDIA_EXTS.includes(ext);
  }

  static async openMediaDialog({ isTauri, makeId }) {
    if (!isTauri) return null;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    const selected = await open({
      multiple: true,
      filters: [
        { name: "Medien", extensions: MEDIA_EXTS },
        { name: "Videos", extensions: VIDEO_EXTS },
        { name: "Audio", extensions: AUDIO_EXTS },
        { name: "Bilder", extensions: IMAGE_EXTS },
        { name: "Alle Dateien", extensions: ["*"] },
      ],
    });
    if (!selected) return [];
    const paths = Array.isArray(selected) ? selected : [selected];
    return paths.map((path) => {
      const name = path.split(/[\\/]/).pop() || path;
      return {
        id: makeId("vid"),
        name,
        path,
        originalPath: path,
        proxyPath: null,
        proxySrc: null,
        proxyResolution: null,
        src: convertFileSrc(path),
        mediaType: getMediaType(name),
        importedAt: new Date().toISOString(),
      };
    });
  }

  static async openReplacementDialog(mediaType) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    return open({
      multiple: false,
      filters: filtersForMediaType(mediaType),
    });
  }

  static async openDirectoryDialog() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    return open({ directory: true, multiple: false });
  }

  static async pathExists(path) {
    if (!path) return false;
    const { invoke } = await import("@tauri-apps/api/core");
    return Boolean(await invoke("media_path_exists", { path }));
  }

  static async findMediaByName(folderPath, fileName) {
    if (!folderPath || !fileName) return null;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("find_media_by_name", { folderPath, fileName });
  }

  static getPreviewSrc(media, previewQuality = "half") {
    if (!media) return null;
    const quality = normalizePreviewQuality(previewQuality);
    const previewProxy = media.previewProxies?.[quality];
    if (previewProxy?.proxySrc) return previewProxy.proxySrc;
    if (media.proxyQuality === quality && media.proxySrc) return media.proxySrc;
    if (!media.proxyQuality && !media.previewProxies && media.proxySrc) {
      return media.proxySrc;
    }
    return media.src;
  }

  static async generateProxy(media, previewQuality = "half") {
    if (!media || media.mediaType !== "video" || !media.path) return null;
    const quality = normalizePreviewQuality(previewQuality);
    if (quality === "full") return null;
    const height = getPreviewResolution(quality) || 360;
    const { invoke, convertFileSrc } = await import("@tauri-apps/api/core");
    const result = await invoke("generate_proxy", {
      inputPath: media.originalPath || media.path,
      height,
    });
    if (!result?.path) return null;
    const proxy = {
      proxyPath: result.path,
      proxyResolution: result.resolution || height,
      proxySrc: convertFileSrc(result.path),
    };
    return {
      proxyQuality: quality,
      ...proxy,
      previewProxies: { [quality]: proxy },
    };
  }

  static async deleteProxy(proxyPath) {
    if (!proxyPath) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_proxy", { proxyPath });
  }

  static probeDuration(
    src,
    mediaType = "video",
    defaultImageDuration = 3,
  ) {
    if (mediaType === "image") return Promise.resolve(defaultImageDuration);
    return new Promise((resolve) => {
      const media = document.createElement(
        mediaType === "audio" ? "audio" : "video",
      );
      media.preload = "metadata";
      media.muted = true;
      const cleanup = () => {
        media.onloadedmetadata = null;
        media.onerror = null;
        media.src = "";
      };
      media.onloadedmetadata = () => {
        const duration =
          isFinite(media.duration) && media.duration > 0 ? media.duration : 5;
        cleanup();
        resolve(duration);
      };
      media.onerror = () => {
        cleanup();
        resolve(5);
      };
      media.src = src;
    });
  }

  static async generateImageThumbnails(src, count = 12) {
    return Array(count).fill(src);
  }

  // Deprecated: use useMediaWorker for non-blocking generation.
  static async generateThumbnails(src, count = 12) {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    video.playsInline = true;
    video.src = src;
    const isReady = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 5000);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve(true);
      };
      video.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
    });
    if (!isReady || !video.duration || !isFinite(video.duration)) {
      video.src = "";
      return [];
    }
    const duration = video.duration;
    const aspect =
      video.videoWidth && video.videoHeight
        ? video.videoHeight / video.videoWidth
        : 9 / 16;
    const thumbWidth = 120;
    const thumbHeight = Math.max(40, Math.round(thumbWidth * aspect));
    const canvas = document.createElement("canvas");
    canvas.width = thumbWidth;
    canvas.height = thumbHeight;
    const ctx = canvas.getContext("2d");
    const thumbs = [];
    for (let i = 0; i < count; i++) {
      const targetTime = ((i + 0.5) / count) * duration;
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          video.onseeked = null;
          resolve();
        }, 2000);
        video.onseeked = () => {
          clearTimeout(timer);
          video.onseeked = null;
          resolve();
        };
        try {
          video.currentTime = Math.min(duration - 0.05, Math.max(0, targetTime));
        } catch {
          resolve();
        }
      });
      try {
        ctx.drawImage(video, 0, 0, thumbWidth, thumbHeight);
        thumbs.push(canvas.toDataURL("image/jpeg", 0.55));
      } catch {
        thumbs.push(null);
      }
    }
    video.src = "";
    return thumbs;
  }

  // Deprecated: use useMediaWorker for non-blocking generation.
  static async generateWaveform(src, samples = 200) {
    try {
      const response = await fetch(src);
      const arrayBuffer = await response.arrayBuffer();
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      const audioCtx = new AudioCtx();
      const audioBuffer = await audioCtx
        .decodeAudioData(arrayBuffer)
        .catch(() => null);
      if (!audioBuffer) {
        audioCtx.close();
        return null;
      }
      const channels = [];
      for (let ch = 0; ch < Math.min(audioBuffer.numberOfChannels, 2); ch++) {
        channels.push(audioBuffer.getChannelData(ch));
      }
      const length = channels[0].length;
      const blockSize = Math.max(1, Math.floor(length / samples));
      const peaks = [];
      for (let i = 0; i < samples; i++) {
        const start = i * blockSize;
        const end = Math.min(length, start + blockSize);
        let sum = 0;
        let count = 0;
        for (const data of channels) {
          let peak = 0;
          for (let j = start; j < end; j++) {
            const value = Math.abs(data[j] || 0);
            if (value > peak) peak = value;
          }
          sum += peak;
          count += 1;
        }
        peaks.push(count > 0 ? sum / count : 0);
      }
      audioCtx.close();
      return peaks;
    } catch {
      return null;
    }
  }
}
