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
// sections, tagged top-level bullets, indented detail bullets, untagged
// container and informational headings, and prose.
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

    expect(summary.releases).toHaveLength(2);
    expect(summary.releases[0].title).toBe("2026-08-06 23:54 — Newest release");
    expect(summary.releases[0].counts).toEqual({ total: 5, added: 2, changed: 1, fixed: 2 });
    expect(summary.releases[1].counts).toEqual({ total: 3, added: 2, changed: 0, fixed: 1 });
  });

  it("reports the newest release as the latest", () => {
    const summary = summarizeChangeHistory(SAMPLE);
    expect(summary.latest?.title).toBe("2026-08-06 23:54 — Newest release");
  });

  it("sums every release into the all-time totals", () => {
    expect(summarizeChangeHistory(SAMPLE).allTime).toEqual({
      total: 8,
      added: 4,
      changed: 1,
      fixed: 3,
    });
  });

  it("ignores untagged headings, indented bullets, and prose", () => {
    // "Also in this release" and "Known issues" are containers; the indented
    // `[Changed]` bullet is detail under a section that was already counted.
    const summary = summarizeChangeHistory(SAMPLE);
    expect(summary.allTime.total).toBe(8);
    expect(summary.allTime.changed).toBe(1);
  });

  it("ignores anything above the first release heading", () => {
    const stray = "# Change History\n\n- [Added] Not inside any release\n\n## R1\n\n- [Fixed] One\n";
    const summary = summarizeChangeHistory(stray);
    expect(summary.allTime).toEqual({ total: 1, added: 0, changed: 0, fixed: 1 });
  });

  it("returns zeroed totals and no latest release for an empty log", () => {
    const summary = summarizeChangeHistory("# Change History\n");
    expect(summary.releases).toEqual([]);
    expect(summary.latest).toBeNull();
    expect(summary.allTime).toEqual({ total: 0, added: 0, changed: 0, fixed: 0 });
  });

  it("handles an empty string without throwing", () => {
    expect(summarizeChangeHistory("").allTime.total).toBe(0);
  });

  it("tolerates CRLF line endings", () => {
    const summary = summarizeChangeHistory(SAMPLE.replace(/\n/g, "\r\n"));
    expect(summary.allTime).toEqual({ total: 8, added: 4, changed: 1, fixed: 3 });
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
    expect(history.summary?.allTime.total).toBe(8);
  });

  it("returns nulls when there is no log to read", () => {
    expect(getChangeHistory(fakeRepo(null))).toEqual({ markdown: null, summary: null });
  });

  it("summarizes an empty log as zeroes rather than nulls", () => {
    // An existing-but-empty file is a different state from a missing one.
    const history = getChangeHistory(fakeRepo(""));
    expect(history.markdown).toBe("");
    expect(history.summary?.allTime).toEqual({ total: 0, added: 0, changed: 0, fixed: 0 });
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
