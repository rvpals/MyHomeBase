# Migration 0123: TODO Lists

**Date:** 2026-09-30
**Type:** two new tables under an existing prefix, with a three-row seed

## What this does

Adds the storage behind **TODO Lists** — a new section of the existing **Tools**
module, plus a home-screen widget showing the same lists as tabs.

| Object | Shape | Notes |
|---|---|---|
| `tol_todo_categories` | `id` PK, `name`, `sort_order`, `created_at` | One row per list ("To BUY", "Work TODO") |
| `tol_todo_items` | `id` PK, `category_id`, `title`, `notes`, `is_done`, `done_at`, `sort_order`, `created_by`, `created_at` | One row per item |
| `idx_tol_todo_categories_name` | unique index | `name COLLATE NOCASE` — one list per name |
| `idx_tol_todo_categories_order` | index | `(sort_order, id)` — the panel's and tab strip's order |
| `idx_tol_todo_items_open` | index | `(category_id, is_done, sort_order, id)` — a list's outstanding items |
| `idx_tol_todo_items_done` | index | `(category_id, is_done, done_at DESC, id DESC)` — the Completed group |
| `idx_tol_todo_items_category` | index | `(category_id)` — the per-list count and the delete guard |

Three starter lists are seeded. **No module row is registered** — this is a
section of Tools, which already exists, so there is no accompanying
`seed_*_module` migration and no `DEFAULT_MODULES` change.

## Why `tol_` and not a new prefix

TODO Lists is a *section* of Tools, not a module. `coding-guide.md` records the
lesson twice already — a prefix is a **namespace**, chosen so it still fits the
next table, not an abbreviation of whichever feature needed it first. That is
exactly how `tol_uploaded_csv_files` joined `tol_uploaded_databases` without a
rename, and why Tools is `tol_` rather than `sql_`.

A `tdo_` namespace would have claimed a fourth prefix for two tables that already
have a home, and left the registry implying TODO was a module of its own.

## Both tables are shared — unlike the Scratchpad's

This is the feature's central decision, and it is deliberately the *opposite* of
migration 0096.

The Floating Scratchpad splits ownership down the middle: categories are shared
structure the admin arranges, notes are private working-out carrying a mandatory
`user_id`. Neither table here has a `user_id`, because a TODO item is not private
working-out — it is a **household commitment**. "Pick up AML" has to be visible
to whoever is next out of the house, and tickable by them. A list where each
person sees only their own items cannot be a shared errand list, which is the
whole thing being built.

So access is the only gate: whoever is granted the Tools module sees the
household's lists and can act on all of them.

The cost is real and worth stating plainly: **there is no way to keep a private
item here.** The Scratchpad is the place for one, and it already exists. Adding a
nullable `user_id` later to mean "mine only" would be additive, but it would also
reopen the question this migration settles, so it is not being hedged for now.

`created_by` records who added an item without conferring ownership — attribution
for the household, never a permission check. Nothing filters on it, and it goes
NULL rather than taking its item with it when an account is removed.

## Ticking is not deleting

`is_done` plus the Completed group is the reason for the design. A checked item
moves into "Completed (146)" and stays readable; removing it is a separate,
deliberate act behind the hover ✕. A schema where ticking deleted the row would
make the completed list — the thing the screenshot shows most of — impossible.

`done_at` is the one nullable column, and it is nullable for the reason
`hsh_recipes.rating` is: "not completed" genuinely has no timestamp, where a
sentinel date would sort and read as a real completion. It is cleared again when
an item is un-ticked, so the column can never claim a completion that was undone.

## Two indexes on the items, because the halves sort differently

The two reads of `tol_todo_items` disagree about order, and that is intentional:

- **Outstanding** items sort by `sort_order` — an errand list is arranged by what
  matters, not by when it was typed.
- **Completed** items sort by `done_at DESC` — once something is done its place
  in the queue stops being meaningful, but "what did we just finish" does not.

One index cannot serve both. Reusing the open-items index for the Completed group
would mean scanning and sorting every item ever finished in that list — already
146 rows in one list of the screenshot this was built from, and a number that only
grows, since nothing prunes completed items.

Both carry an explicit id tiebreaker. `sort_order` ties are the *ordinary* case
(every item starts at the same default until something is moved), and
`datetime('now')` has one-second resolution, so ticking two items quickly stamps
them identically. Without the tiebreaker, tied rows come back in an arbitrary
order and the list appears to shuffle between renders. This is the same trap
`idx_sys_scratchpad_notes_recent` records.

## Deleting a list is refused while it holds items

`deleteCategory` checks and refuses, rather than the table cascading. Same
reasoning as 0096: cascading would let one person destroy a list of commitments
the rest of the household is relying on, and an "Uncategorised" fallback would
cost a permanent list that cannot be renamed or removed.

`idx_tol_todo_items_category` is what makes that guard cheap — without it the
check is a full scan on every attempted delete. The same index serves the side
panel's per-list count, which is read on every render of the screen.

## The seed

Three lists, so the first person to open the screen finds somewhere to type
rather than an empty panel. Seeded as rows rather than defaulted in code for the
reason 0096 gives: a code-level default reappears every time someone deletes the
last one, and staying deleted is the point.

## Reversing

No down migration, per project convention. To undo by hand:

```sql
DROP INDEX IF EXISTS idx_tol_todo_items_category;
DROP INDEX IF EXISTS idx_tol_todo_items_done;
DROP INDEX IF EXISTS idx_tol_todo_items_open;
DROP TABLE IF EXISTS tol_todo_items;
DROP INDEX IF EXISTS idx_tol_todo_categories_order;
DROP INDEX IF EXISTS idx_tol_todo_categories_name;
DROP TABLE IF EXISTS tol_todo_categories;
```

Nothing else references either table.
