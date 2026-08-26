-- A per-module background picture, uploaded from that module's own
-- configuration screen. The Music Library is the first to use it.
--
-- WHY NOT sys_module_settings. Module settings already live there as key/value
-- rows (music_scan_extensions, music_skip_unstreamable, ...), which is where a
-- reader will look first -- so the omission needs a reason. Its `value` column
-- is `TEXT NOT NULL` (0006), so a picture would have to be base64: ~33% larger,
-- in a table read whenever a module screen renders its settings, for bytes only
-- one route ever wants. That is precisely the mistake
-- 0040_add_carousel_image_to_modules.md documents. The knobs *could* have gone
-- there while the BLOB lived here, but splitting one feature's state across two
-- tables buys nothing: a texture with no image is just a row with NULL bytes.
--
-- WHY NOT A COLUMN ON sys_modules. sys_modules is read on every authenticated
-- page to build the rail, and MODULE_COLUMNS exists specifically to keep the
-- carousel BLOB out of that read (0040). Adding a second BLOB to the same table
-- would mean a second column every one of those reads must remember to exclude.
-- A separate table cannot be got wrong by omission.
--
-- WHY KEYED BY SLUG, NOT A PINNED id = 1. sys_dashboard_texture (0063) is a
-- single-row singleton because there is exactly one dashboard. Here there is one
-- row per module, so the module's slug is the key -- the same identifier the
-- routes, the module registry and DEFAULT_MODULES already use. Not a foreign key
-- to sys_modules.id: the slug is the stable public name (it appears in URLs),
-- while a module row can be reseeded. A texture for a module that no longer
-- exists is inert, not corrupt -- nothing reads it.
--
-- `sys_` prefix: application chrome, not domain data -- alongside sys_modules
-- (0001), sys_app_settings (0002) and sys_dashboard_texture (0063).
CREATE TABLE sys_module_texture (
  -- The module this picture belongs to, e.g. 'music-library'. One row per
  -- module; no row at all means that module has no texture, which is the
  -- overwhelmingly common case and costs nothing to represent.
  module_slug     TEXT PRIMARY KEY,

  -- The picture, and the type to serve it back as. Both nullable together: a row
  -- can carry only the display knobs while the admin has removed the image, and
  -- that must mean "no texture" rather than "no row". Mirrors sys_users.avatar
  -- (0011), sys_modules.carousel_image (0040) and sys_dashboard_texture (0063).
  image           BLOB,
  image_mime_type TEXT,

  -- How strongly the picture reads through, 0..1. Defaulted near the floor for
  -- the same reason 0063 does it: a photograph behind a module's tables and
  -- track lists competes with the text over it, and `.paper-texture` in
  -- globals.css -- the app's only other surface texture -- sits at 0.02-0.035.
  -- An admin can raise it; the app should not ship a legibility problem.
  opacity         REAL NOT NULL DEFAULT 0.10 CHECK (opacity >= 0 AND opacity <= 1),

  -- 'cover' scales one picture to fill the viewport; 'tile' repeats it at its
  -- natural size. A CHECK rather than free text, so storage cannot represent a
  -- third value the UI never offers and force every reader to handle it.
  mode            TEXT NOT NULL DEFAULT 'cover' CHECK (mode IN ('cover', 'tile')),

  -- Gaussian blur in px, applied to the texture layer only -- the cheapest way
  -- to take a busy photograph down to something a module screen can sit on top
  -- of without discarding the picture. Capped at 40: beyond that every image is
  -- an indistinguishable wash.
  blur            INTEGER NOT NULL DEFAULT 0 CHECK (blur >= 0 AND blur <= 40),

  -- Bumped on every write so the serving route's ?v= cache-buster changes and a
  -- replaced picture appears immediately rather than after max-age expires --
  -- the same role it plays in 0063 and for the carousel in 0040.
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- No index: the primary key IS the lookup. Every read is
-- `WHERE module_slug = ?`, which the PK already serves.

-- No seed row, unlike 0063. That table has one guaranteed subject (the
-- dashboard) so seeding gives the admin screen something to edit; here a missing
-- row is meaningful -- it says this module has no texture -- and the repository's
-- fallback returns the display defaults for it. Seeding every module would write
-- rows for modules that will never have a picture.
