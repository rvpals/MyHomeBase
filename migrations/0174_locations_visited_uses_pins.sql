-- The built-in "Locations Visited" report reads an entry's pinned locations.
--
-- Until now it counted the free-text place_name field only, so an entry whose
-- place was a pin -- from the saved-location library or dropped on the map --
-- never appeared. It now selects every entry with at least one pin and builds
-- both tables from the pins (see table.topPlaces / table.placeMentions in
-- src/lib/journal-reports/render.ts).
--
-- Selection moves to where_mode = 'sql' because the filter-query syntax has no
-- field for "has a pin". The fragment is a read-only EXISTS, which sql-guard
-- accepts. Encrypted entries are still excluded by the runner.
--
-- The per-entry 'row' part is dropped: one row per entry cannot show one row per
-- place, so the "Every mention" table is now the {{table.placeMentions}}
-- placeholder in the header.
--
-- Only the builtin of that name is touched; a copy the reader made keeps its text.

UPDATE jrn_reports
SET description = 'The places your entries are pinned to -- saved locations and map pins -- most visited first.',
    where_mode  = 'sql',
    where_query = '',
    where_sql   = 'EXISTS (SELECT 1 FROM jrn_entry_locations x WHERE x.entry_id = e.id)',
    updated_at  = datetime('now')
WHERE name = 'Locations Visited' AND is_builtin = 1;

DELETE FROM jrn_report_details
WHERE part = 'row'
  AND report_id IN (SELECT id FROM jrn_reports WHERE name = 'Locations Visited' AND is_builtin = 1);

UPDATE jrn_report_details
SET html = '<h1>Locations Visited</h1>
<p>{{stat.entryCount}} entries are pinned to a place &middot; {{stat.dateRange}}</p>
<h2>Most visited</h2>
{{table.topPlaces}}
<h2>Every mention</h2>
{{table.placeMentions}}'
WHERE part = 'header'
  AND report_id IN (SELECT id FROM jrn_reports WHERE name = 'Locations Visited' AND is_builtin = 1);

UPDATE jrn_report_details
SET html = '<p><em>Generated {{stat.generatedAt}}.</em></p>'
WHERE part = 'footer'
  AND report_id IN (SELECT id FROM jrn_reports WHERE name = 'Locations Visited' AND is_builtin = 1);
