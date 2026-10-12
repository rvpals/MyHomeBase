# Migration 0139: a street address on an entry's location pin

**Date:** 2026-10-12
**Type:** one nullable column added to `jrn_entry_locations`, no new tables, no dropped columns, no dropped rows

## What this does

Adds `street_address TEXT` (nullable) to `jrn_entry_locations`, so a pin on a journal
entry can carry the full street address alongside its coordinates.

| Column | Type | Meaning |
|---|---|---|
| `street_address` | `TEXT` (nullable) | The full street address for this pin, or NULL when none was captured |

## Why nullable, and not `NOT NULL DEFAULT ''`

Every other text column on this table is `NOT NULL DEFAULT ''`, so this one breaks the
local convention deliberately. The three states are genuinely different here:

- **NULL** — no address was ever captured. Every row written before this migration, and
  every pin dropped straight on the map without a lookup.
- **`''`** — a lookup ran and came back with nothing.
- **a string** — an address is known.

Collapsing the first two would make "never asked" and "asked, got nothing" indis-
tinguishable, which is the difference that decides whether re-running a lookup is
worth it.

## Why this is a copy, not a join

`jrn_locations.address` already exists and holds the library's address for a saved place.
This column is **not** that value read live — it is the entry's own copy, written when the
pin was added.

The entry stays a historical record: editing or deleting the library row never changes
what an entry says. That is the same rule `latitude`, `longitude` and `location_name`
already follow, and the reason `saved_location_id` is provenance rather than a join
(see the 0101 log).

The cost to accept: an address copied onto an entry does not update when the library row
is corrected later. That is the intended direction — history does not move.

## What is not changed

- **`jrn_locations`** — untouched. The library's own `address` column is unaffected.
- **`jrn_recycled_entry_locations`** (migration 0079) — untouched, so an entry moved to
  the Recycle Bin and restored comes back **without** its street addresses. That table
  already drops `saved_location_id` the same way; this migration keeps the two consistent
  rather than fixing one and not the other.
- **The CSV and ICS importers** — unchanged. They write no address, so their rows get NULL.

## Rollback

SQLite cannot drop a column in place on older versions. To reverse, rebuild the table
without `street_address` and copy the rows across.
