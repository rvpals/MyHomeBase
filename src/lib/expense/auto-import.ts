// Automatic CSV import. The watched folder holds one sub-folder per card, named
// after it:
//
//     /csv_import/Visa Gold/*.csv     -> the "Visa Gold" account
//     /csv_import/Amex/*.csv          -> the "Amex" account
//
// The sub-folder name selects both the account and the saved column mapping, so
// the files inside can be named anything the card company produces. Each file is
// imported (applying the fuzzy rules), then renamed so it isn't picked up again.
//
// Orchestration only — file access is behind CsvFolderPort and everything it
// touches is a repository, so the whole flow is testable without a disk or a DB.

import type { CsvImportMappingRepository, NamedMapping } from "@/lib/csv-import";
import type { CsvFolderPort } from "./csv-folder";
import { importExpenseCsv } from "./csv-import";
import type { ExpenseRepository } from "./ports";
import { isAutoImportEnabled, type ExpenseSettings } from "./settings";
import type { CreditCardAccount } from "./types";

export interface AutoImportFileResult {
  /** The card sub-folder this file came from. */
  cardFolder: string;
  fileName: string;
  status: "imported" | "failed";
  /** Present on failure, and on success as a short summary of what happened. */
  detail: string;
  importedCount?: number;
  duplicateCount?: number;
  categorisedCount?: number;
  /** What the file was renamed to, when it was renamed. */
  renamedTo?: string;
}

export interface AutoImportRunSummary {
  /** False when the settings aren't configured — nothing was looked at. */
  ran: boolean;
  reason?: string;
  files: AutoImportFileResult[];
}

export interface AutoImportDependencies {
  expenseRepo: ExpenseRepository;
  mappingRepo: CsvImportMappingRepository;
  folder: CsvFolderPort;
  /** Recorded as the creator of imported transactions. */
  createdByUserId: number;
  /** Injected so the rename suffix is deterministic in tests. */
  now?: () => Date;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** The card sub-folder's name is the account name, verbatim. */
export function accountNameFromFolderName(folderName: string): string {
  return folderName.trim();
}

/** Local timestamp suffix, e.g. 20260802-140501. */
function timestampSuffix(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

/**
 * The saved mapping to use for a card: the one named after the account. If
 * there's no name match but exactly one Expense mapping exists, that one is
 * used — the common single-card setup shouldn't need the names to line up.
 */
export function findMappingForAccount(
  accountName: string,
  mappings: NamedMapping[],
): NamedMapping | undefined {
  const byName = mappings.find((mapping) => normalize(mapping.name) === normalize(accountName));
  if (byName) return byName;
  return mappings.length === 1 ? mappings[0] : undefined;
}

function findAccount(
  accountName: string,
  accounts: CreditCardAccount[],
): CreditCardAccount | undefined {
  return accounts.find((account) => normalize(account.name) === normalize(accountName));
}

/**
 * Runs one pass over the watched folder: each sub-folder is a card, each *.csv
 * inside it a statement. Every file is handled independently, so one bad
 * statement never stops the others and each outcome is reported.
 *
 * A processed file is renamed to `<name>_<timestamp>.backup`, which both keeps
 * the original and takes it out of the `*.csv` scan. A failed one becomes
 * `<name>_<timestamp>.failed` so it isn't retried every minute forever — rename
 * it back to .csv once the cause is fixed.
 */
export function runAutoImport(
  settings: ExpenseSettings,
  dependencies: AutoImportDependencies,
): AutoImportRunSummary {
  const { expenseRepo, mappingRepo, folder, createdByUserId } = dependencies;
  const now = dependencies.now ?? (() => new Date());

  if (!isAutoImportEnabled(settings)) {
    return { ran: false, reason: "Auto-import is not configured.", files: [] };
  }
  if (!folder.directoryExists(settings.autoImportPath)) {
    return {
      ran: false,
      reason: `Folder not found: ${settings.autoImportPath}`,
      files: [],
    };
  }

  const cardFolders = folder.listSubdirectoryNames(settings.autoImportPath);
  const accounts = expenseRepo.listAccounts();
  const mappings = mappingRepo.listNamedMappings("Expense");
  const files: AutoImportFileResult[] = [];

  // A CSV dropped at the top level has no card, so say so rather than ignoring
  // it silently — that's a mistake the user can only fix if they hear about it.
  for (const strayFile of folder.listCsvFileNames(settings.autoImportPath)) {
    files.push({
      cardFolder: "",
      fileName: strayFile,
      status: "failed",
      detail: "Not in a card sub-folder — move it into a folder named after the card.",
    });
  }

  for (const cardFolder of cardFolders) {
    const accountName = accountNameFromFolderName(cardFolder);
    const cardPath = folder.joinPath(settings.autoImportPath, cardFolder);
    const fileNames = folder.listCsvFileNames(cardPath);
    if (fileNames.length === 0) continue;

    const account = findAccount(accountName, accounts);
    const mapping = findMappingForAccount(accountName, mappings);

    for (const fileName of fileNames) {
      const suffix = timestampSuffix(now());
      const baseName = fileName.replace(/\.csv$/i, "");

      const fail = (detail: string) => {
        const renamedTo = `${baseName}_${suffix}.failed`;
        try {
          folder.renameFile(cardPath, fileName, renamedTo);
          files.push({ cardFolder, fileName, status: "failed", detail, renamedTo });
        } catch (renameError) {
          // Report the original problem *and* that the file is still in place, so
          // it's clear why the same failure will reappear next tick.
          files.push({
            cardFolder,
            fileName,
            status: "failed",
            detail: `${detail} (could not rename: ${
              renameError instanceof Error ? renameError.message : "unknown error"
            })`,
          });
        }
      };

      if (!account) {
        fail(`No credit-card account named "${accountName}" (from the sub-folder name).`);
        continue;
      }
      if (!mapping) {
        fail(
          `No saved Expense mapping named "${accountName}" (and more than one, or none, exists).`,
        );
        continue;
      }

      try {
        const fileText = folder.readFileText(cardPath, fileName);
        const summary = importExpenseCsv(
          expenseRepo,
          fileText,
          mapping.columnMapping,
          mapping.fieldOptions,
          { transactionAccountId: account.id, skipDuplicates: true, applyRules: true },
          createdByUserId,
        );

        const renamedTo = `${baseName}_${suffix}.backup`;
        folder.renameFile(cardPath, fileName, renamedTo);

        files.push({
          cardFolder,
          fileName,
          status: "imported",
          detail:
            `Imported ${summary.importedCount}, skipped ${summary.skippedCount} ` +
            `(${summary.duplicateCount} already present), categorised ${summary.categorisedCount}.`,
          importedCount: summary.importedCount,
          duplicateCount: summary.duplicateCount,
          categorisedCount: summary.categorisedCount,
          renamedTo,
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Unknown error during import.");
      }
    }
  }

  return { ran: true, files };
}
