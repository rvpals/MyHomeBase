import { describe, expect, it } from "vitest";
import { buildImportCandidates, existingLocationKey } from "./import-from-entries";
import type { EntryLocationSource } from "./types";

/** A source row with everything defaulted, so a test names only what it means. */
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

const NONE = new Set<string>();

describe("buildImportCandidates", () => {
  it("collapses identical coordinates into one candidate", () => {
    const rows = [
      source({ entryLocationId: 1 }),
      source({ entryLocationId: 2 }),
      source({ entryLocationId: 3 }),
    ];

    const candidates = buildImportCandidates(rows, NONE);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].sourceCount).toBe(3);
    expect(candidates[0].entryLocationIds).toEqual([1, 2, 3]);
  });

  it("keeps coordinates that differ at all as separate places", () => {
    // Exact matching, deliberately: two readings metres apart are two places,
    // and merging them is a guess the reader can't undo.
    const rows = [
      source({ entryLocationId: 1, latitude: 40.33990 }),
      source({ entryLocationId: 2, latitude: 40.33991 }),
    ];

    expect(buildImportCandidates(rows, NONE)).toHaveLength(2);
  });

  it("stores the coordinate exactly as the entry held it", () => {
    const rows = [source({ latitude: 40.123456789, longitude: -74.987654321 })];

    const [candidate] = buildImportCandidates(rows, NONE);

    expect(candidate.latitude).toBe(40.123456789);
    expect(candidate.longitude).toBe(-74.987654321);
  });

  it("names the candidate after the most common location name, not the first", () => {
    const rows = [
      source({ entryLocationId: 1, locationName: "Old name" }),
      source({ entryLocationId: 2, locationName: "Small World" }),
      source({ entryLocationId: 3, locationName: "Small World" }),
    ];

    expect(buildImportCandidates(rows, NONE)[0].name).toBe("Small World");
  });

  it("breaks a name tie by first appearance", () => {
    const rows = [
      source({ entryLocationId: 1, locationName: "First" }),
      source({ entryLocationId: 2, locationName: "Second" }),
    ];

    expect(buildImportCandidates(rows, NONE)[0].name).toBe("First");
  });

  it("ignores blank and whitespace-only names", () => {
    const rows = [
      source({ entryLocationId: 1, locationName: "   " }),
      source({ entryLocationId: 2, locationName: "" }),
      source({ entryLocationId: 3, locationName: "Real name" }),
    ];

    expect(buildImportCandidates(rows, NONE)[0].name).toBe("Real name");
  });

  it("leaves the name blank when no source row had one", () => {
    const rows = [source({ locationName: "" })];

    expect(buildImportCandidates(rows, NONE)[0].name).toBe("");
  });

  it("takes the description from the entry's place name", () => {
    const rows = [source({ placeName: "Princeton, NJ" })];

    expect(buildImportCandidates(rows, NONE)[0].description).toBe("Princeton, NJ");
  });

  it("keeps every distinct place name, most common first", () => {
    // Both are things the reader wrote about this coordinate; dropping either
    // would lose information they typed.
    const rows = [
      source({ entryLocationId: 1, placeName: "Mum's" }),
      source({ entryLocationId: 2, placeName: "Home" }),
      source({ entryLocationId: 3, placeName: "Home" }),
    ];

    expect(buildImportCandidates(rows, NONE)[0].description).toBe("Home; Mum's");
  });

  it("leaves the description blank when no entry had a place name", () => {
    const rows = [source({ placeName: "" }), source({ entryLocationId: 2, placeName: "  " })];

    expect(buildImportCandidates(rows, NONE)[0].description).toBe("");
  });

  it("skips coordinates the library already holds", () => {
    const rows = [
      source({ entryLocationId: 1, latitude: 40.3399, longitude: -74.4619 }),
      source({ entryLocationId: 2, latitude: 41.5, longitude: -75.5 }),
    ];
    const existing = new Set([existingLocationKey(40.3399, -74.4619)]);

    const candidates = buildImportCandidates(rows, existing);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].latitude).toBe(41.5);
  });

  it("returns nothing when every coordinate is already in the library", () => {
    // What makes running the import a second time a no-op.
    const rows = [source()];
    const existing = new Set([existingLocationKey(40.3399, -74.4619)]);

    expect(buildImportCandidates(rows, existing)).toEqual([]);
  });

  it("orders candidates by how many entries feed them", () => {
    const rows = [
      source({ entryLocationId: 1, latitude: 1, longitude: 1 }),
      source({ entryLocationId: 2, latitude: 2, longitude: 2 }),
      source({ entryLocationId: 3, latitude: 2, longitude: 2 }),
      source({ entryLocationId: 4, latitude: 2, longitude: 2 }),
    ];

    const candidates = buildImportCandidates(rows, NONE);

    expect(candidates.map((entry) => entry.sourceCount)).toEqual([3, 1]);
  });

  it("returns nothing for no rows", () => {
    expect(buildImportCandidates([], NONE)).toEqual([]);
  });

  it("skips a coordinate that is not a finite number", () => {
    const rows = [
      source({ entryLocationId: 1, latitude: Number.NaN }),
      source({ entryLocationId: 2, longitude: Number.POSITIVE_INFINITY }),
      source({ entryLocationId: 3, latitude: 40, longitude: -74 }),
    ];

    const candidates = buildImportCandidates(rows, NONE);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].latitude).toBe(40);
  });

  it("skips an out-of-range coordinate rather than failing the whole import", () => {
    // The CSV importer accepts junk like "12234.44" by design (lib/journal), so
    // rows like this really are in the data. The library's schema would reject
    // them at the write, which would take the whole run down with it.
    const rows = [
      source({ entryLocationId: 1, latitude: 12234.44, longitude: -2334.333 }),
      source({ entryLocationId: 2, latitude: -91, longitude: 0 }),
      source({ entryLocationId: 3, latitude: 0, longitude: 181 }),
      source({ entryLocationId: 4, latitude: 40, longitude: -74 }),
    ];

    const candidates = buildImportCandidates(rows, NONE);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].entryLocationIds).toEqual([4]);
  });

  it("accepts the exact coordinate bounds", () => {
    const rows = [
      source({ entryLocationId: 1, latitude: 90, longitude: 180 }),
      source({ entryLocationId: 2, latitude: -90, longitude: -180 }),
    ];

    expect(buildImportCandidates(rows, NONE)).toHaveLength(2);
  });
});

describe("existingLocationKey", () => {
  it("matches the key a candidate is grouped under", () => {
    const rows = [source({ latitude: 40.3399, longitude: -74.4619 })];

    const [candidate] = buildImportCandidates(rows, NONE);

    expect(candidate.key).toBe(existingLocationKey(40.3399, -74.4619));
  });
});
