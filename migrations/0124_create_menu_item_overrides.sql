-- Menu items: administrator overrides for a navigable destination's title and hint.
--
-- WHY `sys_` AND NOT A NEW PREFIX. A menu item is every module's sections plus
-- Administration's screens plus Home -- it is platform navigation, owned by no feature
-- module, so it sits with `sys_modules` and `sys_app_settings`. A 3-letter prefix is a
-- *module* namespace (`coding-guide.md` records the lesson under `pho_` and `tol_`),
-- and there is no module here to namespace.
--
-- WHY THE PRIMARY KEY IS A TEXT SLOT ID, NOT AN AUTOINCREMENT INTEGER. This is the
-- load-bearing decision of the whole feature, so it is recorded here rather than only
-- in the log.
--
-- Every section in the app ALREADY has a permanent unique id: `sectionSlotId(namespace,
-- slug)` derives `journal_section_locations`, it is registered in `ICON_SLOTS`, and it
-- is what `ico_slot_overrides.slot_id` stores. A menu item reuses exactly that string.
--
-- Minting a parallel integer id was considered and rejected on two grounds:
--
--   * It would give every subnode two identities and two places to set an icon --
--     precisely the trap `coding-guide.md` names under *What must NOT become a slot*
--     ("a second, competing way to set one value").
--   * An integer id needs an allocator, and an allocator is a thing to forget. A
--     derived id allocates itself from the slug: add a section, get a menu item, with
--     no bookkeeping and no counter to bump.
--
-- The cost, and it is real: **a menu item id is permanent once shipped.** Renaming a
-- section slug orphans the override row here AND the uploaded icon in
-- `ico_slot_overrides`. That rule already applied to icon slots; this table widens its
-- blast radius rather than inventing a new rule.
--
-- WHY THE TABLE IS SPARSE. A row exists only where an administrator actually changed
-- something -- there is no row per menu item. The registry (derived from the section
-- files at runtime) is the default, and this table is the exception list. So "reset to
-- default" is a DELETE, not an UPDATE back to a remembered value, and an install where
-- nothing has been renamed carries zero rows.
--
-- No DB-level foreign keys, per project convention. There is nothing to point at in any
-- case: the menu item catalogue is code, not a table.
CREATE TABLE sys_menu_item_overrides (
  -- The icon slot id, e.g. `journal_section_locations`. See the header on why this is
  -- the key. TEXT PRIMARY KEY gives the upsert its conflict target for free.
  menu_item_id TEXT PRIMARY KEY,

  -- The replacement title, or NULL to keep the registry's.
  --
  -- NULL rather than '' for "unchanged", because a blank title is a different thing
  -- from an absent one and the difference matters: this string renders in the
  -- navigation tree, so an empty one would be an unnamed, unclickable-looking row that
  -- an admin could not identify in order to fix. `setMenuItemOverride` refuses to write
  -- a blank, and `resolve()` ignores one if it somehow lands here.
  title        TEXT,

  -- The replacement one-line description, or NULL to keep the registry's.
  --
  -- Unlike `title`, '' is a MEANINGFUL value here: clearing a description to nothing is
  -- a legitimate edit, and plenty of sections ship without one. So this column
  -- distinguishes three states -- NULL (use the registry's), '' (deliberately none),
  -- and a string (this one).
  hint         TEXT,

  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- No secondary indexes, deliberately.
--
-- Every read is either the whole table (`listAll`, which resolves the registry in one
-- query) or a lookup by the primary key. The table is bounded by the number of
-- navigable destinations an admin has chosen to rename -- expected to be a handful, and
-- capped by the ~78 that exist. An index on `updated_at` would cost writes to serve a
-- query nothing makes.
