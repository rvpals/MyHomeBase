-- Personal toolbars: a configurable bar of shortcuts docked to a screen edge.
--
-- WHAT THIS IS NOT. A personal toolbar does NOT replace the main navigation. The
-- navigation tree (full layout) and the two-tier bottom bar (compact) are untouched
-- by this feature; a toolbar is an *additional* surface alongside them. Nothing about
-- where-you-are lives on one -- that belongs to a navigation tier, per design.md ->
-- "Adding a UI element to the shell". A reader who hides every toolbar loses no
-- navigation whatsoever.
--
-- WHY `sys_` AND NOT A NEW PREFIX. Same reasoning as 0124: a toolbar points at
-- destinations across every module and Administration, so it is platform chrome owned
-- by no feature module. A 3-letter prefix is a *module* namespace, and there is no
-- module here to namespace.
--
-- WHY TWO TABLES AND NOT A SETTINGS ROW. `coding-guide.md`'s test is whether rows
-- accumulate and are queried individually. The floating layer's enabled list is one
-- settings row because it is bounded by the registered components and always read
-- whole. Toolbars are not bounded by anything -- an admin can add a fifth, a tenth --
-- they are ordered, individually edited, and their items are a growing ordered list
-- per bar. That is two tables.
--
-- WHY OWNERSHIP IS SPLIT. An administrator decides which toolbars exist and how each
-- looks; each reader decides whether a given bar is on their own screen (stored in
-- `sys_user_preferences`, not here -- see the note on `is_visible` below). This is the
-- same split migration 0096 made for the scratchpad and `floating_enabled` made for
-- the floating layer, and for the same reason: "put that bar away" is a personal
-- gesture, and an admin-only switch would leave a reader unable to undo their own
-- screen.
--
-- No DB-level foreign keys, per project convention -- the repository maintains the
-- link and deletes a bar's items in the same transaction as the bar.
CREATE TABLE sys_toolbars (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,

  -- What the admin calls it ("Min's shortcuts"). Shown on the admin list and used as
  -- the rendered bar's accessible name, which is why it is required: a landmark with
  -- no name is one a screen reader announces as just "navigation".
  name             TEXT    NOT NULL,

  -- The three colours, as CSS colour strings, or NULL to inherit the app's surface.
  --
  -- Stored as literal colours rather than theme token NAMES, which is a deliberate
  -- exception to design.md's "colours are tokens, not literals" rule and is worth
  -- being honest about: the entire feature is that an admin picks the colours. A
  -- token picker would be stricter and would keep a bar in step with a theme change;
  -- it would also make "I want my red bar" impossible, which is the request.
  --
  -- NULL is the default and the common case, so an unconfigured toolbar stays themed
  -- and keeps working when the colour scheme changes. The *format* is constrained in
  -- `schema.ts` to hex and rgb()/hsl() -- these values are interpolated into an inline
  -- style, so `url(...)` must never reach the DOM.
  background_color TEXT,
  border_color     TEXT,
  text_color       TEXT,

  -- Which screen edge it docks to. CHECK rather than a lookup table: the four edges
  -- are a closed set fixed by CSS (each has its own rule in globals.css), so a fifth
  -- value could not be rendered even if it were stored.
  edge             TEXT    NOT NULL DEFAULT 'left'
                   CHECK (edge IN ('top', 'bottom', 'left', 'right')),

  -- Show only on the full layout. 0/1; SQLite has no boolean.
  --
  -- This flag exists because the compact bottom edge is ALREADY claimed by the
  -- section trigger and the music player, and the side edges are ~390px apart on a
  -- phone. A bar that earns its space on a desktop is often simply in the way on a
  -- phone, and this is the honest way to say so rather than a restyle pretending a
  -- ten-item bar fits.
  full_mode_only   INTEGER NOT NULL DEFAULT 0,

  -- Whether the bar exists for the household at all -- the administrator's switch.
  --
  -- Distinct from a reader's own visibility, which is a `toolbars_hidden` list in
  -- `sys_user_preferences`. Hidden here means hidden for everyone regardless of
  -- preference; visible here still only puts it on the screens of readers who have
  -- not hidden it themselves. The reader's half is a preference and not a column
  -- here because it is per-person, and a row per (toolbar, person) would need
  -- cleaning up on both deletions to store a set of small integers.
  is_visible       INTEGER NOT NULL DEFAULT 1,

  -- Position among toolbars sharing an edge, and the order the admin list shows.
  -- Explicit rather than ordering by `name` or `id`, for the reason 0123 gives: these
  -- are arranged deliberately, and ordering by id would mean a new bar can only ever
  -- be last.
  sort_order       INTEGER NOT NULL DEFAULT 0,

  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The shell's read: every toolbar, in arranged order, on every page render.
CREATE INDEX idx_sys_toolbars_order ON sys_toolbars (sort_order, id);

-- One row on one toolbar: a shortcut, a heading, or a flexible space.
CREATE TABLE sys_toolbar_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  toolbar_id   INTEGER NOT NULL,                  -- -> sys_toolbars.id

  -- What the row is. CHECK for the same reason `edge` has one: the three kinds are a
  -- closed set the renderer switches on exhaustively.
  --
  --   menu-item  a shortcut to a destination, in `menu_item_id`
  --   heading    a label grouping the rows under it ("My favourites"), in `label`
  --   separator  flexible space between two rows; carries neither
  kind         TEXT    NOT NULL DEFAULT 'menu-item'
               CHECK (kind IN ('menu-item', 'heading', 'separator')),

  -- The menu item this row opens, for `kind = 'menu-item'`. NULL otherwise.
  --
  -- A PLAIN STRING, NOT A FOREIGN KEY, AND IT CANNOT BE ONE. Menu items are derived
  -- from code -- the `*-sections.ts` files and `adminNav` -- not stored in a table
  -- (see migration 0124). There is nothing to point at, so nothing at the database
  -- level can stop this from naming a section that a later release removes.
  --
  -- That is handled deliberately rather than ignored: `addToolbarItem` validates the
  -- id against the live registry on the way IN, which is the one moment the mistake
  -- is fixable, and `resolveToolbar` DROPS a row whose id no longer resolves on the
  -- way out, so a removed section leaves a shorter bar rather than a dead button.
  menu_item_id TEXT,

  -- A heading's text, or an optional per-toolbar nickname for a menu item row.
  --
  -- Left NULL on a menu-item row, which is the common case, the row renders whatever
  -- the menu item currently says -- so an admin retitling a section on the Menu Items
  -- screen updates every toolbar pointing at it. Setting it is a deliberate override.
  label        TEXT,

  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The only read of this table: one bar's rows in order, and (without the toolbar_id
-- bound) every bar's rows for the shell's single-query load. The id tiebreaker is not
-- optional -- `sort_order` ties are ordinary, and without it tied rows come back in an
-- arbitrary order that appears to shuffle between renders. Same trap 0123 documents.
CREATE INDEX idx_sys_toolbar_items_order
  ON sys_toolbar_items (toolbar_id, sort_order, id);

-- No rows are seeded.
--
-- Unlike 0123's starter TODO lists, an empty state here is correct: a toolbar nobody
-- asked for, docked to an edge and covering content, is worse than no toolbar. The
-- admin screen's empty state explains what the feature is and offers the New button.
