-- A library of up to 20 dashboard background pictures, one of them selected.
--
-- WHY A SECOND TABLE RATHER THAN RELAXING 0063's CHECK. `sys_dashboard_texture`
-- is a settings singleton pinned to id = 1, and its migration log says in as many
-- words that it is "deliberately not" a collection: every write is an upsert
-- against a constant key, so no reader has to decide which of several rows is the
-- live one. Dropping that CHECK to store 20 pictures would throw away exactly the
-- property that makes the singleton safe, and it would leave "which row is the
-- one the dashboard draws?" answered only by convention.
--
-- So the singleton keeps its job and gains a pointer. The collection lives here:
--   sys_dashboard_textures       -- the 20 pictures (this table)
--   sys_dashboard_texture        -- which one is selected (0063, + selected_texture_id)
-- The dashboard still reads one row by a constant key, and that read still never
-- touches a BLOB.
--
-- WHY THE 20 CAP IS NOT A CHECK HERE. SQLite cannot express "at most 20 rows" in
-- a column CHECK -- a subquery over the same table isn't allowed in one. The cap
-- lives in `addDashboardTexture()` instead, which is also where it belongs for a
-- second reason: what an admin should see on hitting it is a sentence explaining
-- the limit, not a SQLITE_CONSTRAINT error.
--
-- `sys_` prefix: application chrome, not domain data -- alongside
-- sys_dashboard_texture (0063) and sys_module_texture (0064).
CREATE TABLE sys_dashboard_textures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- What the admin calls this texture, so a grid of 20 thumbnails is navigable
  -- by something other than eyesight. Not UNIQUE: two similar photographs may
  -- reasonably share a name, and rejecting that would be a rule the admin never
  -- asked for. Length is bounded by the lib's schema, which can report a
  -- sentence; a CHECK here would only report a constraint error.
  name TEXT NOT NULL,

  -- The picture, and the type to serve it back as.
  --
  -- NOT NULL, unlike 0063's nullable pair. There, a row with no image is the
  -- meaningful state "no texture, but keep the display knobs". Here, a library
  -- entry with no picture is nothing at all -- the way to remove one is to
  -- DELETE the row, which also frees a space against the 20 cap. Making these
  -- nullable would invent a second, emptier kind of removal.
  image BLOB NOT NULL,
  image_mime_type TEXT NOT NULL,

  -- The display knobs, per picture rather than application-wide.
  --
  -- WHY PER-PICTURE. These three are a property of the image, not of the
  -- dashboard: a dark photograph needs a much lower opacity than a pale seamless
  -- pattern, and a pattern wants 'tile' where a photograph wants 'cover'. With
  -- one shared set, every switch between two textures means re-tuning all three,
  -- and switching back loses what you had. Carrying them here means selecting a
  -- texture restores the way it was tuned.
  --
  -- Same bounds and same defaults as 0063, deliberately: these rows are populated
  -- from that table by the backfill below, and a texture moved between the two
  -- must not change appearance.
  opacity REAL NOT NULL DEFAULT 0.10 CHECK (opacity >= 0 AND opacity <= 1),
  mode TEXT NOT NULL DEFAULT 'cover' CHECK (mode IN ('cover', 'tile')),
  blur INTEGER NOT NULL DEFAULT 0 CHECK (blur >= 0 AND blur <= 40),

  -- Where this picture sits in the gallery. Its own column rather than ordering
  -- by id, so the order stays the admin's to change later without a migration;
  -- today every insert appends. Not UNIQUE -- a future reorder would have to
  -- shuffle values and a uniqueness constraint would make that a multi-statement
  -- dance for no gain.
  sort_order INTEGER NOT NULL DEFAULT 0,

  -- Bumped on every write, so the serving route's ?v= cache-buster changes and a
  -- replaced picture appears immediately rather than after max-age expires. Same
  -- role it plays in 0063 and for sys_modules.carousel_image (0040).
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The gallery reads every row in display order, and that is the only listing
-- this table has. At 20 rows max SQLite would be happy with a scan; the index is
-- here because the ORDER BY is in the one hot read and costs nothing to serve
-- from an index instead.
CREATE INDEX idx_dashboard_textures_sort ON sys_dashboard_textures (sort_order, id);

-- Which library picture the dashboard draws.
--
-- NULL means "none selected", which is byte-for-byte the state the dashboard
-- already handles: `hasImage` false, no texture layer emitted, flat paper. That
-- is what makes this column safe to add to a live row -- an existing install
-- lands on NULL and renders exactly as it did, and the backfill below then
-- points it at the migrated picture.
--
-- No REFERENCES clause: this database does not run with foreign keys on (no
-- other table declares one), so a FK here would be decoration that reads like a
-- guarantee. `deleteDashboardTexture()` clears the pointer itself, and
-- `getTexture()` treats a dangling id as "nothing selected" rather than trusting
-- the column.
ALTER TABLE sys_dashboard_texture ADD COLUMN selected_texture_id INTEGER;

-- Carry the existing picture into the library, so an admin who already uploaded
-- one finds it there, named, still selected, and still tuned the way they left
-- it. Without this the upgrade would silently blank the dashboard.
--
-- Guarded by `WHERE image IS NOT NULL`: on an install that never uploaded
-- anything this inserts no row and the library starts empty, which is correct.
INSERT INTO sys_dashboard_textures (name, image, image_mime_type, opacity, mode, blur, sort_order)
SELECT 'Texture 1', image, image_mime_type, opacity, mode, blur, 0
  FROM sys_dashboard_texture
 WHERE id = 1 AND image IS NOT NULL;

-- ...and select it. `last_insert_rowid()` is not used: it would be NULL when the
-- INSERT above matched nothing, and this way the statement is correct whether or
-- not a picture existed.
UPDATE sys_dashboard_texture
   SET selected_texture_id = (SELECT id FROM sys_dashboard_textures ORDER BY id LIMIT 1)
 WHERE id = 1;

-- The bytes in sys_dashboard_texture.image are deliberately LEFT IN PLACE rather
-- than nulled out. They are now a duplicate of library row 1 and nothing reads
-- them -- the serving route reads the library. Keeping them makes this migration
-- reversible without data loss (see Rollback in the .md): an admin who rolls back
-- gets their original dashboard picture, not a blank one. The cost is one
-- duplicated image, once, on an upgrade; the first replace clears it.
