"use server";

// Web adapters for the Keywords section's ignore list. Both call the one use-case in
// `@/lib/documents` and revalidate. No logic lives here — the read-modify-write around
// the stored row is in `setKeywordIgnored`, so a CLI could drive it identically.

import { revalidatePath } from "next/cache";
import { setKeywordIgnored } from "@/lib/documents";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "documents";

const DOCUMENTS_KEYWORDS_PATH = "/modules/documents/keywords";

export interface IgnoredKeywordsResult {
  ok: boolean;
  error?: string;
  /** The list after the change, so the caller doesn't re-read to find out. */
  words?: string[];
}

function toErrorResult(error: unknown, fallback: string): IgnoredKeywordsResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

/**
 * The ✕ beside a keyword: stop ranking this word.
 *
 * `revalidatePath` is what makes the next word move up into the list — the ranking is
 * computed on the server from every document's text, so the page has to re-render for
 * the change to show. The client calls `router.refresh()` to ask for that render.
 */
export async function ignoreKeywordAction(word: string): Promise<IgnoredKeywordsResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  let result: IgnoredKeywordsResult;
  try {
    const words = setKeywordIgnored(deps.moduleRepo, deps.moduleSettingsRepo, word, true);
    result = { ok: true, words };
  } catch (error) {
    return toErrorResult(error, `Failed to ignore "${word}".`);
  }
  revalidatePath(DOCUMENTS_KEYWORDS_PATH);
  return result;
}

/**
 * The ✕ beside an ignored word: count this word again.
 *
 * Restoring a word the list doesn't hold is not an error — the end state is the same,
 * and a double-click shouldn't report a failure. That tolerance is in the use-case.
 */
export async function restoreKeywordAction(word: string): Promise<IgnoredKeywordsResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  let result: IgnoredKeywordsResult;
  try {
    const words = setKeywordIgnored(deps.moduleRepo, deps.moduleSettingsRepo, word, false);
    result = { ok: true, words };
  } catch (error) {
    return toErrorResult(error, `Failed to restore "${word}".`);
  }
  revalidatePath(DOCUMENTS_KEYWORDS_PATH);
  return result;
}
