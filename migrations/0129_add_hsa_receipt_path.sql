-- HSA receipts move out of the database and into a folder on the NAS.
--
-- The file is written to <receipt folder>/<YYYY>/<name>, the folder being the
-- Household module's `hsa_receipt_root` setting (a sys_module_settings row, so no
-- table for it). This column holds the path RELATIVE to that folder, e.g.
-- "2026/2026-10-03_CVS_$42.50_17.jpg" — relative, so moving the whole archive means
-- changing one setting rather than rewriting every row.
--
-- NULL = no receipt. "Receipt attached?" is now derived from this column.
ALTER TABLE hsh_hsa_expenses ADD COLUMN receipt_path TEXT;

-- The BLOB from 0128 is no longer read or written. Dropped rather than left behind:
-- no receipt was ever stored in it (confirmed with Min before this shipped), and a
-- dead BLOB column invites a SELECT * that reads nothing useful. It carries no
-- index, constraint or trigger reference, which DROP COLUMN requires.
ALTER TABLE hsh_hsa_expenses DROP COLUMN receipt_file;
