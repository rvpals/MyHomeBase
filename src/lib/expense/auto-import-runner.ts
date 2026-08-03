// Resolves everything the auto-importer needs from the composition root and
// runs one pass. Separate from auto-import.ts so that file stays a pure
// orchestration unit taking explicit dependencies, while this one knows about
// `deps`, module settings, and which user to attribute imports to.

import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { isAdmin, listUsers } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { runAutoImport, type AutoImportRunSummary } from "./auto-import";
import { resolveExpenseSettings, type ExpenseSettings } from "./settings";

export const EXPENSE_MODULE_SLUG = "expense";

/** The module's saved settings, or the disabled defaults if the module is absent. */
export function loadExpenseSettings(): ExpenseSettings {
  const expenseModule = getModuleBySlug(deps.moduleRepo, EXPENSE_MODULE_SLUG);
  return resolveExpenseSettings(
    expenseModule ? listModuleSettingsFor(deps.moduleSettingsRepo, expenseModule.id) : [],
  );
}

/**
 * Auto-imported rows still need a creator. There's no session here, so the
 * lowest-id admin is used; with no admin at all the run is skipped rather than
 * writing a made-up id.
 */
function firstAdminUserId(): number | undefined {
  const admins = listUsers(deps.userRepo)
    .filter((user) => isAdmin(user))
    .sort((a, b) => a.id - b.id);
  return admins[0]?.id;
}

/** Runs one auto-import pass using the saved settings. Never throws. */
export function runExpenseAutoImport(): AutoImportRunSummary {
  try {
    const settings = loadExpenseSettings();
    const createdByUserId = firstAdminUserId();
    if (createdByUserId === undefined) {
      return { ran: false, reason: "No admin account to attribute imports to.", files: [] };
    }

    return runAutoImport(settings, {
      expenseRepo: deps.expenseRepo,
      mappingRepo: deps.csvImportMappingRepo,
      folder: deps.csvFolder,
      createdByUserId,
    });
  } catch (error) {
    // A scheduled job must not take the server down; report and move on.
    return {
      ran: false,
      reason: error instanceof Error ? error.message : "Unknown auto-import error.",
      files: [],
    };
  }
}
