// The documents recycle bin (migration 0163) and the delete that fills it.
//
// Deleting a document moves it here; Documents → Recycled Documents restores them,
// purges them, or empties the bin.
//
// These use-cases are thin over the repository wherever the work is SQL, which is
// how `clips/recycle.ts` and `journal/recycle.ts` are built and what makes the three
// readable as one pattern. **Restore is the exception**, and deliberately so: the
// files are on the share, so choosing the id a document lands at and moving its
// folder to match is a decision that spans the database and the filesystem. Neither
// half can make it alone, so it is sequenced here.

import { z } from "zod";
import { documentFolder } from "./attachment-path";
import type { DocumentFiles } from "./documents";
import type { DocumentsRepository } from "./ports";
import type { RecycledDocument } from "./types";

/**
 * A list of ids from a boundary (a form post, a CLI argument).
 *
 * Non-empty because every caller is acting on a selection, and an empty one is a UI
 * bug worth surfacing rather than a no-op worth hiding. The de-dupe is deliberate: a
 * double-submitted button must not make the returned count disagree with what the
 * reader was shown.
 */
const idListSchema = z
  .array(z.number().int().positive())
  .min(1, "Select at least one document.")
  .transform((ids) => [...new Set(ids)]);

function requireRoot(files: DocumentFiles): string {
  if (files.root.trim() === "") {
    throw new Error("No document folder is set. Set one in the module's Configuration.");
  }
  return files.root;
}

export interface DocumentRecycleResult {
  /** How many documents actually moved. May be less than requested. */
  movedCount: number;
  /** How many requested ids no longer existed and were skipped. */
  skippedCount: number;
}

/**
 * Moves the given documents into the bin.
 *
 * This is what the Delete button calls now. The irreversible step moved behind the
 * bin's own purge.
 *
 * **Files first, then rows.** Each document's folder is moved to its stamped
 * `_deleted/…` destination, and the destinations are handed to the repository so the
 * bin rows can record where the bytes went. Doing it the other way round would mean a
 * failed move leaves a bin row pointing at a folder that is still live, and a restore
 * would then move a folder that nothing had vacated.
 *
 * A document whose files were already gone records `""` and bins fine — that is an
 * index worth keeping even when the bytes are not there.
 */
export async function recycleDocuments(
  repo: DocumentsRepository,
  files: DocumentFiles,
  ids: number[],
): Promise<DocumentRecycleResult> {
  const validated = idListSchema.parse(ids);
  const root = requireRoot(files);

  const deletedFolders = new Map<number, string>();
  for (const id of validated) {
    // Only for documents that still exist: moving the folder of an id that has
    // already gone would strand a live folder under `_deleted/` with no row to
    // restore it.
    if (!repo.getDocumentById(id)) continue;
    deletedFolders.set(id, await files.store.moveToDeleted(root, id));
  }

  const movedCount = repo.recycleDocuments(validated, deletedFolders);
  return { movedCount, skippedCount: validated.length - movedCount };
}

/** Everything in the bin, newest deleted first. */
export function listRecycledDocuments(repo: DocumentsRepository): RecycledDocument[] {
  return repo.listRecycledDocuments();
}

export interface DocumentRestoreResult {
  restoredCount: number;
  skippedCount: number;
  /**
   * The documents that came back under a **different** id than they had, because
   * something else had taken the original since.
   *
   * Surfaced rather than swallowed: their attachment paths were rewritten to match,
   * so nothing is broken, but any bookmark or external reference to the old id now
   * points at a different document. The reader should be told, not left to discover it.
   */
  renumbered: { title: string; fromId: number; toId: number }[];
}

/**
 * Puts binned documents back, keyed by `recycledId`.
 *
 * ## Why this is async, when the clips equivalent is not
 *
 * A document's attachment paths **hardcode its id** — `doc_17/lease.pdf`. A clip's
 * images are database blobs and carry no such dependency, which is why
 * `restoreRecycledClips` can fall back to a fresh id and lose nothing.
 *
 * Here that fallback would be silent corruption: the document comes back as id 42
 * while every attachment row still says `doc_17/…`, which is now a *different*
 * document's folder. Downloads would serve someone else's files.
 *
 * So the restore does the work instead:
 *
 * | Case | What happens |
 * |---|---|
 * | Original id free | Restore at it; move the folder back to `doc_17/`. Paths unchanged. |
 * | Original id taken | Restore at a fresh id; move the folder to `doc_42/`; rewrite every path. |
 *
 * ## Ordering
 *
 * Rows first, then files. The insert is what allocates the fresh id in the taken
 * case, and the folder cannot be moved to a destination that has not been chosen.
 * A move that then fails leaves a restored index whose files are still under
 * `_deleted/` — recoverable by hand, and visible, which is the better failure than a
 * folder moved out from under a row that was never written.
 *
 * Nothing is merged. A restore adds the document back; it never reconciles it with
 * something written since.
 */
export async function restoreRecycledDocuments(
  repo: DocumentsRepository,
  files: DocumentFiles,
  recycledIds: number[],
): Promise<DocumentRestoreResult> {
  const validated = idListSchema.parse(recycledIds);
  const root = requireRoot(files);

  let restoredCount = 0;
  const renumbered: DocumentRestoreResult["renumbered"] = [];

  for (const recycledId of validated) {
    const binned = repo.getRecycledDocument(recycledId);
    if (!binned) continue;

    const targetId = repo.isDocumentIdTaken(binned.id) ? 0 : binned.id;
    // 0 asks the repository to let SQLite allocate; it returns where the row landed.
    const landedId = repo.restoreRecycledDocument(recycledId, targetId);

    await files.store.restoreFromDeleted(root, binned.deletedFolder, landedId);

    if (landedId !== binned.id) {
      renumbered.push({ title: binned.title, fromId: binned.id, toId: landedId });
    }
    restoredCount += 1;
  }

  return { restoredCount, skippedCount: validated.length - restoredCount, renumbered };
}

export interface DocumentPurgeResult {
  deletedCount: number;
  skippedCount: number;
}

/**
 * Removes documents from the bin for good.
 *
 * **This drops the index, not the bytes.** The files stay under `_deleted/` on the
 * share, where they have been since the delete. Nothing in this module ever unlinks a
 * user's file: the share is backed up and browsable, and a module that quietly
 * destroyed scanned originals would be the wrong thing to trust a lease to. Clearing
 * `_deleted/` is a deliberate act done on the NAS.
 *
 * So "there is no undo past this point" means the *document* — its title, filing and
 * the mapping from stored file to original name — is gone, and what remains is an
 * unidentified folder of files.
 */
export function deleteRecycledDocumentsForever(
  repo: DocumentsRepository,
  recycledIds: number[],
): DocumentPurgeResult {
  const validated = idListSchema.parse(recycledIds);
  const deletedCount = repo.deleteRecycledDocumentsForever(validated);
  return { deletedCount, skippedCount: validated.length - deletedCount };
}

/**
 * Empties the bin.
 *
 * No id list, so no `idListSchema` guard and no minimum: emptying an already empty
 * bin is a harmless no-op that reports 0, unlike a selection-based call where an
 * empty list means the UI lost the reader's ticks.
 *
 * Same contract as the purge above — the index goes, the files stay under `_deleted/`.
 */
export function emptyDocumentsRecycleBin(repo: DocumentsRepository): { deletedCount: number } {
  return { deletedCount: repo.emptyDocumentsRecycleBin() };
}

/** How many documents the bin holds — the number the confirmations quote. */
export function countRecycledDocuments(repo: DocumentsRepository): number {
  return repo.countRecycledDocuments();
}

/**
 * Where a restored document's files would land, for a confirmation that wants to say
 * so. Exported mainly so the view never rebuilds `doc_<id>` by hand — the same reason
 * `expenseGroupHref` exists.
 */
export function restoredFolderFor(documentId: number): string {
  return documentFolder(documentId);
}
