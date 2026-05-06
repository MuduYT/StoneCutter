export const PREVIEW_QUALITY_OPTIONS = ["full", "half", "quarter", "eighth"];

export const PREVIEW_QUALITY_LABELS = {
  full: "Full",
  half: "1/2",
  quarter: "1/4",
  eighth: "1/8",
};

export const normalizePreviewQuality = (value) =>
  PREVIEW_QUALITY_OPTIONS.includes(value) ? value : "half";

export const formatPreviewQualityLabel = (value) =>
  PREVIEW_QUALITY_LABELS[normalizePreviewQuality(value)] || "1/2";

export const getPreviewResolution = (previewQuality) => {
  if (previewQuality === "full") return null;
  if (previewQuality === "half") return 540;
  if (previewQuality === "quarter") return 270;
  if (previewQuality === "eighth") return 135;
  return 540;
};

export const getPreviewMediaSrc = (media, previewQuality = "half") => {
  if (!media) return null;
  const quality = normalizePreviewQuality(previewQuality);
  if (quality === "full") return media.src;
  const previewProxy = media.previewProxies?.[quality];
  if (previewProxy?.proxySrc) return previewProxy.proxySrc;
  if (media.proxyQuality === quality && media.proxySrc) return media.proxySrc;
  if (!media.proxyQuality && !media.previewProxies && media.proxySrc) {
    return media.proxySrc;
  }
  return media.src;
};
