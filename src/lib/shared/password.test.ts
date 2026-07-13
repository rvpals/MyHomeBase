import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("hashPassword / verifyPassword", () => {
  it("verifies the correct password against its hash", () => {
    const hash = hashPassword("correct-horse-battery-staple");
    expect(verifyPassword("correct-horse-battery-staple", hash)).toBe(true);
  });

  it("rejects an incorrect password", () => {
    const hash = hashPassword("correct-horse-battery-staple");
    expect(verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("produces a different hash for the same password on each call (random salt)", () => {
    const first = hashPassword("same-password");
    const second = hashPassword("same-password");
    expect(first).not.toBe(second);
    expect(verifyPassword("same-password", first)).toBe(true);
    expect(verifyPassword("same-password", second)).toBe(true);
  });

  it("rejects a malformed stored hash", () => {
    expect(verifyPassword("anything", "not-a-valid-hash")).toBe(false);
  });
});
