import { describe, expect, it } from "vitest";
import { getModuleCode } from "./format";

describe("getModuleCode", () => {
  it("takes the first letter of each hyphen-separated word, capped at 3", () => {
    expect(getModuleCode("real-estate-investment")).toBe("REI");
  });

  it("handles a single-word slug", () => {
    expect(getModuleCode("finance")).toBe("F");
  });

  it("falls back to a placeholder for an empty slug", () => {
    expect(getModuleCode("")).toBe("?");
  });
});
