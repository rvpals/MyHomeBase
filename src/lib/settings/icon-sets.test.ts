import { describe, expect, it } from "vitest";
import { DEFAULT_ICON_SET_ID, ICON_SETS, getIconSet } from "./icon-sets";

describe("getIconSet", () => {
  it("returns the matching set by id", () => {
    expect(getIconSet("lucide").name).toBe("Lucide");
    expect(getIconSet("fluent-3d").colorful).toBe(true);
    expect(getIconSet("solar-bold-duotone").colorful).toBe(false);
  });

  it("falls back to the first set for an unknown id", () => {
    expect(getIconSet("does-not-exist")).toBe(ICON_SETS[0]);
  });

  it("exposes the default id as a real set", () => {
    expect(ICON_SETS.some((set) => set.id === DEFAULT_ICON_SET_ID)).toBe(true);
  });
});
