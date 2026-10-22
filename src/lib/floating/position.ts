import { FLOATING_COMPONENTS, isFloatingId } from "./registry";
import type { FloatingId, PuckPosition } from "./types";

// Where one reader has dragged each minimized puck.
//
// The close sibling of `src/lib/toolbars/position.ts`, deliberately: migration 0153
// solved this same problem for the floating toolbar, and a second draggable thing on
// the same screen should not invent a second idiom for remembering where it was put.
// What differs is the key — a `FloatingId` rather than a toolbar's numeric row id —
// and that difference is why this is its own file rather than a generic shared one.
// Making it generic would mean a `Map<string, Point>` and losing the closed union that
// keeps a typo from compiling, which is the guarantee `FloatingId` exists to give.
//
// Stored as one preference key holding a small list, the shape `toolbar_positions`,
// `toolbars_hidden` and `nav_expanded_modules` already use:
//
//     clock:320,180;calculator:900,420
//
// Bounded by the registry: at most one entry per floating component.
//
// ## A position is per reader, never per household
//
// The same ownership split the enabled list draws, and for a stronger reason here:
// `floating_enabled` is an administrator's (which components exist) while this is each
// person's (where mine sits on my screen). Two readers on different monitors cannot
// share one pixel coordinate, so this could not be a setting even if the ownership
// argument did not already settle it.
//
// ## Positions are stored verbatim, and clamped on the way out
//
// A stored point is where the reader put the puck on *some* viewport — possibly a wider
// one, possibly before they rotated the device. It is kept as given rather than
// normalised to a percentage, and `clampPuckPosition` is what makes it safe to render
// on whatever screen is actually in front of them now. A percentage would survive a
// resize but drift on every one, which is worse: a puck parked beside a card should
// still be beside that card.

/** The preference key the position list lives under. */
export const FLOATING_POSITIONS_PREFERENCE_KEY = "floating_positions";

/**
 * How much of a puck must stay on screen, in pixels.
 *
 * The puck is its own drag handle — there is no separate grip — so losing it off an
 * edge is unrecoverable through the UI, the one place you would go to drag it back.
 * Same reasoning `KEEP_TOOLBAR_VISIBLE` and `Modal`'s `KEEP_VISIBLE_X` both record.
 *
 * Two thirds of the 56px puck rather than the toolbar's 48, because a puck is round:
 * its corners are empty, so the grabbable area at the edge of a clipped circle is
 * smaller than the same number of pixels of a rectangular bar.
 */
export const KEEP_PUCK_VISIBLE = 36;

/**
 * The positions, parsed from the stored value, keyed by component id.
 *
 * Unknown, malformed and non-finite entries are **dropped** rather than throwing. A
 * component retired from the registry leaves its id behind in every reader's row, and a
 * hand-edited or truncated value must not be able to take the shell down — this is read
 * on every authenticated page. A screen that crashed on a stale entry would be
 * unfixable through the UI. Same rule `parseEnabledFloating`, `resolvePuckCorner` and
 * `parseToolbarPositions` all follow.
 */
export function parsePuckPositions(
  value: string | undefined,
): Map<FloatingId, PuckPosition> {
  const positions = new Map<FloatingId, PuckPosition>();
  if (!value) return positions;

  for (const part of value.split(";")) {
    const [idText, pointText] = part.split(":");
    if (idText === undefined || pointText === undefined) continue;

    const id = idText.trim();
    if (!isFloatingId(id)) continue;

    const [xText, yText] = pointText.split(",");
    const x = Number(xText);
    const y = Number(yText);
    // Both halves checked for finiteness rather than truthiness: `Number("")` is 0 and
    // `Number(undefined)` is NaN, so a legitimately stored `0` must survive — and it
    // would not if this tested `if (!x)`.
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    positions.set(id, { x: Math.round(x), y: Math.round(y) });
  }

  return positions;
}

/**
 * Registry order, for the sort below.
 *
 * Derived rather than written out, so a new floating component cannot ship with a
 * missing entry — the same derivation `FLOATING_STATE_KEYS` makes.
 */
const FLOATING_ID_ORDER: readonly FloatingId[] = FLOATING_COMPONENTS.map(
  (component) => component.id,
);

/**
 * The positions as stored. Registry order, so a round trip never looks like a change.
 *
 * Rounded to whole pixels on the way out as well as on parse: a pointer drag on a
 * scaled display produces fractional coordinates, and storing `183.3999999999999` makes
 * every save look like a change to anything diffing the preference value.
 */
export function serializePuckPositions(
  positions: ReadonlyMap<FloatingId, PuckPosition>,
): string {
  return [...positions.entries()]
    // Registry order rather than insertion order, for the same reason
    // `enabledFloatingToValue` sorts: the order the reader happened to drag things in
    // is not a preference worth preserving, and a stable value keeps a no-op save from
    // looking like an edit.
    .sort(([a], [b]) => FLOATING_ID_ORDER.indexOf(a) - FLOATING_ID_ORDER.indexOf(b))
    .map(([id, point]) => `${id}:${Math.round(point.x)},${Math.round(point.y)}`)
    .join(";");
}

/**
 * Records where one puck now sits, returning the new map.
 *
 * Takes and returns the whole map rather than mutating, so the caller writes the one
 * preference key with `setValue` — never through `userPreferencesToEntries`, which
 * writes every key it carries and would let a stale tab clobber an unrelated
 * preference. Same reasoning as `setToolbarPosition` and `saveFloatingState`.
 */
export function setPuckPosition(
  positions: ReadonlyMap<FloatingId, PuckPosition>,
  id: FloatingId,
  position: PuckPosition,
): Map<FloatingId, PuckPosition> {
  const next = new Map(positions);
  next.set(id, { x: Math.round(position.x), y: Math.round(position.y) });
  return next;
}

/**
 * Forgets one puck's position, returning the new map — the "reset" on Account.
 *
 * Removing the entry rather than storing a default is what lets the default *change*: a
 * puck with no entry parks wherever its corner rule currently puts it, so a reader who
 * reset last year is not pinned to last year's idea of where a puck opens. It is also
 * what hands the puck back to the corner queue — see `resolvePuckSlots`.
 */
export function clearPuckPosition(
  positions: ReadonlyMap<FloatingId, PuckPosition>,
  id: FloatingId,
): Map<FloatingId, PuckPosition> {
  const next = new Map(positions);
  next.delete(id);
  return next;
}

/**
 * Pulls a position back onto the viewport.
 *
 * Pure arithmetic over numbers the caller measured — nothing here reads the DOM, which
 * is the whole reason the clamp lives in `lib` rather than inline in the drag handler.
 * It is also the only part of this feature a unit test can catch, since two pucks
 * overlapping is invisible to a headless browser (design.md records that WebKit does
 * not emulate safe-area insets).
 *
 * Symmetric, unlike `clampToolbarPosition`, and the difference is the shape:
 *
 * - A toolbar is wide and may legitimately overhang an edge, because a wide bar on a
 *   narrow screen genuinely does not fit and snapping it flush would put its far
 *   shortcuts out of reach.
 * - A puck is 56px square. It always fits, so there is never a reason to let one hang
 *   off an edge — `KEEP_PUCK_VISIBLE` is a floor against a bad stored value, not a
 *   layout accommodation.
 *
 * The top edge is still special: `y` may never go negative. The puck is its own handle,
 * so losing it upward is unrecoverable in a way losing the bottom edge is not — exactly
 * the trade `Modal`'s clamp and `clampToolbarPosition` both document.
 */
export function clampPuckPosition(
  position: PuckPosition,
  puck: { width: number; height: number },
  viewport: { width: number; height: number },
): PuckPosition {
  const minX = KEEP_PUCK_VISIBLE - puck.width;
  const maxX = viewport.width - KEEP_PUCK_VISIBLE;
  const maxY = viewport.height - KEEP_PUCK_VISIBLE;

  return {
    // `Math.min(maxX, ...)` outermost so a viewport narrower than the puck resolves to
    // the left overhang rather than the right. Degenerate on any real screen — a 56px
    // puck fits everywhere — but the ordering is free and the alternative is a silent
    // NaN-shaped surprise if it ever is not.
    x: Math.min(maxX, Math.max(minX, position.x)),
    y: Math.min(maxY, Math.max(0, position.y)),
  };
}

/**
 * Every puck's position for one reader, from their raw preference rows.
 *
 * Returns only the pucks that *have* one, unlike `resolveFloatingStates` and
 * `resolvePuckCorners` beside it, which both return a full record. The difference is
 * meaningful rather than an inconsistency: a missing state or corner has a sensible
 * default to fill in, whereas "has not been dragged" is not a position — it is the
 * absence of one, and it is exactly what tells the renderer to use the corner instead.
 */
export function resolvePuckPositions(
  byKey: ReadonlyMap<string, string>,
): Map<FloatingId, PuckPosition> {
  return parsePuckPositions(byKey.get(FLOATING_POSITIONS_PREFERENCE_KEY));
}
