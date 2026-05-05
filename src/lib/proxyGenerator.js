export const PREVIEW_QUALITY_OPTIONS = ["full", "half", "quarter"];

export const normalizePreviewQuality = (value) =>
  PREVIEW_QUALITY_OPTIONS.includes(value) ? value : "full";

export const getPreviewResolution = (previewQuality) => {
  if (previewQuality === "quarter") return 360;
  if (previewQuality === "half") return 480;
  return null;
};

export const getPreviewMediaSrc = (media, previewQuality = "full") => {
  if (!media) return null;
  if (normalizePreviewQuality(previewQuality) === "full") return media.src;
  return media.proxySrc || media.src;
};
