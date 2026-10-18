import { describe, expect, it } from "vitest";
import {
  MAX_VENN_SETS,
  buildVennLayout,
  defaultVennNames,
  findVennRegion,
  rankTaxonomyNames,
} from "./venn-regions";
import type { SavedLocation } from "./types";

let nextId = 1;

function place(
  name: string,
  tags: string[] = [],
  categories: string[] = [],
): SavedLocation {
  return {
    id: nextId++,
    name,
    latitude: 0,
    longitude: 0,
    description: "",
    address: "",
    categories,
    tags,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** The names in a region, for terser assertions. */
function namesIn(places: SavedLocation[]): string[] {
  return places.map((entry) => entry.name);
}

describe("rankTaxonomyNames", () => {
  it("orders by use, most-used first", () => {
    const places = [
      place("Blue Ridge", ["Hiking", "Scenic"]),
      place("Mt Tam", ["Hiking", "Scenic"]),
      place("Eagle Peak", ["Hiking"]),
      place("Dolores Park", ["Urban"]),
    ];
    expect(rankTaxonomyNames(places, "tag")).toEqual([
      { name: "Hiking", count: 3 },
      { name: "Scenic", count: 2 },
      { name: "Urban", count: 1 },
    ]);
  });

  it("breaks ties alphabetically so the order is stable", () => {
    const places = [place("A", ["Zebra"]), place("B", ["Apple"])];
    expect(rankTaxonomyNames(places, "tag").map((entry) => entry.name)).toEqual([
      "Apple",
      "Zebra",
    ]);
  });

  it("counts casing variants as one name", () => {
    const places = [place("A", ["Hiking"]), place("B", ["hiking"])];
    expect(rankTaxonomyNames(places, "tag")).toEqual([{ name: "Hiking", count: 2 }]);
  });

  it("reads categories when asked for categories", () => {
    const places = [place("A", ["Hiking"], ["Trailhead"])];
    expect(rankTaxonomyNames(places, "category")).toEqual([{ name: "Trailhead", count: 1 }]);
  });

  it("returns nothing when no place carries a tag", () => {
    expect(rankTaxonomyNames([place("A"), place("B")], "tag")).toEqual([]);
  });
});

describe("defaultVennNames", () => {
  it("takes at most three names", () => {
    const places = [place("A", ["One", "Two", "Three", "Four"])];
    expect(defaultVennNames(places, "tag")).toHaveLength(MAX_VENN_SETS);
  });

  it("returns fewer than two when the data cannot fill a diagram", () => {
    expect(defaultVennNames([place("A", ["Only"])], "tag")).toEqual(["Only"]);
    expect(defaultVennNames([place("A")], "tag")).toEqual([]);
  });
});

describe("buildVennLayout", () => {
  it("puts each place in exactly one region", () => {
    const places = [
      place("Blue Ridge", ["Hiking"]),
      place("Ocean Beach", ["Hiking", "Dogs"]),
      place("Point Reyes", ["Hiking", "Dogs", "Scenic"]),
      place("Dolores Park", ["Dogs"]),
    ];
    const layout = buildVennLayout(places, ["Hiking", "Dogs", "Scenic"], "tag");

    expect(namesIn(findVennRegion(layout, [0])!.places)).toEqual(["Blue Ridge"]);
    expect(namesIn(findVennRegion(layout, [0, 1])!.places)).toEqual(["Ocean Beach"]);
    expect(namesIn(findVennRegion(layout, [0, 1, 2])!.places)).toEqual(["Point Reyes"]);
    expect(namesIn(findVennRegion(layout, [1])!.places)).toEqual(["Dolores Park"]);

    // The regions partition the places: every place lands once and only once.
    const drawn = layout.regions.flatMap((region) => region.places.length);
    expect(drawn.reduce((sum, count) => sum + count, 0) + layout.unmatched.length).toBe(
      places.length,
    );
  });

  it("does not put a multi-tag place in the single-tag region", () => {
    const layout = buildVennLayout(
      [place("Ocean Beach", ["Hiking", "Dogs"])],
      ["Hiking", "Dogs"],
      "tag",
    );
    expect(findVennRegion(layout, [0])).toBeUndefined();
    expect(namesIn(findVennRegion(layout, [0, 1])!.places)).toEqual(["Ocean Beach"]);
  });

  it("collects places carrying none of the chosen names", () => {
    const layout = buildVennLayout(
      [place("Blue Ridge", ["Hiking"]), place("Office", ["Work"])],
      ["Hiking", "Dogs"],
      "tag",
    );
    expect(namesIn(layout.unmatched)).toEqual(["Office"]);
    expect(layout.totalPlaces).toBe(2);
  });

  it("drops empty regions rather than drawing a zero", () => {
    const layout = buildVennLayout([place("Blue Ridge", ["Hiking"])], ["Hiking", "Dogs"], "tag");
    expect(layout.regions).toHaveLength(1);
    expect(layout.regions[0].label).toBe("Hiking");
  });

  it("matches names case-insensitively, as the repository does", () => {
    const layout = buildVennLayout([place("Blue Ridge", ["hiking"])], ["Hiking", "Dogs"], "tag");
    expect(namesIn(findVennRegion(layout, [0])!.places)).toEqual(["Blue Ridge"]);
    expect(layout.unmatched).toEqual([]);
  });

  it("labels the full overlap in words, not as a join", () => {
    const three = buildVennLayout(
      [place("Point Reyes", ["A", "B", "C"])],
      ["A", "B", "C"],
      "tag",
    );
    expect(findVennRegion(three, [0, 1, 2])!.label).toBe("All three");

    const two = buildVennLayout([place("Ocean Beach", ["A", "B"])], ["A", "B"], "tag");
    expect(findVennRegion(two, [0, 1])!.label).toBe("Both");
  });

  it("labels a partial overlap with the names it covers", () => {
    const layout = buildVennLayout(
      [place("Ocean Beach", ["Hiking", "Dogs"])],
      ["Hiking", "Dogs", "Scenic"],
      "tag",
    );
    expect(findVennRegion(layout, [0, 1])!.label).toBe("Hiking + Dogs");
  });

  it("orders regions singles, then pairs, then the triple", () => {
    const layout = buildVennLayout(
      [
        place("Triple", ["A", "B", "C"]),
        place("Pair", ["A", "B"]),
        place("Single", ["A"]),
      ],
      ["A", "B", "C"],
      "tag",
    );
    expect(layout.regions.map((region) => region.setIndices.length)).toEqual([1, 2, 3]);
  });

  it("intersects categories when asked for categories", () => {
    const layout = buildVennLayout(
      [place("Blue Ridge", ["Hiking"], ["Trailhead", "Park"])],
      ["Trailhead", "Park"],
      "category",
    );
    expect(namesIn(findVennRegion(layout, [0, 1])!.places)).toEqual(["Blue Ridge"]);
  });

  it("treats everything as unmatched when given fewer than two names", () => {
    const places = [place("Blue Ridge", ["Hiking"])];
    const layout = buildVennLayout(places, ["Hiking"], "tag");
    expect(layout.regions).toEqual([]);
    expect(namesIn(layout.unmatched)).toEqual(["Blue Ridge"]);
  });

  it("throws on more than three names rather than silently dropping one", () => {
    expect(() => buildVennLayout([], ["A", "B", "C", "D"], "tag")).toThrow(/at most 3 sets/);
  });

  it("handles an empty library", () => {
    const layout = buildVennLayout([], ["A", "B"], "tag");
    expect(layout.regions).toEqual([]);
    expect(layout.unmatched).toEqual([]);
    expect(layout.totalPlaces).toBe(0);
  });
});

describe("findVennRegion", () => {
  it("finds a region whatever order the indices are given in", () => {
    const layout = buildVennLayout(
      [place("Ocean Beach", ["A", "B"])],
      ["A", "B", "C"],
      "tag",
    );
    expect(findVennRegion(layout, [1, 0])).toBe(findVennRegion(layout, [0, 1]));
  });

  it("returns undefined for an empty region", () => {
    const layout = buildVennLayout([place("Blue Ridge", ["A"])], ["A", "B"], "tag");
    expect(findVennRegion(layout, [0, 1])).toBeUndefined();
  });
});
