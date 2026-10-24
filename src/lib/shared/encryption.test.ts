import { describe, expect, it } from "vitest";
import {
  MalformedCipherTextError,
  WrongPasswordError,
  decryptText,
  encryptText,
  isEncryptedBlob,
} from "./encryption";

const PASSWORD = "correct horse battery staple";

describe("encryptText / decryptText", () => {
  it("round-trips text through a password", () => {
    const blob = encryptText("Dinner with Sam", PASSWORD);
    expect(decryptText(blob, PASSWORD)).toBe("Dinner with Sam");
  });

  it("round-trips multi-line prose, unicode and punctuation", () => {
    const prose = "Line one — with an em dash.\n\nLine two: café, naïve, 🔒\nTabs\there.";
    const blob = encryptText(prose, PASSWORD);
    expect(decryptText(blob, PASSWORD)).toBe(prose);
  });

  it("round-trips the empty string rather than short-circuiting it", () => {
    // An untitled entry must not be distinguishable on disk from a titled one.
    const blob = encryptText("", PASSWORD);
    expect(blob).not.toBe("");
    expect(decryptText(blob, PASSWORD)).toBe("");
  });

  it("writes the v1 five-field shape, all hex", () => {
    const blob = encryptText("hello", PASSWORD);
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
    const first = encryptText("same text", PASSWORD);
    const second = encryptText("same text", PASSWORD);
    expect(first).not.toBe(second);
    expect(decryptText(first, PASSWORD)).toBe("same text");
    expect(decryptText(second, PASSWORD)).toBe("same text");
  });

  // 20s: this runs scryptSync 200 times, and scrypt is slow BY DESIGN (N=16384).
  // ~9s on a dev machine, which overruns vitest's 5s default. The loop count is the
  // point of the test, so the timeout moves rather than the loop.
  it("never repeats a salt or an IV across many encryptions", { timeout: 20_000 }, () => {
    const salts = new Set<string>();
    const ivs = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const [, salt, iv] = encryptText("text", PASSWORD).split(":");
      salts.add(salt as string);
      ivs.add(iv as string);
    }
    expect(salts.size).toBe(200);
    expect(ivs.size).toBe(200);
  });

  it("refuses to encrypt with an empty password", () => {
    expect(() => encryptText("text", "")).toThrow();
  });

  it("lets two entries share one password without sharing a key", () => {
    const a = encryptText("entry A", PASSWORD);
    const b = encryptText("entry B", PASSWORD);
    expect(a.split(":")[1]).not.toBe(b.split(":")[1]);
    expect(decryptText(a, PASSWORD)).toBe("entry A");
    expect(decryptText(b, PASSWORD)).toBe("entry B");
  });
});

describe("decryptText failures", () => {
  it("throws WrongPasswordError for the wrong password", () => {
    const blob = encryptText("secret", PASSWORD);
    expect(() => decryptText(blob, "wrong password")).toThrow(WrongPasswordError);
  });

  it("throws WrongPasswordError for an empty password", () => {
    const blob = encryptText("secret", PASSWORD);
    expect(() => decryptText(blob, "")).toThrow(WrongPasswordError);
  });

  it("throws WrongPasswordError when the ciphertext was altered", () => {
    const blob = encryptText("secret", PASSWORD);
    const parts = blob.split(":");
    const ciphertext = parts[4] as string;
    // Flip one hex digit of the payload.
    const flipped = (ciphertext[0] === "a" ? "b" : "a") + ciphertext.slice(1);
    parts[4] = flipped;
    expect(() => decryptText(parts.join(":"), PASSWORD)).toThrow(WrongPasswordError);
  });

  it("throws WrongPasswordError when the auth tag was altered", () => {
    const blob = encryptText("secret", PASSWORD);
    const parts = blob.split(":");
    const tag = parts[3] as string;
    parts[3] = (tag[0] === "a" ? "b" : "a") + tag.slice(1);
    expect(() => decryptText(parts.join(":"), PASSWORD)).toThrow(WrongPasswordError);
  });

  it("throws WrongPasswordError when the IV was swapped for another valid one", () => {
    const blob = encryptText("secret", PASSWORD);
    const other = encryptText("secret", PASSWORD);
    const parts = blob.split(":");
    parts[2] = other.split(":")[2] as string;
    expect(() => decryptText(parts.join(":"), PASSWORD)).toThrow(WrongPasswordError);
  });

  it.each([
    ["too few fields", "v1:aabb:ccdd:eeff"],
    ["too many fields", "v1:aa:bb:cc:dd:ee"],
    ["an unknown version", "v2:aabb:ccdd:eeff:0011"],
    ["empty string", ""],
    ["plain text", "not encrypted at all"],
    ["non-hex salt", "v1:zzzz:ccdd:eeff:0011"],
  ])("throws MalformedCipherTextError for %s", (_label, blob) => {
    expect(() => decryptText(blob, PASSWORD)).toThrow(MalformedCipherTextError);
  });

  it("throws MalformedCipherTextError when the salt is the wrong width", () => {
    const blob = encryptText("secret", PASSWORD);
    const parts = blob.split(":");
    parts[1] = "aabb"; // 2 bytes, not 16
    expect(() => decryptText(parts.join(":"), PASSWORD)).toThrow(MalformedCipherTextError);
  });
});

describe("isEncryptedBlob", () => {
  it("recognises what encryptText writes", () => {
    expect(isEncryptedBlob(encryptText("x", PASSWORD))).toBe(true);
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
