// Word frequency across the journal's own prose — what the home screen's
// "Top Words" list ranks, beside Top Tags and Top Categories. How many words it
// shows is the reader's own `topWordLimit` preference, passed in as `limit`.
//
// Pure functions over entries that are already in memory: no repository, no I/O,
// no cache. The caller reads the entries and hands them in, which is what lets
// the whole thing be unit-tested without a database.
//
// ## What lives here and what moved
//
// `tokenizeWords`, `STOPWORDS` and the length floor moved to
// `src/lib/shared/word-tokens.ts` when the Document Library's Keywords section
// started ranking words too. They are properties of **English**, not of either
// module, and two copies would have drifted the first time either was tuned.
// They are re-exported below so every existing Journal caller is unchanged.
//
// What stays here is everything specific to the Journal: the reader's own
// excluded-words setting and its parsing, and `topWords` over `JournalEntry`.

import type { JournalEntry } from "./types";
import {
  normalizeWord,
  parseWordList,
  serializeWordList,
  tokenizeWords,
} from "@/lib/shared/word-tokens";

// Re-exported rather than moved out of the Journal's surface: `journal/index.ts`
// exports `tokenizeWords`, and several callers import it from there. Pointing them
// at the shared module instead would be a rename across files that this extraction
// has no reason to touch.
export { tokenizeWords };

/** One ranked word and how many times it was used. */
export interface JournalWordCount {
  word: string;
  /**
   * Total occurrences across every entry, **not** the number of entries
   * containing it — a word used four times in one entry counts four.
   */
  count: number;
}

/**
 * Puts a word into the form the tokenizer compares against: lowercased, trimmed,
 * surrounding apostrophes and a possessive tail removed.
 *
 * Every write path goes through this. Storing `"Beach "` instead would leave a
 * row that looks right in the Preferences list and silently never matches a
 * token, which is the most confusing way for this feature to fail. Returns `""`
 * for anything that can't be a ranked word (blank, too short, digits), and the
 * caller rejects on that rather than storing an unusable row.
 *
 * A thin alias over the shared `normalizeWord` rather than its own copy of the
 * rules: it must agree with `tokenizeWords` exactly, and the surest way to keep
 * two functions in agreement is for one of them to be the other. The name stays
 * because it is what the Journal's preference screen and its actions call.
 */
export function normalizeExcludedWord(raw: string): string {
  return normalizeWord(raw);
}

/**
 * Parses the stored `excluded_words` setting into a word list.
 *
 * Tolerant by design: the value is a comma-joined string in a hand-editable
 * settings row, so blanks, stray spacing, casing and duplicates are all
 * normalized away rather than trusted. Order is preserved (first occurrence
 * wins) so the Preferences list doesn't reshuffle on every save.
 */
export function parseExcludedWords(stored: string): string[] {
  return parseWordList(stored);
}

/**
 * The inverse of `parseExcludedWords` — normalized, deduped, comma-joined.
 *
 * `""` for an empty list, which the caller must turn into *removing* the
 * setting row rather than storing a blank: the module-settings schema rejects an
 * empty value.
 */
export function serializeExcludedWords(words: readonly string[]): string {
  return serializeWordList(words);
}

/**
 * The `limit` most-used words across every entry's title and content, most used
 * first.
 *
 * Ties break alphabetically, so the list is stable: two words used the same
 * number of times would otherwise swap places between renders depending on the
 * order the entries came back in, which reads as the page flickering.
 *
 * Returns fewer than `limit` when the journal doesn't have that many distinct
 * words, and an empty array for an empty journal — the caller renders its own
 * empty state rather than being handed placeholder rows.
 */
export function topWords(
  entries: readonly JournalEntry[],
  limit = 10,
  excludedWords: readonly string[] = [],
): JournalWordCount[] {
  if (limit <= 0) return [];

  // Layered on top of STOPWORDS rather than replacing it: the built-in list is a
  // property of English and stays the floor, while this is the reader's own set
  // of dismissals. Normalized on the way in so a hand-edited settings row with
  // odd casing still matches.
  const extra = new Set(excludedWords.map(normalizeExcludedWord).filter(Boolean));

  const counts = new Map<string, number>();
  for (const entry of entries) {
    // An encrypted entry has nothing to count: its title and content columns are
    // blank and the real text is unreadable without that entry's own password
    // (migration 0131). Skipped rather than tokenized, so the ranking reflects
    // the prose it can actually see instead of being diluted by empty strings.
    if (entry.isEncrypted) continue;
    // Title and content both count, so a word used only in titles still ranks.
    // Joined with a space so the last word of the title can't fuse with the
    // first of the content.
    for (const word of tokenizeWords(`${entry.title} ${entry.content}`, extra)) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((left, right) => right.count - left.count || left.word.localeCompare(right.word))
    .slice(0, limit);
}
