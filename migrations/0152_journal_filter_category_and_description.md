# Migration 0152: categorise and describe a saved journal filter

**Date:** 2026-10-19
**Type:** new columns

## What this does

Adds two columns to `jrn_saved_filters`, the named-filter table from migration
0043.

| Column | Type | Notes |
|---|---|---|
| `category_name` | `TEXT NOT NULL DEFAULT ''` | free-text label, e.g. `CAR`; `''` = uncategorised |
| `description` | `TEXT NOT NULL DEFAULT ''` | the reader's own words about what the filter is for; `''` = none |

Plus `idx_jrn_saved_filters_category` on `(category_name COLLATE NOCASE, name)`,
which serves both reads the grouped mode makes.

## Why

The Entries screen picks a saved filter from one flat `<option>` list ordered by
name. That works at five filters. At thirty — some about the car, some the
house, some the kids — there is no way to narrow it, and the reader scrolls a
list whose only structure is the alphabet.

`category_name` gives the Filtering card a second display mode: **"Show filters
by: by Filter name / by category first."** The first is today's list, unchanged
and still the default. The second shows a category box, and only once a category
is chosen does the filter list appear, holding that category's filters.

`description` is unrelated to grouping and was asked for alongside it: a filter
named "Q3 maintenance" does not say what it actually matches, and the condition
readout is machine-generated. This is the place to write down why the filter
exists.

## Why free text and no catalog table

The obvious alternative was to reuse `jrn_categories` — the managed entry
category list, which already has a CAR-shaped row in it if the reader writes
about the car.

Rejected, because the two are not the same kind of thing. An entry category is a
curated entity: it carries a description, an uploadable icon, and an admin screen
(Journal → Meta Data) to manage it, and it appears on the home screen's Top
Categories card. A filter label needs none of that. Reusing the catalog would
mean a category invented purely to file filters under would show up in the entry
category picker and be counted on the home screen, which is wrong — and the
filter would gain an icon column it never reads.

So this follows `hsh_recipes.category` (migration 0120) instead, whose own log
makes the same call for the same reason: the value is a label, not an entity.
The editor offers every value already in use through a `<datalist>`, so the
reader picks from existing categories in the common case and types a new one when
they want one — one control, no "other" escape hatch, the pattern
`household-recipes-view.tsx` and the journal's calendar-import screen already use.

The cost of that choice, stated plainly: **there is no rename.** Changing `CAR`
to `Vehicle` means editing every filter carrying it, because nothing owns the
list. At this scale that is cheaper than the catalog, admin screen and
orphaned-reference handling the alternative would need. If the number of
categories ever grows enough to make that painful, promoting them to a catalog is
a later migration that can backfill from the distinct values already here.

## Casing

Stored as typed, grouped case-insensitively. `COLLATE NOCASE` sits on the index,
not the column, so `CAR` keeps its capitals on screen while `Car` and `CAR` fall
into one group. Same approach as `sys_scratchpad_categories` and
`tol_todo_categories` take for their unique name indexes.

Note this is an index, **not** a unique constraint — many filters share a
category, which is the entire point.

## Filter names are still globally unique

`UNIQUE (name)` from 0043 is untouched, and `saveFilter` still upserts on it.

So two filters cannot both be named "Monthly" under different categories; they
have to be "CAR Monthly" and "HOUSE Monthly". Making names unique *per category*
would mean replacing the constraint, which SQLite cannot do with `ALTER TABLE` —
it is a full table rebuild — and it would change what "save" means for every
existing caller. Deliberately not done here. The grouped dropdown shows one
category at a time, so a name only has to be distinguishable within its group in
practice.

## Nothing is backfilled

Every row that exists when this runs becomes an uncategorised filter with no
description. That is the honest reading of a filter saved before either column
existed, and there is nothing to guess from — a filter's name is not a category.

The Filtering card defaults to "by Filter name", so a reader who never touches
the new control sees the screen exactly as it was. In the grouped mode, filters
with `category_name = ''` are gathered under an **Uncategorised** option, which
appears last and only when at least one such filter exists.

## Rolling back

Dropping either column loses only what was typed into it. Every filter keeps its
name, its condition tree and its behaviour; the Filtering card returns to one
flat list.

`category_name` is named by an index, so dropping *it* means a table rebuild
rather than `ALTER TABLE ... DROP COLUMN` (drop the index first, or rebuild).
`description` is named by nothing and drops directly.
