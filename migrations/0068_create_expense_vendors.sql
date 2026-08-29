-- Editable vendor list, so a vendor can carry a description and an icon the way
-- a category already does.
--
-- Until now a "vendor" was derived at read time only: src/lib/expense/vendors.ts
-- groups transactions on exp_transactions.vendor (migration 0032), falling back
-- to a brand key stripped from the raw transaction_description. That rollup keeps
-- working untouched — this table adds *identity* on top of it, and nothing more.
-- A vendor row is not required for a transaction to group under that name.
--
-- Keyed by name, the natural-key approach of exp_categories (0029) and
-- jrn_categories (0027). The icon columns are in the initial CREATE rather than
-- bolted on by a later ALTER, which is the one thing this improves on the
-- 0029 -> 0034 two-step for categories.
CREATE TABLE exp_vendors (
  name        TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  -- Stored as a BLOB with its mime type alongside, mirroring
  -- exp_categories.icon_image (0034) and exp_creditcard_accounts.card_image
  -- (0031): the bytes are served by a dedicated route rather than inlined as a
  -- base64 data URL, so they never bloat a payload and the browser can cache
  -- them. Both nullable — "no icon" is a real state, not a missing one.
  -- Reads of the vendor list must name their columns to avoid pulling the blob
  -- on every page render.
  icon_image  BLOB,
  icon_image_mime_type TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- NOCASE so "Costco" and "COSTCO" are one vendor, matching vendorGroupKey()
-- which already upper-cases before grouping. The PRIMARY KEY above stays
-- case-sensitive, so this index is what the lookups actually use.
CREATE UNIQUE INDEX exp_vendors_name_nocase ON exp_vendors (name COLLATE NOCASE);

CREATE TRIGGER exp_vendors_set_updated_at
AFTER UPDATE ON exp_vendors
FOR EACH ROW
BEGIN
  UPDATE exp_vendors SET updated_at = datetime('now') WHERE name = old.name;
END;
