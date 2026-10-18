// Set math for the Location Manager's Venn view: given some saved places and
// two or three taxonomy names, say which places fall in each region of the
// diagram.
//
// Pure data in, data out — no React, no DOM, no geometry. Where the circles sit
// on screen is the component's problem; this file only knows *membership*. That
// split is what lets the compact fork draw labelled groups from exactly the
// same regions the desktop draws as overlapping circles.

import type { LocationTaxonomyKind, SavedLocation } from "./types";

/**
 * How many sets a Venn can actually show.
 *
 * Three is a geometric ceiling, not a arbitrary cap: four sets cannot be drawn
 * with circles at all, and the ellipse forms that manage it are unreadable. The
 * picker enforces this rather than the renderer, so a caller can't hand us a
 * fourth and get a silently wrong picture.
 */
export const MAX_VENN_SETS = 3;

/** Below two sets there is nothing to intersect, so there is no diagram. */
export const MIN_VENN_SETS = 2;

/**
 * One region of the diagram: a combination of the chosen names, and every place
 * carrying exactly that combination.
 *
 * "Exactly" is the important word. A place tagged Hiking + Scenic belongs to the
 * Hiking∩Scenic region and *not* to the Hiking-only region, because the regions
 * partition the places — every place lands in exactly one. That is what makes
 * the counts add up and what stops a name being drawn twice.
 */
export interface VennRegion<P extends SavedLocation = SavedLocation> {
  /**
   * Which of the chosen sets this region is inside, as indices into the names
   * array that produced it. Sorted ascending, never empty.
   *
   * Indices rather than names so the renderer can map a region straight onto
   * the circle it belongs to without a lookup.
   */
  setIndices: number[];
  /** The chosen names this region is inside, in the order they were chosen. */
  names: string[];
  /**
   * A reader-facing label: "Hiking", "Hiking + Scenic", "All three".
   * Built here so the diagram and the compact group list can't word it
   * differently.
   */
  label: string;
  /** Every place carrying exactly this combination, in the order given. */
  places: P[];
}

/**
 * Everything the Venn view needs to draw itself.
 *
 * Generic over the place type so a caller holding `SavedLocationWithUsage` gets
 * those rows back out of a region, rather than the base type — the regions are a
 * re-grouping of the caller's own objects, not a projection of them.
 */
export interface VennLayout<P extends SavedLocation = SavedLocation> {
  /** The chosen names, in display order. Between 2 and 3 of them. */
  names: string[];
  /** Which taxonomy the names came from. */
  kind: LocationTaxonomyKind;
  /**
   * Every non-empty region, ordered by how many sets each is inside — singles
   * first, then pairs, then the triple. Empty regions are dropped: an empty
   * lens is already visible as a gap, and a "0 places" list is noise.
   */
  regions: VennRegion<P>[];
  /**
   * Places carrying none of the chosen names. Shown as a trailing group rather
   * than dropped, so the view never silently hides part of the library.
   */
  unmatched: P[];
  /** How many places the layout accounts for, matched or not. */
  totalPlaces: number;
}

/** The taxonomy values a place carries, for whichever list we're intersecting. */
function valuesOf(place: SavedLocation, kind: LocationTaxonomyKind): string[] {
  return kind === "tag" ? place.tags : place.categories;
}

/**
 * Taxonomy names are compared case-insensitively, because the repository stores
 * and matches them `COLLATE NOCASE` — a place tagged "hiking" must land in the
 * "Hiking" circle, or the diagram would disagree with the filter chips above it
 * about the very same rows.
 */
function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** "Hiking", "Hiking + Scenic", "All three" — one wording, used everywhere. */
function labelFor(names: string[], chosenCount: number): string {
  if (names.length === chosenCount && chosenCount === MAX_VENN_SETS) return "All three";
  if (names.length === chosenCount && chosenCount === MIN_VENN_SETS) return "Both";
  return names.join(" + ");
}

/**
 * Ranks taxonomy names by how many of these places carry them, most-used first.
 *
 * Counted over the places actually on screen rather than read from
 * `countLocationsByTag`, which counts the whole library: the Venn sits under the
 * search box and the filter chips, so "the three most-used tags" has to mean
 * most-used *among what you are looking at*. Otherwise filtering down to a
 * handful of places would still offer three tags none of them carry.
 *
 * Ties break alphabetically so the default picks don't reshuffle between two
 * reads of the same data.
 */
export function rankTaxonomyNames(
  places: readonly SavedLocation[],
  kind: LocationTaxonomyKind,
): { name: string; count: number }[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const place of places) {
    for (const value of valuesOf(place, kind)) {
      const key = value.toLowerCase();
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      // First spelling seen wins the display casing — the taxonomy table holds
      // one canonical row per name, so the variants are only ever casing.
      else counts.set(key, { name: value, count: 1 });
    }
  }
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/**
 * The names the view starts on: the most-used ones, capped at three.
 *
 * Returns fewer than two when the data can't fill a diagram — a library with one
 * tag in use has nothing to intersect — and the view says so rather than drawing
 * a lone circle.
 */
export function defaultVennNames(
  places: readonly SavedLocation[],
  kind: LocationTaxonomyKind,
): string[] {
  return rankTaxonomyNames(places, kind)
    .slice(0, MAX_VENN_SETS)
    .map((entry) => entry.name);
}

/**
 * Partitions `places` into the regions of a Venn over `names`.
 *
 * Throws on more than three names: a four-set diagram cannot be drawn, so a
 * caller asking for one has a bug, and silently dropping the fourth would hide
 * it. Fewer than two returns an empty layout with every place unmatched — that
 * is a legitimate state the view renders as "pick another tag", not an error.
 */
export function buildVennLayout<P extends SavedLocation>(
  places: readonly P[],
  names: readonly string[],
  kind: LocationTaxonomyKind,
): VennLayout<P> {
  if (names.length > MAX_VENN_SETS) {
    throw new Error(
      `A Venn diagram can show at most ${MAX_VENN_SETS} sets; got ${names.length}.`,
    );
  }

  const chosen = [...names];
  if (chosen.length < MIN_VENN_SETS) {
    return {
      names: chosen,
      kind,
      regions: [],
      unmatched: [...places],
      totalPlaces: places.length,
    };
  }

  // Key a region by its set indices, so every place carrying the same
  // combination lands in the same bucket regardless of the order its own tags
  // happen to be stored in.
  const buckets = new Map<string, VennRegion<P>>();
  const unmatched: P[] = [];

  for (const place of places) {
    const values = valuesOf(place, kind);
    const setIndices = chosen
      .map((name, index) => (values.some((value) => sameName(value, name)) ? index : -1))
      .filter((index) => index >= 0);

    if (setIndices.length === 0) {
      unmatched.push(place);
      continue;
    }

    const key = setIndices.join(",");
    let region = buckets.get(key);
    if (!region) {
      const regionNames = setIndices.map((index) => chosen[index]);
      region = {
        setIndices,
        names: regionNames,
        label: labelFor(regionNames, chosen.length),
        places: [],
      };
      buckets.set(key, region);
    }
    region.places.push(place);
  }

  // Singles before pairs before the triple, and within a rank by set order, so
  // the groups read in the same order as the circles are labelled.
  const regions = [...buckets.values()].sort(
    (a, b) =>
      a.setIndices.length - b.setIndices.length ||
      a.setIndices[0] - b.setIndices[0] ||
      (a.setIndices[1] ?? 0) - (b.setIndices[1] ?? 0),
  );

  return { names: chosen, kind, regions, unmatched, totalPlaces: places.length };
}

/**
 * The region covering exactly `setIndices`, or undefined when it is empty.
 *
 * The renderer draws one slot per possible region — including the empty ones,
 * which still need their outline — so it asks for them by combination rather
 * than walking the list.
 */
export function findVennRegion<P extends SavedLocation>(
  layout: VennLayout<P>,
  setIndices: readonly number[],
): VennRegion<P> | undefined {
  const key = [...setIndices].sort((a, b) => a - b).join(",");
  return layout.regions.find((region) => region.setIndices.join(",") === key);
}
