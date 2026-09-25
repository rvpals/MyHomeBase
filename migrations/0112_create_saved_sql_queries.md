# Migration 0112: saved SQL queries

**Date:** 2026-09-25
**Type:** one new table

## What this does

Adds `sys_saved_sql_queries` — named, reusable statements for the Admin → SQL
Explorer → SQL Query tab. An admin saves a statement with a name, description
and tags, and loads it back later from the "Saved SQL" card instead of retyping
it.

| Object | Shape | Notes |
|---|---|---|
| `sys_saved_sql_queries` | `id` PK, `name` (unique), `description`, `tags`, `sql_statement`, timestamps | One row per saved query |
| `sys_saved_sql_queries_set_updated_at` | trigger | The usual `updated_at` stamp |

No index beyond the implicit one on `UNIQUE (name)`. The card reads the whole
table in one go, ordered by name — this is a hand-curated list measured in
dozens, not a table anything scans.

## Why `sys_`

SQL Explorer is a platform admin screen, not a feature module, so its table
takes the platform prefix — the same reasoning that put `sys_messages` (0109)
there rather than under a module. See `coding-guide.md`, *Database table
naming*.

## `UNIQUE (name)` — saving over a name replaces it

Shaped after `jrn_saved_filters` (0043) and `csv_chart_presets` (0022), both of
which are unique on name. This makes *save* a single upsert-by-name rather than
two code paths (create vs. update) plus a UI that has to know which one it is in.

Saving under a name that already exists **replaces** that row's description,
tags and statement. The save dialog says so before it happens, so the
destructive case is stated rather than discovered.

The alternative — allowing duplicate names — was rejected because the list is
addressed by name when reading it, and two rows called "monthly totals" told
apart only by a timestamp is a worse list than one that got overwritten on
purpose.

## Tags are a comma-joined column, not a join table

`tags` holds `"investments,debugging"`. This is a deliberate denormalization and
the one choice in this migration worth defending, because the Journal does the
opposite two tables over.

The Journal's tags get `jrn_tags`, `jrn_entry_tags` and a taxonomy screen
because tags there are **browsable**: the reader filters entries by them,
renames them, and sees them enumerated. These tags are none of those things.
They are a label typed into a save dialog and rendered back as chips on one
card — never queried by SQL, never joined, never renamed. Normalizing them would
mean two extra tables and a cascade delete in service of a string the code only
ever splits on a comma.

If tags here ever grow filtering or renaming, that is the moment to normalize —
*promote on the second caller*, per `ARCHITECTURE.md`. Splitting a comma-joined
column into a pair of tables later is a mechanical migration; the cost of
waiting is low and the cost of building it now is two tables nobody queries.

## Household-wide

No `user_id`, matching `sys_messages` (0109), `jrn_saved_filters` and
`csv_chart_presets`.

Every reader of this table is already an admin — the screen sits behind
`requireAdmin()` and so does every action that touches it — so an owner column
would not be drawing a privacy line, only adding rows and branching code. A
saved query is shared household tooling, like a bookmark. The general defence of
household-wide storage, and the shape to move to if it ever stops holding, is
written up in 0109; the same reasoning covers this table.

## The statement is stored verbatim, and loading does not run it

`sql_statement` is not validated as SQL on the way in and is not restricted to
`SELECT`. The SQL Query tab deliberately runs writes as well as reads, so a
saved `UPDATE` is a legitimate thing to want.

What protects the reader is the **load** step, not the storage: loading a saved
query fills the editor and stops there. The reader then presses Execute. A saved
`DELETE` therefore cannot fire on a single click from the list — which is why
Load deliberately does *not* mirror the Tables tree's "Open in SQL" action, which
does run immediately.
