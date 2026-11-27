import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampPan,
  clampZoom,
  stepZoom,
  wheelZoom,
  zoomPercentLabel,
} from "./zoom";

describe("stepZoom", () => {
  it("steps along the ladder in both directions", () => {
    expect(stepZoom(1, "in")).toBe(1.5);
    expect(stepZoom(1.5, "in")).toBe(2);
    expect(stepZoom(2, "out")).toBe(1.5);
  });

  it("snaps an off-ladder value onto the next listed step", () => {
    expect(stepZoom(2.37, "in")).toBe(3);
    expect(stepZoom(2.37, "out")).toBe(2);
  });

  it("stops at the limits rather than overshooting", () => {
    expect(stepZoom(MAX_ZOOM, "in")).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, "out")).toBe(MIN_ZOOM);
  });
});

describe("clampZoom and wheelZoom", () => {
  it("keeps values in range and survives garbage", () => {
    expect(clampZoom(0.2)).toBe(MIN_ZOOM);
    expect(clampZoom(50)).toBe(MAX_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(MIN_ZOOM);
  });

  it("zooms in on scroll-up and never below fit", () => {
    expect(wheelZoom(1, -100)).toBeGreaterThan(1);
    expect(wheelZoom(1, 100)).toBe(MIN_ZOOM);
  });
});

describe("clampPan", () => {
  const size = { width: 400, height: 300 };

  it("pins the picture at fit-to-stage", () => {
    expect(clampPan({ x: 120, y: -80 }, 1, size)).toEqual({ x: 0, y: 0 });
  });

  it("allows dragging up to the overhang and no further", () => {
    // Zoom 2: the picture overhangs by 200 horizontally and 150 vertically.
    expect(clampPan({ x: 150, y: -100 }, 2, size)).toEqual({ x: 150, y: -100 });
    expect(clampPan({ x: 999, y: -999 }, 2, size)).toEqual({ x: 200, y: -150 });
  });
});

describe("zoomPercentLabel", () => {
  it("rounds to a whole percentage", () => {
    expect(zoomPercentLabel(1)).toBe("100%");
    expect(zoomPercentLabel(1.234)).toBe("123%");
  });
});
