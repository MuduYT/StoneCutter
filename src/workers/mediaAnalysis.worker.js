const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

async function generateThumbnails(src, count = 12) {
  if (
    typeof document === "undefined" ||
    typeof document?.createElement !== "function"
  ) {
    return [];
  }
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
        video.currentTime = clamp(targetTime, 0, Math.max(0, duration - 0.05));
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

async function generateWaveform(src, samples = 200) {
  try {
    const response = await fetch(src);
    const arrayBuffer = await response.arrayBuffer();
    const AudioCtx = self.AudioContext || self.webkitAudioContext;
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

self.onerror = (e) => console.error("Worker error:", e);

self.onmessage = async (event) => {
  const message = event.data || {};
  try {
    if (message.type === "generateThumbnails") {
      const thumbs = await generateThumbnails(message.src, message.count ?? 12);
      self.postMessage({ type: "thumbnailsComplete", id: message.id, thumbs });
      return;
    }
    if (message.type === "generateWaveform") {
      const peaks = await generateWaveform(message.src, message.samples ?? 200);
      self.postMessage({ type: "waveformComplete", id: message.id, peaks });
      return;
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (message.type === "generateThumbnails") {
      self.postMessage({ type: "thumbnailsError", id: message.id, error });
      return;
    }
    if (message.type === "generateWaveform") {
      self.postMessage({ type: "waveformError", id: message.id, error });
      return;
    }
    self.postMessage({ type: "waveformError", id: message.id, error });
  }
};
