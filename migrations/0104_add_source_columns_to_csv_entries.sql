-- Records which of a CSV entry's columns identify where a pooled row came from,
-- rather than carrying a measurement the file supplied.
--
-- Nullable with no default and no backfill: every entry that exists today was a
-- single-file import, which by definition has no source columns, and NULL already
-- reads as "[]" in the repository's mapper. So this migration cannot change how any
-- existing dataset behaves.
ALTER TABLE csv_analytics_entries ADD COLUMN source_columns_json TEXT;
