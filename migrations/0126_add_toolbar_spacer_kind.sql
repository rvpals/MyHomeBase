-- Toolbar items: split the one "flexible space" kind into a real separator and a
-- spacer, by widening the `kind` CHECK constraint.
--
-- WHY THIS IS A NEW FILE AND NOT AN EDIT TO 0125. 0125 is one release old and its
-- `.sql` is still untracked on this machine, which is exactly the reasoning that cost
-- the downtime `coding-guide.md` records for 0114: untracked does NOT mean unapplied.
-- The dev machine, C:\webapp and the NAS each keep their own `sys_schema_migrations`,
-- and the runner SKIPS a filename it has already recorded — so an edited 0125 would
-- never re-run anywhere it had run, leaving the live table with the narrow constraint
-- while the code inserts 'spacer'. The cost of being wrong that way is a deployment
-- that no re-run can fix; the cost of being wrong this way is one redundant file.
--
-- WHAT CHANGED CONCEPTUALLY. 0125 had three kinds and called the flexible-space one
-- `separator`, which was the wrong name for it: a separator is a *drawn dividing
-- line*, and flexible space is a *spacer*. They look nothing alike and do opposite
-- things -- a separator is visible and takes no room along the bar, a spacer is
-- invisible and takes all of it. So:
--
--   * 'separator' now means a drawn line (the name it should always have had), and
--   * 'spacer' is the new kind for flexible space.
--
-- WHY EXISTING ROWS ARE MIGRATED TO 'spacer'. Any row already stored as 'separator'
-- was created under 0125's meaning -- flexible space -- so leaving it alone would
-- silently turn every one of them into a drawn line and change a layout an admin
-- built. The UPDATE below re-points them at the kind that still means what they meant
-- when they were saved. In practice this is expected to affect zero rows (the feature
-- has not shipped), and it is written anyway because "expected to be empty" is not a
-- guarantee and a no-op UPDATE costs nothing.
--
-- A CHECK constraint cannot be altered in place in SQLite, so this is the
-- copy-rename-drop pattern `coding-guide.md` prescribes for a constraint change --
-- not `ALTER TABLE ... RENAME`, which is only for a pure rename.

-- 1. The new shape. Identical to 0125's apart from the widened CHECK; every column
--    comment there still applies and is not repeated here.
CREATE TABLE sys_toolbar_items_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  toolbar_id   INTEGER NOT NULL,

  -- Four kinds now. Still a CHECK and still a closed set the renderer switches on
  -- exhaustively:
  --
  --   menu-item  a shortcut to a destination, in `menu_item_id`
  --   heading    a label grouping the rows under it ("My favourites"), in `label`
  --   separator  a DRAWN DIVIDING LINE; carries neither
  --   spacer     FLEXIBLE EMPTY SPACE, pushing what follows to the far end
  kind         TEXT    NOT NULL DEFAULT 'menu-item'
               CHECK (kind IN ('menu-item', 'heading', 'separator', 'spacer')),

  menu_item_id TEXT,
  label        TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 2. Copy every row across, re-pointing the old meaning at its new name. `id` is
--    carried explicitly so a reader's stored row ids and any toolbar ordering
--    survive -- these ids are referenced by the reorder call.
INSERT INTO sys_toolbar_items_new
  (id, toolbar_id, kind, menu_item_id, label, sort_order, created_at)
SELECT
  id,
  toolbar_id,
  -- The only transformation in this migration. See the header: a stored
  -- 'separator' meant flexible space under 0125.
  CASE WHEN kind = 'separator' THEN 'spacer' ELSE kind END,
  menu_item_id,
  label,
  sort_order,
  created_at
FROM sys_toolbar_items;

-- 3. Swap.
DROP TABLE sys_toolbar_items;
ALTER TABLE sys_toolbar_items_new RENAME TO sys_toolbar_items;

-- 4. Recreate the index. Dropping the table dropped it, and it is the only read this
--    table has: one bar's rows in order, and every bar's rows for the shell's
--    single-query load. The id tiebreaker is not optional -- `sort_order` ties are
--    ordinary, and without it tied rows come back in an arbitrary order that appears
--    to shuffle between renders. Same trap 0123 and 0125 both document.
CREATE INDEX idx_sys_toolbar_items_order
  ON sys_toolbar_items (toolbar_id, sort_order, id);
