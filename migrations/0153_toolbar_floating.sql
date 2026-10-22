-- Personal toolbars: a fifth placement, `floating` -- a bar the reader drags around.
--
-- WHAT THIS ADDS. Today every toolbar is DOCKED: `edge` names one of the four screen
-- edges, `.personal-toolbar[data-edge]` pins it there, and `data-toolbar-<edge>` on
-- <html> reserves page space so the bar never covers content. A `floating` bar is the
-- other arrangement -- it sits OVER the page at a position the reader chose by
-- dragging it, and reserves no space at all.
--
-- WHY A FIFTH `edge` VALUE AND NOT AN `is_floating` COLUMN. A bar is in exactly one
-- place, and these are the five places. A boolean beside `edge` would make `edge`
-- meaningless-but-still-set on a floating bar: two columns that can disagree, with no
-- answer to "which wins" that is not a convention somebody has to remember. The
-- renderer already switches exhaustively on `edge` and `occupiedEdges` already derives
-- the reserved space from it, so one closed set keeps both correct by construction.
--
-- The cost is this file: `edge` carries a CHECK, SQLite cannot alter a CHECK in place,
-- so a fifth value is the copy-rename-drop pattern `coding-guide.md` prescribes rather
-- than the one-line ALTER an additive column would have been. That is the trade, taken
-- deliberately -- a rebuild once is cheaper than a second source of truth forever.
--
-- WHY THE READER'S x/y IS NOT A COLUMN HERE. It is a `toolbar_positions` preference in
-- `sys_user_preferences`, not a column on this table, and that is the same split 0125
-- made for `is_visible` vs the `toolbars_hidden` list. `sys_toolbars` is the
-- ADMINISTRATOR's table -- which bars exist, and how each one looks. Where a bar sits
-- on MY screen is mine, exactly as whether it is on my screen at all is mine. A column
-- here would mean one person dragging a bar moves it for the whole household, which is
-- the behaviour the ownership split exists to prevent.
--
-- WHY A FLOATING BAR IS STILL NOT A FLOATING COMPONENT. `design.md` closes the
-- `FLOATING_COMPONENTS` list, and this does not join it. That list is for self-contained
-- accessories that own a window and a puck (the clock, the calculator, now-playing);
-- each gets a reader-facing on/off switch of its own. A toolbar is an EXISTING chrome
-- surface gaining a placement, and it already has a reader-facing switch -- the
-- `toolbars_hidden` list on the Account screen. Registering it would be a second switch
-- for the same bar.
--
-- No new table, no new 3-letter prefix, no DEFAULT_MODULES change. This is a display
-- setting on chrome that already exists.

-- 1. The new shape -- five placements. Otherwise IDENTICAL to the table 0130 left
--    behind; every column comment in 0125 and 0130 still applies and is not repeated
--    here, except `edge` which is the column being changed.
CREATE TABLE sys_toolbars_new (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT    NOT NULL,

  background_color TEXT,
  border_color     TEXT,
  text_color       TEXT,

  texture_id       INTEGER,
  texture_opacity  REAL    NOT NULL DEFAULT 0.15
                   CHECK (texture_opacity >= 0 AND texture_opacity <= 1),

  -- Where the bar lives. Still a CHECK and still a closed set, for the reason 0125
  -- gives: each placement has its own rule in globals.css, so a sixth value could not
  -- be rendered even if it were stored.
  --
  --   top/bottom/left/right  docked to that screen edge; reserves page space
  --   floating               over the page, at a position each reader drags for
  --                          themselves; reserves NO page space
  edge             TEXT    NOT NULL DEFAULT 'left'
                   CHECK (edge IN ('top', 'bottom', 'left', 'right', 'floating')),

  full_mode_only   INTEGER NOT NULL DEFAULT 0,
  is_visible       INTEGER NOT NULL DEFAULT 1,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 2. Copy every row across verbatim. No row needs converting: the four existing
--    values are all still legal, so this widening cannot reject anything that is
--    already stored -- which is why there is no DELETE here, unlike 0127.
--
--    `id` is carried explicitly so stored ids survive. That is not cosmetic: a
--    reader's `toolbars_hidden` list and their new `toolbar_positions` both address
--    bars BY ID from `sys_user_preferences`, which this migration does not touch. A
--    renumbered table would silently re-point every reader's hide list and every
--    saved position at the wrong bar.
INSERT INTO sys_toolbars_new
  (id, name, background_color, border_color, text_color,
   texture_id, texture_opacity, edge, full_mode_only, is_visible, sort_order, created_at)
SELECT
   id, name, background_color, border_color, text_color,
   texture_id, texture_opacity, edge, full_mode_only, is_visible, sort_order, created_at
FROM sys_toolbars;

-- 3. Swap.
DROP TABLE sys_toolbars;
ALTER TABLE sys_toolbars_new RENAME TO sys_toolbars;

-- 4. Recreate the index -- dropping the table dropped it. The shell's read: every
--    toolbar in arranged order, on every page render. The id tiebreaker is not
--    optional; `sort_order` ties are ordinary, and without it tied rows come back in
--    an order that appears to shuffle between renders.
CREATE INDEX idx_sys_toolbars_order ON sys_toolbars (sort_order, id);

-- Nothing is seeded and no existing bar changes placement. A household that wants a
-- floating bar switches an existing one to it, or makes a new one, on
-- Administration > Display Settings > Toolbars.
