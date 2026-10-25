import { describe, expect, it } from "vitest";
import { splitTabs } from "./tab-overflow";

/**
 * Deliberately a richer type than `TabCandidate`, and deliberately NOT annotated
 * as one: the fixture stands in for `TreeModule`, and the point of the generic is
 * that a caller's own fields survive. Annotating these as `TabCandidate` would
 * erase `label` and hide exactly the regression that broke the build.
 */
interface TestModule {
  slug: string;
  label: string;
}

const MODULES: TestModule[] = [
  { slug: "investments", label: "Investments" },
  { slug: "journal", label: "Journal" },
  { slug: "csv-analysis", label: "CSV Analysis" },
  { slug: "expense", label: "Expense" },
  { slug: "classroom", label: "Classroom" },
  { slug: "clips", label: "Clips" },
];

const slugs = (modules: TestModule[]) => modules.map((module) => module.slug);

describe("splitTabs", () => {
  it("shows everything and offers no menu when the row fits", () => {
    const split = splitTabs(MODULES, 6, "journal");
    expect(slugs(split.visible)).toEqual(slugs(MODULES));
    expect(split.overflow).toEqual([]);
  });

  it("shows everything when the row is wider than the module list", () => {
    const split = splitTabs(MODULES, 99, "journal");
    expect(split.visible).toHaveLength(MODULES.length);
    expect(split.overflow).toEqual([]);
  });

  it("keeps the caller's order rather than re-sorting", () => {
    const split = splitTabs(MODULES, 3, "investments");
    expect(slugs(split.visible)).toEqual(["investments", "journal", "csv-analysis"]);
    expect(slugs(split.overflow)).toEqual(["expense", "classroom", "clips"]);
  });

  it("pulls an overflowed active module into the row", () => {
    // Classroom sits at index 4 — past a capacity of 3 — so it would be hidden.
    const split = splitTabs(MODULES, 3, "classroom");
    expect(slugs(split.visible)).toContain("classroom");
    expect(slugs(split.overflow)).not.toContain("classroom");
  });

  it("swaps the active module into the LAST slot, so earlier tabs don't shift", () => {
    const split = splitTabs(MODULES, 3, "clips");
    // The first two tabs are untouched; only the third changed.
    expect(slugs(split.visible)).toEqual(["investments", "journal", "clips"]);
    // The tab it displaced took its place in the menu rather than vanishing.
    expect(slugs(split.overflow)).toContain("csv-analysis");
    expect(split.visible.length + split.overflow.length).toBe(MODULES.length);
  });

  it("leaves the row alone when the active module already fits", () => {
    const split = splitTabs(MODULES, 3, "journal");
    expect(slugs(split.visible)).toEqual(["investments", "journal", "csv-analysis"]);
  });

  it("drops no module, whatever the capacity", () => {
    for (let capacity = -2; capacity <= 8; capacity += 1) {
      const split = splitTabs(MODULES, capacity, "classroom");
      expect([...slugs(split.visible), ...slugs(split.overflow)].sort()).toEqual(
        slugs(MODULES).sort(),
      );
    }
  });

  it("still draws one tab when measured at zero or negative width", () => {
    // A row measured before layout, or inside a hidden container.
    expect(splitTabs(MODULES, 0, "journal").visible).toHaveLength(1);
    expect(splitTabs(MODULES, -5, "journal").visible).toHaveLength(1);
  });

  it("shows the active module even in the single-tab case", () => {
    const split = splitTabs(MODULES, 0, "clips");
    expect(slugs(split.visible)).toEqual(["clips"]);
  });

  it("handles a fractional capacity by flooring it", () => {
    expect(splitTabs(MODULES, 3.9, "journal").visible).toHaveLength(3);
  });

  it("returns empty for an empty module list", () => {
    expect(splitTabs([], 5, "journal")).toEqual({ visible: [], overflow: [] });
  });

  it("works with no active module at all", () => {
    const split = splitTabs(MODULES, 2, undefined);
    expect(slugs(split.visible)).toEqual(["investments", "journal"]);
    expect(split.overflow).toHaveLength(4);
  });

  it("ignores an active slug that matches no module", () => {
    const split = splitTabs(MODULES, 2, "nonexistent");
    expect(slugs(split.visible)).toEqual(["investments", "journal"]);
    expect(split.overflow).toHaveLength(4);
  });

  it("hands back the caller's own objects, with their extra fields intact", () => {
    // The regression this guards: when `TabCandidate` demanded a `label` that
    // `TreeModule` spells `name`, the generic stopped binding and every result
    // narrowed to `{ slug }` — so the tab row had no name or icon left to draw.
    const split = splitTabs(MODULES, 3, "clips");
    expect(split.visible.every((module) => typeof module.label === "string")).toBe(true);
    expect(split.overflow.every((module) => typeof module.label === "string")).toBe(true);
    // Identity, not just shape: nothing is copied or rebuilt on the way through.
    expect(split.visible[0]).toBe(MODULES[0]);
  });

  it("does not mutate the caller's array", () => {
    const original = slugs(MODULES);
    splitTabs(MODULES, 2, "clips");
    expect(slugs(MODULES)).toEqual(original);
  });
});
