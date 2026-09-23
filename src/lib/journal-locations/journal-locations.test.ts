import { describe, expect, it } from "vitest";
import {
  MAX_LOCATION_ICON_BYTES,
  clearLocationTaxonomyIcon,
  countLocationsByCategory,
  createSavedLocation,
  deleteLocationTaxonomy,
  deleteSavedLocation,
  findLocationDuplicates,
  getLocationTaxonomyIcon,
  getSavedLocation,
  listSavedLocations,
  mergeSavedLocations,
  promoteToSavedLocation,
  saveLocationTaxonomy,
  searchSavedLocations,
  setLocationTaxonomyIcon,
  updateSavedLocation,
} from "./journal-locations";
import { FakeSavedLocationRepository } from "./fake-repository";

/** A repo with the two taxonomy lists the tests keep reaching for. */
function repoWithTaxonomy(): FakeSavedLocationRepository {
  const repo = new FakeSavedLocationRepository();
  repo.upsertCategory({ name: "Restaurant", description: "" });
  repo.upsertCategory({ name: "Trailhead", description: "" });
  repo.upsertTag({ name: "Family", description: "" });
  repo.upsertTag({ name: "Weekend", description: "" });
  return repo;
}

const PRINCETON = { latitude: 40.3399, longitude: -74.4619 };

describe("createSavedLocation", () => {
  it("saves a place with its categories and tags", () => {
    const repo = repoWithTaxonomy();

    const created = createSavedLocation(repo, {
      name: "Small World Coffee",
      ...PRINCETON,
      description: "The one on Witherspoon",
      address: "14 Witherspoon St, Princeton, NJ",
      categories: ["Restaurant"],
      tags: ["Weekend"],
    });

    expect(created.id).toBeGreaterThan(0);
    expect(created.name).toBe("Small World Coffee");
    expect(created.categories).toEqual(["Restaurant"]);
    expect(created.tags).toEqual(["Weekend"]);
    expect(getSavedLocation(repo, created.id)?.address).toBe("14 Witherspoon St, Princeton, NJ");
  });

  it("fills the optional fields so a coordinate-only save works", () => {
    const repo = repoWithTaxonomy();

    const created = createSavedLocation(repo, PRINCETON);

    expect(created.name).toBe("");
    expect(created.description).toBe("");
    expect(created.address).toBe("");
    expect(created.categories).toEqual([]);
    expect(created.tags).toEqual([]);
  });

  it("trims, drops blanks and de-dupes the taxonomy names case-insensitively", () => {
    const repo = repoWithTaxonomy();

    const created = createSavedLocation(repo, {
      ...PRINCETON,
      categories: [" Restaurant ", "restaurant", "", "   "],
      tags: ["Family", "Family"],
    });

    expect(created.categories).toEqual(["Restaurant"]);
    expect(created.tags).toEqual(["Family"]);
  });

  it("rejects a category that is not a managed row", () => {
    const repo = repoWithTaxonomy();

    expect(() =>
      createSavedLocation(repo, { ...PRINCETON, categories: ["Speakeasy"] }),
    ).toThrow(/Unknown location category "Speakeasy"/);
  });

  it("rejects an unknown tag", () => {
    const repo = repoWithTaxonomy();

    expect(() => createSavedLocation(repo, { ...PRINCETON, tags: ["Nope"] })).toThrow(
      /Unknown location tag "Nope"/,
    );
  });

  it("writes nothing when one of several names is unknown", () => {
    const repo = repoWithTaxonomy();

    expect(() =>
      createSavedLocation(repo, { ...PRINCETON, categories: ["Restaurant", "Ghost"] }),
    ).toThrow(/Ghost/);
    expect(listSavedLocations(repo)).toHaveLength(0);
  });

  it("rejects an out-of-range latitude", () => {
    const repo = repoWithTaxonomy();

    expect(() => createSavedLocation(repo, { latitude: 91, longitude: 0 })).toThrow(
      /latitude must be between -90 and 90/,
    );
  });

  it("rejects an out-of-range longitude", () => {
    const repo = repoWithTaxonomy();

    expect(() => createSavedLocation(repo, { latitude: 0, longitude: -181 })).toThrow(
      /longitude must be between -180 and 180/,
    );
  });
});

describe("updateSavedLocation", () => {
  it("replaces the fields and the taxonomy lists wholesale", () => {
    const repo = repoWithTaxonomy();
    const created = createSavedLocation(repo, {
      name: "Old name",
      ...PRINCETON,
      categories: ["Restaurant"],
      tags: ["Family", "Weekend"],
    });

    const updated = updateSavedLocation(repo, {
      id: created.id,
      name: "New name",
      latitude: 41,
      longitude: -75,
      description: "moved",
      address: "",
      categories: ["Trailhead"],
      tags: [],
    });

    expect(updated.name).toBe("New name");
    expect(updated.latitude).toBe(41);
    expect(updated.categories).toEqual(["Trailhead"]);
    expect(updated.tags).toEqual([]);
  });

  it("throws for an id that does not exist", () => {
    const repo = repoWithTaxonomy();

    expect(() => updateSavedLocation(repo, { id: 404, ...PRINCETON })).toThrow(
      /No saved location with id 404/,
    );
  });
});

describe("deleteSavedLocation", () => {
  it("removes the place", () => {
    const repo = repoWithTaxonomy();
    const created = createSavedLocation(repo, { name: "Typo", ...PRINCETON });

    deleteSavedLocation(repo, created.id);

    expect(getSavedLocation(repo, created.id)).toBeUndefined();
  });

  it("is allowed even when entries use the place", () => {
    // Every place that has ever been picked is "in use", so refusing here would
    // strand a mistyped one forever. Entries keep their own copy — see 0101.
    const repo = repoWithTaxonomy();
    const created = createSavedLocation(repo, { name: "Used", ...PRINCETON });
    repo.linkEntryLocation(77, created.id);
    expect(repo.countUsage(created.id)).toBe(1);

    deleteSavedLocation(repo, created.id);

    expect(getSavedLocation(repo, created.id)).toBeUndefined();
  });

  it("throws for an unknown id", () => {
    const repo = repoWithTaxonomy();

    expect(() => deleteSavedLocation(repo, 999)).toThrow(/No saved location with id 999/);
  });
});

describe("searchSavedLocations", () => {
  function seeded(): FakeSavedLocationRepository {
    const repo = repoWithTaxonomy();
    createSavedLocation(repo, {
      name: "Small World Coffee",
      ...PRINCETON,
      address: "14 Witherspoon St, Princeton, NJ",
      categories: ["Restaurant"],
      tags: ["Weekend"],
    });
    createSavedLocation(repo, {
      name: "Mountain Lakes",
      latitude: 40.36,
      longitude: -74.67,
      description: "The trail by the boardwalk",
      categories: ["Trailhead"],
      tags: ["Family", "Weekend"],
    });
    createSavedLocation(repo, {
      name: "",
      latitude: 41.1,
      longitude: -74.1,
      address: "Somewhere on Witherspoon",
    });
    return repo;
  }

  it("returns everything when nothing is asked for", () => {
    expect(searchSavedLocations(seeded(), {})).toHaveLength(3);
  });

  it("matches the name case-insensitively", () => {
    const found = searchSavedLocations(seeded(), { query: "small world" });

    expect(found.map((place) => place.name)).toEqual(["Small World Coffee"]);
  });

  it("matches the description", () => {
    const found = searchSavedLocations(seeded(), { query: "boardwalk" });

    expect(found.map((place) => place.name)).toEqual(["Mountain Lakes"]);
  });

  it("matches the address, including on a place with no name", () => {
    const found = searchSavedLocations(seeded(), { query: "witherspoon" });

    expect(found).toHaveLength(2);
  });

  it("AND-s several taxonomy filters together", () => {
    const both = searchSavedLocations(seeded(), { tags: ["Family", "Weekend"] });
    const either = searchSavedLocations(seeded(), { tags: ["Weekend"] });

    expect(both.map((place) => place.name)).toEqual(["Mountain Lakes"]);
    expect(either).toHaveLength(2);
  });

  it("combines text and taxonomy filters", () => {
    const found = searchSavedLocations(seeded(), {
      query: "witherspoon",
      categories: ["Restaurant"],
    });

    expect(found.map((place) => place.name)).toEqual(["Small World Coffee"]);
  });

  it("honours the limit", () => {
    expect(searchSavedLocations(seeded(), { limit: 2 })).toHaveLength(2);
  });

  it("rejects a limit that is not a positive integer", () => {
    expect(() => searchSavedLocations(seeded(), { limit: 0 })).toThrow();
  });
});

describe("promoteToSavedLocation", () => {
  it("creates the place and points the entry location at it", () => {
    const repo = repoWithTaxonomy();

    const created = promoteToSavedLocation(repo, {
      name: "Grandma's",
      ...PRINCETON,
      entryLocationId: 42,
      categories: ["Restaurant"],
    });

    expect(created.name).toBe("Grandma's");
    expect(repo.linkedEntryLocations.get(42)).toBe(created.id);
  });

  it("just creates the place when no entry location is named", () => {
    const repo = repoWithTaxonomy();

    const created = promoteToSavedLocation(repo, { name: "Bare", ...PRINCETON });

    expect(getSavedLocation(repo, created.id)?.name).toBe("Bare");
    expect(repo.linkedEntryLocations.size).toBe(0);
  });

  it("links nothing when the place itself is rejected", () => {
    const repo = repoWithTaxonomy();

    expect(() =>
      promoteToSavedLocation(repo, { ...PRINCETON, entryLocationId: 9, tags: ["Unknown"] }),
    ).toThrow(/Unknown location tag/);
    expect(repo.linkedEntryLocations.size).toBe(0);
  });
});

describe("location taxonomy", () => {
  it("creates and then updates a category's description", () => {
    const repo = new FakeSavedLocationRepository();

    saveLocationTaxonomy(repo, "category", { name: "Cafe", description: "Coffee" });
    const updated = saveLocationTaxonomy(repo, "category", {
      name: "Cafe",
      description: "Coffee and cake",
    });

    expect(updated.description).toBe("Coffee and cake");
    expect(repo.listCategories()).toHaveLength(1);
  });

  it("keeps categories and tags in separate lists", () => {
    const repo = new FakeSavedLocationRepository();

    saveLocationTaxonomy(repo, "category", { name: "Shared", description: "" });
    saveLocationTaxonomy(repo, "tag", { name: "Shared", description: "" });

    expect(repo.listCategories().map((row) => row.name)).toEqual(["Shared"]);
    expect(repo.listTags().map((row) => row.name)).toEqual(["Shared"]);
  });

  it("rejects a blank name", () => {
    const repo = new FakeSavedLocationRepository();

    expect(() => saveLocationTaxonomy(repo, "tag", { name: "   ", description: "" })).toThrow(
      /A name is required/,
    );
  });

  it("deletes a category and its pairings, keeping the places", () => {
    const repo = repoWithTaxonomy();
    const created = createSavedLocation(repo, {
      name: "Kept",
      ...PRINCETON,
      categories: ["Restaurant"],
      tags: ["Family"],
    });

    deleteLocationTaxonomy(repo, "category", "Restaurant");

    expect(getSavedLocation(repo, created.id)?.categories).toEqual([]);
    expect(getSavedLocation(repo, created.id)?.tags).toEqual(["Family"]);
  });

  it("throws when deleting a taxonomy row that does not exist", () => {
    const repo = repoWithTaxonomy();

    expect(() => deleteLocationTaxonomy(repo, "tag", "Ghost")).toThrow(
      /No location tag named "Ghost"/,
    );
  });
});

describe("countLocationsByCategory", () => {
  it("counts the places carrying each category, including the empty ones", () => {
    const repo = repoWithTaxonomy();
    createSavedLocation(repo, { ...PRINCETON, categories: ["Restaurant"] });
    createSavedLocation(repo, { ...PRINCETON, categories: ["Restaurant"] });

    expect(countLocationsByCategory(repo)).toEqual([
      { name: "Restaurant", count: 2 },
      { name: "Trailhead", count: 0 },
    ]);
  });
});

describe("findLocationDuplicates", () => {
  it("finds a near-duplicate pair in the library", () => {
    const repo = repoWithTaxonomy();
    createSavedLocation(repo, { ...PRINCETON, name: "Buck's Museum" });
    createSavedLocation(repo, { ...PRINCETON, name: "Bucks Museum" });

    const groups = findLocationDuplicates(repo);

    expect(groups).toHaveLength(1);
    expect(groups[0].locations).toHaveLength(2);
  });

  it("clamps a threshold outside the slider's range instead of throwing", () => {
    // The threshold arrives from a URL/form, so a nonsense value must degrade
    // to the nearest sane one rather than 500-ing the screen.
    const repo = repoWithTaxonomy();
    createSavedLocation(repo, { ...PRINCETON, name: "Blue Bottle" });
    createSavedLocation(repo, { ...PRINCETON, name: "Blue Bottle" });

    expect(findLocationDuplicates(repo, -5)).toHaveLength(1);
    expect(findLocationDuplicates(repo, 99)).toHaveLength(1);
  });

  it("finds nothing in an empty library", () => {
    expect(findLocationDuplicates(repoWithTaxonomy())).toEqual([]);
  });
});

describe("mergeSavedLocations", () => {
  it("repoints entries at the survivor rather than detaching them", () => {
    // The whole reason this is not a loop of deletes: `deleteSavedLocation`
    // would leave entry location 7 pointing at nothing.
    const repo = repoWithTaxonomy();
    const keep = createSavedLocation(repo, { ...PRINCETON, name: "Bucks Museum" });
    const drop = createSavedLocation(repo, { ...PRINCETON, name: "Buck's Museum" });
    repo.linkEntryLocation(7, drop.id);

    const result = mergeSavedLocations(repo, { keepId: keep.id, removeIds: [drop.id] });

    expect(result.movedCount).toBe(1);
    expect(result.removedCount).toBe(1);
    expect(repo.linkedEntryLocations.get(7)).toBe(keep.id);
    expect(getSavedLocation(repo, drop.id)).toBeUndefined();
    expect(getSavedLocation(repo, keep.id)).toBeDefined();
  });

  it("unions the merged-away place's categories and tags onto the survivor", () => {
    const repo = repoWithTaxonomy();
    const keep = createSavedLocation(repo, {
      ...PRINCETON,
      name: "Bucks Museum",
      categories: ["Restaurant"],
      tags: ["Family"],
    });
    const drop = createSavedLocation(repo, {
      ...PRINCETON,
      name: "Buck's Museum",
      categories: ["Trailhead"],
      tags: ["Family", "Weekend"],
    });

    mergeSavedLocations(repo, { keepId: keep.id, removeIds: [drop.id] });

    const survivor = getSavedLocation(repo, keep.id)!;
    expect([...survivor.categories].sort()).toEqual(["Restaurant", "Trailhead"]);
    // "Family" was on both and must not be duplicated.
    expect([...survivor.tags].sort()).toEqual(["Family", "Weekend"]);
  });

  it("merges several places at once", () => {
    const repo = repoWithTaxonomy();
    const keep = createSavedLocation(repo, { ...PRINCETON, name: "School" });
    const a = createSavedLocation(repo, { ...PRINCETON, name: "School" });
    const b = createSavedLocation(repo, { ...PRINCETON, name: "School" });
    repo.linkEntryLocation(1, a.id);
    repo.linkEntryLocation(2, b.id);

    const result = mergeSavedLocations(repo, { keepId: keep.id, removeIds: [a.id, b.id] });

    expect(result.movedCount).toBe(2);
    expect(listSavedLocations(repo)).toHaveLength(1);
  });

  it("leaves entries that already pointed at the survivor alone", () => {
    const repo = repoWithTaxonomy();
    const keep = createSavedLocation(repo, { ...PRINCETON, name: "School" });
    const drop = createSavedLocation(repo, { ...PRINCETON, name: "School" });
    repo.linkEntryLocation(1, keep.id);
    repo.linkEntryLocation(2, drop.id);

    const result = mergeSavedLocations(repo, { keepId: keep.id, removeIds: [drop.id] });

    // Only entry 2 moved; entry 1 was already home.
    expect(result.movedCount).toBe(1);
    expect(repo.linkedEntryLocations.get(1)).toBe(keep.id);
    expect(repo.linkedEntryLocations.get(2)).toBe(keep.id);
  });

  it("rejects keeping and removing the same place", () => {
    const repo = repoWithTaxonomy();
    const keep = createSavedLocation(repo, { ...PRINCETON, name: "School" });

    expect(() => mergeSavedLocations(repo, { keepId: keep.id, removeIds: [keep.id] })).toThrow();
    expect(getSavedLocation(repo, keep.id)).toBeDefined();
  });

  it("rejects an empty removal list", () => {
    const repo = repoWithTaxonomy();
    const keep = createSavedLocation(repo, { ...PRINCETON, name: "School" });

    expect(() => mergeSavedLocations(repo, { keepId: keep.id, removeIds: [] })).toThrow();
  });

  it("reports an unknown survivor without deleting anything", () => {
    const repo = repoWithTaxonomy();
    const drop = createSavedLocation(repo, { ...PRINCETON, name: "School" });

    expect(() => mergeSavedLocations(repo, { keepId: 9999, removeIds: [drop.id] })).toThrow(
      /No saved location with id 9999/,
    );
    expect(getSavedLocation(repo, drop.id)).toBeDefined();
  });

  it("reports an unknown id to remove without half-applying the merge", () => {
    // The check runs over every id before the first write, so the good one
    // survives a batch naming one stale id.
    const repo = repoWithTaxonomy();
    const keep = createSavedLocation(repo, { ...PRINCETON, name: "School" });
    const drop = createSavedLocation(repo, { ...PRINCETON, name: "School" });

    expect(() =>
      mergeSavedLocations(repo, { keepId: keep.id, removeIds: [drop.id, 9999] }),
    ).toThrow(/No saved location with id 9999/);
    expect(listSavedLocations(repo)).toHaveLength(2);
  });

  it("counts a repeated id once", () => {
    const repo = repoWithTaxonomy();
    const keep = createSavedLocation(repo, { ...PRINCETON, name: "School" });
    const drop = createSavedLocation(repo, { ...PRINCETON, name: "School" });

    const result = mergeSavedLocations(repo, { keepId: keep.id, removeIds: [drop.id, drop.id] });

    expect(result.removedCount).toBe(1);
  });
});


describe("location taxonomy icons", () => {
  /** A one-pixel PNG, base64 — the smallest thing decodeImageUpload will accept. */
  const PNG_PIXEL =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const upload = { mimeType: "image/png" as const, base64Data: PNG_PIXEL };

  it("stores an uploaded icon on a category and serves the bytes back", () => {
    const repo = repoWithTaxonomy();

    setLocationTaxonomyIcon(repo, "category", "Restaurant", upload);

    const icon = getLocationTaxonomyIcon(repo, "category", "Restaurant");
    expect(icon?.mimeType).toBe("image/png");
    expect(icon?.data.length).toBeGreaterThan(0);
    // The mime type rides along on the list read; the bytes deliberately do not.
    expect(repo.getCategoryByName("Restaurant")?.iconMimeType).toBe("image/png");
  });

  it("stores an uploaded icon on a tag", () => {
    const repo = repoWithTaxonomy();

    setLocationTaxonomyIcon(repo, "tag", "Family", upload);

    expect(getLocationTaxonomyIcon(repo, "tag", "Family")?.mimeType).toBe("image/png");
  });

  it("matches the name case-insensitively, as the NOCASE columns do", () => {
    const repo = repoWithTaxonomy();

    setLocationTaxonomyIcon(repo, "category", "restaurant", upload);

    expect(getLocationTaxonomyIcon(repo, "category", "Restaurant")).toBeDefined();
  });

  it("refuses an icon for a category that doesn't exist", () => {
    // Otherwise a typo in the name would quietly invent a category.
    const repo = repoWithTaxonomy();

    expect(() => setLocationTaxonomyIcon(repo, "category", "Nope", upload)).toThrow(
      /No location category named "Nope"/,
    );
  });

  it("refuses a non-image upload", () => {
    const repo = repoWithTaxonomy();

    expect(() =>
      setLocationTaxonomyIcon(repo, "category", "Restaurant", {
        mimeType: "image/svg+xml" as never,
        base64Data: PNG_PIXEL,
      }),
    ).toThrow(/PNG, JPEG, WebP or GIF/);
  });

  it("refuses an icon over the size cap", () => {
    const repo = repoWithTaxonomy();
    const tooBig = Buffer.alloc(MAX_LOCATION_ICON_BYTES + 1, 1).toString("base64");

    expect(() =>
      setLocationTaxonomyIcon(repo, "category", "Restaurant", {
        mimeType: "image/png",
        base64Data: tooBig,
      }),
    ).toThrow(/too large/);
  });

  it("clears an icon without removing the category", () => {
    const repo = repoWithTaxonomy();
    setLocationTaxonomyIcon(repo, "category", "Restaurant", upload);

    clearLocationTaxonomyIcon(repo, "category", "Restaurant");

    expect(getLocationTaxonomyIcon(repo, "category", "Restaurant")).toBeUndefined();
    expect(repo.getCategoryByName("Restaurant")).toBeDefined();
    expect(repo.getCategoryByName("Restaurant")?.iconMimeType).toBeUndefined();
  });

  it("refuses to clear an icon on a row that doesn't exist", () => {
    const repo = repoWithTaxonomy();

    expect(() => clearLocationTaxonomyIcon(repo, "tag", "Nope")).toThrow(
      /No location tag named "Nope"/,
    );
  });

  it("reports no icon for a row that never had one", () => {
    const repo = repoWithTaxonomy();

    expect(getLocationTaxonomyIcon(repo, "category", "Trailhead")).toBeUndefined();
  });
});
