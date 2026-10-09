-- Card frames: a nine-slice picture drawn as the border and background of every
-- `CustomizableCard`.
--
-- WHAT THIS IS. An admin uploads a PNG whose outer edges are border artwork and
-- whose middle is background. Four slice values cut it into nine pieces: the
-- corners are placed untouched, the four edges run along the card's sides, and
-- the centre fills behind the content. One selection applies application-wide,
-- so changing it restyles every card at once.
--
-- WHY TWO TABLES, NOT ONE. The same split as 0063/0113: `sys_card_frame` is a
-- pinned single row holding only the selection, and `sys_card_frames` holds the
-- pictures. The selection is read on EVERY protected render to emit the CSS
-- variables, so it has to be answerable without touching a BLOB. One table would
-- mean either a join against a BLOB-bearing row on every page, or a `SELECT *`
-- discipline problem waiting to happen.
--
-- WHY A NEW LIBRARY AND NOT `sys_dashboard_textures`. A frame is not a texture.
-- A texture is a picture tiled or covered behind a page, tuned with opacity,
-- mode and blur. A frame is meaningless without its four slice values, and a
-- texture is meaningless with them. Sharing the table would leave half the
-- columns NULL for every row in it and force both features to branch on which
-- kind of row they were looking at.
--
-- WHY NO FOREIGN KEY on `selected_frame_id`. Project convention is no DB-level
-- foreign keys, and 0117/0130 both made this call for the same pointer shape.
-- Here the pointer additionally cannot go stale in practice: `deleteFrame` runs
-- the DELETE and the selection-clear in one transaction. The INNER JOIN in
-- `getSelection()` is the belt to that braces -- a selection naming a missing
-- row yields no row and reads as "no frame", which renders as the card looked
-- before this migration.

CREATE TABLE sys_card_frames (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- What the admin calls this frame, so a gallery is navigable by something
  -- other than eyesight. Not UNIQUE, as 0113: two similar frames may reasonably
  -- share a name, and rejecting that is a rule nobody asked for.
  name TEXT NOT NULL,
  -- The picture, and the type to serve it back as.
  --
  -- NOT NULL, as 0113 and unlike 0063's nullable pair: a frame row with no
  -- picture is nothing at all. The way to remove one is to DELETE the row, which
  -- also frees a space against the cap.
  image BLOB NOT NULL,
  image_mime_type TEXT NOT NULL,

  -- THE FOUR SLICES, in source-image pixels, measured inward from each edge.
  -- These are the heart of the feature and the one thing that cannot be derived:
  -- the same 300x300 PNG is a 90px ornate border or a 6px hairline depending
  -- only on these numbers. They are a property of the artwork, so they ride on
  -- the picture rather than on the application.
  --
  -- Only the lower bound is enforced here. The upper bound (256px) lives in
  -- `schema.ts`, which can report a sentence the admin screen shows, while this
  -- CHECK reports a SQLite error -- the same split 0130 documents. A negative
  -- slice, by contrast, is never a typo worth explaining: it is simply invalid.
  slice_top INTEGER NOT NULL CHECK (slice_top >= 0),
  slice_right INTEGER NOT NULL CHECK (slice_right >= 0),
  slice_bottom INTEGER NOT NULL CHECK (slice_bottom >= 0),
  slice_left INTEGER NOT NULL CHECK (slice_left >= 0),

  -- Opacity of the CENTRE FILL ONLY -- the card's background. Named
  -- `fill_opacity` rather than `opacity` because it deliberately does NOT dim
  -- the border, and a column called `opacity` would invite exactly that.
  --
  -- A frame faded to 0.3 reads as a rendering fault; a background faded to 0.3
  -- reads as intended. So the border always draws solid and this governs the
  -- middle, which is why the renderer paints the centre as a separate layer
  -- instead of using `border-image`'s own `fill` keyword (that keyword cannot
  -- carry an opacity of its own).
  --
  -- DEFAULT 1.0, not the 0.10 a page background defaults to. A background sits
  -- behind a whole viewport of text and has to stay quiet; a card frame is
  -- chosen to be seen, and 0.10 would make a newly uploaded frame look like a
  -- failed upload. Same reasoning 0130 used to pick 0.15 over 0.10 for a 44px bar.
  fill_opacity REAL NOT NULL DEFAULT 1.0 CHECK (fill_opacity >= 0 AND fill_opacity <= 1),

  -- How the four EDGE strips run along the card's sides. This is
  -- `border-image-repeat`: 'stretch' scales one copy (right for a gradient),
  -- 'repeat' tiles at natural size (right for fine grain), 'round' tiles with
  -- the tile scaled so a whole number fits (right for a rope or a dentil, where
  -- a half-motif at the corner is the thing you notice). Corners never scale
  -- under any of the three.
  fill_mode TEXT NOT NULL DEFAULT 'stretch' CHECK (fill_mode IN ('stretch', 'repeat', 'round')),

  -- Whether the picture's centre paints as the card's background at all.
  --
  -- 0 leaves the theme's own `bg-paper-raised` showing through and uses the
  -- picture purely as a border, which is what a frame with a transparent or
  -- irrelevant middle wants. Its own column rather than overloading
  -- `fill_opacity = 0`: those are different intents, and the admin screen
  -- disables the opacity slider when this is off rather than leaving a dead
  -- control that appears to do nothing.
  center_fill INTEGER NOT NULL DEFAULT 1 CHECK (center_fill IN (0, 1)),

  -- Where this frame sits in the gallery. Its own column rather than ordering by
  -- id, so the order stays the admin's to change later without a migration;
  -- today every insert appends. Not UNIQUE -- a future reorder would have to
  -- shuffle values and uniqueness would make that a multi-statement dance.
  sort_order INTEGER NOT NULL DEFAULT 0,

  -- Bumped on every write, so the serving route's ?v= cache-buster changes and a
  -- replaced picture appears immediately rather than after max-age expires. Same
  -- role as `sys_dashboard_textures.updated_at`.
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_card_frames_sort ON sys_card_frames (sort_order, id);

-- The selection singleton. One row, pinned at id = 1 by the CHECK, exactly as
-- `sys_dashboard_texture` is.
CREATE TABLE sys_card_frame (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  -- Which frame every card draws. NULL = no frame, which is the default and the
  -- state this migration ships in: cards keep the `.card-raised` ring and shadow
  -- they have today until an admin selects something. Nothing about existing
  -- screens changes on applying this migration.
  selected_frame_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed the singleton, so a write never has to branch on whether it exists. The
-- repository still upserts rather than updates -- a missing row would otherwise
-- make a selection silently succeed while changing nothing.
INSERT OR IGNORE INTO sys_card_frame (id) VALUES (1);
