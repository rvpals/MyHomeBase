# Migration 0140: the saved-location library becomes application-wide

**Date:** 2026-10-12
**Type:** five new tables, three triggers, four indexes, plus two taxonomy copies; no dropped tables, no dropped columns, no dropped rows

## What this does

Creates `sys_locations` and its four supporting tables, so saved places belong to the
application rather than to the journal module. The journal's `jrn_location*` tables are
left completely untouched — they are phased out later, once the screens reading them are
gone.

| Table | Holds |
|---|---|
| `sys_locations` | One saved place: name, coordinates, description, address |
| `sys_location_categories` | The category list, keyed by name, with an optional icon |
| `sys_location_tags` | The tag list, same shape |
| `sys_location_category_links` | Which categories a place has |
| `sys_location_tag_links` | Which tags a place has |

## Why `sys_`, not a module prefix

The three-letter module prefix says which module owns a table. These places are meant to
be picked from several modules, so no module owns them; `sys_` is the existing convention
for application-wide tables (`sys_app_settings`, `sys_messages`).

Reaching into `jrn_` tables from a second module would have made the journal a dependency
of everything that wanted a saved place, which is the coupling this avoids.

## What was copied, and what was not

| Data | Copied? | Why |
|---|---|---|
| `jrn_location_categories` | **Yes**, all columns | The names, descriptions and uploaded icons are real work |
| `jrn_location_tags` | **Yes**, all columns | Same |
| `jrn_locations` rows | **No** | The reader is recreating the places by hand |
| Category / tag pairings | **No** | They point at location ids that do not exist here |

`created_at` comes across with each taxonomy row, so a migrated name keeps the date it was
really introduced instead of claiming to be new today.

The copy is unconditional. If `jrn_location_categories` is empty the INSERT copies nothing
and the new table simply starts empty, which is the same end state.

## Why the icon columns are declared inline

The journal's taxonomy got `icon_image` / `icon_image_mime_type` from migration 0105, five
migrations after the tables existed. That sequence was a history, not a shape worth
replaying: these tables are new, so they are created at their final width.

Both columns stay nullable, as 0105 argued — "no icon" is a real state, and an empty blob
is not a sensible stand-in for it. Any read of a taxonomy list must name its columns
explicitly so the blob is not pulled on every page load.

## Foreign keys

The two link tables carry real foreign keys, unlike the journal's *entry* pairings: both
sides are library rows these tables own outright, written in one transaction, with no
importer creating a pairing ahead of the thing it points at.

`ON DELETE CASCADE` on `location_id` removes a place's pairings with it.
`ON UPDATE CASCADE` on the name columns carries a taxonomy rename through.

## What this migration does NOT do

- **No `DEFAULT_MODULES` change.** These screens live under Admin, which is not a
  registered module.
- **No change to `jrn_locations`, `jrn_location_categories`, `jrn_location_tags`,
  their links, or `jrn_entry_locations`.** Nothing is dropped or rewritten; the journal's
  Location Manager keeps working exactly as before off its own tables.
- **No data in `sys_locations`.** It starts empty by request.

## Rollback

Drop the five tables; their triggers and indexes go with them. Nothing outside them was
modified, so there is nothing else to undo.
