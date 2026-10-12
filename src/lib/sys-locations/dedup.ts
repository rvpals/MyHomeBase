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
 * Decimal places coordinates are rounded to when bucketing.
 *
 * 3 places is a ~110m cell. This is a *bucketing* device only: a cell is the
 * unit this scans in, never the test for whether two places are duplicates.
 * See `arePlacesNear` for why that distinction had to be drawn.
 */
export const COORDINATE_PRECISION = 3;

/**
 * How far apart two pins may be and still be called the same place, in metres.
 *
 * Replaces what used to be an accidental rule: cells were compared for *exact
 * equality*, so two pins either side of a rounding boundary never matched
 * however close they were. Measured over random pairs, that missed 30% of pins
 * 25m apart and 57% of pins 50m apart -- and since the entry importer groups on
 * exact coordinates, near-but-not-equal pins are precisely the duplicates this
 * library actually accumulates. A real distance has no boundaries to fall
 * between.
 *
 * 75m by default: under the old nominal 110m, so the default scan is no looser
 * than it claimed to be -- only correct. The dialog exposes it as a slider.
 */
export const DEFAULT_DISTANCE_METRES = 75;

/** The distance slider's range. */
export const MIN_DISTANCE_METRES = 10;
export const MAX_DISTANCE_METRES = 500;

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

/**
 * The cell a point falls in, plus the eight around it.
 *
 * A cell is ~110m of latitude, so a pair within `MAX_DISTANCE_METRES` (500m)
 * can sit up to four cells apart. The step therefore widens with the radius
 * being scanned rather than being fixed at one: a 3x3 neighbourhood would
 * silently stop finding pairs once the slider passed half a cell, which is the
 * same class of bug as the exact-cell comparison this replaces.
 *
 * Longitude cells narrow towards the poles, so the horizontal reach is
 * computed from the latitude rather than assumed symmetric.
 */
export function neighbourKeys(
  latitude: number,
  longitude: number,
  maxMetres: number,
): string[] {
  const cell = 10 ** -COORDINATE_PRECISION;
  const latSteps = Math.max(1, Math.ceil(maxMetres / (cell * METRES_PER_DEGREE)));
  // cos(lat) shrinks towards 0 at the poles; floor it so the division stays
  // finite and the reach simply becomes very wide there.
  const cosLat = Math.max(Math.cos((latitude * Math.PI) / 180), 0.01);
  const lonSteps = Math.max(
    1,
    Math.ceil(maxMetres / (cell * METRES_PER_DEGREE * cosLat)),
  );

  const keys: string[] = [];
  for (let dLat = -latSteps; dLat <= latSteps; dLat += 1) {
    for (let dLon = -lonSteps; dLon <= lonSteps; dLon += 1) {
      keys.push(coordinateKey(latitude + dLat * cell, longitude + dLon * cell));
    }
  }
  return keys;
}

/** True when two places are within `maxMetres` of each other. */
export function arePlacesNear(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
  maxMetres: number,
): boolean {
  return distanceInMetres(left, right) <= maxMetres;
}

/**
 * How the two knobs are passed in. An object rather than two positional
 * numbers so a caller can set the distance without restating the name
 * threshold, and so neither can be passed in the other's place.
 */
export interface DuplicateScanOptions {
  nameThreshold?: number;
  maxMetres?: number;
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
 * Two named places pair when they are **within `maxMetres` of each other** and
 * their names score at or above `nameThreshold`. Both conditions, not either:
 * name alone would merge every "Starbucks" in the state, and proximity alone
 * would merge a restaurant with the car park it shares a pin with.
 *
 * Distance is measured, not bucketed. Cells are still used to decide *which
 * pairs to measure* — each place is only compared against the neighbourhood
 * its own cell sits in — so this stays near-linear on a real library while the
 * answer no longer depends on which side of a rounding boundary a pin landed.
 *
 * **A blank-named place pairs on distance alone**, with another blank-named
 * place or with a named one. There is no name to score, and skipping these
 * (as this did originally) made the commonest duplicate in an imported library
 * invisible: a pin dropped by hand and then saved properly under a name. The
 * exposure is that several genuinely distinct address-only rows in one
 * building now present as a group — visible in the dialog, and the reader
 * declines it, which is the safe direction to be wrong in.
 *
 * Groups come back most-confident first.
 */
export function findLocationDuplicateGroups(
  locations: readonly SavedLocationWithUsage[],
  options: DuplicateScanOptions | number = {},
): LocationDuplicateGroup[] {
  // A bare number keeps the original positional signature working — the CLI
  // and a pile of tests pass the name threshold that way.
  const opts: DuplicateScanOptions =
    typeof options === "number" ? { nameThreshold: options } : options;
  const nameThreshold = opts.nameThreshold ?? DEFAULT_NAME_THRESHOLD;
  const maxMetres = opts.maxMetres ?? DEFAULT_DISTANCE_METRES;

  // Bucket every place by its own cell, so a candidate can find its neighbours
  // without scanning the whole library.
  const buckets = new Map<string, number[]>();
  locations.forEach((place, index) => {
    const key = coordinateKey(place.latitude, place.longitude);
    const existing = buckets.get(key) ?? [];
    existing.push(index);
    buckets.set(key, existing);
  });

  const union = new UnionFind(locations.length);
  const scores = new Map<string, number>();

  locations.forEach((place, index) => {
    for (const key of neighbourKeys(place.latitude, place.longitude, maxMetres)) {
      for (const other of buckets.get(key) ?? []) {
        // Each unordered pair once: the neighbourhood is symmetric, so without
        // this every pair would be examined twice.
        if (other <= index) continue;
        const candidate = locations[other];
        if (!arePlacesNear(place, candidate, maxMetres)) continue;

        const leftBlank = place.name.trim() === "";
        const rightBlank = candidate.name.trim() === "";
        if (leftBlank || rightBlank) {
          // Distance alone decided it. Recorded with no score, so the
          // confidence pass below can tell it apart from a name match.
          union.union(index, other);
          continue;
        }

        const score = nameSimilarity(place.name, candidate.name);
        if (score < nameThreshold) continue;
        scores.set(`${index}:${other}`, score);
        union.union(index, other);
      }
    }
  });

  const byRoot = new Map<number, number[]>();
  locations.forEach((_place, index) => {
    const root = union.find(index);
    const existing = byRoot.get(root) ?? [];
    existing.push(index);
    byRoot.set(root, existing);
  });

  const groups: LocationDuplicateGroup[] = [];

  for (const indexes of byRoot.values()) {
    if (indexes.length < 2) continue;

    // Most-used first: that copy is the one most entries already point at, so
    // it is the sensible default survivor and reads best at the top. A named
    // place outranks a blank one on a tie, so the group does not default to
    // merging everything into "(unnamed)".
    const ordered = [...indexes].sort((left, right) => {
      const a = locations[left];
      const b = locations[right];
      const aNamed = a.name.trim() === "" ? 1 : 0;
      const bNamed = b.name.trim() === "" ? 1 : 0;
      return b.usageCount - a.usageCount || aNamed - bNamed || a.id - b.id;
    });
    const first = locations[ordered[0]];

    // The weakest link that holds this group together — with a transitive
    // chain, the group is only as trustworthy as its loosest pair.
    //
    // A pair joined on distance alone has no name score. Rather than treat
    // that as certainty, it contributes how close the two pins are as a
    // fraction of the radius, so a proximity-only group cannot outrank a
    // genuine name match.
    let confidence = 1;
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const low = Math.min(ordered[i], ordered[j]);
        const high = Math.max(ordered[i], ordered[j]);
        const score = scores.get(`${low}:${high}`);
        if (score !== undefined) {
          confidence = Math.min(confidence, score);
          continue;
        }
        const a = locations[low];
        const b = locations[high];
        if (!arePlacesNear(a, b, maxMetres)) continue;
        const proximity = 1 - distanceInMetres(a, b) / Math.max(maxMetres, 1);
        confidence = Math.min(confidence, proximity);
      }
    }

    const label =
      [...ordered].map((index) => locations[index].name.trim()).find((name) => name !== "") ?? "";

    groups.push({
      key: String(Math.min(...ordered.map((index) => locations[index].id))),
      label,
      coordinateKey: coordinateKey(first.latitude, first.longitude),
      confidence,
      locations: ordered.map((index) => {
        const place = locations[index];
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
