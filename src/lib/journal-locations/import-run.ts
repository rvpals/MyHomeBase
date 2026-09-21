import type { GeocodingClient } from "@/lib/geocoding";
import { reverseGeocode } from "@/lib/geocoding";
import { buildImportCandidates, existingLocationKey } from "./import-from-entries";
import type { SavedLocationRepository } from "./ports";
import type { ImportBatchResult, ImportCandidate } from "./types";

/**
 * Building the location library out of the coordinates already on entries.
 *
 * Split from `import-from-entries.ts`, which holds the pure grouping: this file
 * is the part that touches the repository and the geocoder, so it is the part
 * the unit tests drive with fakes.
 */

/**
 * Nominatim's usage policy is one request per second, and it bans bulk
 * geocoding outright. One second between lookups is the slowest thing in the
 * whole job by orders of magnitude — 300 places is five minutes — which is why
 * the address pass is optional and why the UI states the cost before starting.
 *
 * Exported so the presentation layer can estimate the wall time from the
 * candidate count rather than hardcoding the same number in a second place.
 */
export const GEOCODE_INTERVAL_MS = 1000;

/**
 * How many candidates one batch handles when addresses are being looked up.
 *
 * Deliberately small: a batch is one server action, and a batch of 50 with a
 * one-second throttle would be a 50-second request that some proxy will cut.
 * Five keeps each round trip near five seconds and the progress bar moving.
 */
export const GEOCODED_BATCH_SIZE = 5;

/** Without lookups the work is pure SQLite, so batches can be much larger. */
export const PLAIN_BATCH_SIZE = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The distinct places that could be added, most-used first.
 *
 * Recomputed at the start of every batch rather than held in a server-side
 * job row. It is a read of a few thousand rows and a group-by, which is
 * cheaper than a job table plus its migration plus its cleanup — and it makes
 * the run *self-correcting*: each batch skips what the previous one created,
 * so an interrupted run resumes exactly where it stopped and a run started
 * twice cannot create anything twice.
 */
export function listImportCandidates(repo: SavedLocationRepository): ImportCandidate[] {
  const existing = new Set(
    repo
      .listLocationCoordinates()
      .map((row) => existingLocationKey(row.latitude, row.longitude)),
  );
  return buildImportCandidates(repo.listEntryLocationsForImport(), existing);
}

/** How many places the import would create right now. */
export function countImportCandidates(repo: SavedLocationRepository): number {
  return listImportCandidates(repo).length;
}

/**
 * Creates the next `batchSize` places, optionally looking up each address.
 *
 * Takes no offset. Because every batch recomputes the outstanding candidates
 * and each one it creates drops out of that set, "the next batch" is always
 * the front of the list — an offset would in fact skip rows as the list shrank
 * beneath it.
 */
export async function runImportBatch(
  repo: SavedLocationRepository,
  geocoder: GeocodingClient,
  options: { withAddresses: boolean; batchSize?: number },
): Promise<ImportBatchResult> {
  const { withAddresses } = options;
  const batchSize =
    options.batchSize ?? (withAddresses ? GEOCODED_BATCH_SIZE : PLAIN_BATCH_SIZE);

  const outstanding = listImportCandidates(repo);
  const batch = outstanding.slice(0, batchSize);

  let createdCount = 0;
  let addressCount = 0;

  for (const [index, candidate] of batch.entries()) {
    let address = "";
    if (withAddresses) {
      // Between requests, not before the first: the pause exists to space out
      // calls to Nominatim, and an initial one would only make the bar sit
      // still for a second at the start of every batch.
      if (index > 0) await sleep(GEOCODE_INTERVAL_MS);
      try {
        const place = await reverseGeocode(geocoder, {
          latitude: candidate.latitude,
          longitude: candidate.longitude,
        });
        if (place) {
          address = place.displayName;
          addressCount += 1;
        }
      } catch {
        // A lookup that fails — offline, rate-limited, a point in open ocean —
        // must not lose the place. It is created with a blank address, which
        // the reader can fill from the manager's "Look up" button later.
        address = "";
      }
    }

    const created = repo.createLocation({
      name: candidate.name,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      description: candidate.description,
      address,
      // No categories or tags: nothing in an entry says what *kind* of place a
      // coordinate is, and inventing a taxonomy here would be a guess the
      // reader then has to undo across hundreds of rows.
      categories: [],
      tags: [],
    });
    createdCount += 1;

    // Point every contributing entry location at the new library row, so the
    // entries that produced this place now read as having picked it.
    for (const entryLocationId of candidate.entryLocationIds) {
      repo.linkEntryLocation(entryLocationId, created.id);
    }
  }

  return {
    processedCount: batch.length,
    createdCount,
    addressCount,
    remainingCount: Math.max(outstanding.length - batch.length, 0),
  };
}
