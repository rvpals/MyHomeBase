"use server";

import {
  listCategories,
  listTags,
  loadJournalStatsTab,
  resolveJournalPreferences,
  type JournalStatsTabData,
} from "@/lib/journal";
import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";
import { journalTaxonomyIconUrlsByName } from "./journal-shared";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "journal";

export type JournalStatsTabResult =
  | {
      ok: true;
      data: JournalStatsTabData;
      /**
       * Name -> icon URL for the taxonomy tab's tiles. Built here rather than in
       * `lib/` because an icon URL is a web route — a CLI caller has no use for it.
       * Empty for the other two tabs.
       */
      categoryIcons: Record<string, string>;
      tagIcons: Record<string, string>;
    }
  | { ok: false; error: string };

/**
 * One tab of the home screen's Interesting Journal Stats card, loaded when the reader
 * opens it. The tab key is validated by `loadJournalStatsTab`'s zod schema.
 */
export async function loadJournalStatsTabAction(tab: string): Promise<JournalStatsTabResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const journalModule = getModuleBySlug(deps.moduleRepo, ACCESS_MODULE_SLUG);
    const preferences = resolveJournalPreferences(
      journalModule ? listModuleSettingsFor(deps.moduleSettingsRepo, journalModule.id) : [],
    );
    const data = loadJournalStatsTab(deps.journalRepo, tab, {
      topWordLimit: preferences.topWordLimit,
      excludedWords: preferences.excludedWords,
    });

    const isTaxonomy = data.tab === "taxonomy";
    return {
      ok: true,
      data,
      categoryIcons: isTaxonomy
        ? Object.fromEntries(journalTaxonomyIconUrlsByName("category", listCategories(deps.journalRepo)))
        : {},
      tagIcons: isTaxonomy
        ? Object.fromEntries(journalTaxonomyIconUrlsByName("tag", listTags(deps.journalRepo)))
        : {},
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to load these stats." };
  }
}
