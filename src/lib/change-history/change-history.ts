import type { ChangeHistoryRepository } from "./ports";
import {
  CHANGE_KINDS,
  type ChangeCounts,
  type ChangeHistory,
  type ChangeHistorySummary,
  type ChangeKind,
  type InlineSpan,
  type ReleaseSummary,
  type TaggedLine,
} from "./types";

// Pure parsing over the CHANGE_HISTORY.md text. No file access here — the
// caller supplies the markdown (see repository.ts), so the same counts are
// reachable from the web app, the CLI and a test with a string literal.

const TAG_PATTERN = /^\[(\w+)\]\s+(.*)$/;

function kindFromLabel(label: string): ChangeKind | null {
  const normalized = label.toLowerCase();
  return (CHANGE_KINDS as readonly string[]).includes(normalized) ? (normalized as ChangeKind) : null;
}

/**
 * Split a leading `[Added]` / `[Changed]` / `[Fixed]` tag off a line of body
 * text. Returns `kind: null` and the text unchanged when there is no tag — an
 * unrecognised bracket (`[TODO] …`) is left alone rather than swallowed, so a
 * typo shows up in the rendered page instead of vanishing.
 */
export function readChangeTag(text: string): TaggedLine {
  const match = TAG_PATTERN.exec(text.trim());
  if (!match) return { kind: null, text };

  const kind = kindFromLabel(match[1]);
  return kind ? { kind, text: match[2] } : { kind: null, text };
}

// Inline markup, in precedence order. `code` is first deliberately: backticks in
// this log wrap identifiers and paths (`**/*.ts`, `snake_case`) where an asterisk
// or underscore is a literal character, so a code span is claimed before any
// emphasis rule can bite into it. Links come next so their label can't be split.
//
// Each alternative captures its content in group 1 (links also capture a target
// in group 2), and the union is matched left-to-right in one pass.
const INLINE_PATTERN = new RegExp(
  [
    "`([^`]+)`", // code
    "\\[([^\\]]+)\\]\\(([^)\\s]+)\\)", // [label](target)
    "\\*\\*([^*]+)\\*\\*", // **bold**
    // The underscore spellings require a word boundary either side, per
    // CommonMark's intraword rule. Without it a bare constant like
    // MAX_JOURNAL_ICON_BYTES parses as "MAX" + italic "JOURNAL" + "ICON_BYTES",
    // and this log names constants in prose constantly.
    "(?<![A-Za-z0-9])__([^_]+)__(?![A-Za-z0-9])", // __bold__
    "\\*([^*\\n]+)\\*", // *italic*
    "(?<![A-Za-z0-9])_([^_\\n]+)_(?![A-Za-z0-9])", // _italic_
  ].join("|"),
  "g",
);

/**
 * Split a line of body text into styled runs.
 *
 * Handles the inline markdown this log actually uses — code spans, links, bold
 * and italic — and leaves anything else as literal text, so an unsupported
 * construct renders visibly rather than disappearing. Nesting is not supported:
 * the outermost match wins and its content is taken literally, which keeps this
 * a single pass and is enough for a change log.
 */
export function parseInlineMarkdown(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let lastIndex = 0;

  function pushText(value: string) {
    if (value.length > 0) spans.push({ style: "text", text: value });
  }

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const [whole, code, linkLabel, linkHref, boldStars, boldScores, italicStars, italicScores] =
      match;
    pushText(text.slice(lastIndex, match.index));

    if (code !== undefined) spans.push({ style: "code", text: code });
    else if (linkLabel !== undefined)
      spans.push({ style: "text", text: linkLabel, href: linkHref });
    else if (boldStars !== undefined) spans.push({ style: "bold", text: boldStars });
    else if (boldScores !== undefined) spans.push({ style: "bold", text: boldScores });
    else if (italicStars !== undefined) spans.push({ style: "italic", text: italicStars });
    else if (italicScores !== undefined) spans.push({ style: "italic", text: italicScores });

    lastIndex = match.index + whole.length;
  }

  pushText(text.slice(lastIndex));
  return spans;
}

function emptyCounts(): ChangeCounts {
  return { total: 0, added: 0, changed: 0, fixed: 0, removed: 0, untagged: 0 };
}

/** Record one counted item. `null` is a pre-convention section with no kind tag. */
function tally(counts: ChangeCounts, kind: ChangeKind | null): void {
  if (kind === null) counts.untagged += 1;
  else counts[kind] += 1;
  counts.total += 1;
}

function sumCounts(all: ChangeCounts[]): ChangeCounts {
  return all.reduce<ChangeCounts>((running, counts) => {
    running.total += counts.total;
    running.added += counts.added;
    running.changed += counts.changed;
    running.fixed += counts.fixed;
    running.removed += counts.removed;
    running.untagged += counts.untagged;
    return running;
  }, emptyCounts());
}

/**
 * A `### ` heading that introduces commentary rather than a change, and so is
 * skipped even though it has no kind tag.
 *
 * Matched on the heading text because nothing else in the markup separates these
 * from a genuine untagged change: an "Also" section's body is sometimes tagged
 * bullets and sometimes plain ones, so "does it have tagged children?" misreads
 * half of them. This is the closed set the log actually uses — anything else
 * untagged is treated as a change.
 */
const NOTE_HEADING_PATTERN = /^(also\b|known issues\b|behaviou?r worth knowing\b)/i;

/**
 * Decide whether a line is a countable change, and of which kind.
 *
 * Returns `null` for a line that is not an item at all, and
 * `{ kind: null }` for an item that counts but carries no kind tag.
 *
 * The two item shapes are treated differently on purpose:
 * - a `### ` heading is a change whether or not it is tagged, because the tagging
 *   convention postdates part of this log — unless it is a note heading;
 * - a `- ` bullet counts only when tagged, because an untagged bullet is detail
 *   for the item above it. Indented bullets never count, tagged or not.
 */
function countableItem(line: string): { kind: ChangeKind | null } | null {
  if (line.startsWith("### ")) {
    const body = line.slice(4);
    const { kind } = readChangeTag(body);
    if (kind) return { kind };
    return NOTE_HEADING_PATTERN.test(body.trim()) ? null : { kind: null };
  }

  if (line.startsWith("- ")) {
    const { kind } = readChangeTag(line.slice(2));
    return kind ? { kind } : null;
  }

  return null;
}

/**
 * Count the tagged changes in a change log, per release and in total.
 *
 * A release is a `## ` heading; a change is a `### ` heading beneath it (tagged or
 * not — see `countableItem`) or a tagged top-level `- ` bullet. Anything before the
 * first release heading (the document title) is ignored.
 */
export function summarizeChangeHistory(markdown: string): ChangeHistorySummary {
  const releases: ReleaseSummary[] = [];
  let current: ReleaseSummary | null = null;

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trimEnd();

    if (line.startsWith("## ")) {
      current = { title: line.slice(3).trim(), counts: emptyCounts() };
      releases.push(current);
      continue;
    }

    if (!current) continue;

    const item = countableItem(line);
    if (item) tally(current.counts, item.kind);
  }

  return {
    releases,
    latest: releases[0] ?? null,
    allTime: sumCounts(releases.map((release) => release.counts)),
  };
}

/**
 * The change log and its counts, ready to hand to a view or print from the CLI.
 * `markdown` and `summary` are both null when there is no log to read.
 */
export function getChangeHistory(repo: ChangeHistoryRepository): ChangeHistory {
  const markdown = repo.readChangeLog();
  return {
    markdown,
    summary: markdown === null ? null : summarizeChangeHistory(markdown),
  };
}
