# Migration 0151: link an entry's pin back to its saved place

**Date:** 2026-10-17
**Type:** new column

## What this does

Adds `jrn_entry_locations.saved_location_id`, a nullable pointer at the
`sys_locations` row a pin was copied from.

| Column | Type | Notes |
|---|---|---|
| `saved_location_id` | `INTEGER` (nullable) | `sys_locations.id`, or NULL when the pin came from somewhere else |

Plus `idx_jrn_entry_locations_saved_location_id`, which both of the reads this
exists for filter on.

**Nothing about the existing copy changes.** An entry still stores its own
`latitude`, `longitude`, `location_name` and `street_address`, written when the
pin was added, and a library row corrected later still does not change what an
entry says. The id sits *beside* that copy; it does not replace any part of it.

## Why the copy stays

The obvious question, since a pointer could in principle replace four copied
columns.

Because the copy is the feature. `src/lib/journal/types.ts` has said so since
migration 0139: an entry is a standalone record of where you were on a day, so
renaming a place or correcting its address years later must not rewrite history,
and deleting one must not blank an entry. A join would make an entry's text a
live read of the library and lose all three properties.

So the entry answers "where was I?" from its own columns, and the id answers a
different question the copy cannot: "which entries happened at *this* place?"
Four columns of near-identical text are not a reliable answer to that — two pins
a metre apart with the same name are indistinguishable, and a corrected address
silently splits one place into two.

## Why `saved_location_id` is back

Migration 0141 dropped a column of this name. This is not a reversal of that
decision.

0141's own log says why it went: the column was a reference into `jrn_locations`,
**the table that migration was deleting**, and *"with jrn_locations dropped it
could not point anywhere anyway."* The pointer was removed because its target
ceased to exist, not because provenance was judged a mistake.

`sys_locations` (migration 0140) is now the library, it is where the journal's
picker already reads from, and it is not going anywhere. So the pointer has a
target again. Same column name, different table, and the gap between 0141 and
here is exactly the period in which there was nothing to point at.

## No foreign key

`jrn_entry_locations` is module-owned; `sys_locations` is platform-owned. The
dependency between them runs one way on purpose -- `src/lib/sys-locations`
deliberately knows nothing about any module's tables -- and a `REFERENCES`
clause would invert part of that, letting the library's delete path fail or
cascade on the strength of rows in a module it has never heard of.

**A dangling id is therefore expected, not corrupt.** Delete a saved place and
the entries that pointed at it keep pointing at a row that is gone. They are
still completely readable: every field an entry displays is its own copy. Any
reader of the id must treat "row not found" as ordinary, which is why the new
section's drill-down renders the entries under a "no longer in your saved
places" heading rather than 404ing.

## Counting is the journal's job, not the library's

`sys_locations` still selects `0 AS usage_count` and still joins nothing. The
count shown per place in Journal -> Locations is computed by a **journal-side**
query that reads `jrn_entry_locations` and groups by this column.

That keeps the boundary pointing the way it already pointed. The journal is
allowed to know about the library -- its picker already reads it -- but the
library is not allowed to know about the journal, so a subquery naming
`jrn_entry_locations` does not go in `sys-locations/repository.ts`.

`SavedLocationWithUsage.usageCount` is consequently **still always 0**, and the
dedup screen still prints "used 0 times". That is pre-existing and out of scope
here; fixing it means deciding whether the library may name a module's table,
which this migration deliberately does not decide.

## Counts start from here

Every row written before this migration has `saved_location_id = NULL`, and
nothing backfills them.

So on the day this runs, **every count in Journal -> Locations reads 0**,
including a place visited many times. Only entries written afterwards link. The
section says so on screen, because an empty-looking list is otherwise
indistinguishable from a broken one.

Backfilling by coordinate match is possible -- find pins whose lat/long are
within a few metres of a saved place -- but it is a guess, not a fact: a pin
nudged by hand drifts out of range, and two saved places in one building collide.
That is its own decision with its own migration, and deliberately not folded in
here.

## Which writers set it

Only the library picker ("add from the location database"). Every other way a
pin is created leaves it NULL, correctly:

- clicking the map directly in the entry form -- no library row involved
- the CSV importer and the .ics importer -- neither resolves against the library
- the CLI

The column is optional at every layer above the table (the zod schemas, the
`JournalLocationInput` boundary type, the repository insert), so none of those
callers needed changing to keep working.

## Rolling back

Dropping the column loses the links and nothing else. Every entry keeps its own
copy of every location field and reads exactly as it does today; Journal ->
Locations would show 0 everywhere again.

Note that dropping it means a table rebuild rather than `ALTER TABLE ... DROP
COLUMN`, because the column is named by an index -- the same reason 0141 rebuilt
this table to remove the previous column of this name.
