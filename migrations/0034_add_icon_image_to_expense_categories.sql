-- A small icon per expense category, so a category is recognisable at a glance in
-- the category picker, the transactions grid and the spend rollups.
--
-- Stored as a BLOB with its mime type alongside, mirroring
-- exp_creditcard_accounts.card_image (migration 0031) and sys_users.avatar: the
-- bytes are served by a dedicated route rather than inlined as a base64 data URL,
-- so they never bloat a JSON payload and the browser can cache them.
-- Reads of the category list must select columns explicitly to avoid pulling the
-- blob on every page load.
ALTER TABLE exp_categories ADD COLUMN icon_image BLOB;
ALTER TABLE exp_categories ADD COLUMN icon_image_mime_type TEXT;
