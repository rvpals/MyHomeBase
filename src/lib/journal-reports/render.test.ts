import { describe, expect, it } from "vitest";
import type { JournalEntry } from "@/lib/journal";
import { escapeHtml, renderReport, wrapReportDocument } from "./render";
import type { JournalReport, JournalReportDetail, ReportPartKind } from "./types";

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: 1,
    date: "2026-07-27",
    time: "",
    title: "A day out",
    content: "We walked to the harbour.",
    placeName: "Oslo",
    isPinned: false,
    isLocked: false,
    isEncrypted: false,
    titleEncrypted: "",
    contentEncrypted: "",
    passwordHint: "",
    categories: [],
    tags: [],
    locations: [],
    source: "",
    externalId: "",
    externalContent: "",
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    ...overrides,
  } as JournalEntry;
}

function report(overrides: Partial<JournalReport> = {}): JournalReport {
  return {
    id: 1,
    name: "Test Report",
    description: "",
    whereMode: "filter",
    whereQuery: "",
    whereSql: "",
    sortField: "date",
    sortDirection: "desc",
    maxRows: 0,
    isBuiltin: false,
    sortOrder: 1,
    createdAt: "2026-10-07T00:00:00.000Z",
    updatedAt: "2026-10-07T00:00:00.000Z",
    ...overrides,
  };
}

function details(parts: { part: ReportPartKind; html: string }[]): JournalReportDetail[] {
  return parts.map((part, index) => ({
    id: index + 1,
    reportId: 1,
    part: part.part,
    html: part.html,
    sortOrder: index,
  }));
}

const AT = new Date("2026-10-07T09:30:00.000Z");

describe("escapeHtml", () => {
  it("escapes the five characters that matter", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("escapes ampersands before the entities it introduces", () => {
    // Order matters: escaping < first would turn &lt; into &amp;lt;.
    expect(escapeHtml("a & b < c")).toBe("a &amp; b &lt; c");
  });
});

describe("renderReport", () => {
  it("repeats the row part once per entry", () => {
    const rendered = renderReport({
      report: report(),
      details: details([{ part: "row", html: "<li>{{title}}</li>" }]),
      entries: [entry({ id: 1, title: "One" }), entry({ id: 2, title: "Two" })],
      generatedAt: AT,
    });

    expect(rendered.html).toContain("<li>One</li>");
    expect(rendered.html).toContain("<li>Two</li>");
    expect(rendered.entryCount).toBe(2);
  });

  it("renders header and footer once each, around the rows", () => {
    const rendered = renderReport({
      report: report(),
      details: details([
        { part: "header", html: "<h1>Start</h1>" },
        { part: "row", html: "<p>{{title}}</p>" },
        { part: "footer", html: "<p>End</p>" },
      ]),
      entries: [entry({ title: "Middle" })],
      generatedAt: AT,
    });

    expect(rendered.html.indexOf("Start")).toBeLessThan(rendered.html.indexOf("Middle"));
    expect(rendered.html.indexOf("Middle")).toBeLessThan(rendered.html.indexOf("End"));
  });

  it("escapes entry text, so an entry titled with markup prints as text", () => {
    const rendered = renderReport({
      report: report(),
      details: details([{ part: "row", html: "<p>{{title}}</p>" }]),
      entries: [entry({ title: "<b>Bold</b> & <script>alert(1)</script>" })],
      generatedAt: AT,
    });

    expect(rendered.html).toContain("&lt;b&gt;Bold&lt;/b&gt;");
    expect(rendered.html).not.toContain("<script>");
  });

  it("keeps line breaks in content as <br>", () => {
    const rendered = renderReport({
      report: report(),
      details: details([{ part: "row", html: "<div>{{content}}</div>" }]),
      entries: [entry({ content: "Line one\nLine two" })],
      generatedAt: AT,
    });

    expect(rendered.html).toContain("Line one<br>");
    expect(rendered.html).toContain("Line two");
  });

  it("numbers rows from 1", () => {
    const rendered = renderReport({
      report: report(),
      details: details([{ part: "row", html: "<p>{{index}}. {{title}}</p>" }]),
      entries: [entry({ id: 1, title: "First" }), entry({ id: 2, title: "Second" })],
      generatedAt: AT,
    });

    expect(rendered.html).toContain("1. First");
    expect(rendered.html).toContain("2. Second");
  });

  it("joins categories, tags and locations with commas", () => {
    const rendered = renderReport({
      report: report(),
      details: details([{ part: "row", html: "<p>{{categories}}|{{tags}}|{{locations}}</p>" }]),
      entries: [
        entry({
          categories: ["Travel", "Family"],
          tags: ["beach"],
          locations: [
            { id: 1, entryId: 1, latitude: 0, longitude: 0, locationName: "Pier", sortOrder: 0 },
          ],
        }),
      ],
      generatedAt: AT,
    });

    expect(rendered.html).toContain("Travel, Family|beach|Pier");
  });

  it("renders a weather field, and an empty one when there is no weather", () => {
    const withWeather = renderReport({
      report: report(),
      details: details([{ part: "row", html: "<p>[{{weather}}]</p>" }]),
      entries: [entry({ weather: { temp: 21, unit: "C", description: "Sunny", code: 1 } })],
      generatedAt: AT,
    });
    expect(withWeather.html).toContain("[21C Sunny]");

    const without = renderReport({
      report: report(),
      details: details([{ part: "row", html: "<p>[{{weather}}]</p>" }]),
      entries: [entry()],
      generatedAt: AT,
    });
    expect(without.html).toContain("[]");
  });

  it("drops a conditional block when the field is empty, keeps it when set", () => {
    const template = { part: "row" as ReportPartKind, html: "<p>{{date}}{{#time}} at {{time}}{{/time}}</p>" };

    const withTime = renderReport({
      report: report(),
      details: details([template]),
      entries: [entry({ time: "14:30" })],
      generatedAt: AT,
    });
    expect(withTime.html).toContain("2026-07-27 at 14:30");

    const withoutTime = renderReport({
      report: report(),
      details: details([template]),
      entries: [entry({ time: "" })],
      generatedAt: AT,
    });
    // Without the conditional this would print a dangling " at ".
    expect(withoutTime.html).toContain("<p>2026-07-27</p>");
    expect(withoutTime.html).not.toContain(" at ");
  });

  it("treats a 'No' boolean and a zero count as empty in a conditional", () => {
    // Documented in applyConditionals: without this, {{#isPinned}} would always
    // show, because "No" is a non-empty string.
    const rendered = renderReport({
      report: report(),
      details: details([{ part: "row", html: "<p>{{#isPinned}}PINNED{{/isPinned}}ok</p>" }]),
      entries: [entry({ isPinned: false })],
      generatedAt: AT,
    });
    expect(rendered.html).toBe("<p>ok</p>");

    const pinned = renderReport({
      report: report(),
      details: details([{ part: "row", html: "<p>{{#isPinned}}PINNED{{/isPinned}}ok</p>" }]),
      entries: [entry({ isPinned: true })],
      generatedAt: AT,
    });
    expect(pinned.html).toBe("<p>PINNEDok</p>");
  });

  it("replaces an unknown token with nothing rather than leaving it on the page", () => {
    const rendered = renderReport({
      report: report(),
      details: details([{ part: "row", html: "<p>{{titel}}</p>" }]),
      entries: [entry()],
      generatedAt: AT,
    });

    expect(rendered.html).toBe("<p></p>");
    expect(rendered.html).not.toContain("{{");
  });

  it("says nothing matched when a row template has no entries", () => {
    const rendered = renderReport({
      report: report(),
      details: details([
        { part: "header", html: "<h1>Report</h1>" },
        { part: "row", html: "<p>{{title}}</p>" },
      ]),
      entries: [],
      generatedAt: AT,
    });

    expect(rendered.html).toContain("No entries matched");
    expect(rendered.entryCount).toBe(0);
  });

  it("renders an aggregate report that has no row part at all", () => {
    // Writing Activity, Word Trends and Category & Tag Usage are this shape.
    const rendered = renderReport({
      report: report({ name: "Writing Activity" }),
      details: details([{ part: "header", html: "<h1>{{stat.reportName}}</h1>{{table.entriesByYear}}" }]),
      entries: [entry({ date: "2026-01-01" }), entry({ id: 2, date: "2026-02-01" })],
      generatedAt: AT,
    });

    expect(rendered.html).toContain("Writing Activity");
    expect(rendered.html).toContain("<table>");
    expect(rendered.html).not.toContain("No entries matched");
  });

  describe("stats", () => {
    const statTemplate = details([
      {
        part: "header",
        html: `<p>{{stat.entryCount}}|{{stat.wordCount}}|{{stat.dateRange}}|{{stat.busiestMonth}}|{{stat.topCategory}}|{{stat.topTag}}|{{stat.longestStreak}}|{{stat.generatedAt}}</p>`,
      },
    ]);

    it("computes counts, range, busiest month, top taxonomy and streak", () => {
      const rendered = renderReport({
        report: report(),
        details: statTemplate,
        entries: [
          entry({ id: 1, date: "2026-03-01", content: "one two three", categories: ["Travel"], tags: ["a"] }),
          entry({ id: 2, date: "2026-03-02", content: "four five", categories: ["Travel"], tags: ["b"] }),
          entry({ id: 3, date: "2026-05-10", content: "six", categories: ["Work"], tags: ["a"] }),
        ],
        generatedAt: AT,
      });

      expect(rendered.html).toContain("3|6|2026-03-01 to 2026-05-10|2026-03|Travel|a|2|2026-10-07 09:30");
    });

    it("reports zero and an empty range for no entries", () => {
      const rendered = renderReport({
        report: report(),
        details: statTemplate,
        entries: [],
        generatedAt: AT,
      });

      expect(rendered.html).toContain("0|0|no dated entries|||0|");
    });

    it("counts a streak across consecutive days only", () => {
      const rendered = renderReport({
        report: report(),
        details: details([{ part: "header", html: "<p>{{stat.longestStreak}}</p>" }]),
        entries: [
          entry({ id: 1, date: "2026-03-01" }),
          entry({ id: 2, date: "2026-03-02" }),
          entry({ id: 3, date: "2026-03-03" }),
          entry({ id: 4, date: "2026-06-01" }),
        ],
        generatedAt: AT,
      });

      expect(rendered.html).toContain("<p>3</p>");
    });
  });

  describe("tables", () => {
    it("orders a period table chronologically, not by count", () => {
      // A time series read out of order is unreadable.
      const rendered = renderReport({
        report: report(),
        details: details([{ part: "header", html: "{{table.entriesByMonth}}" }]),
        entries: [
          entry({ id: 1, date: "2026-05-01" }),
          entry({ id: 2, date: "2026-01-01" }),
          entry({ id: 3, date: "2026-01-02" }),
        ],
        generatedAt: AT,
      });

      expect(rendered.html.indexOf("2026-01")).toBeLessThan(rendered.html.indexOf("2026-05"));
    });

    it("orders a tally table by count descending", () => {
      const rendered = renderReport({
        report: report(),
        details: details([{ part: "header", html: "{{table.topCategories}}" }]),
        entries: [
          entry({ id: 1, categories: ["Rare"] }),
          entry({ id: 2, categories: ["Common"] }),
          entry({ id: 3, categories: ["Common"] }),
        ],
        generatedAt: AT,
      });

      expect(rendered.html.indexOf("Common")).toBeLessThan(rendered.html.indexOf("Rare"));
    });

    it("escapes a name in a table", () => {
      const rendered = renderReport({
        report: report(),
        details: details([{ part: "header", html: "{{table.topPlaces}}" }]),
        entries: [entry({ placeName: "<b>Oslo</b>" })],
        generatedAt: AT,
      });

      expect(rendered.html).toContain("&lt;b&gt;Oslo&lt;/b&gt;");
      expect(rendered.html).not.toContain("<b>Oslo</b>");
    });

    it("shows an empty-state line rather than an empty table", () => {
      const rendered = renderReport({
        report: report(),
        details: details([{ part: "header", html: "{{table.topTags}}" }]),
        entries: [entry({ tags: [] })],
        generatedAt: AT,
      });

      expect(rendered.html).toContain("No tag data.");
      expect(rendered.html).not.toContain("<table>");
    });

    it("leaves dismissed words out of the word table", () => {
      const rendered = renderReport({
        report: report(),
        details: details([{ part: "header", html: "{{table.topWords}}" }]),
        entries: [entry({ content: "harbour harbour boring boring boring" })],
        dismissedWords: ["boring"],
        generatedAt: AT,
      });

      expect(rendered.html).toContain("harbour");
      expect(rendered.html).not.toContain("boring");
    });

    it("ignores words shorter than three characters", () => {
      const rendered = renderReport({
        report: report(),
        details: details([{ part: "header", html: "{{table.topWords}}" }]),
        entries: [entry({ content: "we go to it at harbour" })],
        generatedAt: AT,
      });

      expect(rendered.html).toContain("harbour");
      expect(rendered.html).not.toMatch(/<td>we<\/td>/);
    });
  });
});

describe("wrapReportDocument", () => {
  it("produces a standalone document carrying its own styling", () => {
    // The download is opened outside the app, where no theme token or print
    // stylesheet exists.
    const doc = wrapReportDocument("Year in Review", "<h1>Hello</h1>");
    expect(doc).toContain("<!DOCTYPE html>");
    expect(doc).toContain("<title>Year in Review</title>");
    expect(doc).toContain("<h1>Hello</h1>");
    expect(doc).toContain("<style>");
  });

  it("escapes the title", () => {
    expect(wrapReportDocument("<script>x</script>", "")).not.toContain("<script>x</script>");
  });
});
