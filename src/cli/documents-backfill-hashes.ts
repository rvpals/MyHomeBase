import {
  findDuplicates,
  formatBytes,
  getDocumentSettings,
  hashContent,
  readAttachment,
} from "@/lib/documents";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/** How many files one run hashes unless `--limit` says otherwise. */
const DEFAULT_LIMIT = 500;

/**
 * Fills in the content hashes migration 0163 did not backfill.
 *
 *   documents-backfill-hashes
 *   documents-backfill-hashes --limit 50
 *   documents-backfill-hashes --dry-run
 *   documents-backfill-hashes --limit 50 --dry-run
 *
 * `--dry-run` takes no value and `parseFlags` consumes the token after every `--flag`,
 * so it goes **last**. Written as `--dry-run --limit 50` it would eat `--limit` and
 * the run would silently use the default. Hence the `args.includes` test below rather
 * than reading it off the parsed flags.
 *
 * ## Why this is a command and not part of the migration
 *
 * Hashing an existing attachment means **reading the file off the share**, and the
 * share is a NAS over SMB. A migration must run fast and offline — doing a few
 * thousand network reads inside one would turn a schema change into a long job that
 * fails halfway on a flaky mount and leaves no way to resume. So migration 0163 added
 * the column with a `''` default and this command fills it in, resumably, whenever you
 * choose to.
 *
 * Un-hashed rows are not broken: they simply take no part in duplicate detection until
 * this reaches them. Running it twice is safe — each run only looks at rows still
 * carrying `''`, so an interrupted run resumes exactly where it stopped.
 *
 * A file that is missing from the share is **left un-hashed rather than marked**,
 * because a hash is a fact about bytes and there are none to read. The integrity check
 * is what surfaces those; silently recording something here would hide them.
 */
export async function documentsBackfillHashesCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const dryRun = args.includes("--dry-run");

  const limit = flags.limit === undefined ? DEFAULT_LIMIT : Number(flags.limit);
  if (!Number.isInteger(limit) || limit <= 0) {
    console.error("--limit must be a positive whole number.");
    process.exitCode = 1;
    return;
  }

  const settings = getDocumentSettings(deps.moduleRepo, deps.moduleSettingsRepo);
  if (settings.documentRoot === "") {
    console.error("No document folder is set, so there are no files to read.");
    process.exitCode = 1;
    return;
  }
  const files = { store: deps.documentFileStore, root: settings.documentRoot };

  const pending = deps.documentsRepo.listUnhashedAttachments(limit);
  if (pending.length === 0) {
    console.log("Every attachment already has a content hash. Nothing to do.");
    return;
  }

  console.log(
    `${pending.length} attachment(s) to hash${dryRun ? " (dry run — nothing will be written)" : ""}.\n`,
  );

  let hashed = 0;
  let missing = 0;
  let duplicatesFound = 0;

  for (const attachment of pending) {
    const result = await readAttachment(deps.documentsRepo, files, attachment.id);
    if (!result) {
      // Named, not counted silently: a row whose file is gone is exactly what the
      // reader wants to know about, and it is why this run's total will not match the
      // number of rows it looked at.
      console.log(`  MISSING  ${attachment.relativePath}  (${attachment.originalName})`);
      missing += 1;
      continue;
    }

    const contentHash = hashContent(result.data);

    // Reported while backfilling because this is the first time the library has ever
    // been able to see these collisions — every one of them predates the feature.
    const duplicates = findDuplicates(deps.documentsRepo, contentHash, attachment.id);
    if (duplicates.length > 0) {
      duplicatesFound += 1;
      const names = duplicates.map((match) => `"${match.documentTitle}"`).join(", ");
      console.log(
        `  DUPLICATE  ${attachment.originalName}  (${formatBytes(attachment.byteSize)})` +
          `\n             also in: ${names}`,
      );
    }

    if (!dryRun) deps.documentsRepo.setAttachmentHash(attachment.id, contentHash);
    hashed += 1;
  }

  console.log(
    `\n${dryRun ? "Would hash" : "Hashed"} ${hashed} file(s).` +
      (missing > 0 ? `  ${missing} missing from the share.` : "") +
      (duplicatesFound > 0 ? `  ${duplicatesFound} duplicate(s) found.` : ""),
  );

  const remaining = deps.documentsRepo.listUnhashedAttachments(1).length;
  if (!dryRun && remaining > 0) {
    console.log("More remain — run the command again to continue.");
  }
}
