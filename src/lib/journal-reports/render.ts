// The template engine: one stored report x the entries it matched -> HTML.
//
// A SUBSTITUTION PASS, not an interpreter. There is no loop construct and no
// expression language — the `row` part is repeated once per entry by the engine,
// and aggregates come from prebuilt {{table.*}} placeholders. That is a real
// limit (you cannot write a nested loop or a computed column) and it is the
// right trade here: a template language with control flow stored in a database
// column is a language to maintain, and every report the six builtins needed
// fits this shape.
//
// The one control construct is a conditional block, `{{#time}}…{{/time}}`, which
// keeps its body only when the field is non-empty. Without it, an entry with no
// time renders " — " separators around nothing.
//
// EVERY substituted value is HTML-escaped. The template is author-written; the
// values are journal data, and an entry titled `<b>Rome</b>` must print as text,
// not as markup. Escaping rather than stripping, so no entry text is altered.

import type { JournalEntry } from "@/lib/journal";
import type {
  JournalReport,
  JournalReportDetail,
  RenderedReport,
  ReportPartKind,
} from "./types";

/** `&`, `<`, `>`, `"` and `'` — the five that matter inside text and attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escaped, then newlines become <br> so a multi-line entry keeps its shape. */
function escapeMultiline(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br>\n");
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/).length;
}

const SOURCE_LABELS: Record<string, string> = {
  "": "Written",
  csv: "CSV",
  ics: "Calendar",
};

/**
 * One entry -> its placeholder values, already escaped.
 *
 * `index` is 1-based because it is shown to a reader, not used as an offset.
 */
function entryValues(entry: JournalEntry, index: number): Record<string, string> {
  const weather = entry.weather
    ? `${entry.weather.temp}${entry.weather.unit} ${entry.weather.description}`
    : "";

  return {
    date: escapeHtml(entry.date),
    time: escapeHtml(entry.time),
    title: escapeHtml(entry.title),
    content: escapeMultiline(entry.content),
    placeName: escapeHtml(entry.placeName),
    categories: escapeHtml(entry.categories.join(", ")),
    tags: escapeHtml(entry.tags.join(", ")),
    locations: escapeHtml(entry.locations.map((location) => location.locationName).join(", ")),
    weather: escapeHtml(weather),
    isPinned: entry.isPinned ? "Yes" : "No",
    isLocked: entry.isLocked ? "Yes" : "No",
    wordCount: String(countWords(entry.content)),
    source: escapeHtml(SOURCE_LABELS[entry.source] ?? entry.source),
    index: String(index),
  };
}

// --- Aggregates --------------------------------------------------------------

interface Tally {
  name: string;
  count: number;
}

function tally(names: Iterable<string>): Tally[] {
  const counts = new Map<string, number>();
  for (const name of names) {
    const key = name.trim();
    if (key === "") continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // Count descending, then name ascending — so a tie is ordered the same way on
  // every run rather than by insertion order.
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Longest run of consecutive calendar days with at least one entry. */
function longestStreak(dates: string[]): number {
  const unique = [...new Set(dates.filter((date) => date !== ""))].sort();
  if (unique.length === 0) return 0;

  let best = 1;
  let current = 1;
  for (let index = 1; index < unique.length; index += 1) {
    const previous = Date.parse(`${unique[index - 1]}T00:00:00Z`);
    const today = Date.parse(`${unique[index]}T00:00:00Z`);
    // Unparseable dates break the chain rather than throwing: a malformed date
    // in one row should not fail the whole report.
    if (Number.isNaN(previous) || Number.isNaN(today)) {
      current = 1;
      continue;
    }
    const days = Math.round((today - previous) / 86_400_000);
    current = days === 1 ? current + 1 : 1;
    if (current > best) best = current;
  }
  return best;
}

/** A two-column table. Returns the empty-state line rather than an empty <table>. */
function twoColumnTable(rows: Tally[], headings: [string, string]): string {
  if (rows.length === 0) return `<p><em>No ${headings[0].toLowerCase()} data.</em></p>`;
  const body = rows
    .map((row) => `    <tr><td>${escapeHtml(row.name)}</td><td>${row.count}</td></tr>`)
    .join("\n");
  return `<table>
  <thead><tr><th>${escapeHtml(headings[0])}</th><th>${escapeHtml(headings[1])}</th></tr></thead>
  <tbody>
${body}
  </tbody>
</table>`;
}

/** Period rollup: period, entries, words. Used by both by-year and by-month. */
function periodTable(
  entries: JournalEntry[],
  heading: string,
  keyOf: (entry: JournalEntry) => string,
): string {
  const buckets = new Map<string, { count: number; words: number }>();
  for (const entry of entries) {
    const key = keyOf(entry);
    if (key === "") continue;
    const bucket = buckets.get(key) ?? { count: 0, words: 0 };
    bucket.count += 1;
    bucket.words += countWords(entry.content);
    buckets.set(key, bucket);
  }

  if (buckets.size === 0) return `<p><em>No ${heading.toLowerCase()} data.</em></p>`;

  // Chronological, not by count — a time series read out of order is unreadable.
  const body = [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([key, bucket]) =>
        `    <tr><td>${escapeHtml(key)}</td><td>${bucket.count}</td><td>${bucket.words}</td></tr>`,
    )
    .join("\n");

  return `<table>
  <thead><tr><th>${escapeHtml(heading)}</th><th>Entries</th><th>Words</th></tr></thead>
  <tbody>
${body}
  </tbody>
</table>`;
}

/** Words ranked by use, with a stop-word floor and the caller's dismissals removed. */
function wordTally(entries: JournalEntry[], dismissed: readonly string[], limit: number): Tally[] {
  const skip = new Set(dismissed.map((word) => word.toLowerCase()));
  const words: string[] = [];
  for (const entry of entries) {
    for (const raw of entry.content.toLowerCase().split(/[^a-z0-9']+/)) {
      const word = raw.replace(/^'+|'+$/g, "");
      // Three characters is the floor: shorter than that is almost all articles
      // and prepositions, and a stop-word list here would duplicate the one the
      // journal's own word stats already owns.
      if (word.length < 3) continue;
      if (skip.has(word)) continue;
      words.push(word);
    }
  }
  return tally(words).slice(0, limit);
}

const TOP_N = 10;

export interface RenderReportInput {
  report: JournalReport;
  details: JournalReportDetail[];
  entries: JournalEntry[];
  /** Words the reader dismissed from the journal's word stats. */
  dismissedWords?: readonly string[];
  /** Injected so a test can assert a fixed timestamp. */
  generatedAt?: Date;
}

/** Whole-report values: the {{stat.*}} and {{table.*}} placeholders. */
function reportValues(input: RenderReportInput): Record<string, string> {
  const { report, entries } = input;
  const dates = entries.map((entry) => entry.date).filter((date) => date !== "");
  const sorted = [...dates].sort();
  const totalWords = entries.reduce((sum, entry) => sum + countWords(entry.content), 0);

  const categories = tally(entries.flatMap((entry) => entry.categories));
  const tags = tally(entries.flatMap((entry) => entry.tags));
  const places = tally(entries.map((entry) => entry.placeName));
  const months = tally(dates.map((date) => date.slice(0, 7)));
  const words = wordTally(entries, input.dismissedWords ?? [], TOP_N);

  const first = sorted[0] ?? "";
  const last = sorted[sorted.length - 1] ?? "";
  const generated = input.generatedAt ?? new Date();

  return {
    "stat.entryCount": String(entries.length),
    "stat.wordCount": String(totalWords),
    "stat.dateRange": first === "" ? "no dated entries" : escapeHtml(`${first} to ${last}`),
    "stat.firstDate": escapeHtml(first),
    "stat.lastDate": escapeHtml(last),
    // Busiest month is by entry count, so the tally's count-descending order is
    // already the answer.
    "stat.busiestMonth": escapeHtml(months[0]?.name ?? ""),
    "stat.topCategory": escapeHtml(categories[0]?.name ?? ""),
    "stat.topTag": escapeHtml(tags[0]?.name ?? ""),
    "stat.longestStreak": String(longestStreak(dates)),
    "stat.reportName": escapeHtml(report.name),
    "stat.generatedAt": escapeHtml(generated.toISOString().slice(0, 16).replace("T", " ")),

    "table.entriesByYear": periodTable(entries, "Year", (entry) => entry.date.slice(0, 4)),
    "table.entriesByMonth": periodTable(entries, "Month", (entry) => entry.date.slice(0, 7)),
    "table.topCategories": twoColumnTable(categories.slice(0, TOP_N), ["Category", "Entries"]),
    "table.topTags": twoColumnTable(tags.slice(0, TOP_N), ["Tag", "Entries"]),
    "table.topPlaces": twoColumnTable(places.slice(0, TOP_N), ["Place", "Visits"]),
    "table.topWords": twoColumnTable(words, ["Word", "Uses"]),
  };
}

// --- Substitution ------------------------------------------------------------

/**
 * Resolves `{{#field}}body{{/field}}` blocks: the body stays when the field has
 * a value, and goes when it doesn't.
 *
 * Runs before placeholder substitution so a block's body can itself contain
 * placeholders. Not nestable — a block inside a block of the same name would
 * mis-pair, and no builtin needs one.
 *
 * "Empty" means absent, `""`, `"0"` or `"No"`. The last two are what make
 * `{{#isPinned}}` and `{{#stat.longestStreak}}` behave the way an author expects
 * — a boolean field renders as Yes/No and a count as a number, so without them
 * "No" and "0" would both read as present and the block would always show.
 *
 * The trade: `{{#wordCount}}` on a genuinely empty entry is also treated as
 * empty, which is the same answer for a different reason, and
 * `{{#date}}`-style string fields are unaffected. Documented rather than
 * special-cased per field, because a per-field emptiness table would be a
 * second thing to keep in step with the field list.
 */
function applyConditionals(template: string, values: Record<string, string>): string {
  return template.replace(
    /\{\{#\s*([\w.]+)\s*\}\}([\s\S]*?)\{\{\/\s*\1\s*\}\}/g,
    (_match, token: string, body: string) => {
      const value = values[token];
      const empty = value === undefined || value === "" || value === "0" || value === "No";
      return empty ? "" : body;
    },
  );
}

/**
 * Replaces every `{{token}}` with its value.
 *
 * An unknown token becomes an empty string rather than being left visible: a
 * printed report with `{{titel}}` in the middle of it looks broken to whoever is
 * reading the paper. The editor warns about unknown tokens up front (see
 * `unknownTokens` in fields.ts), which is the right place to catch a typo.
 */
function substitute(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, token: string) => values[token] ?? "");
}

function partHtml(details: JournalReportDetail[], part: ReportPartKind): string | undefined {
  return details.find((detail) => detail.part === part)?.html;
}

/**
 * Renders a report.
 *
 * The `row` part is optional: an aggregate report (Writing Activity, Word
 * Trends, Category & Tag Usage) is built from {{table.*}} alone and has no
 * per-entry section. A report with a `row` part but no matching entries renders
 * header and footer around an empty-state line, so it reads as "nothing
 * matched" rather than as a failure.
 */
export function renderReport(input: RenderReportInput): RenderedReport {
  const { details, entries } = input;
  const shared = reportValues(input);

  const pieces: string[] = [];

  const header = partHtml(details, "header");
  if (header) pieces.push(substitute(applyConditionals(header, shared), shared));

  const row = partHtml(details, "row");
  if (row) {
    if (entries.length === 0) {
      pieces.push("<p><em>No entries matched this report.</em></p>");
    } else {
      entries.forEach((entry, position) => {
        // Entry values take precedence on a key collision, but there is none by
        // construction: every report token is namespaced `stat.` or `table.`.
        const values = { ...shared, ...entryValues(entry, position + 1) };
        pieces.push(substitute(applyConditionals(row, values), values));
      });
    }
  }

  const footer = partHtml(details, "footer");
  if (footer) pieces.push(substitute(applyConditionals(footer, shared), shared));

  return { html: pieces.join("\n"), entryCount: entries.length };
}

/**
 * A standalone HTML document around a rendered report, for the Download button
 * and the CLI.
 *
 * Minimal self-contained styling: the downloaded file is opened outside the app,
 * where none of the theme tokens or the print stylesheet exist, so it has to
 * carry enough of its own to be readable on its own.
 */
export function wrapReportDocument(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; color: #111; background: #fff;
         max-width: 42rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  h1, h2, h3 { font-family: Helvetica, Arial, sans-serif; line-height: 1.2; }
  table { border-collapse: collapse; width: 100%; margin: 0.75rem 0; }
  th, td { border-bottom: 1px solid #ddd; padding: 0.35rem 0.5rem; text-align: left;
           vertical-align: top; }
  th { font-family: Helvetica, Arial, sans-serif; font-size: 0.8rem;
       text-transform: uppercase; letter-spacing: 0.04em; }
  article { margin: 1.25rem 0; }
  small { color: #555; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}
