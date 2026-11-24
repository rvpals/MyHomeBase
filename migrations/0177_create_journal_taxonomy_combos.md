# Migration 0177: journal taxonomy combos

**Date:** 2026-11-23
**Type:** new table

## What this does

Creates `jrn_taxonomy_combos` — a named, reusable pairing of categories **and** tags
that either journal entry editor can fill its two taxonomy fields from in one click.

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `name` | `TEXT NOT NULL` | unique, `NOCASE` |
| `description` | `TEXT NOT NULL DEFAULT ''` | when to reach for this one |
| `categories_json` | `TEXT NOT NULL DEFAULT '[]'` | JSON array of category names, in order |
| `tags_json` | `TEXT NOT NULL DEFAULT '[]'` | JSON array of tag names, in order |
| `created_at` / `updated_at` | `TEXT NOT NULL` | `updated_at` maintained by a trigger |

Plus `idx_jrn_taxonomy_combos_name` (unique, `NOCASE`) and
`jrn_taxonomy_combos_set_updated_at`.

## Why

A prefill template (migration 0062) covers a whole *kind* of entry: date, title
skeleton, place, content and taxonomy together. But most of the real repetition is
only the taxonomy — the same three categories and six tags land on every gym entry
whatever else changes — and on an **existing** entry being corrected there is no
template to start from, because the entry already exists.

A combo is that slice on its own. It is created on Journal → Configuration → Meta Data
→ *Prefill Tags & Category Combo*, and applied from the **Prefill Category/Tags
Combo** button inside the Categories & Tags group box of both the New Entry form and
the editor of an existing entry.

## Why this is not a prefill template with two fields

1. **A template fills only blanks and never overwrites** (`applyPrefillTemplate`). A
   combo deliberately **replaces both lists wholesale** — that is exactly what makes
   it useful for fixing an entry that is already tagged wrongly.
2. A template is offered on New Entry only; a combo is offered in both editors.
3. Folding them together would give one dropdown whose entries behave in two
   different ways depending on which fields they happen to name. Nobody could
   predict that.

## Why the names are JSON and not child rows

The same call migration 0062 made, for the same reason, in this same module: a combo
is read and written whole every time, and applying it replaces both lists at once. A
`jrn_taxonomy_combo_categories` / `..._tags` pair would buy one query nothing asks
("which combos mention HEALTH") in exchange for two joins on every read and a
delete-insert on every write.

**The consequence is shared with `jrn_saved_filters.filter_json` (0043) and
`jrn_prefill_templates.fields_json` (0062), and it is not optional:** nothing here is
a foreign key, so a category/tag **rename or merge must rewrite these rows too**.
`src/lib/journal/taxonomy-merge.ts` already follows a merge into saved filters and
prefill templates; this table is a third place it now follows, and the merge plan
names the affected combos before anything is written.

## An empty array is a real value

`[]` means "this kind of entry carries no tags", not "unset". Applying a combo whose
`tags_json` is `[]` **clears** the entry's tags — a combo replaces both lists, and
that is something a reader can legitimately want to express.

## No `is_enabled`, unlike migration 0062

A template clutters the New Entry dropdown whether or not it is in season, which is
what disabling solved there. Combos are reached through a searchable picker, so an
out-of-season one costs nothing and the column would be a setting nobody needs to
find. If that proves wrong it is one more `ALTER`.

## No foreign keys

Per project convention, and here there is nothing to cascade in either direction: a
combo names its categories and tags as text, and deleting a combo cannot affect an
entry, because applying one copies the names onto the entry and nothing points back.
Deleting a *category* does not touch combos either — a combo naming a deleted
category simply re-adds that name as a new chip when applied, which is the same thing
a prefill template already does.

## Rolling back

`DROP TRIGGER jrn_taxonomy_combos_set_updated_at;`
`DROP INDEX idx_jrn_taxonomy_combos_name;`
`DROP TABLE jrn_taxonomy_combos;`

Nothing references the table, so this is safe in isolation. Only the saved combos are
lost; no entry changes, because applying a combo copied its names onto the entry.
