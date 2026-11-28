"use server";

import {
  DEPENDENCY_LOG_SOURCE,
  createTimedPhotoReader,
  dependencyCheckSchema,
  describeErrorFully,
  formatDependencyReport,
  runDependencyChecks,
  runServerResizeSuite,
  type DependencyReport,
} from "@/lib/code-test";
import {
  listAllPhotosInFolder,
  listPhotoFoldersForDate,
  photoFolderAllSchema,
  photoFolderLookupSchema,
  type PhotoFolder,
} from "@/lib/journal-photos";
import { deps } from "@/lib/wiring";
import { photoStore } from "../../modules/[slug]/journal-photo-root";
import { requireAdmin } from "../../require-access";

// Administration -> Code Tester. Thin adapters: authorise, validate, call lib, return.
//
// These actions reuse the archive's existing date-based browsing (`listPhotoFoldersForDate`,
// `listAllPhotosInFolder`), but are their own ADMIN-gated endpoints: the Journal and
// Gallery actions that make the same calls check module access, and an administrator
// testing the server need not have either module.

export interface CodeTestFoldersResult {
  ok: boolean;
  error?: string;
  folders?: PhotoFolder[];
}

export interface CodeTestReportResult {
  ok: boolean;
  error?: string;
  report?: string;
}

export interface DependencyCheckActionResult {
  ok: boolean;
  error?: string;
  report?: DependencyReport;
  /** The same report as plain text, for the Copy button -- what the CLI prints. */
  text?: string;
}

/**
 * Runs the dependency checks named in `ids` (empty = all). A failed dependency is a
 * result inside the report, not `ok: false`; that means only the input was refused.
 */
export async function runDependencyCheckAction(ids: string[]): Promise<DependencyCheckActionResult> {
  await requireAdmin();
  const parsed = dependencyCheckSchema.safeParse({ ids });
  if (!parsed.success) return { ok: false, error: "Not a known dependency." };

  const log = deps.systemLogger;
  log.debug(DEPENDENCY_LOG_SOURCE, `action called with ids [${parsed.data.ids.join(", ") || "all"}]`);
  try {
    const report = await runDependencyChecks(
      { ...deps.codeTestDependencies, now: () => performance.now(), clock: () => new Date(), log },
      parsed.data,
    );
    const text = formatDependencyReport(report);
    log.debug(DEPENDENCY_LOG_SOURCE, `action returning ${report.status}, ${text.length} chars of report`);
    return { ok: true, report, text };
  } catch (error) {
    log.debug(DEPENDENCY_LOG_SOURCE, "action threw", () => describeErrorFully(error));
    return { ok: false, error: error instanceof Error ? error.message : "The checks didn't run." };
  }
}

/** The archive folders for one date -- the picker's first step. Names only, cheap. */
export async function listCodeTestFoldersAction(date: string): Promise<CodeTestFoldersResult> {
  await requireAdmin();
  const parsed = photoFolderLookupSchema.safeParse({ date });
  if (!parsed.success) return { ok: false, error: "Not a valid date." };

  try {
    const lookup = await listPhotoFoldersForDate(photoStore(), parsed.data.date);
    if (!lookup.isAvailable) {
      return { ok: false, error: `The photo archive isn't available (${lookup.reason ?? "unknown"}).` };
    }
    return { ok: true, folders: lookup.folders };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Folder lookup failed." };
  }
}

/**
 * Runs the whole experiment suite over one folder: scan, resize sizes, thumbnail paths,
 * concurrency. Tens of seconds, by design -- it is an admin experiment, not a page load.
 *
 * The report carries its own errors as lines, so `ok: false` here means only that the
 * INPUT was refused, or the folder could not be listed, before anything ran.
 */
export async function runServerResizeSuiteAction(folderPath: string): Promise<CodeTestReportResult> {
  await requireAdmin();
  const parsed = photoFolderAllSchema.safeParse({ relativePath: folderPath });
  if (!parsed.success) return { ok: false, error: "Not a valid photo folder." };

  try {
    const store = photoStore();
    const listing = await listAllPhotosInFolder(store, parsed.data);
    if (!listing.isAvailable) {
      return { ok: false, error: `That folder isn't readable (${listing.reason ?? "unknown"}).` };
    }
    const report = await runServerResizeSuite(
      {
        reader: createTimedPhotoReader(store),
        imageLib: deps.codeTestImageLib,
        now: () => performance.now(),
      },
      { folderPath: parsed.data.relativePath, photos: listing.photos },
    );
    return { ok: true, report };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The test didn't run." };
  }
}
