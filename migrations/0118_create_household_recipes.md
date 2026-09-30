# Migration 0118: the Household module's recipe box

**Date:** 2026-09-28
**Type:** two new tables, one new module prefix

## What this does

Adds the first two tables of the **Household** module — the place the household's
paperwork lives (recipes now; receipts and the HSA later).

| Object | Shape | Notes |
|---|---|---|
| `hsh_recipes` | `id` PK, `name`, `description`, `ingredients`, `directions`, `notes`, `picture` BLOB + `picture_mime_type`, `made_count`, `rating`, `source_url`, timestamps | One row per recipe |
| `hsh_recipe_tags` | `id` PK, `recipe_id`, `tag_name`, `created_at` | Many per recipe, unique on the pair |
| `idx_hsh_recipes_name` | index | The list's default order, and what the search LIKE scans |
| `idx_hsh_recipe_tags_unique` | unique index | `(recipe_id, tag_name)` — makes re-tagging idempotent |
| `idx_hsh_recipe_tags_recipe_id` | index | "the tags on this recipe" |
| `idx_hsh_recipe_tags_tag_name` | index | "every recipe tagged freezer" |
| `hsh_recipes_set_updated_at` | trigger | The usual `updated_at` stamp |

The module row itself is registered separately, in migration 0119 — a later,
separately-numbered seed, per the recipe in `modules.md`.

## Why `hsh_` and not `rcp_`

A prefix is a **module namespace**, not an abbreviation of its first feature.
Household is explicitly a container for more than one thing — the request that
created it named recipes, receipts and the HSA in the same breath — so naming
the namespace after the recipe box would age exactly the way `sql_` would have
for Tools.

That is not a hypothetical here: the HSA Tracker ships in the same change as a
placeholder, so the second feature is already visible. Its tables, when it gets
any, sit under this same prefix without a rename. See `coding-guide.md`,
*Database table naming*, and the `tol_`/`pho_` precedents recorded there.

## `rating` is nullable, and the bound is not a CHECK

Unrated and "rated 1" are different facts. Defaulting the column to a number
would silently invent an opinion about every recipe ever typed in, and there
would then be no way to tell a considered 1 from an untouched default — so the
column is `INTEGER` with no default and `NULL` means unrated.

The 1-10 bound lives in the zod schema rather than in a `CHECK` constraint, for
two reasons. A `CHECK` rejection surfaces as a driver error with no useful text,
where zod's message reaches the form field; and **SQLite cannot alter a
constraint** — widening the scale to 1-100 later would mean the full
copy-rename-drop table rebuild, against a column whose validity is already
enforced at the only boundary that writes it.

## `made_count` is a counter with its own use-case

Not a field on the edit form. "I made this again" is a single click from the
list, and routing it through the edit form would mean re-submitting every other
field — so two people cooking from the same recipe would overwrite each other's
notes to record that they cooked. `incrementMadeCount` is a bare
`SET made_count = made_count + 1`, which is also atomic under concurrent presses.

## Ingredients and directions are TEXT blocks, not structured rows

One item per line, stored as typed. The structured alternative
(quantity / unit / item rows) would enable scaling a recipe to 2x and generating
a shopping list, and neither was asked for — this is the *"write the simple
version and say so"* case from `ARCHITECTURE.md`.

Worth stating because the reverse is not symmetric: splitting a text block into
rows later is an additive migration plus a parser, while collapsing structured
rows back into text if the structure turns out to be unwanted loses whatever
the user typed that didn't fit the parser's grammar.

## Tags are normalized; there is no tag catalog

Rows, not a comma-joined column — the `jrn_entry_tags` (0027) call rather than
the `sys_saved_sql_queries.tags` (0112) one. The distinction 0112 drew is the
test, and these tags land on the other side of it: they **are** browsable. The
recipe list filters by them and the filter enumerates them with counts, which
is exactly the "queried, joined" case that migration says to normalize for.

What is deliberately absent is a managed `hsh_tags` catalog table, the way
Journal has `jrn_tags` alongside `jrn_entry_tags`. Nothing here needs a per-tag
description or icon, and a catalog would mean a management screen to maintain
it. Tags are created inline as a recipe is written, and the schema lower-cases
and trims them at the boundary — which is what keeps "Weeknight", "weeknight"
and " weeknight " one tag with no catalog to reconcile them against. Adding a
catalog later is additive; it would seed itself from `SELECT DISTINCT tag_name`.

## The picture is a BLOB, and the list must never select it

`picture` + `picture_mime_type` follows the pattern established by
`exp_creditcard_accounts.card_image` (0031), `exp_categories.icon_image` (0034),
`stk_investment_accounts.icon_image` (0037) and `jrn_categories.icon_image`
(0042): the bytes are served by a dedicated route
(`/api/household/recipes/[id]/picture`) rather than inlined as a base64 data
URL, so they never bloat a JSON payload and the browser can cache them.

The trap the earlier migrations all record, restated because it bites hardest
here: **reads of the recipe list must select columns explicitly** and derive
`picture IS NOT NULL AS has_picture`. A `SELECT *` on a 200-recipe list pulls
200 photographs into memory to render 200 thumbnails' worth of boolean. The
repository's `SUMMARY_COLUMNS` constant is where this is enforced.

The cap is 2 MB, set in `schema.ts` rather than in SQL — well above the 64 KB
icon caps elsewhere, because this is a photograph of a finished dish and not a
20px mark, and well below what a modern phone camera emits, so an unscaled
upload is refused with a readable message rather than stored.

SVG is excluded by the shared `IMAGE_UPLOAD_MIME_TYPES` allowlist: it can carry
script, and these bytes are served back from this app's own origin.

## No foreign keys

Following the `jrn_`/`att_` convention in this database. The cascade from a
recipe to its tag rows is the repository's job, inside the same transaction as
the delete — see `deleteRecipe` and `deleteRecipes` in
`src/lib/household/repository.ts`.

## Rollback

```sql
DROP TABLE hsh_recipe_tags;
DROP TABLE hsh_recipes;
```

Dropping the tables discards every stored picture with them; there is no copy
of those bytes anywhere else.
