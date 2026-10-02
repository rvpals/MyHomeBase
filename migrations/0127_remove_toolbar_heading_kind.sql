-- Toolbar items: remove the `heading` kind, and delete any row using it.
--
-- WHY IT IS GONE. A `heading` row carried its own text to label the shortcuts under
-- it ("My favourites"). It does not work, and could not have: a toolbar is 44px thick
-- and every other row is a single glyph, so a text label either truncates to nothing
-- or forces the bar wider than `--toolbar-*-height/width` reserves for it. Reported
-- from the real screen as "it doesn't show fully", which is exactly the failure the
-- geometry predicts.
--
-- A `separator` (migration 0126) does the same grouping job with a mark instead of a
-- word, and fits the bar by construction -- it spans the thickness and takes no room
-- along it. So the idea of grouping survives; only the text-bearing implementation of
-- it is withdrawn.
--
-- WHY THE ROWS ARE DELETED RATHER THAN CONVERTED. The two obvious migrations both
-- lose something, and deleting loses less:
--
--   * Converting each heading to a separator would silently change what an admin
--     built -- a caption becomes a line, in a position chosen for a caption -- and
--     would leave a separator wherever someone had typed a heading they no longer
--     wanted. A renderer that never drew the text properly means the stored labels
--     were not doing their job anyway.
--   * Leaving the rows in place is not an option: the CHECK below would reject them
--     on any future write to the table, and `resolveToolbar` no longer has a branch
--     that renders them, so they would be invisible rows an admin could see in the
--     editor and never get rid of.
--
-- Deleting is visible, final, and leaves every shortcut untouched. The text itself is
-- the only loss, and it was never legible on screen.
--
-- In practice this is expected to affect few rows and possibly none -- the feature has
-- not shipped past this machine. The DELETE is written anyway because "expected to be
-- empty" is not a guarantee.
--
-- WHY A NEW FILE RATHER THAN EDITING 0125/0126. Same reasoning those two record, and
-- it has not changed: a migration is immutable once it has run ANYWHERE, the runner
-- skips a filename it has already recorded, and `git status` cannot tell me whether
-- the NAS has run one. An edited CHECK would never re-run where it had run, leaving
-- the live table accepting a kind the code can no longer render.
--
-- A CHECK constraint cannot be altered in place in SQLite, so this is the
-- copy-rename-drop pattern `coding-guide.md` prescribes for a constraint change.

-- 1. Drop the rows first, so the copy below cannot carry a value the new CHECK
--    rejects. Order matters here: doing this after the INSERT would abort the
--    migration on any install that actually had a heading row.
DELETE FROM sys_toolbar_items WHERE kind = 'heading';

-- 2. The new shape -- three kinds. Otherwise identical to 0126's; every column
--    comment there still applies and is not repeated.
CREATE TABLE sys_toolbar_items_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  toolbar_id   INTEGER NOT NULL,

  --   menu-item  a shortcut to a destination, in `menu_item_id`
  --   separator  a drawn dividing line; carries neither
  --   spacer     flexible empty space, pushing what follows to the far end
  kind         TEXT    NOT NULL DEFAULT 'menu-item'
               CHECK (kind IN ('menu-item', 'separator', 'spacer')),

  menu_item_id TEXT,

  -- Still here, and still useful -- but now ONLY as a per-toolbar nickname for a
  -- shortcut, overriding the menu item's own title in the row's tooltip and
  -- accessible name. It is never drawn as visible text on the bar; that was the
  -- heading's job and is the thing being removed.
  label        TEXT,

  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 3. Copy what is left across verbatim. `id` is carried explicitly so stored row ids
--    survive -- the reorder call addresses items by id.
INSERT INTO sys_toolbar_items_new
  (id, toolbar_id, kind, menu_item_id, label, sort_order, created_at)
SELECT id, toolbar_id, kind, menu_item_id, label, sort_order, created_at
FROM sys_toolbar_items;

-- 4. Swap.
DROP TABLE sys_toolbar_items;
ALTER TABLE sys_toolbar_items_new RENAME TO sys_toolbar_items;

-- 5. Recreate the index -- dropping the table dropped it. One bar's rows in order,
--    and every bar's rows for the shell's single-query load. The id tiebreaker is not
--    optional: `sort_order` ties are ordinary, and without it tied rows come back in
--    an arbitrary order that appears to shuffle between renders.
CREATE INDEX idx_sys_toolbar_items_order
  ON sys_toolbar_items (toolbar_id, sort_order, id);

-- Deleting a heading can leave a gap an admin will want to tidy -- two separators
-- now adjacent, or ornament stranded at an end. Nothing is done about that here:
-- `trimEdgeOrnament` already collapses adjacent duplicates and drops ornament at
-- either end at RENDER time, so the bar reads correctly without the stored rows
-- needing to be rewritten.
