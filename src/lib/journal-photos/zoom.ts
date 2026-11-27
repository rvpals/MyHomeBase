// The photo viewer's zoom and pan arithmetic.
//
// Pure, so the rules -- the steps, the limits, how far a zoomed picture may be dragged
// -- are tested here rather than discovered by eye on the stage. The viewer holds the
// state and calls these; nothing here knows about pointers or the DOM.

/** The zoom levels the `+`/`−` controls step through. 1 is "fit to the stage". */
export const ZOOM_STEPS = [1, 1.5, 2, 3, 4, 6, 8] as const;

export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/** Keeps any zoom value inside the supported range. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * The next step in or out from `current`.
 *
 * Steps to the next LISTED level rather than multiplying, so a zoom reached by the wheel
 * (an arbitrary 2.37) snaps onto the ladder on the next button press instead of
 * wandering between odd percentages forever.
 */
export function stepZoom(current: number, direction: "in" | "out"): number {
  const zoom = clampZoom(current);
  if (direction === "in") {
    return ZOOM_STEPS.find((step) => step > zoom + 1e-9) ?? MAX_ZOOM;
  }
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom - 1e-9) ?? MIN_ZOOM;
}

/** The zoom after a wheel tick. `deltaY < 0` is "scroll up", which zooms in. */
export function wheelZoom(current: number, deltaY: number): number {
  // ~10% per notch of a typical 100px wheel step, proportional for trackpads.
  return clampZoom(current * Math.exp(-deltaY * 0.001));
}

export interface PanOffset {
  x: number;
  y: number;
}

/**
 * Keeps a pan offset inside what the zoomed picture can actually cover.
 *
 * The image is drawn at `width × height` (its fitted size on the stage) and scaled by
 * `zoom` around its centre, so it overhangs by `(zoom − 1) × size / 2` on each side.
 * Dragging further than that would pull black stage into view beside the picture, so
 * the offset is clamped to the overhang. At zoom 1 there is no overhang and the offset
 * is always zero.
 */
export function clampPan(
  offset: PanOffset,
  zoom: number,
  size: { width: number; height: number },
): PanOffset {
  const z = clampZoom(zoom);
  const maxX = Math.max(0, ((z - 1) * size.width) / 2);
  const maxY = Math.max(0, ((z - 1) * size.height) / 2);
  const clamp = (value: number, max: number) => (max === 0 ? 0 : Math.min(max, Math.max(-max, value)));
  return { x: clamp(offset.x, maxX), y: clamp(offset.y, maxY) };
}

/** `1.5` → `"150%"`, for the readout between the buttons. */
export function zoomPercentLabel(zoom: number): string {
  return `${Math.round(clampZoom(zoom) * 100)}%`;
}
