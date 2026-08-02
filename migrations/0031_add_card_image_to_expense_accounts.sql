-- A small image per credit-card account (card art or issuer logo), so cards are
-- easy to tell apart at a glance in the accounts list and the transactions grid.
--
-- Stored as a BLOB with its mime type alongside, mirroring sys_users.avatar:
-- the bytes are served by a dedicated route rather than inlined as a base64 data
-- URL, so they never bloat a JSON payload and the browser can cache them.
-- Reads of the account list must select columns explicitly to avoid pulling the
-- blob on every page load.
ALTER TABLE exp_creditcard_accounts ADD COLUMN card_image BLOB;
ALTER TABLE exp_creditcard_accounts ADD COLUMN card_image_mime_type TEXT;
