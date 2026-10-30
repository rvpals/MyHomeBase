// Content hashing for attachments, and the duplicate lookup it enables (migration 0163).
//
// The question this answers is "do we already have this file?", which a document
// library cannot otherwise answer: two scans of the same lease filed a year apart
// under different names are the same bytes and nothing could tell.
//
// SHA-256 over the uploaded buffer, which `addAttachment` already holds in memory —
// no second read of the share, no dependency. Node's `crypto` is built in.

import { createHash } from "node:crypto";
import type { DocumentsRepository } from "./ports";
import type { DuplicateMatch } from "./types";

/**
 * The empty hash, meaning "this row was never hashed".
 *
 * Every attachment row predating migration 0163 carries it, because backfilling
 * would have meant reading the whole share over SMB inside a migration. It is a
 * real state, not an error: an un-hashed row takes no part in duplicate detection
 * until the backfill CLI reaches it.
 *
 * Exported so callers test against this rather than against a bare `""`, which
 * reads as "unset" and invites someone to treat it as a missing value to fill in
 * with a guess.
 */
export const UNHASHED = "";

/**
 * SHA-256 of a file's bytes, lowercase hex.
 *
 * Content only — no file name, no mime type, no size. Two files are duplicates when
 * their bytes match, whatever they are called; that is the entire point, since the
 * names are exactly what differ in the case worth catching ("Scan 12-03.pdf" and
 * "lease-final.pdf").
 *
 * SHA-256 rather than something faster because this runs once per upload on a file
 * already in memory — the cost is irrelevant beside the share write that follows —
 * and a weaker hash would make a false "you already have this" possible on a
 * household's real documents.
 */
export function hashContent(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Whether a hash can be used for a duplicate lookup.
 *
 * Guards the one mistake available here: passing `UNHASHED` into a search would
 * match every un-hashed row in the library and report a brand new file as a
 * duplicate of everything.
 */
export function isHashed(hash: string): boolean {
  return hash !== UNHASHED;
}

/**
 * Attachments elsewhere in the library with these exact bytes.
 *
 * Returns matches **across the whole library**, not just the document being added
 * to, because "do we already have this?" is the valuable question — the same scan
 * filed under two documents is the case worth catching, and a within-document check
 * would miss precisely that.
 *
 * `excludeAttachmentId` leaves one row out, which is what a re-check of an existing
 * attachment needs so it does not report itself.
 *
 * **This warns; it never blocks.** Filing the same bytes under two documents is
 * sometimes deliberate — a receipt that is both a warranty record and a tax record —
 * and nothing here can tell that case from a mistake. The caller surfaces the match
 * and carries on.
 */
export function findDuplicates(
  repo: DocumentsRepository,
  contentHash: string,
  excludeAttachmentId?: number,
): DuplicateMatch[] {
  if (!isHashed(contentHash)) return [];
  const matches = repo.findAttachmentsByHash(contentHash);
  return excludeAttachmentId === undefined
    ? matches
    : matches.filter((match) => match.attachmentId !== excludeAttachmentId);
}

/**
 * Hashes a buffer and looks it up in one step — what an upload calls.
 *
 * Returns the hash to store alongside the duplicates to report, so the caller
 * cannot accidentally store one file's hash having searched for another's.
 */
export function hashAndFindDuplicates(
  repo: DocumentsRepository,
  data: Buffer,
): { contentHash: string; duplicates: DuplicateMatch[] } {
  const contentHash = hashContent(data);
  return { contentHash, duplicates: findDuplicates(repo, contentHash) };
}
