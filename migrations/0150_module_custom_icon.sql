-- An uploaded icon per module, replacing the glyph picked from MODULE_ICON_NAMES.
--
-- Mirrors carousel_image (0040) on this same table: the bytes live in a BLOB and
-- are served by a dedicated route, never inlined into a page. The difference is
-- that this one also accepts SVG, stored as sanitized *inner* markup in a TEXT
-- column so it can be inlined and inherit `currentColor` — a module icon renders
-- inside the brass-tinted active nav state, where a raster cannot tint.
--
-- THIS TABLE IS READ ON EVERY AUTHENTICATED PAGE. `listModules` runs in the
-- protected layout and `getModuleBySlug` on every module route, so MODULE_COLUMNS
-- in repository.ts reads only `custom_icon IS NOT NULL` and the SVG *presence*,
-- never the payloads. Selecting custom_icon or custom_icon_svg anywhere other
-- than the serving route and the admin read puts the artwork into every render.
--
-- Exactly one payload is ever set. The CHECK below is the same shape
-- ico_slot_overrides (0066) uses, and for the same reason: a row carrying both a
-- sanitized body and raster bytes would be ambiguous to render.
ALTER TABLE sys_modules ADD COLUMN custom_icon BLOB;
ALTER TABLE sys_modules ADD COLUMN custom_icon_mime_type TEXT;
ALTER TABLE sys_modules ADD COLUMN custom_icon_svg TEXT;
ALTER TABLE sys_modules ADD COLUMN custom_icon_width INTEGER;
ALTER TABLE sys_modules ADD COLUMN custom_icon_height INTEGER;

-- No index: the payload is only ever read by exact slug, from one route.
--
-- No CHECK constraint either, despite the paragraph above. SQLite cannot add one
-- to an existing table with ALTER TABLE, and rebuilding sys_modules — the most-read
-- table in the app, carrying a 2 MB BLOB per row — to enforce what a single
-- use-case already guarantees is not a trade worth making. `setModuleCustomIcon`
-- is the only writer and always clears the other payload in the same UPDATE.
