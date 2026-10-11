import { describe, expect, it } from "vitest";
import { helloWorldSettingsInputSchema } from "./schema";
import { MAX_INTERVAL_COUNT, MAX_MESSAGE_LENGTH } from "./types";

const valid = {
  enabled: true,
  message: "Hello, world!",
  intervalCount: 5,
  intervalUnit: "minute",
};

describe("helloWorldSettingsInputSchema", () => {
  it("accepts a valid form", () => {
    expect(helloWorldSettingsInputSchema.parse(valid)).toEqual(valid);
  });

  it("coerces the count from the string a number input produces", () => {
    const parsed = helloWorldSettingsInputSchema.parse({ ...valid, intervalCount: "12" });
    expect(parsed.intervalCount).toBe(12);
  });

  it("trims the message", () => {
    const parsed = helloWorldSettingsInputSchema.parse({ ...valid, message: "  hi  " });
    expect(parsed.message).toBe("hi");
  });

  it("rejects a blank message", () => {
    expect(() => helloWorldSettingsInputSchema.parse({ ...valid, message: "   " })).toThrow();
  });

  it("rejects an over-long message", () => {
    expect(() =>
      helloWorldSettingsInputSchema.parse({
        ...valid,
        message: "x".repeat(MAX_MESSAGE_LENGTH + 1),
      }),
    ).toThrow();
  });

  it("rejects a zero, negative or fractional count", () => {
    for (const intervalCount of [0, -1, 1.5]) {
      expect(() => helloWorldSettingsInputSchema.parse({ ...valid, intervalCount })).toThrow();
    }
  });

  it("rejects a count past the cap", () => {
    expect(() =>
      helloWorldSettingsInputSchema.parse({ ...valid, intervalCount: MAX_INTERVAL_COUNT + 1 }),
    ).toThrow();
  });

  it("rejects an unknown unit", () => {
    expect(() =>
      helloWorldSettingsInputSchema.parse({ ...valid, intervalUnit: "fortnight" }),
    ).toThrow();
  });

  it("rejects a non-boolean switch rather than coercing it", () => {
    expect(() => helloWorldSettingsInputSchema.parse({ ...valid, enabled: "true" })).toThrow();
  });
});
