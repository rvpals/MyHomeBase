import { describe, expect, it } from "vitest";

import {
  MAX_ID_LENGTH,
  QR_PAYLOAD_PREFIX,
  decodeStudentIdPayload,
  encodeStudentIdPayload,
} from "./qr-identity";

describe("encodeStudentIdPayload", () => {
  it("prefixes the id so a foreign QR can be told apart from ours", () => {
    expect(encodeStudentIdPayload("20194")).toBe(`${QR_PAYLOAD_PREFIX}20194`);
  });

  it("keeps non-digit ids intact, unlike the bubble grid it replaced", () => {
    // The grid could only hold digits, so "S-2019" and "2019" encoded identically.
    // A QR has no such limit, and two students whose ids differ only by a letter
    // must not collide.
    expect(encodeStudentIdPayload("S-2019")).toBe(`${QR_PAYLOAD_PREFIX}S-2019`);
    expect(encodeStudentIdPayload("S-2019")).not.toBe(encodeStudentIdPayload("2019"));
  });

  it("trims surrounding whitespace from a hand-typed roster", () => {
    expect(encodeStudentIdPayload("  20194  ")).toBe(`${QR_PAYLOAD_PREFIX}20194`);
  });

  it("returns undefined for an empty id, meaning print no QR at all", () => {
    expect(encodeStudentIdPayload("")).toBeUndefined();
    expect(encodeStudentIdPayload("   ")).toBeUndefined();
  });

  it("refuses an id too long to stay readable at the printed size", () => {
    expect(encodeStudentIdPayload("x".repeat(MAX_ID_LENGTH))).toBeDefined();
    expect(encodeStudentIdPayload("x".repeat(MAX_ID_LENGTH + 1))).toBeUndefined();
  });
});

describe("decodeStudentIdPayload", () => {
  it("round-trips an encoded id", () => {
    const payload = encodeStudentIdPayload("20194");
    expect(decodeStudentIdPayload(payload)).toBe("20194");
  });

  it("round-trips an id with punctuation", () => {
    const payload = encodeStudentIdPayload("S-2019");
    expect(decodeStudentIdPayload(payload)).toBe("S-2019");
  });

  it("rejects a QR that is not ours rather than reading it as an id", () => {
    // A reused sheet with a library sticker, or a shipping label in frame.
    expect(decodeStudentIdPayload("https://example.com/book/20194")).toBeUndefined();
    expect(decodeStudentIdPayload("20194")).toBeUndefined();
  });

  it("rejects a prefix with nothing after it", () => {
    expect(decodeStudentIdPayload(QR_PAYLOAD_PREFIX)).toBeUndefined();
    expect(decodeStudentIdPayload(`${QR_PAYLOAD_PREFIX}   `)).toBeUndefined();
  });

  it("returns undefined when nothing decoded", () => {
    expect(decodeStudentIdPayload(undefined)).toBeUndefined();
    expect(decodeStudentIdPayload("")).toBeUndefined();
  });

  it("rejects an over-long id even if it carries our prefix", () => {
    const tooLong = `${QR_PAYLOAD_PREFIX}${"x".repeat(MAX_ID_LENGTH + 1)}`;
    expect(decodeStudentIdPayload(tooLong)).toBeUndefined();
  });
});
