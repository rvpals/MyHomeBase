-- TODO Lists: a shared set of categories, and the shared items filed under them.
--
-- WHY `tol_` AND NOT A NEW PREFIX. TODO Lists is a section of the Tools module, not a
-- module of its own, so it inherits Tools' namespace alongside `tol_uploaded_databases`
-- and `tol_uploaded_csv_files`. `coding-guide.md` records the lesson twice (`pho_`,
-- `tol_` itself): a prefix is a *namespace*, chosen so it still fits the next table, not
-- an abbreviation of the first feature to need it. A `tdo_` namespace would have claimed
-- a prefix for two tables that already have a home.
--
-- WHY BOTH TABLES ARE SHARED, UNLIKE THE SCRATCHPAD'S. The Floating Scratchpad (0096)
-- splits ownership down the middle: shared category tabs, private notes. This feature
-- deliberately does NOT, and the difference is the whole point of it.
--
--   * A scratchpad note is private working-out -- what someone jotted under "Shopping"
--     is nobody else's business.
--   * A TODO item is a household commitment. "Pick up AML" needs to be visible to
--     whoever is next out of the house, and it needs to be tickable by them -- a list
--     where each person sees only their own items cannot be a shared errand list, which
--     is what this is for.
--
-- So there is no `user_id` on either table. Access is the only gate: whoever is granted
-- the Tools module sees the household's list and can act on all of it. That is a real
-- decision with a real cost -- there is no way to keep a private item here, and the
-- Scratchpad is the place for one -- and it is why `created_by` below records a name
-- without conferring ownership.
--
-- No DB-level foreign keys, per project convention -- the repositories maintain the
-- links. `category_id` integrity matters here, so see the note on deletion below.
CREATE TABLE tol_todo_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,

  -- The list's name, e.g. "To BUY". Unique case-insensitively (see the index below):
  -- two lists reading "Work" and "work" are indistinguishable at a glance and items
  -- would be filed into whichever one the reader happened to hit.
  name       TEXT    NOT NULL,

  -- Position in the side panel and the widget's tab strip, top to bottom / left to
  -- right. An explicit column rather than sorting by `name` or `id`: these are arranged
  -- deliberately (a "To DO List" belongs before "Learning", not wherever the alphabet
  -- puts it), and sorting by id would mean a newly added list could never be anything
  -- but last.
  --
  -- Gaps and ties are tolerated -- the read orders by `(sort_order, id)` so a tie falls
  -- back to insertion order rather than being arbitrary.
  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One list per name, case-insensitively. `COLLATE NOCASE` on the index rather than on
-- the column so the stored value keeps the typed capitalisation ("To BUY", not "to buy")
-- while still rejecting a near-duplicate.
CREATE UNIQUE INDEX idx_tol_todo_categories_name
  ON tol_todo_categories (name COLLATE NOCASE);

-- The side panel's and the widget's only read: every list, in the arranged order.
CREATE INDEX idx_tol_todo_categories_order
  ON tol_todo_categories (sort_order, id);

-- One TODO item, filed under one list. Shared -- see the header.
CREATE TABLE tol_todo_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,                    -- -> tol_todo_categories.id

  -- What to do. Required and single-line: an item with no title is not an item, and the
  -- screen renders these as one line each in a card.
  title       TEXT    NOT NULL,

  -- Optional detail -- the second line the screenshot shows under a long item
  -- ("Complicated one: SpectraMax L (XML); PDF format (Raman)"). `TEXT NOT NULL
  -- DEFAULT ''` rather than nullable so no reader has to handle two kinds of nothing,
  -- the same mapping `sys_scratchpad_notes.title` uses.
  notes       TEXT    NOT NULL DEFAULT '',

  -- 0 or 1. Ticking an item does NOT delete it: the screenshot's "Completed (146)"
  -- group is the whole reason -- a checked item moves into that group and stays
  -- readable, and deleting is a separate deliberate act (the hover ✕).
  is_done     INTEGER NOT NULL DEFAULT 0,

  -- When it was ticked, or NULL while it is outstanding. Nullable on purpose, and the
  -- one nullable column here: "not completed" genuinely has no timestamp, where a
  -- sentinel date would sort and read as a real completion. Cleared again when an item
  -- is un-ticked, so it can never claim a completion that was undone.
  done_at     TEXT,

  -- Position within its list, among the outstanding items. Same reasoning as the
  -- category's: an errand list is arranged by what matters, not by when it was typed.
  --
  -- Completed items ignore this and sort by `done_at DESC` instead -- most recently
  -- ticked first -- because once something is done its place in the queue is no longer
  -- meaningful, but "what did we just finish" is.
  sort_order  INTEGER NOT NULL DEFAULT 0,

  -- Who added it, or NULL once that account is gone. Records a fact for the household
  -- without conferring ownership: every item is actionable by everyone granted the
  -- module (see the header), so this is attribution, never a permission check. Nothing
  -- filters on it.
  created_by  INTEGER,                             -- -> sys_users.id

  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The screen's read: one list's items, outstanding ones in their arranged order.
--
-- `is_done` leads the index because every read of this table splits on it -- the card
-- draws the open items and the Completed group separately, and neither ever wants the
-- other's rows mixed in. The id tiebreaker is not optional: `sort_order` ties are
-- ordinary (every item starts at the same default until something is dragged), and
-- without it tied rows come back in an arbitrary order that appears to shuffle between
-- renders.
CREATE INDEX idx_tol_todo_items_open
  ON tol_todo_items (category_id, is_done, sort_order, id);

-- The Completed group's read: most recently ticked first.
--
-- A second index rather than reusing the one above, because the completed half sorts by
-- a different column entirely (`done_at DESC`, see above) and would otherwise be a scan
-- plus a sort of every item ever finished in that list -- 146 of them in one list of the
-- screenshot this was built from, and that number only grows.
--
-- `done_at DESC, id DESC` -- the tiebreaker again, and it matters more here:
-- `datetime('now')` has one-second resolution, so ticking two items quickly stamps them
-- identically and the pair would otherwise swap places on every render.
CREATE INDEX idx_tol_todo_items_done
  ON tol_todo_items (category_id, is_done, done_at DESC, id DESC);

-- Counting a list's items, for the side panel's per-list count and the delete guard.
--
-- Deleting a list is REFUSED while any item is filed under it -- see `deleteCategory`
-- in src/lib/todo/categories.ts. The alternative designs were both worse, exactly as
-- 0096 records for the scratchpad: cascading would let one person destroy a list of
-- commitments the rest of the household is relying on, and re-filing orphans into a
-- reserved "Uncategorised" list would cost a permanent category that cannot be renamed
-- or removed. Refusing keeps the destructive step where the items are visible.
CREATE INDEX idx_tol_todo_items_category
  ON tol_todo_items (category_id);

-- Three starter lists, so the first person to open the screen finds somewhere to type
-- rather than an empty panel.
--
-- Seeded here rather than defaulted in code, for the reason 0096 gives: a code-level
-- default would reappear every time someone deleted the last list. These are real rows
-- that can be renamed, reordered and removed, and staying removed is the point.
INSERT INTO tol_todo_categories (name, sort_order) VALUES
  ('To BUY',    0),
  ('To DO',     1),
  ('Work TODO', 2);
