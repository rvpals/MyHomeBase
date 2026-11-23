# Migration 0174: Locations Visited reads pinned locations

**Date:** 2026-11-23
**Type:** data change to a built-in report (no schema change)

## What this does

Rewrites the built-in **Locations Visited** journal report (seeded by 0132) so it
counts an entry's *pinned locations* instead of the free-text `place_name` field.

| Part | Before | After |
|---|---|---|
| Selection | filter `place is not empty` | SQL `EXISTS (... jrn_entry_locations ...)` |
| Most visited | tally of `place_name` | tally of pins |
| Every mention | one row per entry | one row per place on each entry |

## How a pin is named

1. Linked to the saved-location library (`saved_location_id`, 0151): the library
   row's **current** name in `sys_locations`, so a rename there is followed.
2. Library row deleted or name blank: the entry's own copy of the name.
3. No name at all (a pin dropped on the map): its coordinates, to five decimals.

A place is counted once per entry however many pins share it.

## Why SQL mode

The filter-query syntax has no "has a pin" field. The fragment is read-only and
passes `sql-guard`. Encrypted entries are still excluded by the runner.

## Things to know

- Only the **built-in** report of that name is changed. A copy the reader made keeps
  its own text and filter. Edits made to the built-in itself are overwritten.
- The `row` part is deleted; "Every mention" is now `{{table.placeMentions}}`, a new
  report placeholder added alongside this migration.
- `place_name` is untouched and `{{placeName}}` still works in other reports.
