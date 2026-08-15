-- A small icon per journal category and tag, so each is recognisable at a
-- glance wherever it's listed.
--
-- Stored as a BLOB with its mime type alongside, mirroring
-- exp_categories.icon_image (migration 0034) and stk_investment_accounts.icon_image
-- (migration 0037): the bytes are served by a dedicated route rather than inlined
-- as a base64 data URL, so they never bloat a JSON payload and the browser can
-- cache them.
-- Reads of the category/tag lists must select columns explicitly to avoid pulling
-- the blob on every page load.
ALTER TABLE jrn_categories ADD COLUMN icon_image BLOB;
ALTER TABLE jrn_categories ADD COLUMN icon_image_mime_type TEXT;

ALTER TABLE jrn_tags ADD COLUMN icon_image BLOB;
ALTER TABLE jrn_tags ADD COLUMN icon_image_mime_type TEXT;

-- jrn_icons was ported from the source app's own icon scheme (a separate table
-- keyed by icon_type + name) but was never wired into any repository or route —
-- dead schema from day one. The columns above are the app's now-established
-- pattern for a per-row icon, so this table is redundant rather than superseded
-- functionality; nothing reads or writes it.
DROP TABLE IF EXISTS jrn_icons;
