-- The home dashboard's background picture, uploaded in Administration.
--
-- WHY ITS OWN TABLE RATHER THAN sys_app_settings. `sys_app_settings` is a
-- key/value TEXT store read on every authenticated page (the root layout reads
-- `application_name`, `color_theme` and `icon_set` through `getSetting`). Its
-- `value` column is `TEXT NOT NULL` (0002), so the bytes would have to be
-- base64 -- ~33% larger, and loaded on every render for a value only one route
-- serves. That is exactly the mistake `0040_add_carousel_image_to_modules.md`
-- documents. The BLOB lives here instead, where the only read that touches it is
-- the serving route.
--
-- WHY A SINGLE-ROW TABLE. There is one dashboard and the setting is
-- application-wide, so the row is pinned to id = 1 by a CHECK -- the same shape
-- as a settings singleton, and it makes every write an upsert against a known
-- key with no "which row won" ambiguity. Per-user textures would need a user_id
-- and a different key; this is deliberately not that.
--
-- `sys_` prefix: application chrome, not domain data -- alongside sys_modules
-- (0001) and sys_app_settings (0002).
CREATE TABLE sys_dashboard_texture (
  -- Pinned to one row. A settings singleton, not a collection.
  id          INTEGER PRIMARY KEY CHECK (id = 1),

  -- The picture, and the type to serve it back as. Both nullable together:
  -- a row can exist carrying only the display knobs below while the admin has
  -- removed the image, and that must mean "no texture" rather than "no row".
  -- Mirrors sys_users.avatar (0011), exp_creditcard_accounts.card_image (0031),
  -- exp_categories.icon_image (0034), stk_investment_accounts.icon_image (0037)
  -- and sys_modules.carousel_image (0040).
  image           BLOB,
  image_mime_type TEXT,

  -- How strongly the picture reads through, 0..1. The default is deliberately
  -- near the floor: a photograph behind the dashboard competes with the text
  -- over it, and `.paper-texture` in globals.css -- the app's only other surface
  -- texture -- sits at 0.02-0.035 for that reason. An admin can raise it; the
  -- app should not ship a legibility problem as its default.
  opacity     REAL NOT NULL DEFAULT 0.10 CHECK (opacity >= 0 AND opacity <= 1),

  -- 'cover' scales one picture to fill the viewport; 'tile' repeats it at its
  -- natural size. A CHECK rather than free text, following
  -- sys_module_settings.auto_refresh_interval (0061): the UI offers exactly two
  -- choices, so the storage should not be able to represent a third and force
  -- every reader to decide whether it is legal.
  mode        TEXT NOT NULL DEFAULT 'cover' CHECK (mode IN ('cover', 'tile')),

  -- Gaussian blur in px, applied to the texture layer only. The cheapest way to
  -- take a busy photograph down to something a dashboard can sit on top of
  -- without discarding the picture. 0 = untouched. Capped at 40 because beyond
  -- that every image is an indistinguishable wash.
  blur        INTEGER NOT NULL DEFAULT 0 CHECK (blur >= 0 AND blur <= 40),

  -- Bumped on every write so the serving route's URL cache-buster changes and a
  -- replaced picture appears immediately rather than after max-age expires --
  -- the same role sys_modules.updated_at plays for the carousel (0040).
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- No index: one row, read by a constant key.

-- Seeds the row with no image, so every read finds the display defaults and the
-- admin screen has something to edit. `INSERT OR IGNORE` keeps a re-run
-- harmless, matching how 0061 seeds its settings.
INSERT OR IGNORE INTO sys_dashboard_texture (id) VALUES (1);
