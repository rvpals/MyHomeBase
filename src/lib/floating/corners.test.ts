import { describe, expect, it } from "vitest";
import {
  DEFAULT_PUCK_CORNER,
  PUCK_CORNERS,
  isPuckCorner,
  puckCornerKey,
  puckCornerKeyFor,
  resolvePuckCorner,
  resolvePuckCorners,
} from "./corners";
import { FLOATING_COMPONENTS } from "./registry";

describe("PUCK_CORNERS", () => {
  it("offers all four corners with no duplicates", () => {
    const ids = PUCK_CORNERS.map((corner) => corner.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it("gives every corner a label for the preference UI", () => {
    for (const corner of PUCK_CORNERS) {
      expect(corner.label.length, corner.id).toBeGreaterThan(0);
    }
  });

  it("defaults to bottom-right, where the pucks have always gone", () => {
    expect(DEFAULT_PUCK_CORNER).toBe("bottom-right");
    expect(isPuckCorner(DEFAULT_PUCK_CORNER)).toBe(true);
  });

  it("guards a stored corner", () => {
    expect(isPuckCorner("top-left")).toBe(true);
    expect(isPuckCorner("middle")).toBe(false);
    expect(isPuckCorner("")).toBe(false);
  });
});

describe("resolvePuckCorner", () => {
  it("reads a stored corner", () => {
    expect(resolvePuckCorner("top-right")).toBe("top-right");
  });

  it("defaults when nothing is stored", () => {
    expect(resolvePuckCorner(undefined)).toBe(DEFAULT_PUCK_CORNER);
    expect(resolvePuckCorner("")).toBe(DEFAULT_PUCK_CORNER);
  });

  it("clamps a retired corner rather than throwing", () => {
    // Read on every authenticated page, so a stale row must degrade instead of
    // failing to render the layer.
    expect(resolvePuckCorner("centre")).toBe(DEFAULT_PUCK_CORNER);
  });

  it("tolerates whitespace", () => {
    expect(resolvePuckCorner("  bottom-left  ")).toBe("bottom-left");
  });
});

describe("resolvePuckCorners", () => {
  it("returns a full record so callers never check for a missing row", () => {
    const corners = resolvePuckCorners(new Map());
    for (const component of FLOATING_COMPONENTS) {
      expect(corners[component.id], component.id).toBe(DEFAULT_PUCK_CORNER);
    }
  });

  it("reads each component's corner independently", () => {
    const rows = new Map([[puckCornerKey("clock"), "top-left"]]);
    const corners = resolvePuckCorners(rows);
    expect(corners.clock).toBe("top-left");
    // The calculator has no row, so it stays on the default rather than following.
    expect(corners.calculator).toBe(DEFAULT_PUCK_CORNER);
  });
});

describe("puckCornerKey", () => {
  it("namespaces the key per component", () => {
    expect(puckCornerKey("clock")).toBe("floating_corner_clock");
    expect(puckCornerKey("calculator")).toBe("floating_corner_calculator");
  });

  it("returns undefined for an id that is not a floating component", () => {
    expect(puckCornerKeyFor("clock")).toBe("floating_corner_clock");
    expect(puckCornerKeyFor("nonsense")).toBeUndefined();
  });
});
