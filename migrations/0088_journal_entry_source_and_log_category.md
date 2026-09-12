# 0088 — Where a journal entry came from, and the Log category

**Date:** 2026-09-11
**Type:** new columns (`jrn_entries.source`, `.external_id`, and the same two on
`jrn_recycled_entries`) + one seeded `jrn_categories` row

## What this does

Backs the journal's new **Calendar Import** section, which reads a Google Calendar
`.ics` export and turns the events you pick into ordinary journal entries.

Two things the import needs that the schema couldn't say before:

- **`source`** — `''` for an entry written by hand, `'ics'` for one imported from an
  iCalendar file, `'csv'` for the existing CSV importer. Provenance, so a screen can
  tell a logged activity from something you sat down and wrote.
- **`external_id`** — the source's own id for the entry. For `'ics'`, the `VEVENT`'s
  `UID`.

Plus a seeded **`Log`** category, which `listTodayInHistory` now excludes.

Nothing to add to `DEFAULT_MODULES`: Calendar Import is a section inside the existing
Journal module, not a new one.

## Why `external_id` and not date + time + title

The CSV importer already has a duplicate check — `countEntriesMatching` on date, time
and title (see `ports.ts`). It is the right key for a CSV, which carries no stable id,
and the wrong one here.

A calendar event has an identity that outlives its own fields. Rename "Swim practice"
to "Skylar swim practice", or move it from 6:00 to 6:30, and Google keeps the same
`UID`. Matched on date+time+title, that edited event is a **new** entry, so the second
import silently duplicates it — and the reader's journal fills with near-copies of
every event they ever adjusted. Matched on `UID`, it is recognised as the entry already
stored.

So the two importers match differently on purpose, each on the strongest key its format
actually offers.

## Why the index isn't UNIQUE

`idx_jrn_entries_source_external` covers the importer's one lookup: *is this
`(source, external_id)` already here?*

It can't be UNIQUE. Every hand-written entry carries `('', '')`, and that is the
overwhelming majority of the table — a unique index would allow exactly one of them and
reject the second entry anyone ever wrote. Uniqueness of a real `UID` is enforced by
the importer's lookup instead, which is where the semantics ("same UID, same source =
same entry") live anyway.

## Why the recycle bin gets the columns too

`recycleEntries` and `restoreRecycledEntries` (0079) copy entry columns **by name**, in
both directions. A column missing from the mirror is silently dropped on the way in.

Without these two, recycling an imported entry and restoring it would return it with
`source` and `external_id` blanked — and the next import, no longer able to match it,
would create a second copy. That is precisely the failure `external_id` exists to
prevent, arriving by the back door. The mirror stays faithful, as 0079 argued it must.

## Why `Log` is seeded here

`createEntry` already auto-registers an unknown category, so the import would create
`Log` on its own the first time it ran. Seeding it in the migration buys two things:

- It carries a **description**, which auto-registration leaves empty.
- It exists on the Meta Data screen from the moment the migration runs, so the category
  can be given an icon and used in a filter before any import has happened.

`INSERT OR IGNORE`, because `jrn_categories.name` is the natural key (0027) and a
reader who already made their own `Log` category keeps whatever description they wrote.

## The Today-in-History exclusion is code, not schema

`listTodayInHistory` filters `Log` out in `src/lib/journal/journal.ts`, comparing
against the `LOG_CATEGORY_NAME` constant case-insensitively. No SQL here does it.

That is deliberate: the widget reads entries that already carry their `categories`
array, so the rule is one `.filter()` in the use-case and needs no new repository
method or query. It also keeps the rule where a test can reach it without a database.

Worth knowing: the exclusion applies **only** to the Today in History widget. Entries,
Calendar and search still show `Log` entries, which is why the category is visible and
filterable rather than hidden.

## Reversibility

SQLite can't drop a column in the versions this project targets, so a rollback would
rebuild `jrn_entries`. There is no need: both columns default to `''`, and every
statement that existed before this migration still runs unchanged against the new
shape. Leaving them in place costs nothing.

The `Log` row can be deleted from the Meta Data screen like any other category — though
`listTodayInHistory` will keep filtering the *name*, so entries tagged `Log` stay out of
the widget whether or not the managed row exists.
