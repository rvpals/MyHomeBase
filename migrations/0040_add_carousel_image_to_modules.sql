-- A replaceable graphic per module, shown large on the home screen's carousel.
--
-- Stored as a BLOB with its mime type alongside, mirroring sys_users.avatar
-- (0011), exp_creditcard_accounts.card_image (0031), exp_categories.icon_image
-- (0034) and stk_investment_accounts.icon_image (0037): the bytes are served by
-- a dedicated route rather than inlined as a base64 data URL, so they never
-- bloat a JSON payload and the browser can cache them.
--
-- THIS TABLE IS READ ON EVERY AUTHENTICATED PAGE. `listModules` runs in the
-- protected layout and `getModuleBySlug` on every module route, so both were
-- moved off `SELECT *` onto explicit column lists in the same change. Reading
-- these two columns anywhere other than the serving route puts a megabyte of
-- image into a page render.
ALTER TABLE sys_modules ADD COLUMN carousel_image BLOB;
ALTER TABLE sys_modules ADD COLUMN carousel_image_mime_type TEXT;
