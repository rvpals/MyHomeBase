import { describe, expect, it } from "vitest";
import {
  COMPACT_NAV_STYLES,
  DEFAULT_COMPACT_NAV_STYLE,
  getCompactNavStyle,
  resolveCompactNavStyle,
} from "./nav-style";
import type { CompactNavStyle } from "./types";

describe("COMPACT_NAV_STYLES", () => {
  it("offers both styles, with the default among them", () => {
    expect(COMPACT_NAV_STYLES.map((style) => style.id)).toEqual(["drill-in", "segmented"]);
    expect(COMPACT_NAV_STYLES.some((style) => style.id === DEFAULT_COMPACT_NAV_STYLE)).toBe(true);
  });

  it("describes every style well enough to choose without trying it", () => {
    COMPACT_NAV_STYLES.forEach((style) => {
      expect(style.label.length).toBeGreaterThan(0);
      expect(style.description.length).toBeGreaterThan(0);
      expect(style.tradeoff.length).toBeGreaterThan(0);
    });
  });

  it("uses unique ids and labels, so neither the store nor the picker is ambiguous", () => {
    expect(new Set(COMPACT_NAV_STYLES.map((style) => style.id)).size).toBe(
      COMPACT_NAV_STYLES.length,
    );
    expect(new Set(COMPACT_NAV_STYLES.map((style) => style.label)).size).toBe(
      COMPACT_NAV_STYLES.length,
    );
  });

  it("agrees with design.md that sections cost two taps in both styles", () => {
    // The whole premise of offering a choice: section switching is equally cheap,
    // so the only real difference is the cost of switching module.
    COMPACT_NAV_STYLES.forEach((style) => {
      expect(style.tapsToSection).toBe(2);
    });
    expect(getCompactNavStyle("drill-in").tapsToModule).toBe(3);
    expect(getCompactNavStyle("segmented").tapsToModule).toBe(2);
  });
});

describe("resolveCompactNavStyle", () => {
  it("accepts each known style unchanged", () => {
    expect(resolveCompactNavStyle("drill-in")).toBe("drill-in");
    expect(resolveCompactNavStyle("segmented")).toBe("segmented");
  });

  it("falls back to the default for a missing row", () => {
    expect(resolveCompactNavStyle(undefined)).toBe(DEFAULT_COMPACT_NAV_STYLE);
  });

  it("falls back to the default rather than throwing on a garbled value", () => {
    // Navigation is the surface a reader needs in order to reach the screen that
    // would fix a bad preference, so this must never be able to throw.
    expect(resolveCompactNavStyle("")).toBe(DEFAULT_COMPACT_NAV_STYLE);
    expect(resolveCompactNavStyle("bottom-tabs")).toBe(DEFAULT_COMPACT_NAV_STYLE);
    expect(resolveCompactNavStyle("DRILL-IN")).toBe(DEFAULT_COMPACT_NAV_STYLE);
  });
});

describe("getCompactNavStyle", () => {
  it("returns the catalogue entry for a style", () => {
    expect(getCompactNavStyle("segmented").label).toBe("Split bar");
  });

  it("stays total for a value that escaped the type", () => {
    expect(getCompactNavStyle("nope" as CompactNavStyle).id).toBe(COMPACT_NAV_STYLES[0].id);
  });
});
