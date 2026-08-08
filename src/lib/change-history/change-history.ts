import type { ChangeHistoryRepository } from "./ports";
import {
  CHANGE_KINDS,
  type ChangeCounts,
  type ChangeHistory,
  type ChangeHistorySummary,
  type ChangeKind,
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

function emptyCounts(): ChangeCounts {
  return { total: 0, added: 0, changed: 0, fixed: 0 };
}

function tally(counts: ChangeCounts, kind: ChangeKind): void {
  counts[kind] += 1;
  counts.total += 1;
}

function sumCounts(all: ChangeCounts[]): ChangeCounts {
  return all.reduce<ChangeCounts>((running, counts) => {
    running.total += counts.total;
    running.added += counts.added;
    running.changed += counts.changed;
    running.fixed += counts.fixed;
    return running;
  }, emptyCounts());
}

/**
 * Strip the tag off a `### ` heading or a top-level `- ` bullet, if it carries
 * one. Indented bullets are supporting detail for the item above them, not
 * items in their own right, so only column-zero bullets count.
 */
function itemKind(line: string): ChangeKind | null {
  let body: string;
  if (line.startsWith("### ")) body = line.slice(4);
  else if (line.startsWith("- ")) body = line.slice(2);
  else return null;

  return readChangeTag(body).kind;
}

/**
 * Count the tagged changes in a change log, per release and in total.
 *
 * A release is a `## ` heading; a change is any tagged `### ` heading or
 * top-level `- ` bullet beneath it. Anything before the first release heading
 * (the document title) is ignored, as is any untagged line.
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

    const kind = itemKind(line);
    if (kind) tally(current.counts, kind);
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
