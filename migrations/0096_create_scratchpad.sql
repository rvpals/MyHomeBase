-- The Floating Scratchpad: a shared list of note categories, and per-person notes.
--
-- WHY `sys_` AND NOT A NEW PREFIX. `coding-guide.md` prescribes `sys_` for a
-- "Platform / cross-cutting" table, and a floating component is platform furniture --
-- available on every page, owned by no feature module, exactly like
-- `sys_user_preferences`, `ico_slot_overrides` and `sys_calculator_history` (0095). A
-- `scr_` namespace was considered and rejected for the reason 0095 records: a prefix is
-- a *namespace*, so it has to still fit the second table, and notes plus their
-- categories are the scratchpad's entire domain. There is no third table coming.
--
-- WHY THE CATEGORIES ARE SHARED AND THE NOTES ARE NOT. These two tables deliberately
-- disagree about ownership, and that split is the feature's central decision.
--
--   * A category is *structure* -- the tabs across the top of the window. It is
--     configured once, in Administration, and applies to the household, exactly like
--     which floating components exist at all (`floating_enabled`). A per-user category
--     list would mean the admin screen had nothing to administer.
--   * A note is *content* -- private working-out, like a calculator tape. What someone
--     jotted under "Shopping" is nobody else's business, so `user_id` is part of every
--     note query's identity and the repository exposes no method that reads a note
--     across users.
--
-- So two people share the tabs and never see each other's notes. That is why
-- `sys_scratchpad_categories` has no `user_id` column and `sys_scratchpad_notes` has a
-- mandatory one.
--
-- No DB-level foreign keys, per project convention -- the repositories maintain the
-- links. `category_id` integrity matters more here than most, so see the note on
-- deletion below.
CREATE TABLE sys_scratchpad_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,

  -- The tab's label, e.g. "Shopping". Unique case-insensitively (see the index below):
  -- two tabs reading "Work" and "work" are indistinguishable at a glance and a reader
  -- would file notes into whichever they hit.
  name       TEXT    NOT NULL,

  -- Tab order, left to right. An explicit column rather than sorting by `name` or `id`:
  -- the admin arranges these deliberately (a "Today" tab belongs first, not wherever
  -- the alphabet puts it), and sorting by id would mean a newly added category could
  -- never be anything but last.
  --
  -- Gaps and ties are tolerated -- the read orders by `(sort_order, id)` so a tie falls
  -- back to insertion order rather than being arbitrary.
  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One tab per name, case-insensitively. `COLLATE NOCASE` on the index rather than on the
-- column so the stored value keeps the admin's own capitalisation ("Shopping", not
-- "shopping") while still rejecting a near-duplicate.
CREATE UNIQUE INDEX idx_sys_scratchpad_categories_name
  ON sys_scratchpad_categories (name COLLATE NOCASE);

-- The tab strip's only read: every category, in the admin's order.
CREATE INDEX idx_sys_scratchpad_categories_order
  ON sys_scratchpad_categories (sort_order, id);

-- One note: a person's text, filed under one category.
CREATE TABLE sys_scratchpad_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,                     -- -> sys_users.id
  category_id INTEGER NOT NULL,                     -- -> sys_scratchpad_categories.id

  -- Optional label. Blank is the ordinary case: a reader opens the window and types.
  --
  -- It exists because a tab holding ten notes has to be navigable, and a list of ten
  -- untitled textareas is not. When it is blank the list falls back to the note's first
  -- line, which is computed on read (`noteLabel`) rather than stored -- a stored copy
  -- would go stale the moment the body was edited.
  title       TEXT    NOT NULL DEFAULT '',

  -- The note itself. `TEXT NOT NULL DEFAULT ''` because a note is created empty (the
  -- reader presses "New note" and *then* types) and autosave writes into it after.
  -- A NULL body would mean every reader of this column had to handle two kinds of
  -- nothing.
  body        TEXT    NOT NULL DEFAULT '',

  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),

  -- Bumped on every autosave, and the sort key for the list.
  --
  -- Newest-edited first is the right order for a scratchpad specifically: the note you
  -- were just typing in should be at the top when you come back, which `created_at`
  -- would not give you.
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The only read this table serves: "my notes in this tab, most recently edited first."
--
-- `updated_at DESC, id DESC` -- the tiebreaker is not optional. `datetime('now')` has
-- one-second resolution, so two notes saved in the same second carry an identical
-- timestamp and would otherwise come back in an arbitrary order, making the list appear
-- to shuffle while someone typed. The id breaks the tie monotonically.
CREATE INDEX idx_sys_scratchpad_notes_recent
  ON sys_scratchpad_notes (user_id, category_id, updated_at DESC, id DESC);

-- Counting a category's notes across every user, for the delete guard.
--
-- Deleting a category is REFUSED while any note is filed under it -- see
-- `deleteCategory` in src/lib/scratchpad/categories.ts. The alternative designs were
-- both worse: cascading would let an admin destroy other people's notes from a settings
-- screen (and a non-admin could not get them back), and re-filing orphans into a
-- reserved "Uncategorized" tab would cost a permanent category that cannot be renamed
-- or removed. Refusing keeps the destructive step where the notes are visible, in the
-- window, belonging to whoever wrote them.
--
-- This index is what makes that guard cheap: without it the check is a full scan of
-- every note in the household on every attempted delete.
CREATE INDEX idx_sys_scratchpad_notes_category
  ON sys_scratchpad_notes (category_id);

-- Three starter categories, so the first person to open the window finds tabs rather
-- than an empty panel with nothing to type into.
--
-- Seeded here rather than defaulted in code, unlike `defaultEnabledIds()` in the
-- floating registry. The difference: the enabled list is a single setting row that can
-- be absent and resolved at read time, while these are real rows an admin renames,
-- reorders and deletes. A code-level default would reappear every time the admin
-- deleted the last one.
INSERT INTO sys_scratchpad_categories (name, sort_order) VALUES
  ('Ideas',    0),
  ('Shopping', 1),
  ('Work',     2);
