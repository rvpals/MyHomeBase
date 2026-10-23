// The shapes Topics works in. No behaviour here — see match.ts, episodes.ts
// and cooccurrence.ts for the functions that produce these.

import type { JournalEntry } from "@/lib/journal/types";

/**
 * Why an entry turned up for a topic.
 *
 * Carried all the way to the screen rather than collapsed into a score, because
 * "matched because you tagged it HSA" and "matched because the word appears
 * somewhere in the body" deserve very different trust from a reader. The UI
 * badges each row with this.
 */
export type TopicMatchKind = "tag" | "category" | "title" | "body";

/**
 * How confident each kind of match is, before the fuzzy score scales it.
 *
 * Tags and categories outrank text because they are deliberate: the reader put
 * them there to mean something. A title mention is usually meaningful too; a
 * body mention is often incidental, which is why body matching is off by
 * default and weighted lowest when on.
 */
export const MATCH_KIND_WEIGHT: Record<TopicMatchKind, number> = {
  tag: 1,
  category: 1,
  title: 0.8,
  body: 0.5,
};

/** One reason one entry matched, with the text that caused it. */
export interface TopicMatchReason {
  kind: TopicMatchKind;
  /**
   * The matching tag/category name, or `""` for a title/body hit where the
   * match is against the entry's own text rather than a named thing.
   */
  name: string;
  /** The fuzzy score for this reason alone, 0–1. */
  score: number;
}

/**
 * An entry that matched a topic, with every reason it did.
 *
 * Holds the whole `JournalEntry` rather than a projection: the graph needs
 * `categories`/`tags`, the timeline needs `date`, and the list needs the title
 * and an excerpt. Projecting would mean three overlapping shapes and a reason
 * to re-read the entry for each view.
 */
export interface TopicEntry {
  entry: JournalEntry;
  reasons: TopicMatchReason[];
  /**
   * The entry's overall relevance, 0–1 — the best single reason, not the sum.
   *
   * A sum would rank an entry matching weakly three ways above one matching
   * exactly on its tag, which inverts what a reader means by "most relevant".
   */
  score: number;
  /**
   * True when the entry's text could not be read because it is encrypted.
   *
   * Such an entry can still match by tag or category (those rows are
   * plaintext), and it still appears — with its title masked — so the graph
   * does not silently lie about what is in the journal.
   */
  isMasked: boolean;
}

/** Everything one topic lookup found. */
export interface TopicResult {
  /** The term as the reader typed it, for echoing back in the UI. */
  term: string;
  entries: TopicEntry[];
  /**
   * How many matched entries are encrypted, so the screen can say so plainly
   * rather than quietly showing fewer nodes than the journal contains.
   */
  maskedCount: number;
  /**
   * How many *additional* entries would have matched had body matching been on.
   *
   * Always 0 when it is on. This is what lets the screen offer "N more entries
   * mention this term" with a link to Preferences — a setting that silently
   * shrinks results is worse than no setting.
   */
  bodyOnlyCount: number;
  /** The distinct tag/category names that matched the term, for the header. */
  matchedNames: string[];
}

/**
 * A run of entries close together in time — one episode of a topic.
 *
 * This is what turns a flat tag into a narrative: an HSA enrollment in
 * November, a dispute in March, a reimbursement in April read as three events
 * rather than one undifferentiated pile of twelve entries.
 */
export interface TopicEpisode {
  /** First date in the run, "YYYY-MM-DD". */
  startDate: string;
  /** Last date in the run, "YYYY-MM-DD". Equal to `startDate` for a single day. */
  endDate: string;
  /** The entries in the run, in date order. Never empty. */
  entries: TopicEntry[];
}

/** A tag or category that keeps company with the topic. */
export interface TopicCooccurrence {
  name: string;
  kind: "tag" | "category";
  /** How many of the topic's entries also carry this name. */
  entryCount: number;
  /**
   * `entryCount` as a fraction of the topic's entries, 0–1 — how reliably the
   * two travel together, independent of how big the topic is.
   */
  share: number;
}
