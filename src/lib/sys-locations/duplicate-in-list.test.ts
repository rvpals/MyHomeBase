import { describe, expect, it } from "vitest";
import { findDuplicateLocationIndex, isDuplicateLocation } from "./duplicate-in-list";

// A point with the extra fields the app's own location type carries, to prove
// the structural parameter accepts them rather than only bare coordinates.
function point(latitude: number, longitude: number, locationName = "") {
  return { latitude, longitude, locationName };
}

describe("isDuplicateLocation", () => {
  it("refuses a point already in the list", () => {
    const list = [point(40.7128, -74.006, "Home")];
    expect(isDuplicateLocation(list, point(40.7128, -74.006, "Home"))).toBe(true);
  });

  it("allows a point that is somewhere else", () => {
    const list = [point(40.7128, -74.006, "Home")];
    expect(isDuplicateLocation(list, point(51.5074, -0.1278, "London"))).toBe(false);
  });

  it("allows anything into an empty list", () => {
    expect(isDuplicateLocation([], point(40.7128, -74.006))).toBe(false);
  });

  it("treats coordinates a few metres apart as the same place", () => {
    // Differs in the 5th decimal only — the same pin nudged by hand, which is
    // the duplicate this check exists to stop.
    const list = [point(40.71283, -74.00601)];
    expect(isDuplicateLocation(list, point(40.71279, -74.00598))).toBe(true);
  });

  it("allows two points further apart than the radius", () => {
    const list = [point(40.712, -74.006)];
    expect(isDuplicateLocation(list, point(40.715, -74.006))).toBe(false);
  });

  it("ignores the name — the same spot under a different name is still a duplicate", () => {
    const list = [point(40.7128, -74.006, "Corner Cafe")];
    expect(isDuplicateLocation(list, point(40.7128, -74.006, "That coffee place"))).toBe(true);
  });

  it("matches against any row in the list, not just the last", () => {
    const list = [point(40.7128, -74.006), point(48.8584, 2.2945), point(35.6762, 139.6503)];
    expect(isDuplicateLocation(list, point(48.8584, 2.2945))).toBe(true);
  });

  it("catches a pin that straddles a coordinate rounding boundary", () => {
    // This compared rounded cell keys until the dedup fix. 40.35049 and
    // 40.35051 round into different cells but are ~2m apart, so the picker
    // used to append a second pin on top of one already in the list.
    const list = [point(40.35049, -74.5, "Wegmans")];

    expect(isDuplicateLocation(list, point(40.35051, -74.5))).toBe(true);
  });

  it("does not treat a sign flip as the same place", () => {
    const list = [point(40.7128, -74.006)];
    expect(isDuplicateLocation(list, point(40.7128, 74.006))).toBe(false);
    expect(isDuplicateLocation(list, point(-40.7128, -74.006))).toBe(false);
  });

  it("treats 0 and -0 as the same coordinate", () => {
    expect(isDuplicateLocation([point(0, 0)], point(-0, -0))).toBe(true);
  });
});

describe("findDuplicateLocationIndex", () => {
  it("returns the index of the clashing row", () => {
    const list = [point(48.8584, 2.2945), point(40.7128, -74.006)];
    expect(findDuplicateLocationIndex(list, point(40.7128, -74.006))).toBe(1);
  });

  it("returns the first match when several rows clash", () => {
    const list = [point(40.7128, -74.006), point(40.71281, -74.00602)];
    expect(findDuplicateLocationIndex(list, point(40.7128, -74.006))).toBe(0);
  });

  it("returns -1 when nothing clashes", () => {
    expect(findDuplicateLocationIndex([point(48.8584, 2.2945)], point(0, 0))).toBe(-1);
  });

  it("returns -1 for an empty list", () => {
    expect(findDuplicateLocationIndex([], point(40.7128, -74.006))).toBe(-1);
  });
});
