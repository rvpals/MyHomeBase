# Migration 0141: the Journal's saved-location library is retired

**Date:** 2026-10-12
**Type:** five tables dropped, one column dropped via table rebuild, two indexes recreated

**This migration destroys data and cannot be undone by re-running anything.**

## What this does

Removes the Journal's saved-location library, which migration 0140 replaced with the
application-wide `sys_locations` family.

| Dropped | Was |
|---|---|
| `jrn_locations` | The saved places themselves |
| `jrn_location_categories` | Category list — already copied to `sys_location_categories` by 0140 |
| `jrn_location_tags` | Tag list — already copied to `sys_location_tags` by 0140 |
| `jrn_location_category_links` | Place ↔ category pairings |
| `jrn_location_tag_links` | Place ↔ tag pairings |
| `jrn_entry_locations.saved_location_id` | Which library row a pin was copied from |

## What is lost

**The saved places.** 0140 copied the taxonomy across but deliberately not the places, by
request: they are being recreated by hand. After this migration `sys_locations` holds the
categories and tags but **no places**.

**The provenance on existing entries.** `saved_location_id` recorded which library row each
pin came from. With `jrn_locations` gone the pointer has no target, so it goes too.

**What survives:** every entry's own copy of its pins — `latitude`, `longitude`,
`location_name`, `street_address`, `sort_order`. That has always been the entry's own data
(see the 0101 log), which is exactly why dropping the library cannot damage an entry.

## Why the column is dropped by rebuilding

`ALTER TABLE ... DROP COLUMN` is refused by older SQLite when an index names the column,
and `idx_jrn_entry_locations_saved_location_id` does. Rebuilding — create, copy, drop,
rename, re-index — is the form that works on every version this app has shipped against.

`id` is carried across explicitly rather than left to AUTOINCREMENT, so a pin keeps its
row id. Nothing references those ids now, but renumbering rows during a copy is the kind
of silent change that is impossible to notice and awkward to explain later.

## Order

The link tables go first: they carry foreign keys into `jrn_locations` and the two
taxonomy tables, and dropping a parent first would leave children pointing at a table that
no longer exists.

## What is NOT changed

- **`jrn_entries.place_name`** — entry-level trip context ("NYC Trip"), not a location
  table. Untouched.
- **`sys_locations` and its four tables** — untouched; this migration only removes the
  predecessor.
- **The icon-serving routes' response helper** (`src/app/api/journal/icon-response.ts`) —
  still used by the journal's entry-taxonomy icons and by the new `/api/admin/locations`
  routes.

## Rollback

None. The dropped tables' contents are gone. Restore from the NAS backup taken before the
release if the places are needed.
