// The whole-library duplicate check behind Documents → Document Review.
//
// `content-hash.ts` answers "does THIS file already exist?" at upload. This answers
// the other question: "which files does the library already hold more than once?" —
// the list a reader works through to clean up.
//
// Reports; never removes. The same bytes under two documents is sometimes deliberate
// (a receipt that is both a warranty and a tax record), so deciding is the reader's
// job and removal goes through the ordinary `removeAttachment`.

import type { DocumentsRepository } from "./ports";
import type { DuplicateAttachment, DuplicateGroup, DuplicateReport } from "./types";

/**
 * Groups the repository's duplicate rows by hash.
 *
 * Ordered by the most copies first, then the largest file — the groups where cleaning
 * up wins back the most. Ties fall back to the first document title, so the order is
 * stable between visits.
 *
 * A group of one is dropped even though the query should never return one: a file
 * removed between reads must not show up as "a duplicate of nothing".
 */
export function groupDuplicates(rows: DuplicateAttachment[]): DuplicateGroup[] {
  const byHash = new Map<string, DuplicateAttachment[]>();
  for (const row of rows) {
    if (row.contentHash === "") continue;
    const list = byHash.get(row.contentHash);
    if (list) list.push(row);
    else byHash.set(row.contentHash, [row]);
  }

  const groups: DuplicateGroup[] = [];
  for (const [contentHash, files] of byHash) {
    if (files.length < 2) continue;
    files.sort(
      (a, b) =>
        a.documentTitle.localeCompare(b.documentTitle, undefined, { sensitivity: "base" }) ||
        a.attachmentId - b.attachmentId,
    );
    groups.push({ contentHash, byteSize: files[0].byteSize, files });
  }

  return groups.sort(
    (a, b) =>
      b.files.length - a.files.length ||
      b.byteSize - a.byteSize ||
      a.files[0].documentTitle.localeCompare(b.files[0].documentTitle, undefined, {
        sensitivity: "base",
      }),
  );
}

/** Every set of attachments that share their bytes, plus how many files are unchecked. */
export function findDuplicateGroups(repo: DocumentsRepository): DuplicateReport {
  return {
    groups: groupDuplicates(repo.listDuplicateAttachments()),
    unhashedCount: repo.countUnhashedAttachments(),
  };
}
