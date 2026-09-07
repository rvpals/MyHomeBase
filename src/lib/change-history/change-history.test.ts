import { describe, expect, it } from "vitest";
import {
  getChangeHistory,
  parseInlineMarkdown,
  readChangeTag,
  summarizeChangeHistory,
} from "./change-history";
import type { ChangeHistoryRepository } from "./ports";
import { FileChangeHistoryRepository } from "./repository";

// A miniature change log covering every shape the real file uses: tagged `###`
// sections, tagged top-level bullets, indented detail bullets, note headings
// ("Also in this release", "Known issues"), a pre-convention untagged `###`
// change section, and prose.
const SAMPLE = `# Change History

## 2026-08-06 23:54 — Newest release

Some prose introducing the release.

### [Added] A brand new screen

It does a thing.

- A supporting detail, not a change in its own right.

### [Fixed] Two silent bugs

  - [Changed] Not counted — indented bullets are detail.

### [Changed] The dialog is a floating window

### Also in this release

- [Added] A small extra
- [Fixed] A small bug
- An untagged aside

### Known issues in this release

- Something still broken, but not a change we made.

## 2026-07-12 22:10 — Oldest release

- [Added] The first thing
- [Added] The second thing
- [Fixed] A data-integrity bug

## 2026-06-01 09:00 — Before the tags existed

### SQL Explorer: a Truncate button

Written before the kind tags were introduced. Still a change.

### Tetris, and a puzzle

Also a change.

### Also

- An aside that is not a change.
`;

describe("readChangeTag", () => {
  it("splits a recognised tag off the text", () => {
    expect(readChangeTag("[Added] A brand new screen")).toEqual({
      kind: "added",
      text: "A brand new screen",
    });
  });

  it("is case-insensitive on the label", () => {
    expect(readChangeTag("[FIXED] shouting")).toEqual({ kind: "fixed", text: "shouting" });
    expect(readChangeTag("[changed] quiet")).toEqual({ kind: "changed", text: "quiet" });
  });

  it("leaves untagged text alone", () => {
    expect(readChangeTag("Just a heading")).toEqual({ kind: null, text: "Just a heading" });
  });

  it("leaves an unrecognised tag in place rather than swallowing it", () => {
    // A typo should be visible on the page, not silently eaten.
    expect(readChangeTag("[Addded] typo")).toEqual({ kind: null, text: "[Addded] typo" });
  });

  it("ignores a tag that isn't at the start of the line", () => {
    expect(readChangeTag("see [Added] below")).toEqual({ kind: null, text: "see [Added] below" });
  });
});

describe("summarizeChangeHistory", () => {
  it("counts tagged sections and top-level bullets per release", () => {
    const summary = summarizeChangeHistory(SAMPLE);

    expect(summary.releases).toHaveLength(3);
    expect(summary.releases[0].title).toBe("2026-08-06 23:54 — Newest release");
    expect(summary.releases[0].counts).toEqual({
      total: 5,
      added: 2,
      changed: 1,
      fixed: 2,
      removed: 0,
      untagged: 0,
    });
    expect(summary.releases[1].counts).toEqual({
      total: 3,
      added: 2,
      changed: 0,
      fixed: 1,
      removed: 0,
      untagged: 0,
    });
  });

  it("reports the newest release as the latest", () => {
    const summary = summarizeChangeHistory(SAMPLE);
    expect(summary.latest?.title).toBe("2026-08-06 23:54 — Newest release");
  });

  it("sums every release into the all-time totals", () => {
    expect(summarizeChangeHistory(SAMPLE).allTime).toEqual({
      total: 10,
      added: 4,
      changed: 1,
      fixed: 3,
      removed: 0,
      untagged: 2,
    });
  });

  // The bug this guards: releases predating the kind tags counted zero changes,
  // so the About page showed "0 changes" for a release that shipped several.
  it("counts an untagged `###` section as a change of no particular kind", () => {
    const legacy = summarizeChangeHistory(SAMPLE).releases[2];
    expect(legacy.title).toBe("2026-06-01 09:00 — Before the tags existed");
    expect(legacy.counts.total).toBe(2);
    expect(legacy.counts.untagged).toBe(2);
  });

  it("still skips note headings, so their prose is not counted as a change", () => {
    const noteOnly = (heading: string) => `## R

### ${heading}
`;

    expect(summarizeChangeHistory(noteOnly("Known issues")).allTime.total).toBe(0);
    expect(summarizeChangeHistory(noteOnly("Behaviour worth knowing")).allTime.total).toBe(0);
    expect(summarizeChangeHistory(noteOnly("Also")).allTime.total).toBe(0);
    expect(summarizeChangeHistory(noteOnly("Also in this release")).allTime.total).toBe(0);
  });

  it("does not mistake a real change for a note when it merely starts similarly", () => {
    // The word boundary matters: "Also" is a note, "Alsatian…" is a change.
    const summary = summarizeChangeHistory(`## R

### Alsatian import, fixed
`);
    expect(summary.allTime.total).toBe(1);
    expect(summary.allTime.untagged).toBe(1);
  });

  it("counts a [Removed] item under its own kind", () => {
    const summary = summarizeChangeHistory(`## R

### [Removed] The old module
`);
    expect(summary.allTime.total).toBe(1);
    expect(summary.allTime.removed).toBe(1);
    expect(summary.allTime.untagged).toBe(0);
  });

  it("counts an untagged top-level bullet as detail, not a change", () => {
    // Asymmetry with headings is deliberate: a bare bullet supports the item above it.
    const summary = summarizeChangeHistory(`## R

### [Added] A screen

- just detail
`);
    expect(summary.allTime.total).toBe(1);
    expect(summary.allTime.untagged).toBe(0);
  });

  it("ignores note headings, indented bullets, and prose", () => {
    // "Also in this release" and "Known issues" are notes; the indented
    // `[Changed]` bullet is detail under a section that was already counted.
    const summary = summarizeChangeHistory(SAMPLE);
    expect(summary.allTime.total).toBe(10);
    expect(summary.allTime.changed).toBe(1);
  });

  it("ignores anything above the first release heading", () => {
    const stray = "# Change History\n\n- [Added] Not inside any release\n\n## R1\n\n- [Fixed] One\n";
    const summary = summarizeChangeHistory(stray);
    expect(summary.allTime).toEqual({
      total: 1,
      added: 0,
      changed: 0,
      fixed: 1,
      removed: 0,
      untagged: 0,
    });
  });

  it("returns zeroed totals and no latest release for an empty log", () => {
    const summary = summarizeChangeHistory("# Change History\n");
    expect(summary.releases).toEqual([]);
    expect(summary.latest).toBeNull();
    expect(summary.allTime).toEqual({
      total: 0,
      added: 0,
      changed: 0,
      fixed: 0,
      removed: 0,
      untagged: 0,
    });
  });

  it("handles an empty string without throwing", () => {
    expect(summarizeChangeHistory("").allTime.total).toBe(0);
  });

  it("tolerates CRLF line endings", () => {
    const summary = summarizeChangeHistory(SAMPLE.replace(/\n/g, "\r\n"));
    expect(summary.allTime).toEqual({
      total: 10,
      added: 4,
      changed: 1,
      fixed: 3,
      removed: 0,
      untagged: 2,
    });
  });
});

// Hand-written fake — no mocking framework, matching the module's port.
function fakeRepo(markdown: string | null): ChangeHistoryRepository {
  return { readChangeLog: () => markdown };
}

describe("getChangeHistory", () => {
  it("returns the log alongside its counts", () => {
    const history = getChangeHistory(fakeRepo(SAMPLE));
    expect(history.markdown).toBe(SAMPLE);
    expect(history.summary?.allTime.total).toBe(10);
  });

  it("returns nulls when there is no log to read", () => {
    expect(getChangeHistory(fakeRepo(null))).toEqual({ markdown: null, summary: null });
  });

  it("summarizes an empty log as zeroes rather than nulls", () => {
    // An existing-but-empty file is a different state from a missing one.
    const history = getChangeHistory(fakeRepo(""));
    expect(history.markdown).toBe("");
    expect(history.summary?.allTime).toEqual({
      total: 0,
      added: 0,
      changed: 0,
      fixed: 0,
      removed: 0,
      untagged: 0,
    });
  });
});

describe("parseInlineMarkdown", () => {
  it("returns a single text span for a line with no markup", () => {
    expect(parseInlineMarkdown("Just prose.")).toEqual([{ style: "text", text: "Just prose." }]);
  });

  it("splits bold, italic and code out of the surrounding text", () => {
    expect(parseInlineMarkdown("A **bold** and *italic* and `code` line")).toEqual([
      { style: "text", text: "A " },
      { style: "bold", text: "bold" },
      { style: "text", text: " and " },
      { style: "italic", text: "italic" },
      { style: "text", text: " and " },
      { style: "code", text: "code" },
      { style: "text", text: " line" },
    ]);
  });

  it("accepts the underscore spellings of bold and italic", () => {
    expect(parseInlineMarkdown("__strong__ and _slanted_")).toEqual([
      { style: "bold", text: "strong" },
      { style: "text", text: " and " },
      { style: "italic", text: "slanted" },
    ]);
  });

  it("carries a link's target on the span", () => {
    expect(parseInlineMarkdown("see [the docs](./ARCHITECTURE.md) first")).toEqual([
      { style: "text", text: "see " },
      { style: "text", text: "the docs", href: "./ARCHITECTURE.md" },
      { style: "text", text: " first" },
    ]);
  });

  it("treats asterisks and underscores inside a code span as literal", () => {
    // The real log is full of these — `**/*.ts`, `snake_case`. Emphasis must not
    // bite into a code span or the identifier renders mangled.
    expect(parseInlineMarkdown("matches `**/*.ts` and `filter_json`")).toEqual([
      { style: "text", text: "matches " },
      { style: "code", text: "**/*.ts" },
      { style: "text", text: " and " },
      { style: "code", text: "filter_json" },
    ]);
  });

  it("leaves an unterminated marker as literal text", () => {
    // A typo should show up on the page, not swallow the rest of the line.
    expect(parseInlineMarkdown("an **unclosed bold")).toEqual([
      { style: "text", text: "an **unclosed bold" },
    ]);
  });

  it("does not treat a mid-word underscore as emphasis", () => {
    expect(parseInlineMarkdown("MAX_JOURNAL_ICON_BYTES")).toEqual([
      { style: "text", text: "MAX_JOURNAL_ICON_BYTES" },
    ]);
  });

  it("returns nothing for an empty line", () => {
    expect(parseInlineMarkdown("")).toEqual([]);
  });
});

describe("FileChangeHistoryRepository", () => {
  it("reads the repo's own change log", () => {
    // The real file is the parser's most demanding input; if it ever stops
    // producing counts, the About page silently shows zeroes.
    const history = getChangeHistory(new FileChangeHistoryRepository());
    expect(history.markdown).not.toBeNull();
    expect(history.summary?.allTime.total).toBeGreaterThan(0);
  });

  it("returns null when there is no change log at the given root", () => {
    expect(new FileChangeHistoryRepository("./no-such-directory-for-tests").readChangeLog()).toBeNull();
  });
});
