import { describe, expect, it } from "vitest";
import {
  DESKTOP_NAV_STYLES,
  DEFAULT_DESKTOP_NAV_STYLE,
  getDesktopNavStyle,
  resolveDesktopNavStyle,
} from "./desktop-nav-style";
import type { DesktopNavStyle } from "./types";

describe("DESKTOP_NAV_STYLES", () => {
  it("lists both shapes, with the default among them", () => {
    expect(DESKTOP_NAV_STYLES.map((style) => style.id)).toEqual(["tree", "horizontal"]);
    expect(DESKTOP_NAV_STYLES.some((style) => style.id === DEFAULT_DESKTOP_NAV_STYLE)).toBe(true);
  });

  it("gives every shape a label, a description and a stated trade", () => {
    DESKTOP_NAV_STYLES.forEach((style) => {
      expect(style.label.length).toBeGreaterThan(0);
      expect(style.description.length).toBeGreaterThan(0);
      expect(style.tradeoff.length).toBeGreaterThan(0);
    });
  });

  it("keeps ids and labels unique, so the account screen can key on either", () => {
    expect(new Set(DESKTOP_NAV_STYLES.map((style) => style.id)).size).toBe(
      DESKTOP_NAV_STYLES.length,
    );
    expect(new Set(DESKTOP_NAV_STYLES.map((style) => style.label)).size).toBe(
      DESKTOP_NAV_STYLES.length,
    );
  });

  it("states the trade the two shapes actually make: width against reach", () => {
    const tree = getDesktopNavStyle("tree");
    const horizontal = getDesktopNavStyle("horizontal");

    // The tree spends width and shows everything; the tabs spend none and don't.
    expect(tree.widthCost).toBeGreaterThan(horizontal.widthCost);
    expect(horizontal.widthCost).toBe(0);
    expect(tree.allModulesVisible).toBe(true);
    expect(horizontal.allModulesVisible).toBe(false);
  });
});

describe("resolveDesktopNavStyle", () => {
  it("accepts every id in the catalogue", () => {
    DESKTOP_NAV_STYLES.forEach((style) => {
      expect(resolveDesktopNavStyle(style.id)).toBe(style.id);
    });
  });

  it("falls back to the default for an unknown, empty or missing value", () => {
    // Navigation has to render whatever is stored — a hand-edited row must not
    // be able to break the one surface that reaches the screen which would fix it.
    expect(resolveDesktopNavStyle("sideways")).toBe(DEFAULT_DESKTOP_NAV_STYLE);
    expect(resolveDesktopNavStyle("")).toBe(DEFAULT_DESKTOP_NAV_STYLE);
    expect(resolveDesktopNavStyle(undefined)).toBe(DEFAULT_DESKTOP_NAV_STYLE);
  });

  it("defaults to the tree, so the preference ships changing nothing", () => {
    expect(DEFAULT_DESKTOP_NAV_STYLE).toBe("tree");
  });
});

describe("getDesktopNavStyle", () => {
  it("returns the catalogue entry for an id", () => {
    expect(getDesktopNavStyle("horizontal").label).toBe("Top tabs");
    expect(getDesktopNavStyle("tree").label).toBe("Side tree");
  });

  it("stays total for a value that arrived through a cast", () => {
    // Unreachable via the type, but reachable from parsed JSON or a cast.
    expect(getDesktopNavStyle("nonsense" as DesktopNavStyle)).toBe(DESKTOP_NAV_STYLES[0]);
  });
});
