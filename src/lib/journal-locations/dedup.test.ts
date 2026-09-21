import { describe, expect, it } from "vitest";
import {
  COORDINATE_PRECISION,
  DEFAULT_NAME_THRESHOLD,
  coordinateKey,
  countDuplicateLocations,
  distanceInMetres,
  findLocationDuplicateGroups,
  nameSimilarity,
  normalizeLocationName,
  roundCoordinate,
} from "./dedup";
import type { SavedLocationWithUsage } from "./types";

let nextId = 1;

function place(
  name: string,
  latitude: number,
  longitude: number,
  overrides: Partial<SavedLocationWithUsage> = {},
): SavedLocationWithUsage {
  return {
    id: nextId++,
    name,
    latitude,
    longitude,
    description: "",
    address: "",
    categories: [],
    tags: [],
    usageCount: 0,
    createdAt: "2026-01-01 00:00:00",
    updatedAt: "2026-01-01 00:00:00",
    ...overrides,
  };
}

describe("normalizeLocationName", () => {
  it("folds case, punctuation and apostrophes together", () => {
    // The case that motivated the screen: the same museum typed two ways.
    expect(normalizeLocationName("Buck's County Children's Museum")).toBe(
      normalizeLocationName("Bucks County Childrens Museum"),
    );
  });

  it("drops filler words so 'The' is not a difference", () => {
    expect(normalizeLocationName("The Home Depot")).toBe(normalizeLocationName("Home Depot"));
  });

  it("unifies & and and", () => {
    expect(normalizeLocationName("Bed & Breakfast")).toBe(normalizeLocationName("Bed and Breakfast"));
  });

  it("folds accents", () => {
    expect(normalizeLocationName("Café Rouge")).toBe(normalizeLocationName("Cafe Rouge"));
  });

  it("keeps a name made entirely of filler rather than emptying it", () => {
    // "" would match every other all-filler name, which is the opposite of what
    // a normalizer is for.
    expect(normalizeLocationName("The")).toBe("the");
  });

  it("collapses whitespace runs", () => {
    expect(normalizeLocationName("  Blue   Bottle  ")).toBe("blue bottle");
  });
});

describe("nameSimilarity", () => {
  it("scores an identical name 1", () => {
    expect(nameSimilarity("Blue Bottle", "Blue Bottle")).toBe(1);
  });

  it("scores a punctuation-only difference 1", () => {
    expect(nameSimilarity("Buck's Museum", "Bucks Museum")).toBe(1);
  });

  it("scores unrelated names near 0", () => {
    expect(nameSimilarity("Blue Bottle", "Trailhead Parking")).toBeLessThan(0.3);
  });

  it("is insensitive to word order", () => {
    // Bigrams, not edit distance — this is the property that choice buys.
    expect(nameSimilarity("Museum of Art", "Art Museum")).toBeGreaterThan(0.6);
  });

  it("scores a blank name 0 against anything", () => {
    expect(nameSimilarity("", "Blue Bottle")).toBe(0);
    expect(nameSimilarity("", "")).toBe(0);
  });

  it("is symmetric", () => {
    const a = nameSimilarity("Brunswick Acres Elementary", "Brunswick Acres Elementary School");
    const b = nameSimilarity("Brunswick Acres Elementary School", "Brunswick Acres Elementary");
    expect(a).toBe(b);
  });

  it("catches a single-character typo above the default threshold", () => {
    expect(nameSimilarity("Bridgewater Kia", "Bridgewatter Kia")).toBeGreaterThan(
      DEFAULT_NAME_THRESHOLD,
    );
  });
});

describe("roundCoordinate and coordinateKey", () => {
  it("rounds to the declared precision", () => {
    expect(roundCoordinate(40.423681)).toBe(40.424);
    expect(COORDINATE_PRECISION).toBe(3);
  });

  it("normalises -0 to 0 so two keys for the equator agree", () => {
    expect(Object.is(roundCoordinate(-0.0001), 0)).toBe(true);
  });

  it("puts two nearby pins in the same cell and a distant one elsewhere", () => {
    expect(coordinateKey(40.42368, -74.40797)).toBe(coordinateKey(40.42371, -74.40799));
    expect(coordinateKey(40.42368, -74.40797)).not.toBe(coordinateKey(40.5, -74.40797));
  });
});

describe("distanceInMetres", () => {
  it("is 0 for the same point", () => {
    expect(distanceInMetres({ latitude: 40.4, longitude: -74.4 }, { latitude: 40.4, longitude: -74.4 })).toBe(0);
  });

  it("measures a small offset in the tens of metres", () => {
    // ~0.0005 degrees of latitude is ~55m.
    const metres = distanceInMetres(
      { latitude: 40.4, longitude: -74.4 },
      { latitude: 40.4005, longitude: -74.4 },
    );
    expect(metres).toBeGreaterThan(40);
    expect(metres).toBeLessThan(70);
  });
});

describe("findLocationDuplicateGroups", () => {
  it("groups two spellings of one place at the same pin", () => {
    const rows = [
      place("Buck's County Children's Museum", 40.36616, -74.95471),
      place("Bucks County Childrens Museum", 40.36618, -74.95470),
    ];

    const groups = findLocationDuplicateGroups(rows);

    expect(groups).toHaveLength(1);
    expect(groups[0].locations).toHaveLength(2);
    expect(countDuplicateLocations(groups)).toBe(2);
  });

  it("does not group the same name at different coordinates", () => {
    // Two real branches of one chain. Name alone would merge them, which is
    // exactly the mistake the coordinate bucket exists to prevent.
    const rows = [place("Starbucks", 40.4, -74.4), place("Starbucks", 40.9, -74.9)];

    expect(findLocationDuplicateGroups(rows)).toEqual([]);
  });

  it("does not group different names at the same coordinates", () => {
    // A restaurant and the car park sharing its pin.
    const rows = [place("Blue Bottle Coffee", 40.4, -74.4), place("Municipal Car Park", 40.4, -74.4)];

    expect(findLocationDuplicateGroups(rows)).toEqual([]);
  });

  it("merges a transitive chain into one group rather than overlapping pairs", () => {
    // A~B and B~C, but A and C may not score against each other directly. One
    // group of three is the only coherent answer — two pairs sharing B would
    // let a merge of one invalidate the other.
    const rows = [
      place("Brunswick Acres Elementary School", 40.43431, -74.5286),
      place("Brunswick Acres Elementary", 40.43432, -74.5286),
      place("Brunswick Acres Elem School", 40.43430, -74.5286),
    ];

    const groups = findLocationDuplicateGroups(rows, 0.75);

    expect(groups).toHaveLength(1);
    expect(groups[0].locations).toHaveLength(3);
  });

  it("skips blank-named rows instead of grouping them on emptiness", () => {
    const rows = [place("", 40.4, -74.4), place("   ", 40.4, -74.4), place("", 40.4, -74.4)];

    expect(findLocationDuplicateGroups(rows)).toEqual([]);
  });

  it("returns nothing for a library with no duplicates", () => {
    const rows = [place("Blue Bottle", 40.4, -74.4), place("Trailhead", 41.9, -73.1)];

    expect(findLocationDuplicateGroups(rows)).toEqual([]);
  });

  it("returns nothing for an empty library", () => {
    expect(findLocationDuplicateGroups([])).toEqual([]);
  });

  it("puts the most-used copy first, as the default survivor", () => {
    const rows = [
      place("Bridgewater Kia", 40.57532, -74.57223, { id: 100, usageCount: 2 }),
      place("Bridgewater Kia", 40.57533, -74.57223, { id: 101, usageCount: 9 }),
    ];

    const groups = findLocationDuplicateGroups(rows);

    expect(groups[0].locations[0].id).toBe(101);
    expect(groups[0].locations[0].usageCount).toBe(9);
  });

  it("reports each member's distance from the first", () => {
    const rows = [
      place("Bridgewater Kia", 40.575, -74.572, { usageCount: 5 }),
      place("Bridgewater Kia", 40.5754, -74.572, { usageCount: 1 }),
    ];

    const groups = findLocationDuplicateGroups(rows);

    expect(groups[0].locations[0].metresFromFirst).toBe(0);
    expect(groups[0].locations[1].metresFromFirst).toBeGreaterThan(0);
  });

  it("honours a stricter threshold", () => {
    const rows = [
      place("Brunswick Acres Elementary School", 40.434, -74.528),
      place("Brunswick Acres Elem", 40.434, -74.528),
    ];

    // Loose enough to match, then strict enough not to.
    expect(findLocationDuplicateGroups(rows, 0.6)).toHaveLength(1);
    expect(findLocationDuplicateGroups(rows, 1)).toEqual([]);
  });

  it("reports the weakest pair as the group's confidence", () => {
    const rows = [
      place("Blue Bottle Coffee", 40.4, -74.4),
      place("Blue Bottle Coffee", 40.4, -74.4),
    ];

    expect(findLocationDuplicateGroups(rows)[0].confidence).toBe(1);
  });

  it("orders groups most-confident first", () => {
    const rows = [
      // A looser pair, and an exact one. The exact pair must lead.
      place("Brunswick Acres Elementary School", 40.1, -74.1),
      place("Brunswick Acres Elementary", 40.1, -74.1),
      place("Blue Bottle Coffee", 41.2, -75.2),
      place("Blue Bottle Coffee", 41.2, -75.2),
    ];

    const groups = findLocationDuplicateGroups(rows, 0.7);

    expect(groups).toHaveLength(2);
    expect(groups[0].confidence).toBeGreaterThanOrEqual(groups[1].confidence);
    expect(groups[0].label).toBe("Blue Bottle Coffee");
  });
});
