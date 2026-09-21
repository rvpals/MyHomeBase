import type { EntryLocationSource, ImportCandidate } from "./types";

/**
 * Turns every location already sitting on a journal entry into the set of
 * distinct places worth adding to the library.
 *
 * Pure: takes rows, returns candidates. All the I/O — reading the rows, looking
 * up addresses, writing the places — happens in the use-case around it, which
 * is what makes the grouping rules testable without a database or a network.
 */

/**
 * Two entry locations are the same place when their coordinates match exactly.
 *
 * Exact, not rounded. A place picked once and re-used across forty entries was
 * *copied*, so those forty rows hold byte-identical numbers and collapse into
 * one candidate — which is the duplication actually worth removing. Rounding
 * would additionally merge two readings a few metres apart, and that is a guess
 * about intent this has no business making: two neighbouring shops are two
 * places, and a merge cannot be undone by the reader afterwards.
 *
 * The consequence to accept: repeated *hand-dropped* pins at the same spot, or
 * raw GPS readings with jitter, stay separate candidates. Those are visibly
 * near-duplicate rows in the manager, which the reader can delete — the safe
 * direction to be wrong in.
 */
function coordinateKey(latitude: number, longitude: number): string {
  return `${latitude},${longitude}`;
}

/**
 * The most common non-blank value, ties broken by first appearance.
 *
 * "Most common" rather than "first" because the rows arrive in entry-date order
 * and the earliest spelling is not the most likely to be right — a place
 * renamed once and then used thirty times should come through under the name it
 * carries thirty times.
 */
function mostCommon(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = raw.trim();
    if (value === "") continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  // Map iterates in insertion order, so the first-seen value wins a tie.
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Every distinct non-blank value, most common first, joined with "; ".
 *
 * Used for the description, which is built from the entries' `place_name`.
 * Joining rather than picking one because these are the reader's own words
 * about where they were: if a coordinate was described as "Home" thirty times
 * and "Mum's" twice, both are true and dropping either loses information the
 * reader wrote down.
 */
function joinDistinct(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = raw.trim();
    if (value === "") continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  if (counts.size === 0) return "";
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value]) => value)
    .join("; ");
}

/**
 * Groups entry locations into the distinct places to create.
 *
 * `existingKeys` are the coordinates the library already holds; a candidate
 * matching one is dropped, which is what makes running the import twice a
 * no-op rather than a way to double the library.
 *
 * Candidates come back in descending order of how many entry locations feed
 * them, so the places the journal leans on hardest are created (and address-
 * looked-up) first — if a long run is cancelled half way, what got done is the
 * half that mattered most.
 */
export function buildImportCandidates(
  rows: readonly EntryLocationSource[],
  existingKeys: ReadonlySet<string>,
): ImportCandidate[] {
  const groups = new Map<
    string,
    {
      latitude: number;
      longitude: number;
      names: string[];
      placeNames: string[];
      entryLocationIds: number[];
    }
  >();

  for (const row of rows) {
    // A coordinate that isn't a real number can't be placed on a map or looked
    // up, and the library's schema rejects it — so it is skipped here rather
    // than failing the whole import at the write.
    if (!Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) continue;
    if (row.latitude < -90 || row.latitude > 90) continue;
    if (row.longitude < -180 || row.longitude > 180) continue;

    const key = coordinateKey(row.latitude, row.longitude);
    const existing = groups.get(key);
    if (existing) {
      existing.names.push(row.locationName);
      existing.placeNames.push(row.placeName);
      existing.entryLocationIds.push(row.entryLocationId);
      continue;
    }
    groups.set(key, {
      // The first member's values, stored exactly as the entry holds them —
      // no rounding anywhere, so a created place sits on precisely the point
      // the journal recorded.
      latitude: row.latitude,
      longitude: row.longitude,
      names: [row.locationName],
      placeNames: [row.placeName],
      entryLocationIds: [row.entryLocationId],
    });
  }

  const candidates: ImportCandidate[] = [];
  for (const [key, group] of groups) {
    if (existingKeys.has(key)) continue;
    candidates.push({
      key,
      latitude: group.latitude,
      longitude: group.longitude,
      name: mostCommon(group.names),
      // The entry's `place_name` becomes the description, per the feature's
      // whole point: that field is where the reader already wrote what the
      // place was, and it would otherwise be stranded on the entry.
      description: joinDistinct(group.placeNames),
      entryLocationIds: group.entryLocationIds,
      sourceCount: group.entryLocationIds.length,
    });
  }

  return candidates.sort(
    (a, b) => b.sourceCount - a.sourceCount || a.key.localeCompare(b.key),
  );
}

/** The key format `buildImportCandidates` matches against, for the caller's set. */
export function existingLocationKey(latitude: number, longitude: number): string {
  return coordinateKey(latitude, longitude);
}
