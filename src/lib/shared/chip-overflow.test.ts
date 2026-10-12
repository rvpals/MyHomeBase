import { describe, expect, it } from "vitest";
import { splitChipOverflow } from "./chip-overflow";

describe("splitChipOverflow", () => {
  it("shows everything and hides nothing when the list fits", () => {
    const result = splitChipOverflow(["Work", "Job"], 3);
    expect(result.shown).toEqual(["Work", "Job"]);
    expect(result.hidden).toEqual([]);
  });

  it("shows exactly the limit and hides nothing at the boundary", () => {
    // The off-by-one that would otherwise render a "+0" marker.
    const result = splitChipOverflow(["Work", "Job", "Liang"], 3);
    expect(result.shown).toHaveLength(3);
    expect(result.hidden).toEqual([]);
  });

  it("caps at the limit and hands the rest to the marker", () => {
    const result = splitChipOverflow(["Work", "Job", "Liang", "Ting", "Skylar"], 3);
    expect(result.shown).toEqual(["Work", "Job", "Liang"]);
    expect(result.hidden).toEqual(["Ting", "Skylar"]);
  });

  it("preserves the given order rather than sorting", () => {
    const result = splitChipOverflow(["Zeta", "Alpha", "Mu"], 2);
    expect(result.shown).toEqual(["Zeta", "Alpha"]);
  });

  it("returns two empty lists for an empty input", () => {
    const result = splitChipOverflow([], 3);
    expect(result.shown).toEqual([]);
    expect(result.hidden).toEqual([]);
  });

  it("still shows one item when the limit is zero or negative", () => {
    // A row hidden entirely behind a "+N" explains nothing, so the limit floors at 1.
    expect(splitChipOverflow(["Work", "Job"], 0).shown).toEqual(["Work"]);
    expect(splitChipOverflow(["Work", "Job"], -5).shown).toEqual(["Work"]);
    expect(splitChipOverflow(["Work", "Job"], 0).hidden).toEqual(["Job"]);
  });

  it("floors a fractional limit rather than slicing on it", () => {
    const result = splitChipOverflow(["Work", "Job", "Liang"], 2.9);
    expect(result.shown).toEqual(["Work", "Job"]);
    expect(result.hidden).toEqual(["Liang"]);
  });
});
