// Where one reader has dragged each floating toolbar.
//
// Deliberately NOT a column on `sys_toolbars`: that table is the administrator's —
// which bars exist, and how each one looks — and this is per-person, exactly as the
// `toolbars_hidden` list beside it is. Where a bar sits on MY screen is mine, in the
// same way whether it is on my screen at all is mine. A column would mean one person
// dragging a bar moves it for the whole household, which is the behaviour the
// ownership split exists to prevent, and it would be wrong on its face besides: two
// readers on different screen sizes cannot share one pixel position.
//
// So this is one preference key holding a small list, the shape `toolbars_hidden` and
// `nav_expanded_modules` already use:
//
//     <toolbarId>:<x>,<y>;<toolbarId>:<x>,<y>
//
// Bounded by the toolbars that exist, and only the floating ones ever get an entry.
//
// ## Positions are stored, and then clamped on the way out
//
// A stored position is a point the reader put the bar at on *some* screen — possibly
// a wider one, possibly before they rotated the device. It is kept verbatim rather
// than normalised, and `clampToolbarPosition` is what makes it safe to render on
// whatever viewport is actually in front of them now. Storing a percentage instead
// would survive a resize but would drift the bar every time, which is worse: a bar
// parked beside a card should still be beside that card.

/** The preference key the position list lives under. */
export const TOOLBAR_POSITIONS_PREFERENCE_KEY = "toolbar_positions";

/**
 * How much of a floating bar must stay on screen, in pixels.
 *
 * The bar is its own drag handle's host, so losing it off an edge is unrecoverable
 * through the UI — the one place you would go to drag it back. Same reasoning
 * `Modal`'s `KEEP_VISIBLE_X` records, and deliberately the same order of magnitude:
 * enough of the bar to grab.
 */
export const KEEP_TOOLBAR_VISIBLE = 48;

/** One floating toolbar's position on this reader's screen, in CSS pixels. */
export interface ToolbarPosition {
  x: number;
  y: number;
}

/**
 * The positions, parsed from the stored value, keyed by toolbar id.
 *
 * Unknown, malformed and non-finite entries are **dropped** rather than throwing: a
 * deleted toolbar leaves its id behind in every reader's row, and a hand-edited or
 * truncated value should not be able to take the shell down. A screen that crashed
 * on a stale entry would be unfixable through the UI — the one place you would go to
 * fix it. Same rule `parseHiddenToolbars` and `parseEnabledFloating` both follow.
 */
export function parseToolbarPositions(
  value: string | undefined,
): Map<number, ToolbarPosition> {
  const positions = new Map<number, ToolbarPosition>();
  if (!value) return positions;

  for (const part of value.split(";")) {
    const [idText, pointText] = part.split(":");
    if (idText === undefined || pointText === undefined) continue;

    const id = Number(idText.trim());
    if (!Number.isInteger(id) || id <= 0) continue;

    const [xText, yText] = pointText.split(",");
    const x = Number(xText);
    const y = Number(yText);
    // `Number("")` is 0 and `Number(undefined)` is NaN, so both halves are checked
    // for finiteness rather than for truthiness — a legitimately stored `0` must
    // survive, and it would not if this tested `if (!x)`.
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    positions.set(id, { x: Math.round(x), y: Math.round(y) });
  }

  return positions;
}

/**
 * The positions as stored. Sorted by id, so a round trip never looks like a change.
 *
 * Rounded to whole pixels on the way in as well as on parse: a pointer drag produces
 * fractional coordinates on a scaled display, and storing `183.3999999999999` makes
 * every save look like a change to anything diffing the preference value.
 */
export function serializeToolbarPositions(
  positions: ReadonlyMap<number, ToolbarPosition>,
): string {
  return [...positions.entries()]
    .sort(([a], [b]) => a - b)
    .map(([id, point]) => `${id}:${Math.round(point.x)},${Math.round(point.y)}`)
    .join(";");
}

/**
 * Records where one toolbar now sits, returning the new map.
 *
 * Takes and returns the whole map rather than mutating, so the caller writes one
 * preference key with `setValue` — never through `userPreferencesToEntries`, which
 * writes every key it carries and would let a stale tab clobber an unrelated
 * preference. Same reasoning as `setToolbarHidden` and `saveFloatingState`.
 */
export function setToolbarPosition(
  positions: ReadonlyMap<number, ToolbarPosition>,
  toolbarId: number,
  position: ToolbarPosition,
): Map<number, ToolbarPosition> {
  const next = new Map(positions);
  next.set(toolbarId, { x: Math.round(position.x), y: Math.round(position.y) });
  return next;
}

/**
 * Forgets one toolbar's position, returning the new map — the "reset" on Account.
 *
 * Removing the entry rather than storing the default is what makes the default able
 * to *change*: a bar with no entry is parked by whatever the renderer currently
 * considers sensible, so a reader who reset last year is not pinned to last year's
 * idea of where a bar opens.
 */
export function clearToolbarPosition(
  positions: ReadonlyMap<number, ToolbarPosition>,
  toolbarId: number,
): Map<number, ToolbarPosition> {
  const next = new Map(positions);
  next.delete(toolbarId);
  return next;
}

/**
 * Pulls a position back onto the viewport.
 *
 * Pure arithmetic over numbers the caller measured — nothing here reads the DOM, so
 * this is testable without a browser, which is the whole reason the clamp lives in
 * `lib` rather than inline in the drag handler.
 *
 * Asymmetric by design, and the asymmetry is the point:
 *
 * - Horizontally, the bar may hang off **either** edge as long as
 *   `KEEP_TOOLBAR_VISIBLE` of it remains grabbable. A wide bar on a narrow screen
 *   genuinely does not fit, and refusing to let it overhang would snap it to the
 *   left edge and make the right-hand shortcuts unreachable.
 * - Vertically it may **never** go above the viewport top. The bar is its own handle,
 *   so losing it upward is unrecoverable in a way losing the bottom edge is not —
 *   exactly the trade `Modal`'s clamp documents.
 */
export function clampToolbarPosition(
  position: ToolbarPosition,
  bar: { width: number; height: number },
  viewport: { width: number; height: number },
): ToolbarPosition {
  const minX = KEEP_TOOLBAR_VISIBLE - bar.width;
  const maxX = viewport.width - KEEP_TOOLBAR_VISIBLE;
  const maxY = viewport.height - KEEP_TOOLBAR_VISIBLE;

  return {
    // Clamped into [minX, maxX], which stays a valid range even for a bar far wider
    // than the screen: a 900px bar on a 320px viewport gives [-852, 272]. (It would
    // only invert if the bar and the viewport together were under
    // 2 * KEEP_TOOLBAR_VISIBLE, which no real screen reaches — an earlier comment
    // here claimed the inversion was the normal wide-bar case and it is not.)
    //
    // So a wide bar simply keeps the x it was dragged to, overhanging whichever edge
    // the reader pushed it past, with KEEP_TOOLBAR_VISIBLE always left to grab.
    x: Math.min(maxX, Math.max(minX, position.x)),
    y: Math.min(maxY, Math.max(0, position.y)),
  };
}
