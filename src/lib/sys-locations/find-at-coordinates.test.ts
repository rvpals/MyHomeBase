import { describe, expect, it } from "vitest";
import { findLocationsAtCoordinates } from "./find-at-coordinates";
import type { SavedLocation } from "./types";

function place(
  id: number,
  name: string,
  latitude: number,
  longitude: number,
): SavedLocation {
  return {
    id,
    name,
    latitude,
    longitude,
    description: "",
    address: "",
    categories: [],
    tags: [],
    createdAt: "2026-10-12 12:00:00",
    updatedAt: "2026-10-12 12:00:00",
  };
}

const CVS = place(1, "CVS Pharmacy (Beekman corner)", 40.434, -74.54723);
const FAR = place(2, "Princeton", 40.3499, -74.6593);

describe("findLocationsAtCoordinates", () => {
  it("finds a place at exactly the same point", () => {
    const found = findLocationsAtCoordinates([CVS, FAR], {
      latitude: 40.434,
      longitude: -74.54723,
    });
    expect(found.map((row) => row.name)).toEqual(["CVS Pharmacy (Beekman corner)"]);
  });

  it("finds a place a few metres away, which an exact match would miss", () => {
    // ~11m north. The whole reason this is a radius and not an equality test:
    // a nudged pin is the common way one place gets saved twice.
    const found = findLocationsAtCoordinates([CVS], {
      latitude: 40.4341,
      longitude: -74.54723,
    });
    expect(found).toHaveLength(1);
  });

  it("returns nothing when the candidate is somewhere else", () => {
    expect(
      findLocationsAtCoordinates([CVS, FAR], { latitude: 51.5074, longitude: -0.1278 }),
    ).toEqual([]);
  });

  it("returns nothing when the library is empty", () => {
    expect(findLocationsAtCoordinates([], { latitude: 40.434, longitude: -74.54723 })).toEqual(
      [],
    );
  });

  it("excludes the row being edited, so a place never duplicates itself", () => {
    const found = findLocationsAtCoordinates(
      [CVS],
      { latitude: 40.434, longitude: -74.54723 },
      CVS.id,
    );
    expect(found).toEqual([]);
  });

  it("still reports a different place at the same point while editing", () => {
    const neighbour = place(3, "Beekman Plaza", 40.434, -74.54723);
    const found = findLocationsAtCoordinates(
      [CVS, neighbour],
      { latitude: 40.434, longitude: -74.54723 },
      CVS.id,
    );
    expect(found.map((row) => row.name)).toEqual(["Beekman Plaza"]);
  });

  it("orders several matches nearest first, so the warning names the likeliest", () => {
    const exact = place(4, "Exact", 40.434, -74.54723);
    const nudged = place(5, "Nudged", 40.43405, -74.54723);
    const found = findLocationsAtCoordinates([nudged, exact], {
      latitude: 40.434,
      longitude: -74.54723,
    });
    expect(found.map((row) => row.name)).toEqual(["Exact", "Nudged"]);
  });
});
