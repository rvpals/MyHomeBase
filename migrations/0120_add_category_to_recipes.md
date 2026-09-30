# Migration 0120: a category per recipe

**Date:** 2026-09-29
**Type:** one new column, one new index

## What this does

Adds `hsh_recipes.category` — what a dish *is*: Dinner, Dessert, Breakfast. The
editor offers a dropdown of every category already in use and accepts a new one
typed in, so the vocabulary grows by use rather than by administration.

| Object | Shape | Notes |
|---|---|---|
| `hsh_recipes.category` | `TEXT NOT NULL DEFAULT ''` | Blank means uncategorised |
| `idx_hsh_recipes_category` | index on `category COLLATE NOCASE` | The filter, and the DISTINCT that builds the dropdown |

`DEFAULT ''` makes this safe against a table that already holds rows: every
existing recipe becomes uncategorised, which is an accurate statement about
them rather than a guess.

## Why a column, and not a catalog table

Journal gives its categories a table (`jrn_categories`) with a description, an
icon and a management screen. That is the right shape *there* because those
categories are administered: they are renamed, described, and given artwork.

Nothing has asked for any of that here. A catalog would mean a second table, a
cascade to think about, and a management screen to build and maintain, all in
service of a string the recipe editor could hold on its own. The "previously
used" list the dropdown needs comes from `SELECT DISTINCT category` over the
recipes themselves — no catalog to keep in step, and no way for the list to
drift from what is actually stored.

This is *promote on the second caller* (`ARCHITECTURE.md`). If categories later
need descriptions, icons, or renaming in one place, the promotion is mechanical
and can seed itself from that same `SELECT DISTINCT`.

## Why one category, and not many

The module already has a many-valued free-text label: `hsh_recipe_tags`. A
second one would be the same feature under a different name, and the reader
would have to guess which box a word belongs in.

They divide cleanly as one-vs-many, which is why the split is worth having at
all:

- **Category** — what the dish *is*. A dish has one. Mutually exclusive by
  nature: a thing is not both Dessert and Breakfast.
- **Tags** — cross-cutting labels. A dish has any number. `freezer`, `quick`,
  `kids-like-it` are all true of one recipe at once.

## Case is preserved; matching is case-insensitive

This is the one place Category deliberately parts company with Tags.

A tag is lower-cased at the boundary (`tagNameSchema`), because it renders as a
small chip where lower case looks deliberate, and because that normalization is
the only thing stopping "Weeknight" and "weeknight" becoming two tags with no
catalog to reconcile them.

A category is a **display label**, shown prominently as a column and as a filter
option. Lower-casing "Dessert" to "dessert" there would look like a bug. So the
string is stored exactly as typed, and the *matching* carries the normalization
instead:

- the dropdown de-duplicates case-insensitively, so typing "dessert" when
  "Dessert" exists reuses the existing spelling rather than forking it;
- the filter compares `COLLATE NOCASE`, so a bookmarked `?category=dessert`
  still finds the "Dessert" recipes;
- the index is declared `COLLATE NOCASE` so that comparison can use it rather
  than scanning.

The tradeoff is honest: two recipes *can* end up as "Dessert" and "DESSERT" if
someone bypasses the dropdown and insists. They will filter together and appear
as one option in the list, so the consequence is cosmetic — which is the right
side to err on for a label a person reads.

## Rollback

SQLite cannot drop a column without rebuilding the table. To reverse this:

```sql
DROP INDEX idx_hsh_recipes_category;
-- then the copy-rename-drop dance if the column itself must go; leaving an
-- unread NOT NULL DEFAULT '' column in place costs nothing and is the usual
-- answer.
```
