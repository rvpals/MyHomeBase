import { describe, expect, it } from "vitest";
import { COLOR_THEMES } from "@/lib/settings";
import {
  CONTRAST_PAIRS,
  checkThemeContrast,
  contrastRatio,
  failingContrastPairs,
  parseHex,
  relativeLuminance,
} from "./contrast";

describe("parseHex", () => {
  it("reads a 6-digit hex color", () => {
    expect(parseHex("#1A2B3C")).toEqual({ r: 0x1a, g: 0x2b, b: 0x3c });
  });

  it("is case-insensitive and tolerates surrounding space", () => {
    expect(parseHex("  #aabbcc  ")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
  });

  it("refuses shorthand, other notations and junk", () => {
    // The value is interpolated into a CSS declaration, so anything that is not
    // #rrggbb has to be rejected rather than guessed at.
    expect(parseHex("#abc")).toBeUndefined();
    expect(parseHex("rgb(1,2,3)")).toBeUndefined();
    expect(parseHex("red")).toBeUndefined();
    expect(parseHex("#12345g")).toBeUndefined();
    expect(parseHex("")).toBeUndefined();
  });
});

describe("relativeLuminance", () => {
  it("puts black at 0 and white at 1", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("weights green above red above blue, per the sRGB coefficients", () => {
    const red = relativeLuminance("#FF0000")!;
    const green = relativeLuminance("#00FF00")!;
    const blue = relativeLuminance("#0000FF")!;
    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
    expect(green).toBeCloseTo(0.7152, 4);
  });

  it("is undefined for an unparseable color", () => {
    expect(relativeLuminance("nope")).toBeUndefined();
  });
});

describe("contrastRatio", () => {
  it("gives 21:1 for black on white", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 2);
  });

  it("gives 1:1 for a color against itself", () => {
    expect(contrastRatio("#3F5F7F", "#3F5F7F")).toBeCloseTo(1, 5);
  });

  it("does not depend on which color is named first", () => {
    const a = contrastRatio("#12161A", "#EEF2F3");
    const b = contrastRatio("#EEF2F3", "#12161A");
    expect(a).toBeCloseTo(b!, 10);
  });

  it("is undefined when either color is unparseable", () => {
    expect(contrastRatio("#000000", "chartreuse")).toBeUndefined();
    expect(contrastRatio("teal", "#FFFFFF")).toBeUndefined();
  });
});

describe("checkThemeContrast", () => {
  const tokens = COLOR_THEMES[0].tokens;

  it("reports every checked pair, passes included", () => {
    const findings = checkThemeContrast(tokens);
    expect(findings).toHaveLength(CONTRAST_PAIRS.length);
    expect(findings.every((finding) => finding.ratio > 0)).toBe(true);
  });

  it("flags body text that is nearly invisible", () => {
    const findings = checkThemeContrast({ ...tokens, ink: "#13171B" });
    const inkOnPaper = findings.find((finding) => finding.id === "ink-on-paper");
    expect(inkOnPaper?.fails).toBe(true);
  });

  it("passes body text on a legible page", () => {
    const findings = checkThemeContrast({ ...tokens, paper: "#000000", ink: "#FFFFFF" });
    const inkOnPaper = findings.find((finding) => finding.id === "ink-on-paper");
    expect(inkOnPaper?.fails).toBe(false);
    expect(inkOnPaper?.ratio).toBeCloseTo(21, 1);
  });

  it("omits a pair whose color will not parse rather than calling it a failure", () => {
    // An unparseable hex is a validation error the schema already reports. Reporting it
    // here too would mean two messages for one mistake.
    const findings = checkThemeContrast({ ...tokens, ink: "not-a-color" });
    expect(findings.some((finding) => finding.id === "ink-on-paper")).toBe(false);
    expect(findings.some((finding) => finding.id === "brass-on-paper")).toBe(true);
  });

  it("never flags an informational pair, however low it measures", () => {
    // `line` on `paper` is 1.1-1.5 in every shipped theme by design. If this starts
    // failing, the builder has begun warning about the app's own themes.
    const findings = checkThemeContrast(tokens);
    const line = findings.find((finding) => finding.id === "line-on-paper");
    expect(line?.ratio).toBeLessThan(3);
    expect(line?.fails).toBe(false);
  });

  it("holds every shipped theme's real text pairings to AA", () => {
    // A regression guard on the eight built-ins. These four are the pairings every
    // shipped theme was measured to satisfy; if one starts failing, either a theme
    // regressed or a threshold is wrong.
    const guarded = [
      "ink-on-paper",
      "ink-on-paper-raised",
      "brass-on-paper",
      "paper-on-brass",
    ];

    for (const theme of COLOR_THEMES) {
      const failures = failingContrastPairs(theme.tokens).map((finding) => finding.id);
      for (const id of guarded) {
        expect(failures, `${theme.name} fails ${id}`).not.toContain(id);
      }
    }
  });
});
