// Diagonal fade overlay shapes (SVG viewBox 0 0 100 100, y grows downward).
// Black falls from top to bottom along a straight edge (not a curved envelope).

/** Left fade-in: top-left triangle; edge from bottom-left to top-right (/). */
export const FADE_IN_POLYGON = "0,0 0,100 100,0";
export const FADE_IN_POLYLINE = "0,100 100,0";

/** Right fade-out: top-right triangle; edge from top-left to bottom-right. */
export const FADE_OUT_POLYGON = "0,0 100,0 100,100";
export const FADE_OUT_POLYLINE = "0,0 100,100";
