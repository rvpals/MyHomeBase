// Candidate topics for the picker — "what can I look at?"
//
// A topic is not a stored thing (see the Topics plan: the term in the URL is
// the whole state), so there is no list of topics to read. The journal's own
// taxonomy is the list: every tag and category a reader has used is a topic
// they can ask about, and the ones on the most entries are the ones worth
// offering first.

import { termSimilarity } from "./fuzzy";
import type { JournalTaxonomyCount } from "@/lib/journal/types";

/** One offered topic. */
export interface TopicSuggestion {
  name: string;
  kind: "tag" | "category";
  /** How many entries carry this name — what the picker ranks and shows by. */
  entryCount: number;
}

export interface SuggestTopicsOptions {
  /**
   * What the reader has typed so far. Blank offers the most-used names;
   * otherwise the list is narrowed by the same fuzzy rule the matcher uses, so
   * typing `hsa` surfaces `Health Savings Account`.
   */
  query?: string;
  /** How many to return. */
  limit?: number;
  /**
   * Names on fewer entries than this are left out. 1 by default — a name used
   * once is a legitimate topic, just a small one. Raised by the caller when
   * the picker would otherwise be unreadably long.
   */
  minEntryCount?: number;
}

/**
 * Ranked topic candidates drawn from the journal's tags and categories.
 *
 * With no query, ordered by entry count descending — the biggest subjects
 * first, which is what a reader opening an empty picker wants to browse.
 *
 * With a query, ordered by fuzzy score first and entry count second: a strong
 * name match on a small tag should beat a weak match on a huge one, otherwise
 * typing a specific term still surfaces the same three popular names.
 *
 * Both orders break ties alphabetically so the list does not reshuffle between
 * keystrokes.
 */
export function suggestTopics(
  tags: readonly JournalTaxonomyCount[],
  categories: readonly JournalTaxonomyCount[],
  options: SuggestTopicsOptions = {},
): TopicSuggestion[] {
  const query = (options.query ?? "").trim();
  const limit = options.limit ?? 20;
  const minEntryCount = options.minEntryCount ?? 1;

  const all: TopicSuggestion[] = [
    ...tags.map((row) => ({ name: row.name, kind: "tag" as const, entryCount: row.entryCount })),
    ...categories.map((row) => ({
      name: row.name,
      kind: "category" as const,
      entryCount: row.entryCount,
    })),
  ].filter((row) => row.name.trim() !== "" && row.entryCount >= minEntryCount);

  if (query === "") {
    return all
      .sort((a, b) => {
        if (b.entryCount !== a.entryCount) return b.entryCount - a.entryCount;
        return a.name.localeCompare(b.name);
      })
      .slice(0, limit);
  }

  return all
    .map((row) => ({ row, score: termSimilarity(query, row.name) }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.row.entryCount !== a.row.entryCount) return b.row.entryCount - a.row.entryCount;
      return a.row.name.localeCompare(b.row.name);
    })
    .slice(0, limit)
    .map((scored) => scored.row);
}
