import { findDuplicateGroups, formatBytes } from "@/lib/documents";
import { deps } from "@/lib/wiring";

/**
 * Lists every file the Document Library holds more than once — the same report as
 * Documents → Document Review → "Check for duplicate attachments".
 *
 *   documents-duplicates
 *
 * Reads only. Cleaning up is a per-file decision, made on the screen or in the editor.
 */
export async function documentsDuplicatesCommand(): Promise<void> {
  const { groups, unhashedCount } = findDuplicateGroups(deps.documentsRepo);

  if (groups.length === 0) {
    console.log("No duplicate attachments found.");
  } else {
    console.log(`${groups.length} file(s) are attached more than once.\n`);
    for (const group of groups) {
      console.log(
        `${formatBytes(group.byteSize)} · ${group.files.length} copies · ${group.contentHash.slice(0, 12)}`,
      );
      for (const file of group.files) {
        console.log(
          `  doc ${file.documentId}  "${file.documentTitle}"  —  ${file.originalName}  (attachment ${file.attachmentId})`,
        );
      }
      console.log("");
    }
  }

  if (unhashedCount > 0) {
    console.log(
      `${unhashedCount} file(s) have not been checked yet. Run documents-backfill-hashes to include them.`,
    );
  }
}
