import { describe, expect, it } from "vitest";
import {
  MalformedCipherTextError,
  WrongPasswordError,
  decryptEntryText,
  encryptEntryText,
  isEncryptedBlob,
} from "./encryption";

const PASSWORD = "correct horse battery staple";

describe("encryptEntryText / decryptEntryText", () => {
  it("round-trips text through a password", () => {
    const blob = encryptEntryText("Dinner with Sam", PASSWORD);
    expect(decryptEntryText(blob, PASSWORD)).toBe("Dinner with Sam");
  });

  it("round-trips multi-line prose, unicode and punctuation", () => {
    const prose = "Line one — with an em dash.\n\nLine two: café, naïve, 🔒\nTabs\there.";
    const blob = encryptEntryText(prose, PASSWORD);
    expect(decryptEntryText(blob, PASSWORD)).toBe(prose);
  });

  it("round-trips the empty string rather than short-circuiting it", () => {
    // An untitled entry must not be distinguishable on disk from a titled one.
    const blob = encryptEntryText("", PASSWORD);
    expect(blob).not.toBe("");
    expect(decryptEntryText(blob, PASSWORD)).toBe("");
  });

  it("writes the v1 five-field shape, all hex", () => {
    const blob = encryptEntryText("hello", PASSWORD);
    const parts = blob.split(":");
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe("v1");
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/); // 16-byte salt
    expect(parts[2]).toMatch(/^[0-9a-f]{24}$/); // 12-byte IV
    expect(parts[3]).toMatch(/^[0-9a-f]{32}$/); // 16-byte tag
    expect(parts[4]).toMatch(/^[0-9a-f]+$/);
  });

  it("produces a different blob every time, even for identical input", () => {
    // Fresh salt and IV per call. Equal blobs here would mean a reused IV, which
    // under one key leaks the XOR of the two plaintexts.
    const first = encryptEntryText("same text", PASSWORD);
    const second = encryptEntryText("same text", PASSWORD);
    expect(first).not.toBe(second);
    expect(decryptEntryText(first, PASSWORD)).toBe("same text");
    expect(decryptEntryText(second, PASSWORD)).toBe("same text");
  });

  it("never repeats a salt or an IV across many encryptions", () => {
    const salts = new Set<string>();
    const ivs = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const [, salt, iv] = encryptEntryText("text", PASSWORD).split(":");
      salts.add(salt as string);
      ivs.add(iv as string);
    }
    expect(salts.size).toBe(200);
    expect(ivs.size).toBe(200);
  });

  it("refuses to encrypt with an empty password", () => {
    expect(() => encryptEntryText("text", "")).toThrow();
  });

  it("lets two entries share one password without sharing a key", () => {
    const a = encryptEntryText("entry A", PASSWORD);
    const b = encryptEntryText("entry B", PASSWORD);
    expect(a.split(":")[1]).not.toBe(b.split(":")[1]);
    expect(decryptEntryText(a, PASSWORD)).toBe("entry A");
    expect(decryptEntryText(b, PASSWORD)).toBe("entry B");
  });
});

describe("decryptEntryText failures", () => {
  it("throws WrongPasswordError for the wrong password", () => {
    const blob = encryptEntryText("secret", PASSWORD);
    expect(() => decryptEntryText(blob, "wrong password")).toThrow(WrongPasswordError);
  });

  it("throws WrongPasswordError for an empty password", () => {
    const blob = encryptEntryText("secret", PASSWORD);
    expect(() => decryptEntryText(blob, "")).toThrow(WrongPasswordError);
  });

  it("throws WrongPasswordError when the ciphertext was altered", () => {
    const blob = encryptEntryText("secret", PASSWORD);
    const parts = blob.split(":");
    const ciphertext = parts[4] as string;
    // Flip one hex digit of the payload.
    const flipped = (ciphertext[0] === "a" ? "b" : "a") + ciphertext.slice(1);
    parts[4] = flipped;
    expect(() => decryptEntryText(parts.join(":"), PASSWORD)).toThrow(WrongPasswordError);
  });

  it("throws WrongPasswordError when the auth tag was altered", () => {
    const blob = encryptEntryText("secret", PASSWORD);
    const parts = blob.split(":");
    const tag = parts[3] as string;
    parts[3] = (tag[0] === "a" ? "b" : "a") + tag.slice(1);
    expect(() => decryptEntryText(parts.join(":"), PASSWORD)).toThrow(WrongPasswordError);
  });

  it("throws WrongPasswordError when the IV was swapped for another valid one", () => {
    const blob = encryptEntryText("secret", PASSWORD);
    const other = encryptEntryText("secret", PASSWORD);
    const parts = blob.split(":");
    parts[2] = other.split(":")[2] as string;
    expect(() => decryptEntryText(parts.join(":"), PASSWORD)).toThrow(WrongPasswordError);
  });

  it.each([
    ["too few fields", "v1:aabb:ccdd:eeff"],
    ["too many fields", "v1:aa:bb:cc:dd:ee"],
    ["an unknown version", "v2:aabb:ccdd:eeff:0011"],
    ["empty string", ""],
    ["plain text", "not encrypted at all"],
    ["non-hex salt", "v1:zzzz:ccdd:eeff:0011"],
  ])("throws MalformedCipherTextError for %s", (_label, blob) => {
    expect(() => decryptEntryText(blob, PASSWORD)).toThrow(MalformedCipherTextError);
  });

  it("throws MalformedCipherTextError when the salt is the wrong width", () => {
    const blob = encryptEntryText("secret", PASSWORD);
    const parts = blob.split(":");
    parts[1] = "aabb"; // 2 bytes, not 16
    expect(() => decryptEntryText(parts.join(":"), PASSWORD)).toThrow(MalformedCipherTextError);
  });
});

describe("isEncryptedBlob", () => {
  it("recognises what encryptEntryText writes", () => {
    expect(isEncryptedBlob(encryptEntryText("x", PASSWORD))).toBe(true);
  });

  it.each([
    ["an empty column", ""],
    ["plain prose", "Dinner with Sam"],
    ["prose containing colons", "09:30 — met Sam: we talked:about:things"],
    ["a wrong version", "v2:aa:bb:cc:dd"],
  ])("rejects %s", (_label, value) => {
    expect(isEncryptedBlob(value)).toBe(false);
  });
});
