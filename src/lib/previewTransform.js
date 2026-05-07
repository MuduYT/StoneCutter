const clampScale = (value) => Math.max(0, Math.min(400, value));

/** Resolve-style: soft pull toward 0 (frame center offset in px). Quadratic falloff inside radius. */
export const PREVIEW_POSITION_MAGNET_PX = 22;

export function softMagnetTowardZero(value, magnetPx = PREVIEW_POSITION_MAGNET_PX) {
  const v = Number(value) || 0;
  const d = Math.abs(v);
  if (d >= magnetPx || d < 1e-6) return v;
  const t = d / magnetPx;
  const eased = t * t;
  return (v < 0 ? -1 : 1) * d * eased;
}

/**
 * Free float when snap off. When snap on: soft center snap + optional alignment guides
 * only while cursor is inside the magnet zone (Resolve-like, not per-frame quantization).
 */
export function smoothPreviewMove(rawX, rawY, rect, snapEnabled) {
  const w = Math.max(1, Number(rect?.width) || 1);
  const h = Math.max(1, Number(rect?.height) || 1);
  const rx = Number(rawX) || 0;
  const ry = Number(rawY) || 0;
  if (!snapEnabled) {
    return {
      positionX: rx,
      positionY: ry,
      guides: null,
    };
  }
  const nearCenterX = Math.abs(rx) < PREVIEW_POSITION_MAGNET_PX;
  const nearCenterY = Math.abs(ry) < PREVIEW_POSITION_MAGNET_PX;
  const x = softMagnetTowardZero(rx, PREVIEW_POSITION_MAGNET_PX);
  const y = softMagnetTowardZero(ry, PREVIEW_POSITION_MAGNET_PX);
  const guides = {};
  if (nearCenterX) guides.x = w / 2 + x;
  if (nearCenterY) guides.y = h / 2 + y;
  return {
    positionX: x,
    positionY: y,
    guides: Object.keys(guides).length > 0 ? guides : null,
  };
}

const parseResizeMode = (mode) => {
  const token = String(mode || "").replace(/^resize-/, "");
  switch (token) {
    case "nw":
      return { horizontal: -1, vertical: -1 };
    case "ne":
      return { horizontal: 1, vertical: -1 };
    case "se":
      return { horizontal: 1, vertical: 1 };
    case "sw":
      return { horizontal: -1, vertical: 1 };
    case "left":
      return { horizontal: -1, vertical: 0 };
    case "right":
      return { horizontal: 1, vertical: 0 };
    case "top":
      return { horizontal: 0, vertical: -1 };
    case "bottom":
      return { horizontal: 0, vertical: 1 };
    default:
      return { horizontal: 0, vertical: 0 };
  }
};

const rotateVector = (x, y, rotationDeg) => {
  const angle = (Number(rotationDeg) || 0) * (Math.PI / 180);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  };
};

export const computePreviewResizeTransform = ({
  mode,
  rect,
  dx = 0,
  dy = 0,
  clip,
  altKey = false,
}) => {
  const width = Math.max(1, Number(rect?.width) || 1);
  const height = Math.max(1, Number(rect?.height) || 1);
  const baseScaleX = Number(clip?.scaleX ?? clip?.scale ?? 100);
  const baseScaleY = Number(clip?.scaleY ?? clip?.scale ?? 100);
  const locked = clip?.scaleLocked !== false;
  const { horizontal, vertical } = parseResizeMode(mode);
  const flipSignX = clip?.flipH ? -1 : 1;
  const flipSignY = clip?.flipV ? -1 : 1;
  const visualHorizontal = horizontal * flipSignX;
  const visualVertical = vertical * flipSignY;
  const isCornerHandle = horizontal !== 0 && vertical !== 0;
  const centered = altKey || !isCornerHandle;

  const scaleDeltaX =
    visualHorizontal === 0
      ? 0
      : (visualHorizontal * Number(dx || 0) / width) * 100;
  const scaleDeltaY =
    visualVertical === 0
      ? 0
      : (visualVertical * Number(dy || 0) / height) * 100;

  let nextScaleX = baseScaleX;
  let nextScaleY = baseScaleY;

  if (horizontal !== 0) nextScaleX = baseScaleX + scaleDeltaX;
  if (vertical !== 0) nextScaleY = baseScaleY + scaleDeltaY;

  if (locked) {
    const uniformDelta =
      Math.abs(scaleDeltaX) >= Math.abs(scaleDeltaY)
        ? scaleDeltaX
        : scaleDeltaY;
    nextScaleX = baseScaleX + uniformDelta;
    nextScaleY = baseScaleY + uniformDelta;
  }

  const clampedScaleX = clampScale(nextScaleX);
  const clampedScaleY = clampScale(nextScaleY);
  const patch = {
    scaleX: clampedScaleX,
    scaleY: clampedScaleY,
    scale: clampScale(
      locked ? clampedScaleX : (clampedScaleX + clampedScaleY) / 2,
    ),
    scaleLocked: locked,
  };

  if (centered || !isCornerHandle) {
    return patch;
  }

  const anchorX = (-horizontal * width) / 2;
  const anchorY = (-vertical * height) / 2;
  const oldAnchor = {
    x: anchorX * flipSignX * (baseScaleX / 100),
    y: anchorY * flipSignY * (baseScaleY / 100),
  };
  const newAnchor = {
    x: anchorX * flipSignX * (clampedScaleX / 100),
    y: anchorY * flipSignY * (clampedScaleY / 100),
  };
  const offset = rotateVector(
    oldAnchor.x - newAnchor.x,
    oldAnchor.y - newAnchor.y,
    clip?.rotation ?? 0,
  );

  return {
    ...patch,
    positionX: Number(clip?.positionX ?? 0) + offset.x,
    positionY: Number(clip?.positionY ?? 0) + offset.y,
  };
};
