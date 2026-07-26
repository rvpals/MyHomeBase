import { describe, expect, it } from "vitest";
import { secureCompare } from "./secret";

describe("secureCompare", () => {
  it("returns true for identical strings", () => {
    expect(secureCompare("the-secret", "the-secret")).toBe(true);
  });

  it("returns false for different strings", () => {
    expect(secureCompare("the-secret", "wrong")).toBe(false);
  });

  it("returns false for strings of different lengths without throwing", () => {
    expect(secureCompare("short", "a-much-longer-secret")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(secureCompare("", "")).toBe(true);
  });
});
