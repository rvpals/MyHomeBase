# Migration 0096: the Floating Scratchpad's categories and notes

**Date:** 2026-09-15
**Type:** new tables (2)

## What this does

Adds the storage behind the **Floating Scratchpad** — the third floating component, after
the Clock and the Calculator. A notepad over every page: the tabs are a household-wide
list of categories an admin configures, and the notes inside each tab belong to whoever
wrote them.

| Table | What it holds |
|---|---|
| `sys_scratchpad_categories` | One tab: its name and its position in the strip. **Shared by the household** |
| `sys_scratchpad_notes` | One note: a title, a body, and which tab it is filed under. **Per person** |

### `sys_scratchpad_categories`

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PK AUTOINCREMENT` | |
| `name` | `TEXT NOT NULL` | The tab label. Unique case-insensitively |
| `sort_order` | `INTEGER NOT NULL DEFAULT 0` | Tab order, left to right |
| `created_at` | `TEXT NOT NULL` | `datetime('now')` |

Plus `idx_sys_scratchpad_categories_name` (unique, `name COLLATE NOCASE`) and
`idx_sys_scratchpad_categories_order` on `(sort_order, id)`.

Seeded with three rows: **Ideas**, **Shopping**, **Work**.

### `sys_scratchpad_notes`

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PK AUTOINCREMENT` | |
| `user_id` | `INTEGER NOT NULL` | → `sys_users.id`. No DB-level FK, per convention |
| `category_id` | `INTEGER NOT NULL` | → `sys_scratchpad_categories.id` |
| `title` | `TEXT NOT NULL DEFAULT ''` | Optional. Blank is the ordinary case |
| `body` | `TEXT NOT NULL DEFAULT ''` | The note. Capped at the boundary, not here |
| `created_at` | `TEXT NOT NULL` | `datetime('now')` |
| `updated_at` | `TEXT NOT NULL` | Bumped on every autosave; the list's sort key |

Plus `idx_sys_scratchpad_notes_recent` on `(user_id, category_id, updated_at DESC, id DESC)`
and `idx_sys_scratchpad_notes_category` on `(category_id)`.

## Why `sys_` and not a new three-letter prefix

Same call migration 0095 made for the calculator's tape, for the same reason.
`coding-guide.md` prescribes `sys_` for a **platform / cross-cutting** table, and a
floating component is platform furniture: available on every page, owned by no feature
module, exactly like `sys_user_preferences` and `ico_slot_overrides`.

A `scr_` namespace was rejected because **a prefix is a namespace, so it has to still fit
the second table** — the mistake the guide names when it explains why the Picture
Gallery's prefix is `pho_` (the module's domain) and not `alb_` (the first table that
needed one). Notes and the categories they are filed under are the scratchpad's *entire*
domain; there is no third table coming that a `scr_` namespace would justify.

## Why the categories are shared and the notes are not

This is the load-bearing decision, and the two tables deliberately disagree about
ownership. `sys_scratchpad_categories` has **no `user_id`**; `sys_scratchpad_notes` has a
mandatory one.

The split follows what each thing *is*:

- A **category is structure** — the tabs across the top of the window. It is configured
  once, in Administration › Display Settings › Scratchpad Categories, and applies to
  everyone, exactly like the decision about which floating components exist at all
  (`floating_enabled`, a single `sys_app_settings` row). Had categories been per-user,
  the admin screen would have had nothing to administer beyond the on/off switch that
  already exists.
- A **note is content** — private working-out, the same category of thing as a
  calculator tape. What someone jotted under "Shopping" is nobody else's business, and
  two people using the app at once must not see each other's notes interleaved in one
  list.

So the household shares the tabs and nobody shares the notes.
[`ScratchpadRepository`](../src/lib/scratchpad/ports.ts) exposes **no method that reads a
note across users** — there is no `listAll` — so a screen cannot accidentally render
someone else's notebook. The one place notes are counted household-wide
(`countNotesInCategory`) returns a **number and a person-count, never any text**, because
it exists only to tell an admin why a delete was refused.

## Why deleting a category is refused rather than cascaded

Attempting to delete a category that still has notes in it **fails**, reporting how many
notes there are and how many people wrote them. Two alternatives were considered and
both are worse:

- **Cascade the notes.** This lets an admin destroy other people's notes from a settings
  screen, and a non-admin has no way to get them back. The project's rule about
  irreversible actions points the other way.
- **Re-file orphans into a reserved "Uncategorized" tab.** Nothing is lost, but it costs
  a permanent category that can't be renamed or removed, and it silently rearranges
  someone's notebook as a side effect of an unrelated admin action.

Refusing keeps the destructive step **where the notes are visible, in the window,
belonging to whoever wrote them.** The admin's path is to ask the owner to clear the tab.

`idx_sys_scratchpad_notes_category` is what makes the guard cheap — without it, the
check is a full scan of every note in the household on every attempted delete.

## Why `updated_at DESC` with an `id` tiebreaker

Notes list **most recently edited first**, which is the right order for a scratchpad
specifically: the note you were just typing in should be at the top when you come back.
`created_at DESC` would not give you that.

The `id DESC` tiebreaker is not optional. `datetime('now')` has **one-second
resolution**, so two notes saved in the same second carry an identical timestamp and
would come back in an arbitrary order — which, during autosave, would make the list
appear to shuffle itself while someone was typing. The id breaks the tie monotonically,
and the index is built to match.

## Why `title` is optional, and why the fallback isn't stored

A note is created empty and the reader types into it, so a mandatory title would mean a
prompt before you could write anything.

When the title is blank the list shows the note's **first line** instead. That fallback
is computed on read (`noteLabel` in `src/lib/scratchpad/scratchpad.ts`) rather than
stored, because a stored copy would go stale the moment the body was edited — the
classic denormalisation bug, and there is no query that needs it as a column.

`title` and `body` are both `NOT NULL DEFAULT ''` rather than nullable: a note is created
empty by design, and a NULL would mean every reader of these columns had to handle two
different kinds of nothing.

## What is *not* in these tables

The scratchpad's **window state** — open, minimized or closed, and which corner its puck
docks in — stays in `sys_user_preferences` as key/value rows (migration 0044), handled
entirely by the existing floating layer (`floating_state_scratchpad`,
`floating_corner_scratchpad`). No migration was needed for those; adding the id to
`FLOATING_COMPONENTS` derives the keys.

Which floating components **exist** likewise stays in the one `floating_enabled` setting
row, so turning the Scratchpad on for the household needed no schema change either.

The **length caps** on `title` and `body` are enforced at the boundary by
`src/lib/scratchpad/schema.ts`, not by the column types. SQLite doesn't enforce `VARCHAR`
lengths anyway, and the boundary is where a too-long note has to produce a message a
caller can show.

## Rollback

```sql
DROP TABLE sys_scratchpad_notes;
DROP TABLE sys_scratchpad_categories;
```

Loses every saved note and the category list. Nothing else is affected — the floating
layer keeps working, the Scratchpad simply has nothing to show, and its window state
rows in `sys_user_preferences` are left behind harmlessly (the layer drops an id it
doesn't recognise). Drop the notes table first: the categories table is what the notes
reference.
