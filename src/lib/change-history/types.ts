// Domain model for CHANGE_HISTORY.md — the release log rendered on Admin → About.
//
// Every logged change carries a kind tag written into the markdown itself
// (`### [Added] …` or `- [Fixed] …`). The tag, not a keyword guess, is what the
// counts are built from: an untagged heading is a container or a note, never a
// change.

export const CHANGE_KINDS = ["added", "changed", "fixed"] as const;

export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** How many changes of each kind, plus their sum. */
export interface ChangeCounts {
  total: number;
  added: number;
  changed: number;
  fixed: number;
}

/** One dated `## …` entry in the log. */
export interface ReleaseSummary {
  /** The heading text with the leading `## ` removed, e.g. "2026-08-06 23:54 — …". */
  title: string;
  counts: ChangeCounts;
}

export interface ChangeHistorySummary {
  /** Every release in file order — newest first, as the log is written. */
  releases: ReleaseSummary[];
  /** The newest release, or null when the log holds no releases at all. */
  latest: ReleaseSummary | null;
  /** Totals across every release. */
  allTime: ChangeCounts;
}

/** A markdown line split into its kind tag (if any) and the remaining text. */
export interface TaggedLine {
  kind: ChangeKind | null;
  text: string;
}

/**
 * One run of body text with a single inline style applied. A line of markdown
 * parses to a list of these, which a view maps to elements — keeping the regex
 * work out of the `.tsx` and under test.
 *
 * `code` wins over the emphasis styles: backticks in this log wrap identifiers
 * and file paths, where a `*` or `_` is literal and must not be read as markup.
 */
export type InlineStyle = "text" | "bold" | "italic" | "code";

export interface InlineSpan {
  style: InlineStyle;
  text: string;
  /** Set when the span was written as a link; the view renders an anchor. */
  href?: string;
}

/** The log itself plus its counts. Both null when there is no log to read. */
export interface ChangeHistory {
  markdown: string | null;
  summary: ChangeHistorySummary | null;
}
