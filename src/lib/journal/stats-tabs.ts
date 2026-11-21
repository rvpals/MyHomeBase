import { z } from "zod";
import { countEntriesByYearAndMonth, listEntries, listTopCategories, listTopTags } from "./journal";
import type { JournalRepository } from "./ports";
import type { JournalTaxonomyCount, JournalYearCount } from "./types";
import { topWords, type JournalWordCount } from "./word-stats";

// The three tabs of the Journal home screen's "Interesting Journal Stats" card, and
// the data each one needs. Loaded one tab at a time, when the reader opens it: the
// Words ranking tokenizes every entry, so computing all three on every visit to the
// home screen paid for lists most visits never looked at.

/** The tab keys, in the order the card draws them. */
export const JOURNAL_STATS_TABS = ["taxonomy", "count", "words"] as const;

export type JournalStatsTab = (typeof JOURNAL_STATS_TABS)[number];

/** Boundary schema for the tab key — the server action and any CLI caller parse with it. */
export const journalStatsTabSchema = z.enum(JOURNAL_STATS_TABS);

/** How many categories the first tab ranks. */
export const JOURNAL_STATS_TAXONOMY_LIMIT = 10;

/** How many tags the first tab ranks — more than categories, since there are more tags. */
export const JOURNAL_STATS_TOP_TAGS_LIMIT = 20;

export type JournalStatsTabData =
  | { tab: "taxonomy"; topTags: JournalTaxonomyCount[]; topCategories: JournalTaxonomyCount[] }
  | { tab: "count"; yearCounts: JournalYearCount[] }
  | { tab: "words"; words: JournalWordCount[]; limit: number };

export interface JournalStatsOptions {
  /** The reader's Top Words length (Journal → Preferences). */
  topWordLimit: number;
  /** Words the reader dismissed from the ranking. */
  excludedWords: readonly string[];
}

/**
 * The data for one tab. Throws on an unknown tab key — validate with
 * `journalStatsTabSchema` first, which is what this does on entry.
 */
export function loadJournalStatsTab(
  repo: JournalRepository,
  tab: unknown,
  options: JournalStatsOptions,
): JournalStatsTabData {
  const parsed = journalStatsTabSchema.parse(tab);

  switch (parsed) {
    case "taxonomy":
      return {
        tab: "taxonomy",
        topTags: listTopTags(repo, JOURNAL_STATS_TOP_TAGS_LIMIT),
        topCategories: listTopCategories(repo, JOURNAL_STATS_TAXONOMY_LIMIT),
      };
    case "count":
      return { tab: "count", yearCounts: countEntriesByYearAndMonth(repo) };
    case "words":
      return {
        tab: "words",
        words: topWords(listEntries(repo), options.topWordLimit, options.excludedWords),
        // The asked-for figure, not `words.length` — the card's line names it, and a
        // thin journal returns fewer words than asked.
        limit: options.topWordLimit,
      };
  }
}
