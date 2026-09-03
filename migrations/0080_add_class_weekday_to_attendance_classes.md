# Migration 0080: add a class weekday to attendance classes

**Date:** 2026-09-03
**Type:** additive column

## What this does

Gives each attendance class the weekday it meets on, so the home screen can open
on today's register instead of on one statically configured class.

| Column | Type | Notes |
|---|---|---|
| `class_weekday` | `INTEGER NOT NULL DEFAULT 0` | 1 = Monday … 5 = Friday; `0` means never set |

Plain `ALTER TABLE ADD COLUMN` — an additive column with a default, so no
rebuild, and existing rows are valid as they stand.

## Why the weekday is on the class, not the session

"Math 101 is the Monday class" is a fact about the *class*. A saved attendance
record already carries its own `attendance_date` and can derive the day from it
whenever it wants, so storing a weekday per session would denormalise something
the date already implies — and it would go stale the moment a timetable changed.

That also means correcting a class's weekday immediately changes which register
the home screen opens on, which is the behaviour you want: the old day was simply
wrong.

## Why 1–5 and not 0–6

The stored numbers match `Date.getDay()` (0 = Sunday), so the home screen
compares today's day number straight against the column with no lookup table in
between. Only 1–5 are offered: this is a school timetable, and Monday-to-Friday
is the requirement. On a Saturday or Sunday nothing matches, and the screen falls
through to the configured default class — the weekend has no register rather
than a wrong one.

## Why the default is 0 and there is no back-fill

`1` (Monday) is a plausible guess but would be a lie stored against an existing
row, indistinguishable from a day the teacher had confirmed — and it would make
the home screen open on the wrong register with full confidence every Monday.

`0` is therefore a real state meaning "never set":

- `attendanceClassSchema` admits `0`, so an existing class stays *readable*.
  Refusing it here would have made every pre-migration class un-loadable.
- `createClassSchema` requires 1–5, so `0` can never be *written*. Once a class
  is saved through the form it carries a real weekday.
- `resolveWeekdayClassId()` in `src/lib/attendance/weekday.ts` skips a class
  sitting on `0` — an unset class is never today's class, so the screen falls
  through to the configured default rather than guessing.

The Classes grid renders such a class as "—", so the gap is visible.

The CSV roster importer creates a class with `0` as well. An import names a class
but says nothing about when it meets, and inventing a Monday there would be the
same lie by another route.

## How the home screen chooses a class

Precedence, most specific first:

1. `?classId=` in the URL — so a bookmarked first-period register still lands
   where it points.
2. Today's weekday class.
3. The configured `attendance_default_class_id` setting.
4. Nothing — "Pick a class…".

The weekday beats the static default because it is the more specific fact; the
URL beats both because it is an explicit request.

## What the database does not enforce

- **No UNIQUE index on `class_weekday`.** Two classes may legitimately share a
  weekday — a Monday morning and a Monday afternoon class is ordinary — so a
  weekday does not identify a class row exactly, and the rule in
  `coding-guide.md` → *Never put a DATE column in a unique index* applies for the
  same reason. When several match, `resolveWeekdayClassId()` takes the first by
  name (the order `listClasses()` already returns) and the dropdown stays fully
  usable.
- **No index at all.** Every read of this column arrives with the whole class
  list already in hand; `listClasses()` returns a handful of rows and the match
  happens in TypeScript.
- **No CHECK on the 1–5 range.** `createClassSchema` is the only writer and
  already applies it, which is where this module's invariants live per
  `ARCHITECTURE.md`. Adding a CHECK to an existing SQLite table requires the full
  create-copy-drop rebuild — a poor trade for a bound already held.

## Rollback

```sql
ALTER TABLE att_classes DROP COLUMN class_weekday;
```
