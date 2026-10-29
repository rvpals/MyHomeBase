import {
  buildDocumentArchive,
  formatBytes,
  getDocument,
  getDocumentLimits,
  getDocumentSettings,
  listDocuments,
} from "@/lib/documents";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/**
 * Lists the Document Library from the terminal — the same use-cases the web app's
 * screens call, through the same `index.ts` and the same `deps`.
 *
 *   list-documents
 *   list-documents --search lease
 *   list-documents --category Insurance --tag car
 *   list-documents --id 17
 *   list-documents --id 17 --zip ./lease.zip
 *
 * `--id` prints one document in full, with every attachment and where it sits on the
 * share. `--zip` writes that document's files to a single archive, which is the one
 * thing here the browser does differently — it streams the same bytes to a download.
 *
 * Adding this command required **no change to `src/lib/documents`**, which is the
 * property ARCHITECTURE.md asks for: if it had, the use-cases were carrying
 * presentation assumptions.
 */
export async function listDocumentsCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  const settings = getDocumentSettings(deps.moduleRepo, deps.moduleSettingsRepo);
  // The store comes from the composition root, never constructed here — a
  // presentation layer that builds its own repository is the anti-pattern
  // ARCHITECTURE.md names.
  const files = { store: deps.documentFileStore, root: settings.documentRoot };

  // One document, in full.
  if (flags.id) {
    const id = Number(flags.id);
    if (!Number.isInteger(id) || id <= 0) {
      console.error("--id must be a positive whole number.");
      process.exitCode = 1;
      return;
    }

    const result = getDocument(deps.documentsRepo, id);
    if (!result) {
      console.error(`There is no document with id ${id}.`);
      process.exitCode = 1;
      return;
    }

    const { document, attachments } = result;
    console.log(`#${document.id}  ${document.title}`);
    if (document.description !== "") console.log(document.description);
    if (document.categories.length > 0) console.log(`Categories: ${document.categories.join(", ")}`);
    if (document.tags.length > 0) console.log(`Tags: ${document.tags.join(", ")}`);
    console.log(`Filed: ${document.createdAt}   Updated: ${document.updatedAt}`);

    if (attachments.length === 0) {
      console.log("\nNo files attached.");
    } else {
      console.log(`\n${attachments.length} file(s):`);
      for (const file of attachments) {
        console.log(
          `  ${file.originalName}  ${formatBytes(file.byteSize)}  ${file.mimeType}\n` +
            `    ${file.relativePath}`,
        );
      }
    }

    if (flags.zip) {
      if (settings.documentRoot === "") {
        console.error("\nNo document folder is set, so there are no files to archive.");
        process.exitCode = 1;
        return;
      }
      const archive = await buildDocumentArchive(deps.documentsRepo, files, id);
      if (!archive) {
        console.error("\nThat document has no files to archive.");
        process.exitCode = 1;
        return;
      }
      const { writeFile } = await import("node:fs/promises");
      await writeFile(flags.zip, archive.data);
      console.log(`\nWrote ${flags.zip} (${formatBytes(archive.data.byteLength)}).`);
      // Named rather than silently skipped, exactly as the download route does.
      if (archive.missing.length > 0) {
        console.log(`Missing from the share, not included: ${archive.missing.join(", ")}`);
      }
    }
    return;
  }

  // The list.
  const documents = listDocuments(deps.documentsRepo, {
    search: flags.search ?? "",
    categories: flags.category ? [flags.category] : [],
    tags: flags.tag ? [flags.tag] : [],
  });

  if (settings.documentRoot === "") {
    console.log("Note: no document folder is set, so no file can be attached yet.\n");
  }

  if (documents.length === 0) {
    console.log("No documents match.");
    return;
  }

  for (const document of documents) {
    const files_ =
      document.attachmentCount === 0
        ? "no files"
        : `${document.attachmentCount} file(s), ${formatBytes(document.totalBytes)}`;
    const taxonomy = [...document.categories, ...document.tags].join(", ");
    console.log(
      `#${document.id}  ${document.title}  [${files_}]` + (taxonomy ? `  (${taxonomy})` : ""),
    );
  }

  const limits = getDocumentLimits(deps.moduleRepo, deps.moduleSettingsRepo);
  console.log(
    `\n${documents.length} document(s). Limits: ${formatBytes(limits.maxFileBytes)} per file, ` +
      `${limits.maxFilesPerDocument} files per document.`,
  );
}
