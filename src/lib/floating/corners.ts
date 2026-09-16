import { FLOATING_COMPONENTS, isFloatingId } from "./registry";
import type { FloatingId, PuckCorner, PuckCornerInfo } from "./types";

/**
 * The four corners, as the data the preference UI renders.
 *
 * A catalogue in `lib` rather than literals in the view, the same call
 * `COMPACT_NAV_STYLES` and `CLOCK_FACE_OPTIONS` make: the labels are facts about the
 * corners and the CLI prints the same list. Order is reading order — the two bottom
 * corners first, because they are where a puck normally goes.
 */
export const PUCK_CORNERS: readonly PuckCornerInfo[] = [
  { id: "bottom-right", label: "Bottom right" },
  { id: "bottom-left", label: "Bottom left" },
  { id: "top-right", label: "Top right" },
  { id: "top-left", label: "Top left" },
];

/**
 * Where a puck goes when the reader has expressed no preference.
 *
 * Bottom-right: where the music puck already docks, where this app's pucks have always
 * gone, and the corner furthest from the navigation on both layouts.
 */
export const DEFAULT_PUCK_CORNER: PuckCorner = "bottom-right";

/** Whether `value` names a corner — the guard for a stored row. */
export function isPuckCorner(value: string): value is PuckCorner {
  return PUCK_CORNERS.some((corner) => corner.id === value);
}

/**
 * A stored corner, or the default.
 *
 * Clamps rather than throwing: this is read on every authenticated page, so a row
 * holding a corner we retired must degrade to bottom-right instead of failing to
 * render the layer.
 */
export function resolvePuckCorner(value: string | undefined): PuckCorner {
  const trimmed = value?.trim();
  return trimmed !== undefined && isPuckCorner(trimmed) ? trimmed : DEFAULT_PUCK_CORNER;
}

/** The preference key one component's corner is stored under. */
export function puckCornerKey(id: FloatingId): string {
  return `floating_corner_${id}`;
}

/**
 * Every registered component's corner for one reader.
 *
 * A full record — a component with no stored row lands on the default — so callers
 * never branch on whether a row existed. Same contract `resolveFloatingStates` holds.
 */
export function resolvePuckCorners(
  byKey: ReadonlyMap<string, string>,
): Record<FloatingId, PuckCorner> {
  return Object.fromEntries(
    FLOATING_COMPONENTS.map((component) => [
      component.id,
      resolvePuckCorner(byKey.get(puckCornerKey(component.id))),
    ]),
  ) as Record<FloatingId, PuckCorner>;
}

/** One component's corner key, or `undefined` for an unknown id. */
export function puckCornerKeyFor(id: string): string | undefined {
  return isFloatingId(id) ? puckCornerKey(id) : undefined;
}
