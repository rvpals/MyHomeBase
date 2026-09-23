import {
  DEFAULT_NAME_THRESHOLD,
  MAX_NAME_THRESHOLD,
  MIN_NAME_THRESHOLD,
  findLocationDuplicateGroups,
  type LocationDuplicateGroup,
} from "./dedup";
import {
  decodeImageUpload,
  type ImageUploadInput,
} from "@/lib/shared/image-upload";
// Through the barrel, not the files inside it. The name->glyph chain is generic:
// nothing in it knows a name came from a location rather than an entry.
import { fetchIconSvg, isSafeGeneratedIconSvg } from "@/lib/journal";
import type { SavedLocationRepository } from "./ports";
import {
  locationIdSchema,
  locationSearchInputSchema,
  locationTaxonomyNameSchema,
  mergeLocationsInputSchema,
  promoteLocationInputSchema,
  saveLocationInputSchema,
  updateLocationInputSchema,
  upsertLocationTaxonomyInputSchema,
} from "./schema";
import type {
  LocationSearchInput,
  MergeLocationsInput,
  PromoteLocationInput,
  SaveLocationInput,
  UpdateLocationInput,
  UpsertLocationTaxonomyInput,
} from "./schema";
import type {
  LocationCategory,
  LocationTag,
  LocationTaxonomyCount,
  LocationTaxonomyIcon,
  LocationTaxonomyKind,
  SavedLocation,
  SavedLocationWithUsage,
} from "./types";

/**
 * Trims, drops blanks, and de-dupes case-insensitively while keeping the first
 * spelling the caller used.
 *
 * Case-insensitive because the taxonomy tables are name-keyed: letting both
 * "Cafe" and "cafe" through would create two rows that read as one list entry
 * and split the filter counts between them.
 */
function cleanNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (name === "") continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(name);
  }
  return cleaned;
}

// --- Reads -------------------------------------------------------------------

/** Every saved place, each with how many entries use it. */
export function listSavedLocations(repo: SavedLocationRepository): SavedLocationWithUsage[] {
  return repo.listLocations();
}

export function getSavedLocation(
  repo: SavedLocationRepository,
  id: number,
): SavedLocation | undefined {
  return repo.getLocationById(locationIdSchema.parse(id));
}

/**
 * The places matching a text query and/or category and tag filters.
 *
 * Backs three screens at once — the Location Manager's search box, the "add
 * from library" picker in the entry form, and the Location Map's filters — so
 * that all three agree on what "matching" means.
 */
export function searchSavedLocations(
  repo: SavedLocationRepository,
  input: LocationSearchInput,
): SavedLocationWithUsage[] {
  const criteria = locationSearchInputSchema.parse(input);
  return repo.searchLocations({
    ...criteria,
    categories: cleanNames(criteria.categories),
    tags: cleanNames(criteria.tags),
  });
}

// --- Writes ------------------------------------------------------------------

/**
 * Saves a new place.
 *
 * Categories and tags must already exist as managed rows — unlike an entry's
 * tags, which the CSV importer may invent on the fly. A place is only ever
 * created by a person at a form with both lists in front of them, so a name
 * that isn't in the list is a typo, and silently creating a near-duplicate
 * category is the outcome worth preventing.
 */
export function createSavedLocation(
  repo: SavedLocationRepository,
  input: SaveLocationInput,
): SavedLocation {
  const data = saveLocationInputSchema.parse(input);
  const categories = cleanNames(data.categories);
  const tags = cleanNames(data.tags);
  assertTaxonomyExists(repo, categories, tags);
  return repo.createLocation({ ...data, categories, tags });
}

/** Updates a place in full — the category and tag lists replace what was there. */
export function updateSavedLocation(
  repo: SavedLocationRepository,
  input: UpdateLocationInput,
): SavedLocation {
  const { id, ...rest } = updateLocationInputSchema.parse(input);
  if (!repo.getLocationById(id)) {
    throw new Error(`No saved location with id ${id}.`);
  }
  const categories = cleanNames(rest.categories);
  const tags = cleanNames(rest.tags);
  assertTaxonomyExists(repo, categories, tags);
  return repo.updateLocation(id, { ...rest, categories, tags });
}

/**
 * Removes a place from the library.
 *
 * Deliberately allowed even when entries use it: those entries keep their own
 * copy of the coordinates and name and simply stop pointing here (migration
 * 0101). The caller is expected to show the usage count first — refusing the
 * delete would strand a mistyped place forever, since every place that has ever
 * been picked is "in use".
 */
export function deleteSavedLocation(repo: SavedLocationRepository, id: number): void {
  const parsed = locationIdSchema.parse(id);
  if (!repo.getLocationById(parsed)) {
    throw new Error(`No saved location with id ${parsed}.`);
  }
  repo.deleteLocation(parsed);
}

/**
 * The near-duplicate groups in the library, for the Merging & Dedup dialog.
 *
 * A read, not a write: it proposes and nothing more. See `dedup.ts` for how two
 * places qualify (same rounded coordinate cell *and* similar names).
 */
export function findLocationDuplicates(
  repo: SavedLocationRepository,
  threshold: number = DEFAULT_NAME_THRESHOLD,
): LocationDuplicateGroup[] {
  const clamped = Math.min(MAX_NAME_THRESHOLD, Math.max(MIN_NAME_THRESHOLD, threshold));
  return findLocationDuplicateGroups(repo.listLocations(), clamped);
}

/**
 * Folds duplicate places into one survivor: entries pointing at a removed place
 * are repointed at `keepId`, the removed places' categories and tags are unioned
 * onto it, and the removed rows are deleted. Returns the survivor and how many
 * entry locations moved.
 *
 * **Not a loop of deletes.** Deleting a place detaches every entry that used it
 * (`ON DELETE SET NULL`, migration 0101) — correct for retiring a place, wrong
 * for merging, where those entries should end up on the survivor. The repoint
 * and the delete therefore happen together in one repository transaction.
 *
 * This does **not** re-check that the places were duplicates. The similarity
 * score is a suggestion; the reader chose, and merging two places they decided
 * are the same is a legitimate thing to ask for.
 */
export function mergeSavedLocations(
  repo: SavedLocationRepository,
  input: MergeLocationsInput,
): { location: SavedLocation; movedCount: number; removedCount: number } {
  const { keepId, removeIds } = mergeLocationsInputSchema.parse(input);

  if (!repo.getLocationById(keepId)) {
    throw new Error(`No saved location with id ${keepId}.`);
  }
  // Every id is checked before anything is written, so a merge naming one good
  // and one stale id reports the stale one rather than half-applying.
  for (const id of removeIds) {
    if (!repo.getLocationById(id)) {
      throw new Error(`No saved location with id ${id}.`);
    }
  }

  // De-duplicated: the same id twice would double-count `removedCount` and, in
  // SQL, widen the IN list for no reason.
  const unique = [...new Set(removeIds)];
  const movedCount = repo.mergeLocations(keepId, unique);

  const location = repo.getLocationById(keepId);
  if (!location) throw new Error(`Failed to read back merged saved location ${keepId}.`);
  return { location, movedCount, removedCount: unique.length };
}

/**
 * Creates a library row from a location that was dropped on the map by hand,
 * and — when the caller names one — points that entry row at the new place.
 *
 * The forward path (library → entry) is an ordinary copy done by the entry
 * form. This is the backward one: it is how a journal that already holds
 * hundreds of ad-hoc coordinates gets a library without re-typing them.
 */
export function promoteToSavedLocation(
  repo: SavedLocationRepository,
  input: PromoteLocationInput,
): SavedLocation {
  const { entryLocationId, ...rest } = promoteLocationInputSchema.parse(input);
  const created = createSavedLocation(repo, rest);
  if (entryLocationId !== undefined) {
    repo.linkEntryLocation(entryLocationId, created.id);
  }
  return created;
}

/**
 * Throws unless every named category and tag is a managed row.
 *
 * Both lists are checked before either is used, so a save naming one good
 * category and one bad one reports the bad one rather than half-applying.
 */
function assertTaxonomyExists(
  repo: SavedLocationRepository,
  categories: readonly string[],
  tags: readonly string[],
): void {
  for (const name of categories) {
    if (!repo.getCategoryByName(name)) {
      throw new Error(`Unknown location category "${name}".`);
    }
  }
  for (const name of tags) {
    if (!repo.getTagByName(name)) {
      throw new Error(`Unknown location tag "${name}".`);
    }
  }
}

// --- Taxonomy ----------------------------------------------------------------

export function listLocationCategories(repo: SavedLocationRepository): LocationCategory[] {
  return repo.listCategories();
}

export function listLocationTags(repo: SavedLocationRepository): LocationTag[] {
  return repo.listTags();
}

/** Category names with how many places carry each — the filter UI's counts. */
export function countLocationsByCategory(
  repo: SavedLocationRepository,
): LocationTaxonomyCount[] {
  return repo.countLocationsByCategory();
}

export function countLocationsByTag(repo: SavedLocationRepository): LocationTaxonomyCount[] {
  return repo.countLocationsByTag();
}

/**
 * Creates or updates one taxonomy row.
 *
 * `kind` rather than two near-identical functions: the two lists have the same
 * shape and the same rules, and the editor screen renders them from one
 * component — so a single entry point is what keeps them from drifting.
 */
export function saveLocationTaxonomy(
  repo: SavedLocationRepository,
  kind: LocationTaxonomyKind,
  input: UpsertLocationTaxonomyInput,
): LocationCategory | LocationTag {
  const data = upsertLocationTaxonomyInputSchema.parse(input);
  return kind === "category" ? repo.upsertCategory(data) : repo.upsertTag(data);
}

/** The icon size cap, matching the entry-side taxonomy (MAX_JOURNAL_ICON_BYTES). */
export const MAX_LOCATION_ICON_BYTES = 128 * 1024;

/** Throws unless the named row exists, so an upload can't conjure a category. */
function requireTaxonomy(
  repo: SavedLocationRepository,
  kind: LocationTaxonomyKind,
  name: string,
): string {
  const parsed = locationTaxonomyNameSchema.parse(name);
  const exists =
    kind === "category" ? repo.getCategoryByName(parsed) : repo.getTagByName(parsed);
  if (!exists) throw new Error(`No location ${kind} named "${parsed}".`);
  return parsed;
}

/**
 * Stores the icon shown beside a location category or tag wherever it's listed.
 *
 * The row must already exist — creating one as a side effect of an upload would
 * let a typo add a category nobody asked for. Same rule as `setCategoryIcon` on
 * the entry side.
 */
export function setLocationTaxonomyIcon(
  repo: SavedLocationRepository,
  kind: LocationTaxonomyKind,
  name: string,
  input: ImageUploadInput,
): void {
  const parsed = requireTaxonomy(repo, kind, name);
  const icon = decodeImageUpload(input, MAX_LOCATION_ICON_BYTES);
  if (kind === "category") repo.setCategoryIcon(parsed, icon);
  else repo.setTagIcon(parsed, icon);
}

/** Removes the icon, leaving the category or tag itself untouched. */
export function clearLocationTaxonomyIcon(
  repo: SavedLocationRepository,
  kind: LocationTaxonomyKind,
  name: string,
): void {
  const parsed = requireTaxonomy(repo, kind, name);
  if (kind === "category") repo.setCategoryIcon(parsed, undefined);
  else repo.setTagIcon(parsed, undefined);
}

/** Used only by the icon-serving routes — never by anything rendering a list. */
export function getLocationTaxonomyIcon(
  repo: SavedLocationRepository,
  kind: LocationTaxonomyKind,
  name: string,
): LocationTaxonomyIcon | undefined {
  return kind === "category" ? repo.getCategoryIcon(name) : repo.getTagIcon(name);
}

/**
 * Draws an icon from the row's *name* — the ⚡ button in the Location Meta Data
 * editor.
 *
 * Reuses the entry side's icon-search/fetch/fallback chain wholesale: those
 * modules map a name to a Material Design Icons glyph and fall back to a locally
 * drawn one offline, and none of it knows or cares that the name came from a
 * location rather than an entry.
 *
 * Deliberately not routed through `decodeImageUpload`: that validator refuses
 * SVG because *uploaded* SVG served from our own origin is a stored-XSS vector.
 * These bytes are ours, and `isSafeGeneratedIconSvg` re-checks the exact string
 * on its way to the DB — the same split the entry side documents at
 * `buildFetchedIcon`.
 *
 * Replaces any existing icon, which is the point: the button is how you swap a
 * hand-uploaded icon for a generated one. The UI confirms first when there's
 * already an icon to lose.
 */
export async function generateLocationTaxonomyIcon(
  repo: SavedLocationRepository,
  kind: LocationTaxonomyKind,
  name: string,
): Promise<void> {
  const parsed = requireTaxonomy(repo, kind, name);
  const { svg, mimeType } = await fetchIconSvg(parsed);
  if (!isSafeGeneratedIconSvg(svg)) {
    throw new Error("The generated icon failed its safety check and was not saved.");
  }
  const icon = { data: Buffer.from(svg, "utf8"), mimeType };
  if (kind === "category") repo.setCategoryIcon(parsed, icon);
  else repo.setTagIcon(parsed, icon);
}

/** What a batch icon fill did. */
export interface LocationIconFillSummary {
  generated: number;
  failed: number;
}

/**
 * Draws an icon for every category and tag that hasn't got one.
 *
 * Skips rows that already have an icon rather than replacing them: this is the
 * "fill in the gaps" button, and silently overwriting a hand-picked icon is the
 * one thing it must not do. A single failure is counted, not thrown — one name
 * that maps to nothing shouldn't abandon the rest of the run.
 */
export async function generateMissingLocationTaxonomyIcons(
  repo: SavedLocationRepository,
): Promise<LocationIconFillSummary> {
  const summary: LocationIconFillSummary = { generated: 0, failed: 0 };
  const lists: { kind: LocationTaxonomyKind; rows: (LocationCategory | LocationTag)[] }[] = [
    { kind: "category", rows: repo.listCategories() },
    { kind: "tag", rows: repo.listTags() },
  ];
  for (const { kind, rows } of lists) {
    for (const row of rows) {
      if (row.iconMimeType) continue;
      try {
        await generateLocationTaxonomyIcon(repo, kind, row.name);
        summary.generated += 1;
      } catch {
        summary.failed += 1;
      }
    }
  }
  return summary;
}

/**
 * Removes a taxonomy row and every pairing that used it.
 *
 * The places themselves survive — losing the "Restaurant" category must not
 * lose the restaurants.
 */
export function deleteLocationTaxonomy(
  repo: SavedLocationRepository,
  kind: LocationTaxonomyKind,
  name: string,
): void {
  const parsed = locationTaxonomyNameSchema.parse(name);
  if (kind === "category") {
    if (!repo.getCategoryByName(parsed)) {
      throw new Error(`No location category named "${parsed}".`);
    }
    repo.deleteCategory(parsed);
    return;
  }
  if (!repo.getTagByName(parsed)) {
    throw new Error(`No location tag named "${parsed}".`);
  }
  repo.deleteTag(parsed);
}
