import type { SavedLocationRepository } from "./ports";
import type {
  LocationSearchCriteria,
  LocationTaxonomyWriteData,
  LocationWriteData,
} from "./schema";
import type {
  EntryLocationSource,
  LocationCategory,
  LocationTag,
  LocationTaxonomyCount,
  SavedLocation,
  SavedLocationWithUsage,
} from "./types";

/**
 * An in-memory `SavedLocationRepository` for unit tests.
 *
 * A hand-written fake rather than a mock (ARCHITECTURE.md → *Fakes over mocks*),
 * and it lives beside the code rather than inside the test file so the CLI's
 * tests and any future caller's can reuse it.
 *
 * It reimplements the SQL semantics the use-cases rely on — NOCASE name lookups,
 * AND-ed taxonomy filters, substring search across the three text columns — so a
 * test passing here means the use-case is right, not that the fake is lenient.
 */
export class FakeSavedLocationRepository implements SavedLocationRepository {
  private locations: SavedLocation[] = [];
  private categories: LocationCategory[] = [];
  private tags: LocationTag[] = [];
  private nextId = 1;

  /** entry-location id → saved-location id, so tests can assert provenance. */
  readonly linkedEntryLocations = new Map<number, number>();

  private static readonly TIMESTAMP = "2026-09-20 12:00:00";

  // --- Places ---------------------------------------------------------------

  listLocations(): SavedLocationWithUsage[] {
    return this.sorted(this.locations).map((place) => this.withUsage(place));
  }

  getLocationById(id: number): SavedLocation | undefined {
    const found = this.locations.find((place) => place.id === id);
    return found ? { ...found } : undefined;
  }

  searchLocations(criteria: LocationSearchCriteria): SavedLocationWithUsage[] {
    const query = criteria.query.toLowerCase();
    const matched = this.locations.filter((place) => {
      if (query !== "") {
        const haystack = [place.name, place.description, place.address].join("\n").toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      // AND, not OR: a place must carry every selected name.
      const has = (list: string[], name: string) =>
        list.some((candidate) => candidate.toLowerCase() === name.toLowerCase());
      if (!criteria.categories.every((name) => has(place.categories, name))) return false;
      if (!criteria.tags.every((name) => has(place.tags, name))) return false;
      return true;
    });

    const sorted = this.sorted(matched).map((place) => this.withUsage(place));
    return criteria.limit === undefined ? sorted : sorted.slice(0, criteria.limit);
  }

  createLocation(input: LocationWriteData): SavedLocation {
    const created: SavedLocation = {
      id: this.nextId++,
      name: input.name,
      latitude: input.latitude,
      longitude: input.longitude,
      description: input.description,
      address: input.address,
      categories: [...input.categories],
      tags: [...input.tags],
      createdAt: FakeSavedLocationRepository.TIMESTAMP,
      updatedAt: FakeSavedLocationRepository.TIMESTAMP,
    };
    this.locations.push(created);
    return { ...created };
  }

  updateLocation(id: number, input: LocationWriteData): SavedLocation {
    const index = this.locations.findIndex((place) => place.id === id);
    if (index === -1) throw new Error(`No saved location with id ${id}.`);
    const updated: SavedLocation = {
      ...this.locations[index],
      name: input.name,
      latitude: input.latitude,
      longitude: input.longitude,
      description: input.description,
      address: input.address,
      categories: [...input.categories],
      tags: [...input.tags],
    };
    this.locations[index] = updated;
    return { ...updated };
  }

  deleteLocation(id: number): void {
    this.locations = this.locations.filter((place) => place.id !== id);
    // Mirrors the schema's ON DELETE SET NULL: the entry row survives, detached.
    for (const [entryLocationId, savedId] of this.linkedEntryLocations) {
      if (savedId === id) this.linkedEntryLocations.delete(entryLocationId);
    }
  }

  countUsage(id: number): number {
    let count = 0;
    for (const savedId of this.linkedEntryLocations.values()) {
      if (savedId === id) count += 1;
    }
    return count;
  }

  mergeLocations(keepId: number, removeIds: readonly number[]): number {
    const removing = new Set(removeIds);
    const survivor = this.locations.find((place) => place.id === keepId);

    // The taxonomy union, mirroring the INSERT OR IGNORE against the unique
    // index: a name both copies carry stays one entry.
    if (survivor) {
      const categories = new Set(survivor.categories);
      const tags = new Set(survivor.tags);
      for (const place of this.locations) {
        if (!removing.has(place.id)) continue;
        for (const name of place.categories) categories.add(name);
        for (const name of place.tags) tags.add(name);
      }
      survivor.categories = [...categories];
      survivor.tags = [...tags];
    }

    // The repoint, *before* the delete — the ordering is the whole contract, so
    // the fake has to honour it or a test would pass against a broken merge.
    let moved = 0;
    for (const [entryLocationId, savedId] of this.linkedEntryLocations) {
      if (removing.has(savedId)) {
        this.linkedEntryLocations.set(entryLocationId, keepId);
        moved += 1;
      }
    }

    this.locations = this.locations.filter((place) => !removing.has(place.id));
    return moved;
  }

  linkEntryLocation(entryLocationId: number, savedLocationId: number): void {
    this.linkedEntryLocations.set(entryLocationId, savedLocationId);
  }

  // --- Importing from existing entries ---------------------------------------

  /** The entry-location rows a test wants the importer to see. Set directly. */
  entryLocationSources: EntryLocationSource[] = [];

  listEntryLocationsForImport(): EntryLocationSource[] {
    return [...this.entryLocationSources];
  }

  listLocationCoordinates(): { latitude: number; longitude: number }[] {
    return this.locations.map((place) => ({
      latitude: place.latitude,
      longitude: place.longitude,
    }));
  }

  // --- Taxonomy -------------------------------------------------------------

  listCategories(): LocationCategory[] {
    return [...this.categories].sort(byName);
  }

  getCategoryByName(name: string): LocationCategory | undefined {
    return this.categories.find((row) => row.name.toLowerCase() === name.toLowerCase());
  }

  upsertCategory(input: LocationTaxonomyWriteData): LocationCategory {
    return this.upsertInto(this.categories, input);
  }

  deleteCategory(name: string): void {
    this.categories = this.categories.filter(
      (row) => row.name.toLowerCase() !== name.toLowerCase(),
    );
    for (const place of this.locations) {
      place.categories = place.categories.filter(
        (candidate) => candidate.toLowerCase() !== name.toLowerCase(),
      );
    }
  }

  countLocationsByCategory(): LocationTaxonomyCount[] {
    return this.listCategories().map((row) => ({
      name: row.name,
      count: this.locations.filter((place) =>
        place.categories.some((name) => name.toLowerCase() === row.name.toLowerCase()),
      ).length,
    }));
  }

  listTags(): LocationTag[] {
    return [...this.tags].sort(byName);
  }

  getTagByName(name: string): LocationTag | undefined {
    return this.tags.find((row) => row.name.toLowerCase() === name.toLowerCase());
  }

  upsertTag(input: LocationTaxonomyWriteData): LocationTag {
    return this.upsertInto(this.tags, input);
  }

  deleteTag(name: string): void {
    this.tags = this.tags.filter((row) => row.name.toLowerCase() !== name.toLowerCase());
    for (const place of this.locations) {
      place.tags = place.tags.filter(
        (candidate) => candidate.toLowerCase() !== name.toLowerCase(),
      );
    }
  }

  countLocationsByTag(): LocationTaxonomyCount[] {
    return this.listTags().map((row) => ({
      name: row.name,
      count: this.locations.filter((place) =>
        place.tags.some((name) => name.toLowerCase() === row.name.toLowerCase()),
      ).length,
    }));
  }

  // --- Internals ------------------------------------------------------------

  private upsertInto(
    list: LocationCategory[],
    input: LocationTaxonomyWriteData,
  ): LocationCategory {
    const existing = list.find((row) => row.name.toLowerCase() === input.name.toLowerCase());
    if (existing) {
      existing.description = input.description;
      return { ...existing };
    }
    const created: LocationCategory = {
      name: input.name,
      description: input.description,
      createdAt: FakeSavedLocationRepository.TIMESTAMP,
      updatedAt: FakeSavedLocationRepository.TIMESTAMP,
    };
    list.push(created);
    return { ...created };
  }

  private sorted(places: SavedLocation[]): SavedLocation[] {
    return [...places].sort(
      (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id - b.id,
    );
  }

  private withUsage(place: SavedLocation): SavedLocationWithUsage {
    return { ...place, usageCount: this.countUsage(place.id) };
  }
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}
