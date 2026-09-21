import { describe, expect, it, vi } from "vitest";
import type { GeocodingClient, GeoPlace } from "@/lib/geocoding";
import { FakeSavedLocationRepository } from "./fake-repository";
import { countImportCandidates, listImportCandidates, runImportBatch } from "./import-run";
import type { EntryLocationSource } from "./types";

/**
 * A geocoder that answers from a fixed table and records what it was asked.
 *
 * Hand-written rather than mocked, like every other fake here — and it counts
 * its calls, which is how the "one lookup per created place" assertions work.
 */
class FakeGeocoder implements GeocodingClient {
  readonly reverseCalls: { latitude: number; longitude: number }[] = [];
  constructor(
    private readonly answers: Record<string, string> = {},
    private readonly failOn: Set<string> = new Set(),
  ) {}

  search(): Promise<GeoPlace[]> {
    throw new Error("The importer never forward-geocodes.");
  }

  async reverse(latitude: number, longitude: number): Promise<GeoPlace | undefined> {
    this.reverseCalls.push({ latitude, longitude });
    const key = `${latitude},${longitude}`;
    if (this.failOn.has(key)) throw new Error("Nominatim is down.");
    const displayName = this.answers[key];
    return displayName === undefined ? undefined : { latitude, longitude, displayName };
  }
}

function source(overrides: Partial<EntryLocationSource> = {}): EntryLocationSource {
  return {
    entryLocationId: 1,
    latitude: 40.3399,
    longitude: -74.4619,
    locationName: "",
    placeName: "",
    ...overrides,
  };
}

/** A repo preloaded with entry locations the importer will see. */
function repoWith(rows: EntryLocationSource[]): FakeSavedLocationRepository {
  const repo = new FakeSavedLocationRepository();
  repo.entryLocationSources = rows;
  return repo;
}

// The throttle is real time, so every test that looks up addresses runs with
// fake timers auto-advanced rather than actually waiting seconds.
function withoutWaiting<T>(run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 });
  return run().finally(() => vi.useRealTimers());
}

describe("listImportCandidates", () => {
  it("is empty when no entry has a location", () => {
    expect(listImportCandidates(repoWith([]))).toEqual([]);
  });

  it("groups the entry locations into distinct places", () => {
    const repo = repoWith([
      source({ entryLocationId: 1, locationName: "Cafe" }),
      source({ entryLocationId: 2, locationName: "Cafe" }),
      source({ entryLocationId: 3, latitude: 41, longitude: -75 }),
    ]);

    expect(listImportCandidates(repo)).toHaveLength(2);
  });

  it("skips coordinates the library already holds", () => {
    const repo = repoWith([source()]);
    repo.createLocation({
      name: "Already here",
      latitude: 40.3399,
      longitude: -74.4619,
      description: "",
      address: "",
      categories: [],
      tags: [],
    });

    expect(listImportCandidates(repo)).toEqual([]);
  });
});

describe("countImportCandidates", () => {
  it("counts the distinct places that would be created", () => {
    const repo = repoWith([
      source({ entryLocationId: 1 }),
      source({ entryLocationId: 2 }),
      source({ entryLocationId: 3, latitude: 1, longitude: 1 }),
    ]);

    expect(countImportCandidates(repo)).toBe(2);
  });
});

describe("runImportBatch without addresses", () => {
  it("creates a place per distinct coordinate", async () => {
    const repo = repoWith([
      source({ entryLocationId: 1, locationName: "Cafe", placeName: "Princeton" }),
      source({ entryLocationId: 2, latitude: 41, longitude: -75, locationName: "Park" }),
    ]);

    const result = await runImportBatch(repo, new FakeGeocoder(), { withAddresses: false });

    expect(result.createdCount).toBe(2);
    expect(result.remainingCount).toBe(0);
    expect(repo.listLocations()).toHaveLength(2);
  });

  it("carries the name and the entry's place name into the new place", async () => {
    const repo = repoWith([source({ locationName: "Small World", placeName: "Princeton, NJ" })]);

    await runImportBatch(repo, new FakeGeocoder(), { withAddresses: false });

    const [created] = repo.listLocations();
    expect(created.name).toBe("Small World");
    expect(created.description).toBe("Princeton, NJ");
    expect(created.address).toBe("");
  });

  it("leaves the address blank and asks the geocoder nothing", async () => {
    const geocoder = new FakeGeocoder({ "40.3399,-74.4619": "14 Witherspoon St" });
    const repo = repoWith([source()]);

    await runImportBatch(repo, geocoder, { withAddresses: false });

    expect(geocoder.reverseCalls).toHaveLength(0);
    expect(repo.listLocations()[0].address).toBe("");
  });

  it("links every contributing entry location to the created place", async () => {
    const repo = repoWith([
      source({ entryLocationId: 7 }),
      source({ entryLocationId: 8 }),
      source({ entryLocationId: 9 }),
    ]);

    await runImportBatch(repo, new FakeGeocoder(), { withAddresses: false });

    const [created] = repo.listLocations();
    expect(repo.linkedEntryLocations.get(7)).toBe(created.id);
    expect(repo.linkedEntryLocations.get(8)).toBe(created.id);
    expect(repo.linkedEntryLocations.get(9)).toBe(created.id);
    expect(created.usageCount).toBe(3);
  });

  it("creates no categories or tags", async () => {
    const repo = repoWith([source({ locationName: "Somewhere" })]);

    await runImportBatch(repo, new FakeGeocoder(), { withAddresses: false });

    expect(repo.listLocations()[0].categories).toEqual([]);
    expect(repo.listLocations()[0].tags).toEqual([]);
  });

  it("stops at the batch size and reports what is left", async () => {
    const repo = repoWith([
      source({ entryLocationId: 1, latitude: 1, longitude: 1 }),
      source({ entryLocationId: 2, latitude: 2, longitude: 2 }),
      source({ entryLocationId: 3, latitude: 3, longitude: 3 }),
    ]);

    const result = await runImportBatch(repo, new FakeGeocoder(), {
      withAddresses: false,
      batchSize: 2,
    });

    expect(result.processedCount).toBe(2);
    expect(result.remainingCount).toBe(1);
  });

  it("resumes where the last batch stopped, without recreating anything", async () => {
    const repo = repoWith([
      source({ entryLocationId: 1, latitude: 1, longitude: 1 }),
      source({ entryLocationId: 2, latitude: 2, longitude: 2 }),
      source({ entryLocationId: 3, latitude: 3, longitude: 3 }),
    ]);

    await runImportBatch(repo, new FakeGeocoder(), { withAddresses: false, batchSize: 2 });
    const second = await runImportBatch(repo, new FakeGeocoder(), {
      withAddresses: false,
      batchSize: 2,
    });

    expect(second.createdCount).toBe(1);
    expect(second.remainingCount).toBe(0);
    expect(repo.listLocations()).toHaveLength(3);
  });

  it("is a no-op when run again with nothing left", async () => {
    const repo = repoWith([source()]);
    await runImportBatch(repo, new FakeGeocoder(), { withAddresses: false });

    const again = await runImportBatch(repo, new FakeGeocoder(), { withAddresses: false });

    expect(again.processedCount).toBe(0);
    expect(again.createdCount).toBe(0);
    expect(repo.listLocations()).toHaveLength(1);
  });

  it("does nothing when there are no entry locations at all", async () => {
    const repo = repoWith([]);

    const result = await runImportBatch(repo, new FakeGeocoder(), { withAddresses: false });

    expect(result).toEqual({
      processedCount: 0,
      createdCount: 0,
      addressCount: 0,
      remainingCount: 0,
    });
  });
});

describe("runImportBatch with addresses", () => {
  it("fills the address from the geocoder", async () => {
    const geocoder = new FakeGeocoder({ "40.3399,-74.4619": "14 Witherspoon St, Princeton" });
    const repo = repoWith([source()]);

    const result = await withoutWaiting(() =>
      runImportBatch(repo, geocoder, { withAddresses: true }),
    );

    expect(repo.listLocations()[0].address).toBe("14 Witherspoon St, Princeton");
    expect(result.addressCount).toBe(1);
  });

  it("looks up once per distinct place, not once per entry location", async () => {
    const geocoder = new FakeGeocoder();
    const repo = repoWith([
      source({ entryLocationId: 1 }),
      source({ entryLocationId: 2 }),
      source({ entryLocationId: 3 }),
    ]);

    await withoutWaiting(() => runImportBatch(repo, geocoder, { withAddresses: true }));

    expect(geocoder.reverseCalls).toHaveLength(1);
  });

  it("still creates the place when the lookup throws", async () => {
    // Offline, rate-limited, or a transient 5xx must not lose the place.
    const geocoder = new FakeGeocoder({}, new Set(["40.3399,-74.4619"]));
    const repo = repoWith([source({ locationName: "Kept anyway" })]);

    const result = await withoutWaiting(() =>
      runImportBatch(repo, geocoder, { withAddresses: true }),
    );

    expect(result.createdCount).toBe(1);
    expect(result.addressCount).toBe(0);
    expect(repo.listLocations()[0].name).toBe("Kept anyway");
    expect(repo.listLocations()[0].address).toBe("");
  });

  it("still creates the place when the point has no address", async () => {
    // Nominatim returns nothing for a point in open ocean.
    const geocoder = new FakeGeocoder({});
    const repo = repoWith([source()]);

    const result = await withoutWaiting(() =>
      runImportBatch(repo, geocoder, { withAddresses: true }),
    );

    expect(result.createdCount).toBe(1);
    expect(result.addressCount).toBe(0);
    expect(repo.listLocations()[0].address).toBe("");
  });

  it("counts only the places that actually got an address", async () => {
    const geocoder = new FakeGeocoder({ "1,1": "Somewhere real" });
    const repo = repoWith([
      source({ entryLocationId: 1, latitude: 1, longitude: 1 }),
      source({ entryLocationId: 2, latitude: 2, longitude: 2 }),
    ]);

    const result = await withoutWaiting(() =>
      runImportBatch(repo, geocoder, { withAddresses: true }),
    );

    expect(result.createdCount).toBe(2);
    expect(result.addressCount).toBe(1);
  });
});
