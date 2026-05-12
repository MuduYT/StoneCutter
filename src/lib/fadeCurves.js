// Constant-power fade curve helpers for SVG overlays
const FADE_SVG_STEPS = 24;

const buildFadeInPolyline = () => {
  let pts = "0,100 ";
  for (let i = 1; i <= FADE_SVG_STEPS; i++) {
    const x = (i / FADE_SVG_STEPS) * 100;
    const progress = i / FADE_SVG_STEPS;
    const y = 100 - 100 * Math.sin((Math.PI / 2) * progress);
    pts += x.toFixed(2) + "," + y.toFixed(2) + " ";
  }
  return pts;
};

const buildFadeInPolygon = () => {
  let pts = "0,100 ";
  for (let i = 1; i <= FADE_SVG_STEPS; i++) {
    const x = (i / FADE_SVG_STEPS) * 100;
    const progress = i / FADE_SVG_STEPS;
    const y = 100 - 100 * Math.sin((Math.PI / 2) * progress);
    pts += x.toFixed(2) + "," + y.toFixed(2) + " ";
  }
  pts += "100,100";
  return pts;
};

const buildFadeOutPolyline = () => {
  let pts = "0,0 ";
  for (let i = 1; i <= FADE_SVG_STEPS; i++) {
    const x = (i / FADE_SVG_STEPS) * 100;
    const progress = i / FADE_SVG_STEPS;
    const y = 100 * Math.cos((Math.PI / 2) * progress);
    pts += x.toFixed(2) + "," + y.toFixed(2) + " ";
  }
  return pts;
};

const buildFadeOutPolygon = () => {
  let pts = "0,0 ";
  for (let i = 1; i <= FADE_SVG_STEPS; i++) {
    const x = (i / FADE_SVG_STEPS) * 100;
    const progress = i / FADE_SVG_STEPS;
    const y = 100 * Math.cos((Math.PI / 2) * progress);
    pts += x.toFixed(2) + "," + y.toFixed(2) + " ";
  }
  pts += "100,100 0,100";
  return pts;
};

export const FADE_IN_POLYLINE = buildFadeInPolyline();
export const FADE_IN_POLYGON = buildFadeInPolygon();
export const FADE_OUT_POLYLINE = buildFadeOutPolyline();
export const FADE_OUT_POLYGON = buildFadeOutPolygon();
