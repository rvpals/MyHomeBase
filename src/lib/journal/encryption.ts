// Per-entry encryption for journal entries.
//
// Pure functions over strings — no repository, no I/O, no React. One password
// per entry, supplied by the reader each time; the same password may be reused
// across entries, but every entry is sealed independently with its own salt and
// its own IV.
//
// **There is no recovery path and that is the feature.** Nothing here stores the
// password, a hash of it, or any value derived from it other than the ciphertext
// itself. A forgotten password means the entry is gone — no admin override, no
// reset, no backdoor. Callers must say so plainly before encrypting.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Format version, written as the first field of every blob.
 *
 * A future move to a different cipher or KDF becomes a parse branch here rather
 * than a migration that has to rewrite every stored row — the old blobs keep
 * saying `v1` and keep decrypting the way they were written.
 */
const FORMAT_VERSION = "v1";

/** 16 bytes, matching the salt width in `@/lib/shared/password`. */
const SALT_BYTES = 16;

/** 12 bytes — the IV width AES-GCM is defined for. */
const IV_BYTES = 12;

/** 32 bytes = AES-256. */
const KEY_BYTES = 32;

/**
 * Thrown when a blob will not open with the password supplied.
 *
 * Deliberately does **not** distinguish "wrong password" from "the stored bytes
 * were altered": GCM cannot tell them apart, and inventing a distinction would
 * mean trusting something other than the authentication tag. Callers show one
 * message for both.
 */
export class WrongPasswordError extends Error {
  constructor() {
    super("That password does not open this entry.");
    this.name = "WrongPasswordError";
  }
}

/** Thrown when a stored blob is not in the shape `encryptEntryText` writes. */
export class MalformedCipherTextError extends Error {
  constructor() {
    super("The stored encrypted text is not in a readable format.");
    this.name = "MalformedCipherTextError";
  }
}

/**
 * Encrypts one piece of entry text.
 *
 * Returns `v1:salt:iv:tag:ciphertext`, every field hex. Salt and IV are freshly
 * random on **every call** — never derived, never counted, never reused. Two
 * calls with the same text and the same password therefore produce different
 * blobs, which is correct: reusing an IV under one key in GCM leaks the XOR of
 * the two plaintexts and undermines the authentication tag.
 *
 * An empty string encrypts like any other value rather than short-circuiting to
 * `""`, so an entry with no title is indistinguishable on disk from one whose
 * title happens to be short.
 */
export function encryptEntryText(plain: string, password: string): string {
  if (password === "") throw new Error("A password is required to encrypt an entry.");

  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = scryptSync(password, salt, KEY_BYTES);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    FORMAT_VERSION,
    salt.toString("hex"),
    iv.toString("hex"),
    tag.toString("hex"),
    ciphertext.toString("hex"),
  ].join(":");
}

/**
 * Decrypts a blob written by `encryptEntryText`.
 *
 * The GCM authentication tag **is** the password check — there is no separate
 * verifier stored anywhere, because a wrong key makes `final()` throw. That is
 * both exact and free, and a verifier hash beside it would only hand an attacker
 * an offline cracking target independent of the ciphertext.
 *
 * @throws {MalformedCipherTextError} the blob is not in the expected shape
 * @throws {WrongPasswordError} the password is wrong, or the bytes were altered
 */
export function decryptEntryText(blob: string, password: string): string {
  const parts = blob.split(":");
  if (parts.length !== 5) throw new MalformedCipherTextError();

  const [version, saltHex, ivHex, tagHex, ciphertextHex] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (version !== FORMAT_VERSION) throw new MalformedCipherTextError();

  const salt = hexToBuffer(saltHex, SALT_BYTES);
  const iv = hexToBuffer(ivHex, IV_BYTES);
  // The tag is always 16 bytes for GCM; a blob claiming otherwise is malformed.
  const tag = hexToBuffer(tagHex, 16);
  const ciphertext = hexToBuffer(ciphertextHex);

  const key = scryptSync(password, salt, KEY_BYTES);

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Any failure past this point is a tag mismatch. The original error carries
    // no detail worth surfacing and naming it would only leak which step failed.
    throw new WrongPasswordError();
  }
}

/**
 * What stands in for an encrypted entry's title anywhere a list, the calendar,
 * the neighbour strip or a merge heading would have shown the real one.
 *
 * One constant rather than a literal per call site, so every screen says the
 * same thing and a later change to the wording is one edit.
 */
export const ENCRYPTED_TITLE_PLACEHOLDER = "(encrypted)";

/**
 * The title to display for an entry, given whether it is encrypted.
 *
 * Takes the two fields rather than a `JournalEntry` so the narrow projections —
 * `CalendarEntryLike` and the neighbour refs — can call it without being widened
 * into full entries.
 */
export function displayEntryTitle(title: string, isEncrypted: boolean): string {
  return isEncrypted ? ENCRYPTED_TITLE_PLACEHOLDER : title;
}

/**
 * Whether `blob` looks like something `encryptEntryText` wrote.
 *
 * A shape check only — it says nothing about whether any particular password
 * opens it. Used by the repository to tell a real blob from a blank column on a
 * row written before migration 0131.
 */
export function isEncryptedBlob(blob: string): boolean {
  const parts = blob.split(":");
  if (parts.length !== 5) return false;
  if (parts[0] !== FORMAT_VERSION) return false;
  return parts.slice(1).every((part) => part.length > 0 && isHex(part));
}

/**
 * Hex to bytes, rejecting anything that is not clean hex of the expected width.
 *
 * `Buffer.from(…, "hex")` is silently lenient — it stops at the first invalid
 * character and returns a short buffer rather than throwing, which would turn a
 * corrupt blob into a confusing cipher error further down.
 */
function hexToBuffer(hex: string, expectedBytes?: number): Buffer {
  if (!isHex(hex)) throw new MalformedCipherTextError();
  const buffer = Buffer.from(hex, "hex");
  if (expectedBytes !== undefined && buffer.length !== expectedBytes) {
    throw new MalformedCipherTextError();
  }
  return buffer;
}

function isHex(value: string): boolean {
  return value.length % 2 === 0 && /^[0-9a-f]*$/i.test(value);
}
