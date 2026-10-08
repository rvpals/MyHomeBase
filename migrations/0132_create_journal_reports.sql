-- Journal Reports: a stored HTML report catalogue for the My Journal module.
--
-- A report is a HEADER row (what it's called, which entries feed it) plus up to
-- three DETAIL rows holding the HTML template: 'header', 'row', 'footer'. The
-- 'row' part is rendered once per matching journal entry with {{field}}
-- placeholders substituted; header and footer render once each.
--
-- Deliberately a TEMPLATE, not finished output. Storing rendered HTML would
-- freeze a snapshot that never reflects entries written later; storing the
-- template means one stored report x live journal data stays current.
--
-- ENTRY SELECTION has two modes, which is why there are three columns for it:
--
--   where_mode = 'filter'  ->  where_query holds the compact filter-query
--                              syntax (`category = TRIP and date >= 2026-01-01`),
--                              parsed by parseFilterQuery and compiled by
--                              buildFilterSql. Field names index a fixed
--                              allowlist, so nothing user-typed ever reaches
--                              SQL as an identifier. This is the default.
--
--   where_mode = 'sql'     ->  where_sql holds a bare boolean expression
--                              spliced into the WHERE. ADMIN-ONLY, and checked
--                              by sql-guard.ts on save AND again on run: no
--                              semicolons, no comment markers, no DDL/DML
--                              keywords. Full SQLite expressiveness for the one
--                              person who owns the database.
--
-- Two separate columns rather than one shared one: switching modes in the editor
-- must not destroy the other mode's text, and a mode flag over a single column
-- would leave "which syntax is in here" ambiguous at read time.
--
-- Encrypted entries are excluded by the RUNNER in both modes (an encrypted entry
-- has title = '' and content = '', so it would print as a blank row). That is
-- appended in code, not written by the report author, so it cannot be forgotten.

CREATE TABLE IF NOT EXISTS jrn_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',

  -- 'filter' (default, safe) or 'sql' (admin-only). See the header comment.
  where_mode TEXT NOT NULL DEFAULT 'filter',
  -- Filter-query syntax. '' = every entry.
  where_query TEXT NOT NULL DEFAULT '',
  -- Raw boolean expression, admin-only. '' = every entry.
  where_sql TEXT NOT NULL DEFAULT '',

  -- Entry ordering. Both are validated against an allowlist in code before they
  -- reach the ORDER BY -- they are column choices, not free text.
  sort_field TEXT NOT NULL DEFAULT 'date',
  sort_direction TEXT NOT NULL DEFAULT 'desc',

  -- 0 = no limit. A cap for reports meant to print a top-N rather than the lot.
  max_rows INTEGER NOT NULL DEFAULT 0,

  -- 1 = seeded by this migration. Editable, but the UI refuses to delete it, so
  -- the six starter reports can't be lost.
  is_builtin INTEGER NOT NULL DEFAULT 0,

  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jrn_report_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES jrn_reports(id) ON DELETE CASCADE,
  -- 'header' | 'row' | 'footer'
  part TEXT NOT NULL,
  html TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_jrn_report_details_report
  ON jrn_report_details(report_id);

-- One part of a kind per report: the editor edits three named boxes, so a second
-- 'row' row would make "the row template" ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS idx_jrn_report_details_report_part
  ON jrn_report_details(report_id, part);

-- --------------------------------------------------------------------------
-- The six seeded reports.
--
-- Four are per-entry (a 'row' template repeated per entry). Two -- Writing
-- Activity and Word Trends -- are AGGREGATES: "entries per month" cannot be
-- expressed by repeating a row, so those use {{stat.*}} and {{table.*}}
-- placeholders that the renderer fills once, and carry no 'row' part.
-- --------------------------------------------------------------------------

INSERT INTO jrn_reports
  (name, description, where_mode, where_query, where_sql, sort_field, sort_direction, max_rows, is_builtin, sort_order, created_at, updated_at)
VALUES
  ('Year in Review',
   'One year at a glance: how much you wrote, your busiest month, and your top categories and tags.',
   'filter', '', '', 'date', 'asc', 0, 1, 1, datetime('now'), datetime('now')),

  ('Writing Activity',
   'Entries and words per month and per year, with your longest writing streak.',
   'filter', '', '', 'date', 'asc', 0, 1, 2, datetime('now'), datetime('now')),

  ('Category & Tag Usage',
   'Every category and tag with how often you have used it.',
   'filter', '', '', 'date', 'desc', 0, 1, 3, datetime('now'), datetime('now')),

  ('Entry Log',
   'A printable chronological list of entries -- narrow it with a filter query.',
   'filter', '', '', 'date', 'desc', 0, 1, 4, datetime('now'), datetime('now')),

  ('Locations Visited',
   'The places your entries mention, most visited first.',
   'filter', 'place is not empty', '', 'date', 'desc', 0, 1, 5, datetime('now'), datetime('now')),

  ('Word Trends',
   'The words you use most, with the ones you have dismissed left out.',
   'filter', '', '', 'date', 'desc', 0, 1, 6, datetime('now'), datetime('now'));

-- Templates. Styling stays inline and minimal: the report renders inside the
-- app's `.print-sheet`, whose @media print block already forces ink-on-white and
-- strips borders, so a template that sets its own colours would fight it.

-- Year in Review
INSERT INTO jrn_report_details (report_id, part, html, sort_order)
SELECT id, 'header',
'<h1>Year in Review</h1>
<p>{{stat.entryCount}} entries &middot; {{stat.wordCount}} words &middot; {{stat.dateRange}}</p>
<p>Busiest month: <strong>{{stat.busiestMonth}}</strong></p>
<h2>Top categories</h2>
{{table.topCategories}}
<h2>Top tags</h2>
{{table.topTags}}
<h2>The entries</h2>
<table>
  <thead><tr><th>Date</th><th>Title</th><th>Place</th></tr></thead>
  <tbody>', 0
FROM jrn_reports WHERE name = 'Year in Review';

INSERT INTO jrn_report_details (report_id, part, html, sort_order)
SELECT id, 'row',
'    <tr><td>{{date}}</td><td>{{title}}</td><td>{{placeName}}</td></tr>', 1
FROM jrn_reports WHERE name = 'Year in Review';

INSERT INTO jrn_report_details (report_id, part, html, sort_order)
SELECT id, 'footer',
'  </tbody>
</table>
<p><em>{{stat.entryCount}} entries, generated {{stat.generatedAt}}.</em></p>', 2
FROM jrn_reports WHERE name = 'Year in Review';

-- Writing Activity (aggregate: no 'row' part)
INSERT INTO jrn_report_details (report_id, part, html, sort_order)
SELECT id, 'header',
'<h1>Writing Activity</h1>
<p>{{stat.entryCount}} entries &middot; {{stat.wordCount}} words &middot; {{stat.dateRange}}</p>
<h2>By year</h2>
{{table.entriesByYear}}
<h2>By month</h2>
{{table.entriesByMonth}}', 0
FROM jrn_reports WHERE name = 'Writing Activity';

INSERT INTO jrn_report_details (report_id, part, html, sort_order)
SELECT id, 'footer',
'<p><em>Generated {{stat.generatedAt}}.</em></p>', 2
FROM jrn_reports WHERE name = 'Writing Activity';

-- Category & Tag Usage (aggregate tables, plus no per-entry rows)
INSERT INTO jrn_report_details (report_id, part, html, sort_order)
SELECT id, 'header',
'<h1>Category &amp; Tag Usage</h1>
<p>Across {{stat.entryCount}} entries &middot; {{stat.dateRange}}</p>
<h2>Categories</h2>
{{table.topCategories}}
<h2>Tags</h2>
{{table.topTags}}', 0
FROM jrn_reports WHERE name = 'Category & Tag Usage';

INSERT INTO jrn_report_details (report_id, part, html, sort_order)
SELECT id, 'footer',
'<p><em>Generated {{stat.generatedAt}}.</em></p>', 2
FROM jrn_reports WHERE name = 'Category & Tag Usage';

-- Entry Log (the plainest per-entry report)
INSERT INTO jrn_report_details (report_id, part, html, sort_order)
SELECT id, 'header',
'<h1>Entry Log</h1>
<p>{{stat.entryCount}} entries &middot; {{stat.dateRange}}</p>', 0
FROM jrn_reports WHERE name = 'Entry Log';

INSERT INTO jrn_report_details (report_id, part, html, sort_order)
SELECT id, 'row',
'<article>
  <h3>{{date}}{{#time}} {{time}}{{/time}} &mdash; {{title}}</h3>
  <p>{{content}}</p>
  <p><small>{{placeName}} &middot; {{categories}} &middot; {{tags}}</small></p>
</article>', 1
FROM jrn_reports WHERE name = 'Entry Log';

INSERT INTO jrn_report_details (report_id, part, html, sort_order)
SELECT id, 'footer',
'<p><em>{{stat.entryCount}} entries, generated {{stat.generatedAt}}.</em></p>', 2
FROM jrn_reports WHERE name = 'Entry Log';

-- Locations Visited
INSERT INTO jrn_report_details (report_id, part, html, sort_order)
SELECT id, 'header',
'<h1>Locations Visited</h1>
<p>{{stat.entryCount}} entries mention a place &middot; {{stat.dateRange}}</p>
<h2>Most visited</h2>
{{table.topPlaces}}
<h2>Every mention</h2>
<table>
  <thead><tr><th>Date</th><th>Place</th><th>Title</th></tr></thead>
  <tbody>', 0
FROM jrn_reports WHERE name = 'Locations Visited';

INSERT INTO jrn_report_details (report_id, part, html, sort_order)
SELECT id, 'row',
'    <tr><td>{{date}}</td><td>{{placeName}}</td><td>{{title}}</td></tr>', 1
FROM jrn_reports WHERE name = 'Locations Visited';

INSERT INTO jrn_report_details (report_id, part, html, sort_order)
SELECT id, 'footer',
'  </tbody>
</table>
<p><em>Generated {{stat.generatedAt}}.</em></p>', 2
FROM jrn_reports WHERE name = 'Locations Visited';

-- Word Trends (aggregate: no 'row' part)
INSERT INTO jrn_report_details (report_id, part, html, sort_order)
SELECT id, 'header',
'<h1>Word Trends</h1>
<p>From {{stat.entryCount}} entries &middot; {{stat.wordCount}} words &middot; {{stat.dateRange}}</p>
<h2>Most used words</h2>
{{table.topWords}}', 0
FROM jrn_reports WHERE name = 'Word Trends';

INSERT INTO jrn_report_details (report_id, part, html, sort_order)
SELECT id, 'footer',
'<p><em>Dismissed words are left out. Generated {{stat.generatedAt}}.</em></p>', 2
FROM jrn_reports WHERE name = 'Word Trends';
