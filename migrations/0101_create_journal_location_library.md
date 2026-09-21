# Migration 0101: the Journal's saved-location library

**Date:** 2026-09-20
**Type:** new tables (5) + one added column

## What this does

Adds the storage behind **Journal → Locations → Location Manager**: a library of places
the reader saves once and then picks from when writing an entry, instead of searching
Nominatim or hunting the map for the same coffee shop a fourth time.

| Table | What it holds |
|---|---|
| `jrn_locations` | One saved place: name, coordinates, description, address |
| `jrn_location_categories` | The managed list of place categories ("Restaurant", "Trailhead") |
| `jrn_location_tags` | The managed list of place tags |
| `jrn_location_category_links` | Location ↔ category pairings |
| `jrn_location_tag_links` | Location ↔ tag pairings |

Plus `jrn_entry_locations.saved_location_id` — which library row an entry's location came
from, or `NULL` when the pin was dropped by hand.

## The library is the source; the entry keeps a copy

The one design decision worth recording. A picked location is **copied** onto the entry —
`jrn_entry_locations` still carries its own `latitude`, `longitude` and `location_name`,
exactly as it did before — and `saved_location_id` is a *provenance* column, not a join
the read path depends on.

The alternative was to make `jrn_entry_locations` a pure join table pointing at
`jrn_locations`. Rejected for three reasons:

1. **History must not move.** Correcting a library row's coordinates (the pin was 40 m
   off) would silently relocate every entry that ever referenced it. An entry records
   where the reader *was*, and that is not editable after the fact by touching a lookup
   table.
2. **The existing rows have nowhere to point.** Every location written before today came
   from the map picker or the CSV/ICS importers, and there is no library row for any of
   them. A NOT NULL join column would have needed a backfill that invents a library entry
   per distinct coordinate — creating hundreds of unnamed places nobody asked for.
3. **The importers keep working untouched.** `csv-import.ts` and `ics-import.ts` write
   locations without knowing the library exists; the new column defaults to `NULL` and
   they need no change at all.

The cost is that an entry's copy of a name can drift from the library's after a rename.
That is the intended reading — the entry says what the place was called when it was
written — and the manager shows the usage count so a rename's blast radius is visible.

`ON DELETE SET NULL` on `saved_location_id` is the same argument at delete time: retiring
a place from the library must not delete a location off a past entry. The entry keeps its
coordinates and its name and simply stops pointing anywhere.

## Why location categories are their own list

`jrn_location_categories` deliberately does **not** reuse `jrn_categories`. An entry's
categories describe what the *writing* is about ("Travel", "Work", "Log"); a location's
describe what the *place* is ("Restaurant", "Trailhead", "Family"). One shared list would
put all ~200 existing entry tags into the location filter dropdown and every new place
category into the entry form's, which is noise in both directions.

## The link tables carry foreign keys — the entry ones don't

`jrn_entry_categories` and `jrn_entry_tags` (migration 0027) have no FK, because the CSV
importer may create a pairing for a category that doesn't exist as a managed row yet.

The two new link tables have real FKs with `ON DELETE CASCADE` to the location and
`ON UPDATE CASCADE` to the taxonomy name. Nothing imports into the library — every row is
written by the manager, in one transaction, and the referenced taxonomy row always exists
first. Given that, the FK is free correctness: deleting a place cleans up its pairings,
and renaming a category carries its pairings along instead of orphaning them.

## Columns

### `jrn_locations`

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PK AUTOINCREMENT` | |
| `name` | `TEXT NOT NULL DEFAULT ''` | The label. **Not unique** — two places may share a name; coordinates distinguish them. Blank allowed |
| `latitude` | `REAL NOT NULL` | |
| `longitude` | `REAL NOT NULL` | |
| `description` | `TEXT NOT NULL DEFAULT ''` | Searched, alongside `address` and `name` |
| `address` | `TEXT NOT NULL DEFAULT ''` | Usually reverse-geocoded, always editable |
| `created_at` / `updated_at` | `TEXT NOT NULL` | `updated_at` maintained by trigger |

`name` is not unique on purpose. The natural key would have to be the coordinate pair, and
floats are the wrong thing to key on — two pins 3 m apart are the same place to a person
and different rows to SQLite. Duplicate detection is left to the reader, who can see both
rows on the map.

### `jrn_location_categories` / `jrn_location_tags`

Name-keyed with a description and the usual timestamps — the same shape as `jrn_categories`
and `jrn_tags`, minus the icon columns. No icons here: a location's mark on the map is its
pin, and a second per-category glyph would compete with it.

### `jrn_location_category_links` / `jrn_location_tag_links`

`id`, `location_id`, the taxonomy `name`, `created_at`. Unique on the pair, plus an index
on the taxonomy side for "show me every location tagged X" — the Location Map's filter.

## Reversal

`DROP TABLE` the five new tables. The added column stays: SQLite can drop a column
(3.35+), but there is no reason to — a `NULL`-everywhere provenance column costs nothing
and dropping it would rewrite the whole entry-locations table.
