// The placeholders a report template may use, and what each one means.
//
// This is the list the editor's field picker renders. It is deliberately a
// SUPERSET of the filter builder's FIELD_LABELS: filterable and printable are
// different sets. You can filter on `isPinned` (useful) and you can print
// `weather` (not filterable). Keeping one list for both would have forced a
// compromise on whichever screen lost.
//
// Three kinds of placeholder:
//
//   {{field}}          per-entry, substituted once per matching entry in the
//                      `row` part. Meaningless in header/footer — there is no
//                      "current entry" there.
//   {{stat.name}}      one value for the whole report. Valid anywhere.
//   {{table.name}}     a prebuilt HTML table. Valid anywhere.
//
// The stat and table placeholders exist because a per-entry row repeat cannot
// express an aggregate: "entries per month" is not a property of an entry. The
// three aggregate-only seeded reports are built entirely from these.

/** Which part of the template a placeholder makes sense in. */
export type ReportFieldScope = "entry" | "report";

export interface JournalReportField {
  /** The placeholder text, without the braces — e.g. `date`, `stat.wordCount`. */
  token: string;
  label: string;
  /** One line for the picker, saying what it renders. */
  description: string;
  scope: ReportFieldScope;
}

/**
 * Per-entry fields. Each is substituted from the current entry while rendering
 * the `row` part.
 *
 * `content` is the entry's full text — HTML-escaped on substitution, with
 * newlines turned into <br> so a multi-paragraph entry prints as paragraphs
 * rather than one run-on block.
 */
export const JOURNAL_REPORT_ENTRY_FIELDS: readonly JournalReportField[] = [
  { token: "date", label: "Date", description: "The entry's date, YYYY-MM-DD.", scope: "entry" },
  { token: "time", label: "Time", description: "The entry's time, HH:MM. Empty when unset.", scope: "entry" },
  { token: "title", label: "Title", description: "The entry's title.", scope: "entry" },
  { token: "content", label: "Content", description: "The full entry text, with line breaks kept.", scope: "entry" },
  { token: "placeName", label: "Place", description: "The free-text place name on the entry.", scope: "entry" },
  { token: "categories", label: "Categories", description: "The entry's categories, comma-separated.", scope: "entry" },
  { token: "tags", label: "Tags", description: "The entry's tags, comma-separated.", scope: "entry" },
  { token: "locations", label: "Locations", description: "The entry's pinned location names, comma-separated.", scope: "entry" },
  { token: "weather", label: "Weather", description: "Temperature and description, or empty when none.", scope: "entry" },
  { token: "isPinned", label: "Pinned", description: "Yes or No.", scope: "entry" },
  { token: "isLocked", label: "Locked", description: "Yes or No.", scope: "entry" },
  { token: "wordCount", label: "Word count", description: "Words in this entry's content.", scope: "entry" },
  { token: "source", label: "Source", description: "Written, CSV or Calendar.", scope: "entry" },
  { token: "index", label: "Row number", description: "1 for the first entry, 2 for the second, and so on.", scope: "entry" },
];

/** Whole-report values. Valid in any part, including `row`. */
export const JOURNAL_REPORT_STAT_FIELDS: readonly JournalReportField[] = [
  { token: "stat.entryCount", label: "Entry count", description: "How many entries the report matched.", scope: "report" },
  { token: "stat.wordCount", label: "Total words", description: "Words across every matched entry.", scope: "report" },
  { token: "stat.dateRange", label: "Date range", description: "Earliest to latest matched date.", scope: "report" },
  { token: "stat.firstDate", label: "First date", description: "The earliest matched date.", scope: "report" },
  { token: "stat.lastDate", label: "Last date", description: "The latest matched date.", scope: "report" },
  { token: "stat.busiestMonth", label: "Busiest month", description: "The month with the most entries.", scope: "report" },
  { token: "stat.topCategory", label: "Top category", description: "The most-used category.", scope: "report" },
  { token: "stat.topTag", label: "Top tag", description: "The most-used tag.", scope: "report" },
  { token: "stat.longestStreak", label: "Longest streak", description: "Most consecutive days with an entry.", scope: "report" },
  { token: "stat.reportName", label: "Report name", description: "This report's own name.", scope: "report" },
  { token: "stat.generatedAt", label: "Generated at", description: "When the report was run.", scope: "report" },
];

/**
 * Prebuilt tables. Each renders a complete <table> — the author places it, the
 * renderer builds it.
 *
 * These are what make an aggregate report possible at all. Rendering them in
 * code rather than asking the author to loop means there is no loop construct in
 * the template language, which keeps it a substitution pass rather than an
 * interpreter.
 */
export const JOURNAL_REPORT_TABLE_FIELDS: readonly JournalReportField[] = [
  { token: "table.entriesByYear", label: "Entries by year", description: "A table of year, entries, words.", scope: "report" },
  { token: "table.entriesByMonth", label: "Entries by month", description: "A table of month, entries, words.", scope: "report" },
  { token: "table.topCategories", label: "Top categories", description: "A table of category and count.", scope: "report" },
  { token: "table.topTags", label: "Top tags", description: "A table of tag and count.", scope: "report" },
  { token: "table.topPlaces", label: "Top places", description: "A table of place and visit count.", scope: "report" },
  { token: "table.topWords", label: "Top words", description: "A table of word and count.", scope: "report" },
];

/** Everything the picker offers, in picker order. */
export const JOURNAL_REPORT_FIELDS: readonly JournalReportField[] = [
  ...JOURNAL_REPORT_ENTRY_FIELDS,
  ...JOURNAL_REPORT_STAT_FIELDS,
  ...JOURNAL_REPORT_TABLE_FIELDS,
];

const FIELDS_BY_TOKEN = new Map(JOURNAL_REPORT_FIELDS.map((field) => [field.token, field]));

export function reportField(token: string): JournalReportField | undefined {
  return FIELDS_BY_TOKEN.get(token);
}

export function isReportFieldToken(token: string): boolean {
  return FIELDS_BY_TOKEN.has(token);
}

/** `date` -> `{{date}}`. What the picker inserts at the cursor. */
export function reportPlaceholder(token: string): string {
  return `{{${token}}}`;
}

/**
 * The tokens a template uses that aren't in the list above.
 *
 * Surfaced by the editor as a warning rather than an error: a typo'd
 * `{{titel}}` renders as empty text, which looks exactly like a field that
 * happened to be blank. Naming the unknown tokens is the only way the author
 * can tell those two apart.
 *
 * Conditional blocks (`{{#time}}…{{/time}}`) are not reported here — they are
 * handled by the renderer and carry a `#` or `/` prefix.
 */
export function unknownTokens(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
    const token = match[1].trim();
    if (token.startsWith("#") || token.startsWith("/")) continue;
    if (!FIELDS_BY_TOKEN.has(token)) found.add(token);
  }
  return [...found].sort();
}
