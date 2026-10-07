// Bulk encrypt for a selection of journal entries — the Entries screen's
// "Encrypt" button, beside Bulk edit, Lock/Unlock and Delete.
//
// The fourth and **most dangerous** member of the selection-action family, and
// the only one with no way back. Delete goes to a bin; a lock unlocks; a bulk
// edit can be edited again. This one blanks the plaintext columns in the same
// write that stores the ciphertext, and nothing — here, in the repository, or
// in the database — stores the password or anything derived from it. A
// mis-ticked row plus a forgotten password is destroyed data, permanently.
//
// Three consequences shape everything below:
//
//   - **One password for the whole batch.** Prompting per entry would defeat
//     the point. Each entry is still sealed independently with its own fresh
//     salt and IV (`encryptEntryText` generates both per call), so sharing a
//     password costs nothing cryptographically — it is the *recovery* story
//     that is shared, and the dialog says so.
//   - **All or nothing.** The whole batch runs in one repository transaction.
//     Sealing 6 of 40 and failing would leave the reader with no way to know
//     where it stopped, and no list of which rows now need a password.
//   - **Ineligible rows are skipped, not fatal.** Locked entries and
//     already-encrypted ones are counted and left alone, the way bulk edit
//     treats locked rows. `encryptEntry` throws on both because it acts on one
//     entry a reader is looking at; here one such row must not block 39 others.
//
// Already-encrypted rows are skipped rather than re-sealed because re-sealing
// would need each entry's *existing* password to open it first, which a batch
// under one new password does not have.
//
// The crypto stays here and the SQL stays in the repository: the port takes a
// **sealing function**, so the repository never sees the password. Same
// division as recycle.ts, bulk-edit.ts and bulk-lock.ts.

import { z } from "zod";
import { encryptEntryText } from "./encryption";
import type { JournalRepository } from "./ports";

/** Non-empty and de-duped, for the reasons given in recycle.ts. */
const idListSchema = z
  .array(z.number().int().positive())
  .min(1, "Select at least one entry.")
  .transform((ids) => [...new Set(ids)]);

export interface BulkEncryptResult {
  /** How many entries were actually sealed. */
  encryptedCount: number;
  /** How many were left alone because they are locked. */
  skippedLockedCount: number;
  /** How many were already encrypted, so had nothing to do. */
  skippedEncryptedCount: number;
  /** How many requested ids no longer existed. */
  missingCount: number;
}

/**
 * Seals the title and content of every eligible selected entry under one
 * password.
 *
 * `hint` is stored **in the clear**, once per entry, and must never contain the
 * password — the form that collects it says so. One hint for the batch, because
 * one password covers the batch.
 *
 * Everything other than title and content — date, place, weather, categories,
 * tags, locations, images — stays readable, because that is what the lists, the
 * calendar and the filters are built from.
 */
export function bulkEncryptEntries(
  repo: JournalRepository,
  ids: number[],
  password: string,
  hint = "",
): BulkEncryptResult {
  const validated = idListSchema.parse(ids);
  // Checked before the transaction opens rather than inside the seal callback:
  // an empty password must fail before a single row is touched, not partway
  // through a batch that then has to roll back.
  if (password === "") throw new Error("A password is required to encrypt an entry.");

  const outcome = repo.bulkEncryptEntries(validated, {
    // Called per row by the repository, which hands over that row's plaintext
    // and never learns the password. Fresh salt and IV per call, and separate
    // blobs for title and content — never one key over two plaintexts with a
    // shared IV.
    seal: (title: string, content: string) => ({
      titleEncrypted: encryptEntryText(title, password),
      contentEncrypted: encryptEntryText(content, password),
    }),
    hint,
  });

  return {
    encryptedCount: outcome.encryptedIds.length,
    skippedLockedCount: outcome.skippedLockedIds.length,
    skippedEncryptedCount: outcome.skippedEncryptedIds.length,
    missingCount: outcome.missingIds.length,
  };
}

/**
 * One line summarising what a bulk encrypt did, for the web notice and the
 * CLI's stdout to print identically. Mirrors `describeBulkEditResult`.
 */
export function describeBulkEncryptResult(result: BulkEncryptResult): string {
  const parts: string[] = [];
  parts.push(
    result.encryptedCount === 1
      ? "Encrypted 1 entry."
      : `Encrypted ${result.encryptedCount} entries.`,
  );
  if (result.skippedLockedCount > 0) {
    parts.push(
      result.skippedLockedCount === 1
        ? "1 was locked and skipped."
        : `${result.skippedLockedCount} were locked and skipped.`,
    );
  }
  if (result.skippedEncryptedCount > 0) {
    parts.push(
      result.skippedEncryptedCount === 1
        ? "1 was already encrypted."
        : `${result.skippedEncryptedCount} were already encrypted.`,
    );
  }
  if (result.missingCount > 0) {
    parts.push(
      result.missingCount === 1 ? "1 no longer exists." : `${result.missingCount} no longer exist.`,
    );
  }
  return parts.join(" ");
}
