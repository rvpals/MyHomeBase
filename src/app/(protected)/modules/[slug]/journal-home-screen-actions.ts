"use server";

// Web adapter for the Journal home screen layout. Validation lives in the use-case
// (`saveJournalHomeWidgets` parses with its own schema); the CLI-reachable logic is all
// in `@/lib/journal`.

import { revalidatePath } from "next/cache";
import { saveJournalHomeWidgets, type JournalHomeWidgetPreference } from "@/lib/journal";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "journal";

export interface JournalHomeScreenResult {
  ok: boolean;
  error?: string;
}

/**
 * Stores the signed-in reader's Journal home layout. The session decides whose layout
 * this is — the client never supplies a user id.
 */
export async function saveJournalHomeWidgetsAction(
  widgets: JournalHomeWidgetPreference[],
): Promise<JournalHomeScreenResult> {
  const currentUser = await requireModuleAccess(ACCESS_MODULE_SLUG);

  try {
    saveJournalHomeWidgets(deps.userPreferencesRepo, currentUser.id, widgets);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to save the layout.",
    };
  }

  revalidatePath("/modules/journal");
  revalidatePath("/modules/journal/home-screen");
  return { ok: true };
}
