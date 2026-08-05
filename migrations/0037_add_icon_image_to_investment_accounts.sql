-- An icon per brokerage account, so accounts are told apart at a glance in the
-- account list, the position grid's Account column and the CSV-import picker.
--
-- Stored as a BLOB with its mime type alongside, mirroring
-- exp_creditcard_accounts.card_image (0031), exp_categories.icon_image (0034) and
-- sys_users.avatar (0011): the bytes are served by a dedicated route rather than
-- inlined as a base64 data URL, so they never bloat a JSON payload and the browser
-- can cache them.
-- Reads of the account list must select columns explicitly to avoid pulling the
-- blob on every page load.
ALTER TABLE stk_investment_accounts ADD COLUMN icon_image BLOB;
ALTER TABLE stk_investment_accounts ADD COLUMN icon_image_mime_type TEXT;
