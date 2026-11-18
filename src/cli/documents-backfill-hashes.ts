import {
  backfillContentHashes,
  formatBytes,
  getDocumentSettings,
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
 * The work itself is `backfillContentHashes` in `src/lib/documents/backfill-hashes.ts`,
 * shared with the Document Review screen's "Check these files now" link — see that file
 * for why this is a resumable batch rather than part of the migration, and why a file
 * missing from the share is left un-hashed.
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
  const files = { store: deps.documentFileStore, root: settings.documentRoot };

  let result;
  try {
    result = await backfillContentHashes(deps.documentsRepo, files, { limit, dryRun });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  if (result.examined === 0) {
    console.log("Every attachment already has a content hash. Nothing to do.");
    return;
  }

  console.log(
    `${result.examined} attachment(s) examined${dryRun ? " (dry run — nothing was written)" : ""}.\n`,
  );
  for (const file of result.missing) {
    console.log(`  MISSING  ${file.relativePath}  (${file.originalName})`);
  }
  for (const file of result.duplicates) {
    const names = file.alsoIn.map((title) => `"${title}"`).join(", ");
    console.log(
      `  DUPLICATE  ${file.originalName}  (${formatBytes(file.byteSize)})` +
        `\n             also in: ${names}`,
    );
  }

  console.log(
    `\n${dryRun ? "Would hash" : "Hashed"} ${result.hashed} file(s).` +
      (result.missing.length > 0 ? `  ${result.missing.length} missing from the share.` : "") +
      (result.duplicates.length > 0 ? `  ${result.duplicates.length} duplicate(s) found.` : ""),
  );

  // Missing files stay un-hashed, so they are part of `remaining` and a rerun will
  // name them again — the integrity check is where those get resolved.
  if (!dryRun && result.remaining > result.missing.length) {
    console.log("More remain — run the command again to continue.");
  }
}
