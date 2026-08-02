-- Adds the attribution/source line a quote came from (e.g. "Letter to his son.
-- Letter IX (April 14, 1747)."), so the newsletter importer can keep the
-- "Source:" footers instead of discarding them.
--
-- Plain ALTER TABLE ADD COLUMN is used deliberately: this is a simple additive
-- column with a default, which needs no table rebuild. The copy-rename-drop
-- pattern is reserved for changes to existing columns or constraints.
ALTER TABLE sys_daily_quotes ADD COLUMN source TEXT NOT NULL DEFAULT '';
