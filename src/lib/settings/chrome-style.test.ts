import { describe, expect, it } from "vitest";
import {
  CHROME_STYLES,
  DEFAULT_CHROME_STYLE,
  getChromeStyle,
  resolveChromeStyle,
} from "./chrome-style";
import type { ChromeStyle } from "./types";

describe("CHROME_STYLES", () => {
  it("lists the four styles the admin screen and globals.css agree on", () => {
    expect(CHROME_STYLES.map((style) => style.id)).toEqual([
      "current",
      "inset",
      "outset",
      "emboss",
    ]);
  });

  it("includes the default", () => {
    expect(CHROME_STYLES.some((style) => style.id === DEFAULT_CHROME_STYLE)).toBe(true);
  });

  it("gives every style a label, a description and a tradeoff", () => {
    CHROME_STYLES.forEach((style) => {
      expect(style.label.length).toBeGreaterThan(0);
      expect(style.description.length).toBeGreaterThan(0);
      expect(style.tradeoff.length).toBeGreaterThan(0);
    });
  });

  it("keeps ids and labels unique", () => {
    expect(new Set(CHROME_STYLES.map((style) => style.id)).size).toBe(CHROME_STYLES.length);
    expect(new Set(CHROME_STYLES.map((style) => style.label)).size).toBe(CHROME_STYLES.length);
  });
});

describe("resolveChromeStyle", () => {
  it("passes through every known id", () => {
    CHROME_STYLES.forEach((style) => {
      expect(resolveChromeStyle(style.id)).toBe(style.id);
    });
  });

  // The failure path that matters: a settings row holding anything else must not
  // be able to break the header and the tree, since those are how a reader
  // reaches the screen that would fix it.
  it("falls back to the default for a missing, blank, unknown or miscased value", () => {
    expect(resolveChromeStyle(undefined)).toBe(DEFAULT_CHROME_STYLE);
    expect(resolveChromeStyle("")).toBe(DEFAULT_CHROME_STYLE);
    expect(resolveChromeStyle("bevelled")).toBe(DEFAULT_CHROME_STYLE);
    expect(resolveChromeStyle("Inset")).toBe(DEFAULT_CHROME_STYLE);
    expect(resolveChromeStyle("OUTSET")).toBe(DEFAULT_CHROME_STYLE);
  });
});

describe("getChromeStyle", () => {
  it("returns the catalogue entry for an id", () => {
    expect(getChromeStyle("inset").label).toBe("Inset");
    expect(getChromeStyle("emboss").label).toBe("Emboss");
  });

  it("stays total for a value that reached it past the type", () => {
    expect(getChromeStyle("nonsense" as ChromeStyle).id).toBe(CHROME_STYLES[0].id);
  });
});
