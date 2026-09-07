// Domain model for CHANGE_HISTORY.md — the release log rendered on Admin → About.
//
// A logged change normally carries a kind tag written into the markdown itself
// (`### [Added] …` or `- [Fixed] …`), and that tag — not a keyword guess — is
// what classifies it.
//
// The tagging convention arrived partway through this log's life, so releases
// before it write a change as a plain `### ` section with no tag at all. Those
// sections are still changes and are counted as `untagged`: dropping them made
// entire releases report "0 changes" on the About page while their bodies listed
// five or six things that shipped. What an untagged `### ` is *not* allowed to be
// is a note heading — "Also", "Known issues …" — whose body is commentary
// rather than a change; those are still skipped. See NOTE_HEADING_PATTERN.
//
// Bullets are unchanged: only a *tagged* top-level `- ` bullet counts, because an
// untagged bullet is supporting detail for the item above it.

export const CHANGE_KINDS = ["added", "changed", "fixed", "removed"] as const;

export type ChangeKind = (typeof CHANGE_KINDS)[number];

/**
 * How many changes of each kind, plus their sum.
 *
 * `untagged` holds the pre-convention `### ` sections that carry no kind tag. They
 * count toward `total` but belong to no kind, so the four kind counts plus
 * `untagged` always add up to `total`.
 */
export interface ChangeCounts {
  total: number;
  added: number;
  changed: number;
  fixed: number;
  removed: number;
  untagged: number;
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
