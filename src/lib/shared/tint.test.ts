import { describe, expect, it } from "vitest";
import { TINT_COLORS, tintColorSchema, toTintColor } from "./tint";

describe("tintColorSchema", () => {
  it("accepts every palette key and the blank default", () => {
    for (const key of TINT_COLORS) expect(tintColorSchema.parse(key)).toBe(key);
    expect(tintColorSchema.parse("")).toBe("");
    expect(tintColorSchema.parse(undefined)).toBe("");
  });

  it("rejects a key outside the palette, and a hex value", () => {
    expect(tintColorSchema.safeParse("teal").success).toBe(false);
    expect(tintColorSchema.safeParse("#e11d48").success).toBe(false);
  });
});

describe("toTintColor", () => {
  it("passes a palette key through", () => {
    expect(toTintColor("ocean")).toBe("ocean");
  });

  it("reads null, undefined and unknown keys as no colour", () => {
    expect(toTintColor(null)).toBe("");
    expect(toTintColor(undefined)).toBe("");
    expect(toTintColor("chartreuse")).toBe("");
  });
});
