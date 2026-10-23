// Turning a term into the entries that are about it.
//
// Pure over data: takes the entries and the two settings, returns matches. It
// never reads `module_settings` itself — `matchBody` and the threshold arrive
// as arguments, so the same function serves the web view, the CLI (where flags
// can override the stored preference for one run) and the tests.

import type { JournalEntry } from "@/lib/journal/types";
import {
  DEFAULT_SIMILARITY_THRESHOLD,
  containsTermAsWords,
  termSimilarity,
} from "./fuzzy";
import { MATCH_KIND_WEIGHT } from "./types";
import type { TopicEntry, TopicMatchReason, TopicResult } from "./types";

export interface MatchTopicOptions {
  /**
   * Whether to search entry bodies as well as tags, categories and titles.
   *
   * Stored as the `topic_match_body` journal preference, default off. Off, the
   * result still reports how many entries body matching *would* have added, so
   * the screen can offer the setting at the moment it would help.
   */
  matchBody: boolean;
  /** Fuzzy cutoff; defaults to the shared threshold. */
  threshold?: number;
}

/**
 * Every reason one entry matches a term.
 *
 * Tags and categories are scored by fuzzy similarity against the term, so
 * `HSA` finds a tag spelled `H.S.A.`. Title and body are scored by whole-word
 * containment instead — see `containsTermAsWords` for why similarity is the
 * wrong tool against a long text.
 *
 * An encrypted entry contributes no title or body reason: those columns read as
 * `""` and the real text is unreadable without the entry's password. Its tags
 * and categories still count, which is the whole reason such an entry can
 * appear at all.
 */
function reasonsFor(
  entry: JournalEntry,
  term: string,
  matchBody: boolean,
  threshold: number,
): TopicMatchReason[] {
  const reasons: TopicMatchReason[] = [];

  for (const name of entry.tags) {
    const score = termSimilarity(term, name, threshold);
    if (score > 0) reasons.push({ kind: "tag", name, score });
  }

  for (const name of entry.categories) {
    const score = termSimilarity(term, name, threshold);
    if (score > 0) reasons.push({ kind: "category", name, score });
  }

  // Nothing readable to search on an encrypted entry, and `title`/`content`
  // are `""` rather than absent — so this must be checked rather than relying
  // on the text scan finding nothing.
  if (!entry.isEncrypted) {
    if (containsTermAsWords(entry.title, term)) {
      reasons.push({ kind: "title", name: "", score: 1 });
    }
    if (matchBody && containsTermAsWords(entry.content, term)) {
      reasons.push({ kind: "body", name: "", score: 1 });
    }
  }

  return reasons;
}

/**
 * The entry's overall relevance: the strongest single reason, weighted by how
 * much that kind of match is worth.
 *
 * Deliberately a maximum rather than a sum — see `TopicEntry.score`.
 */
function scoreOf(reasons: readonly TopicMatchReason[]): number {
  let best = 0;
  for (const reason of reasons) {
    const weighted = reason.score * MATCH_KIND_WEIGHT[reason.kind];
    if (weighted > best) best = weighted;
  }
  return best;
}

/**
 * Finds the entries a topic is about.
 *
 * Sorted by score descending, then by date descending — so the most relevant
 * entry leads, and among equally relevant ones the most recent does. Ties
 * broken by id so the order is stable across calls, which matters because the
 * graph seeds node positions from array index and a wobbling order would
 * reshuffle the picture on every refresh.
 *
 * O(entries x names). Fine at journal scale: a few thousand entries with a
 * handful of names each is a few tens of thousands of short string comparisons,
 * done once per lookup rather than per frame.
 */
export function matchTopic(
  entries: readonly JournalEntry[],
  term: string,
  options: MatchTopicOptions,
): TopicResult {
  const threshold = options.threshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const trimmed = term.trim();

  if (trimmed === "") {
    return { term, entries: [], maskedCount: 0, bodyOnlyCount: 0, matchedNames: [] };
  }

  const matched: TopicEntry[] = [];
  const names = new Set<string>();
  let maskedCount = 0;
  let bodyOnlyCount = 0;

  for (const entry of entries) {
    const reasons = reasonsFor(entry, trimmed, options.matchBody, threshold);

    if (reasons.length === 0) {
      // Would turning body matching on have caught this one? Asked only when it
      // is off and nothing else matched, so the screen can quantify what the
      // setting is hiding without the reader having to flip it to find out.
      if (!options.matchBody && !entry.isEncrypted && containsTermAsWords(entry.content, trimmed)) {
        bodyOnlyCount += 1;
      }
      continue;
    }

    for (const reason of reasons) {
      if (reason.name !== "") names.add(reason.name);
    }
    if (entry.isEncrypted) maskedCount += 1;

    matched.push({
      entry,
      reasons,
      score: scoreOf(reasons),
      isMasked: entry.isEncrypted,
    });
  }

  matched.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.entry.date !== a.entry.date) return b.entry.date < a.entry.date ? -1 : 1;
    return a.entry.id - b.entry.id;
  });

  return {
    term,
    entries: matched,
    maskedCount,
    bodyOnlyCount,
    matchedNames: [...names].sort((a, b) => a.localeCompare(b)),
  };
}
