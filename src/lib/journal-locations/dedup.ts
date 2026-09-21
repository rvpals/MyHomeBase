// Finding near-duplicate saved locations for the Location Manager's
// "Merging & Dedup" dialog.
//
// The library fills up from two directions — places typed by hand, and places
// created in bulk from coordinates already on journal entries — so the same
// shop arrives twice under names that differ by an apostrophe, a "The", or a
// pin dropped a few metres off. Exact grouping (what `lib/journal/duplicates.ts`
// does for entries, on date+title) cannot see any of that.
//
// This module *finds candidates*. It never decides what to delete: the reader
// picks the survivor in the dialog, and the merge path takes the ids it is
// given without re-deriving that they were duplicates at all. Same division as
// the entry-duplicates screen, and for the same reason — a similarity score is
// a suggestion, and only a human knows whether two "Starbucks" are one place.

import type { SavedLocationWithUsage } from "./types";

/**
 * How close two names must score to be called duplicates, as a Dice coefficient
 * over character bigrams (0 = nothing in common, 1 = identical).
 *
 * 0.82 is tuned to catch punctuation and filler-word drift — the "Bucks County
 * Childrens Museum" / "Buck's County Children's Museum" case — while keeping
 * genuinely different branches of one chain apart. The dialog exposes it as a
 * slider, so this is the starting point rather than a fixed rule.
 */
export const DEFAULT_NAME_THRESHOLD = 0.82;

/** The slider's range. Below 0.6 almost everything matches everything. */
export const MIN_NAME_THRESHOLD = 0.6;
export const MAX_NAME_THRESHOLD = 1;

/**
 * Decimal places coordinates are rounded to before being compared.
 *
 * 3 places is ~110m at the equator and less with latitude. That is the scale
 * the duplicates in this library actually differ by: the same building
 * reverse-geocoded twice, or a pin nudged by hand. Rounding rather than
 * measuring a real distance is deliberate — it makes the coordinate a *key*
 * that can be grouped on, which is what keeps this O(n) per bucket instead of
 * comparing every pair of places against every other.
 */
export const COORDINATE_PRECISION = 3;

/** Metres per degree of latitude, for the distance a row displays. */
const METRES_PER_DEGREE = 111_320;

/**
 * Words that carry no identity and are dropped before names are compared.
 *
 * Kept deliberately short. Every word removed here is a word that can no longer
 * tell two places apart, so this holds only articles and the one conjunction
 * that is routinely written both ways ("Bed & Breakfast" / "Bed and Breakfast").
 */
const FILLER_WORDS = new Set(["the", "a", "an", "and", "of", "at"]);

/**
 * A name reduced to what it means: lowercased, accents folded, punctuation
 * dropped, filler words removed, whitespace collapsed.
 *
 * Apostrophes are removed rather than replaced with a space, so "Children's"
 * becomes "childrens" and matches "Childrens". Every other punctuation run
 * becomes a space, so "Bed&Breakfast" splits into two words rather than
 * fusing into one.
 */
export function normalizeLocationName(name: string): string {
  const folded = name
    .normalize("NFKD")
    // Combining marks left behind by NFKD — "Café" is now "Cafe".
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ");

  const words = folded.split(" ").filter((word) => word !== "");
  const kept = words.filter((word) => !FILLER_WORDS.has(word));

  // A name made entirely of filler ("The") keeps its words rather than
  // normalizing to "", which would make it match every other such name.
  return (kept.length > 0 ? kept : words).join(" ");
}

/** The set of character bigrams in `value`, for the Dice coefficient below. */
function bigrams(value: string): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    result.add(value.slice(index, index + 2));
  }
  return result;
}

/**
 * Sørensen–Dice similarity of two names, 0 to 1, computed over character
 * bigrams of their normalized forms.
 *
 * Bigrams rather than edit distance: they are insensitive to word order
 * ("Museum of Art" / "Art Museum" score well) and they do not punish a long
 * name for one extra word the way a raw Levenshtein count does. Both matter
 * here, because these names come from a geocoder that is inconsistent about
 * both.
 *
 * Strings shorter than two characters have no bigrams, so those compare by
 * equality — otherwise every one-character name would score 0 against itself.
 */
export function nameSimilarity(left: string, right: string): number {
  const a = normalizeLocationName(left);
  const b = normalizeLocationName(right);

  if (a === "" || b === "") return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

  const first = bigrams(a);
  const second = bigrams(b);
  let shared = 0;
  for (const gram of first) {
    if (second.has(gram)) shared += 1;
  }
  return (2 * shared) / (first.size + second.size);
}

/** `value` rounded to COORDINATE_PRECISION, normalising -0 to 0. */
export function roundCoordinate(value: number): number {
  const factor = 10 ** COORDINATE_PRECISION;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

/** The bucket key two places must share before their names are compared. */
export function coordinateKey(latitude: number, longitude: number): string {
  return `${roundCoordinate(latitude).toFixed(COORDINATE_PRECISION)},${roundCoordinate(
    longitude,
  ).toFixed(COORDINATE_PRECISION)}`;
}

/**
 * Rough great-circle distance in metres — equirectangular, not haversine.
 *
 * Only ever called on two points already known to round to the same ~110m
 * cell, where the flat approximation's error is far below the precision anyone
 * reads off the screen. It exists so a row can say "38 m apart", which is what
 * tells a reader whether two same-named places are one shop or two branches.
 */
export function distanceInMetres(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
): number {
  const meanLatitude = ((left.latitude + right.latitude) / 2) * (Math.PI / 180);
  const dLat = (right.latitude - left.latitude) * METRES_PER_DEGREE;
  const dLon = (right.longitude - left.longitude) * METRES_PER_DEGREE * Math.cos(meanLatitude);
  return Math.round(Math.sqrt(dLat * dLat + dLon * dLon));
}

/** One place inside a duplicate group, trimmed to what the dialog renders. */
export interface DuplicateLocation {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  address: string;
  description: string;
  categories: string[];
  tags: string[];
  /** How many journal entries point at this row — the merge's stakes. */
  usageCount: number;
  /** Metres from the group's first member. 0 for that member itself. */
  metresFromFirst: number;
}

/** Places that look like the same real place. Always 2 or more members. */
export interface LocationDuplicateGroup {
  /** Stable within one scan: the smallest member id, as a string. */
  key: string;
  /** The most-used member's name, or the first non-blank one. */
  label: string;
  /** The coordinate cell every member shares. */
  coordinateKey: string;
  /** Lowest pairwise name score in the group — how sure this finding is. */
  confidence: number;
  locations: DuplicateLocation[];
}

/**
 * Disjoint-set over member indexes, so A~B and B~C produce one group of three
 * rather than two overlapping pairs. Without it the dialog would offer the same
 * place in two groups and a merge of one would invalidate the other.
 */
class UnionFind {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_unused, index) => index);
  }

  find(index: number): number {
    let root = index;
    while (this.parent[root] !== root) root = this.parent[root];
    // Path compression, so repeated finds over a long chain stay cheap.
    let walk = index;
    while (this.parent[walk] !== walk) {
      const next = this.parent[walk];
      this.parent[walk] = root;
      walk = next;
    }
    return root;
  }

  union(left: number, right: number): void {
    const a = this.find(left);
    const b = this.find(right);
    if (a !== b) this.parent[b] = a;
  }
}

/**
 * Groups `locations` into sets that look like the same place, keeping only the
 * sets with more than one member.
 *
 * Two places are candidates when they round to the **same coordinate cell** and
 * their names score at or above `threshold`. Both conditions, not either: name
 * alone would merge every "Starbucks" in the state, and coordinates alone would
 * merge a restaurant with the car park it shares a pin with.
 *
 * Bucketing by coordinate first is also what keeps this fast — names are only
 * compared within a cell, so a library of a few hundred places does a few dozen
 * comparisons rather than n². Groups come back most-confident first.
 *
 * A place with a blank name is skipped: `name` defaults to '' in the schema, so
 * a library holding several address-only rows in one building would otherwise
 * present them as duplicates on the strength of having no name at all.
 */
export function findLocationDuplicateGroups(
  locations: readonly SavedLocationWithUsage[],
  threshold: number = DEFAULT_NAME_THRESHOLD,
): LocationDuplicateGroup[] {
  const buckets = new Map<string, SavedLocationWithUsage[]>();
  for (const place of locations) {
    if (place.name.trim() === "") continue;
    const key = coordinateKey(place.latitude, place.longitude);
    const existing = buckets.get(key) ?? [];
    existing.push(place);
    buckets.set(key, existing);
  }

  const groups: LocationDuplicateGroup[] = [];

  for (const [cell, members] of buckets) {
    if (members.length < 2) continue;

    const union = new UnionFind(members.length);
    // Every pair *within one cell*. Cells hold a handful of rows, so this stays
    // small however large the library gets.
    const scores = new Map<string, number>();
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const score = nameSimilarity(members[i].name, members[j].name);
        if (score >= threshold) {
          scores.set(`${i}:${j}`, score);
          union.union(i, j);
        }
      }
    }

    const byRoot = new Map<number, number[]>();
    for (let index = 0; index < members.length; index += 1) {
      const root = union.find(index);
      const existing = byRoot.get(root) ?? [];
      existing.push(index);
      byRoot.set(root, existing);
    }

    for (const indexes of byRoot.values()) {
      if (indexes.length < 2) continue;

      // Most-used first: that copy is the one most entries already point at, so
      // it is the sensible default survivor and reads best at the top.
      const ordered = [...indexes].sort((left, right) => {
        const a = members[left];
        const b = members[right];
        return b.usageCount - a.usageCount || a.id - b.id;
      });
      const first = members[ordered[0]];

      // The weakest link that holds this group together — with a transitive
      // chain, the group is only as trustworthy as its loosest pair.
      let confidence = 1;
      for (let i = 0; i < ordered.length; i += 1) {
        for (let j = i + 1; j < ordered.length; j += 1) {
          const low = Math.min(ordered[i], ordered[j]);
          const high = Math.max(ordered[i], ordered[j]);
          const score = scores.get(`${low}:${high}`);
          if (score !== undefined) confidence = Math.min(confidence, score);
        }
      }

      groups.push({
        key: String(Math.min(...ordered.map((index) => members[index].id))),
        label: first.name.trim(),
        coordinateKey: cell,
        confidence,
        locations: ordered.map((index) => {
          const place = members[index];
          return {
            id: place.id,
            name: place.name,
            latitude: place.latitude,
            longitude: place.longitude,
            address: place.address,
            description: place.description,
            categories: place.categories,
            tags: place.tags,
            usageCount: place.usageCount,
            metresFromFirst: distanceInMetres(first, place),
          };
        }),
      });
    }
  }

  // Most confident first, then biggest group, then a stable tiebreak on label.
  return groups.sort(
    (left, right) =>
      right.confidence - left.confidence ||
      right.locations.length - left.locations.length ||
      left.label.localeCompare(right.label),
  );
}

/** Total places across every group — the dialog's header count. */
export function countDuplicateLocations(groups: readonly LocationDuplicateGroup[]): number {
  return groups.reduce((total, group) => total + group.locations.length, 0);
}
