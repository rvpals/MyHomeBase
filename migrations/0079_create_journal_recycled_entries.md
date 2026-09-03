# 0079 — A recycle bin for journal entries, and one dead table dropped

**Date:** 2026-09-02
**Type:** new tables (`jrn_recycled_entries` + 3 child mirrors) + `DROP TABLE jrn_entry_images`

## What this does

Journal → Data Management grows a **Correct** tab with two cards:

- **Duplicates** — finds entries sharing a date and a title, lists them with a content
  excerpt, and deletes the ones you check.
- **Recycled Entries** — what those deletes produced. Restore them, delete them forever,
  or empty the bin.

"Delete" in the Duplicates card means **move to the bin**, which is what these tables are
for. Nothing needs adding to `DEFAULT_MODULES`: this is a tab inside an existing section.

## Why four tables and not one

A journal entry is not a row. Its categories, tags and locations live in
`jrn_entry_categories`, `jrn_entry_tags` and `jrn_entry_locations`, and `deleteEntry`
removes all four in one transaction.

A bin that copied only `jrn_entries` would therefore restore an entry with its tags and
GPS points silently gone — data loss dressed up as a safety feature, and worse than no bin
at all, because the user believes the restore was faithful. So each child table gets a
mirror with the same columns, and a recycle/restore round-trip is lossless.

The mirrors key on **`recycled_entry_id` → `jrn_recycled_entries.id`**, not on the original
entry id. This keeps the bin self-contained: a purge follows one key, and two separate
recyclings of the same original entry can coexist without their children colliding.

## Why `entry_id` is a column and not the primary key

`jrn_recycled_entries.id` is its own `AUTOINCREMENT` key; the original id is remembered in
`entry_id`.

The same entry can be recycled, restored, and recycled again — with `entry_id` as the PK
that second recycling would be a constraint violation. It also lets the bin hold two rows
that were both once id 42 (recycled, restored, edited, recycled) without either shadowing
the other.

On restore, `entry_id` is the *preferred* id: if it is still free in `jrn_entries` the
entry goes back exactly where it was, so any bookmark or note referring to entry 42 still
resolves. If something else has taken it since, the restore inserts at a fresh id rather
than refusing or overwriting — see `restoreEntries` in `src/lib/journal/recycle.ts`.

## Why the timestamps are `NOT NULL` with no default, and why there is no trigger

`created_at` and `updated_at` are copied from the original row, so they carry no
`DEFAULT` — a default here would let a buggy insert silently claim the entry was written
today, and the restore would put that lie back into `jrn_entries`.

`jrn_entries` has a `set_updated_at` trigger; **these tables deliberately do not.** A row
in the bin is immutable: inserted on delete, removed on restore or purge, never updated. A
trigger would overwrite the very `updated_at` the restore exists to preserve.

`deleted_at` is the one timestamp this table owns, and it does default to `datetime('now')`.
It orders the list (newest deleted first) and is the only index the reading screen needs.

## Locked entries are recycled, and come back locked

`deleteEntry` refuses a locked entry. The bulk delete behind the Duplicates card does not:
the bin makes the operation recoverable, which is the protection the lock was standing in
for. `is_locked` travels with the row and is restored as-is, so unlocking is never a side
effect of a round-trip.

## Dropping `jrn_entry_images`

Created by 0027 as part of the port from the standalone SQLCipher journal app, which
stored attachments inline as base64 data URLs. MyHomeBase never wired it up — journal
photos are read off the filesystem (`journal-photo-root.ts`).

A repo-wide search finds **no reader, no writer, and no migration touching it since 0027**;
its only mention was a descriptive line in
[`src/lib/sql-explorer/table-reference.ts`](../src/lib/sql-explorer/table-reference.ts),
removed in the same change. Confirmed as a leftover of the original import.

The `DROP` discards any rows it happens to hold. That is the accepted outcome for a table
the running application has no code path to write to.

## Reversibility

The new tables are reversible — `DROP TABLE` on all four and nothing else is affected; no
foreign keys point at them and no other feature reads them. Dropping them loses whatever
is sitting in the bin, which by definition the user already asked to delete.

**The `jrn_entry_images` drop is not reversible.** Re-running 0027's `CREATE TABLE` would
give back the empty shell, not any contents. Guarded with `IF EXISTS` so re-application is
safe.

## Verification

```sql
-- All four tables and their indexes exist; the dropped one does not.
SELECT name FROM sqlite_master
WHERE name LIKE 'jrn_recycled%' OR name = 'jrn_entry_images'
ORDER BY name;

-- The bin starts empty.
SELECT COUNT(*) FROM jrn_recycled_entries;

-- Timestamps have no default: this must fail rather than invent one.
INSERT INTO jrn_recycled_entries (entry_id, entry_date) VALUES (1, '2026-01-01');
-- Expect: NOT NULL constraint failed: jrn_recycled_entries.created_at

-- After recycling one entry from the UI, the parent and its children agree.
SELECT r.id, r.entry_id, r.entry_date, r.title, r.deleted_at,
       (SELECT COUNT(*) FROM jrn_recycled_entry_categories c WHERE c.recycled_entry_id = r.id) AS cats,
       (SELECT COUNT(*) FROM jrn_recycled_entry_tags t WHERE t.recycled_entry_id = r.id) AS tags,
       (SELECT COUNT(*) FROM jrn_recycled_entry_locations l WHERE l.recycled_entry_id = r.id) AS locs
FROM jrn_recycled_entries r ORDER BY r.deleted_at DESC;

-- A restore leaves nothing behind in the bin.
SELECT (SELECT COUNT(*) FROM jrn_recycled_entry_categories) +
       (SELECT COUNT(*) FROM jrn_recycled_entry_tags) +
       (SELECT COUNT(*) FROM jrn_recycled_entry_locations) AS orphaned_children
WHERE (SELECT COUNT(*) FROM jrn_recycled_entries) = 0;
-- Expect: 0
```
