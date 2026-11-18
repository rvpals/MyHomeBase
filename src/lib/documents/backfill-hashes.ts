// Fills in the content hashes migration 0163 did not backfill.
//
// Lives here, not in the CLI, so the `documents-backfill-hashes` command and the
// Document Review screen's "Check these files now" link run the same code.
//
// Hashing an existing attachment means READING THE FILE OFF THE SHARE (a NAS over
// SMB), which is why this is a resumable batch and not part of the migration. Each
// call looks only at rows still carrying `''`, so an interrupted run resumes where it
// stopped and running it twice is safe.
//
// A file missing from the share is LEFT UN-HASHED rather than marked: a hash is a
// fact about bytes and there are none to read. It is reported, and `afterId` lets the
// next batch step past it instead of re-reading the same gap forever.

import { findDuplicates, hashContent } from "./content-hash";
import { readAttachment, type DocumentFiles } from "./documents";
import type { DocumentsRepository } from "./ports";

export interface BackfillHashesOptions {
  /** Files to look at in this batch. */
  limit: number;
  /** Continue after this attachment id — the previous batch's `lastId`. */
  afterId?: number;
  /** Read and hash, but write nothing. */
  dryRun?: boolean;
}

export interface BackfillMissingFile {
  attachmentId: number;
  relativePath: string;
  originalName: string;
}

export interface BackfillDuplicateFile {
  attachmentId: number;
  originalName: string;
  byteSize: number;
  /** Titles of the other documents already holding these bytes. */
  alsoIn: string[];
}

export interface BackfillHashesResult {
  /** Rows this batch looked at. `0` means there was nothing left after `afterId`. */
  examined: number;
  hashed: number;
  missing: BackfillMissingFile[];
  duplicates: BackfillDuplicateFile[];
  /** The highest id examined — pass it back as `afterId` for the next batch. */
  lastId: number;
  /** Un-hashed rows still in the library after this batch, missing files included. */
  remaining: number;
}

/** Hashes one batch of un-hashed attachments. Refuses when no document folder is set. */
export async function backfillContentHashes(
  repo: DocumentsRepository,
  files: DocumentFiles,
  options: BackfillHashesOptions,
): Promise<BackfillHashesResult> {
  if (!Number.isInteger(options.limit) || options.limit <= 0) {
    throw new Error("The batch size must be a positive whole number.");
  }
  if (files.root.trim() === "") {
    throw new Error("No document folder is set, so there are no files to read.");
  }

  const afterId = options.afterId ?? 0;
  const pending = repo.listUnhashedAttachments(options.limit, afterId);

  const result: BackfillHashesResult = {
    examined: pending.length,
    hashed: 0,
    missing: [],
    duplicates: [],
    lastId: afterId,
    remaining: 0,
  };

  for (const attachment of pending) {
    result.lastId = Math.max(result.lastId, attachment.id);

    const read = await readAttachment(repo, files, attachment.id);
    if (!read) {
      result.missing.push({
        attachmentId: attachment.id,
        relativePath: attachment.relativePath,
        originalName: attachment.originalName,
      });
      continue;
    }

    const contentHash = hashContent(read.data);

    // Reported while backfilling because every collision found here predates the
    // upload-time warning — nobody has ever been told about it.
    const matches = findDuplicates(repo, contentHash, attachment.id);
    if (matches.length > 0) {
      result.duplicates.push({
        attachmentId: attachment.id,
        originalName: attachment.originalName,
        byteSize: attachment.byteSize,
        alsoIn: matches.map((match) => match.documentTitle),
      });
    }

    if (!options.dryRun) repo.setAttachmentHash(attachment.id, contentHash);
    result.hashed += 1;
  }

  result.remaining = repo.countUnhashedAttachments();
  return result;
}
