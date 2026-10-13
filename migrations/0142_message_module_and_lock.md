# Migration 0142: messages gain an owning module and a delete lock

**Date:** 2026-10-12
**Type:** two added columns on `sys_messages`; no new tables, no dropped tables, no dropped columns, no dropped rows, no rewritten rows

## What this does

Adds two columns to the application-wide message queue created by migration 0109.

| Column | Type | Default | Holds |
|---|---|---|---|
| `module` | `TEXT NOT NULL` | `''` | The slug of the module that owns the producer, e.g. `investments` |
| `is_locked` | `INTEGER NOT NULL` | `0` | 1 = the message may not be deleted |

Both are `ADD COLUMN` with a constant default, so SQLite rewrites no rows and does not
rebuild the table. The two indexes from 0109 — `idx_messages_unread` and
`idx_messages_created_at` — survive untouched.

## Why `module` sits beside `source` rather than replacing it

They answer different questions. `source` is free text naming the *thing* that filed the
message (`Investments monitor`, `Investments watch list`, `Hello, world!`); `module` names
the module that thing *belongs to* (`investments`, `system`).

Today two of the three producers are both Investments, under two different `source`
strings. Grouping or filtering the admin grid by `source` splits them; by `module` it does
not. Dropping `source` in favour of `module` would have lost the finer attribution, which
is the one an admin reads when a single monitor misbehaves.

## Why it is not a foreign key to `sys_modules`

The same reason 0109 left `source` unconstrained: **a message outlives the thing that
wrote it.** A module deleted next week must not delete its own message history, nor leave
rows pointing at a row that is gone.

Validation happens at the application boundary instead. `messageModuleSchema` in
`src/lib/messages/schema.ts` is a fixed `z.enum` of the known slugs plus `system`, so a
typo fails loudly in the use-case rather than quietly writing a slug nothing will match.
The cost, recorded here so it is not a surprise: **a newly created module cannot file a
message until its slug is added to that enum.** That is one line, and `modules.md` step 7
names it.

## Why `module` defaults to `''` and not `'system'`

Every row that exists when this migration runs was filed before the column did. `''` is
the honest encoding of *"nobody recorded this"*; `'system'` is a positive claim that the
app itself filed it, which for a pre-existing Investments alert would be false.

The repository maps a legacy `''` to `'system'` on the way out, so the domain type
`SystemMessage.module` has a single spelling and no screen has to handle two. New rows
always carry a real slug.

## Why `is_locked` is an INTEGER flag, not a nullable timestamp

`read_at` next to it is a nullable timestamp, and the difference is deliberate rather than
an inconsistency worth "fixing":

- Being **read** is an event. *When* it happened is interesting, and NULL is what makes
  0109's partial index `WHERE read_at IS NULL` possible.
- Being **locked** is a state. Nothing asks when it was locked, and no partial index wants
  it, so SQLite's 0/1 boolean is the smaller honest shape.

## What a lock actually blocks

Both delete paths, which now carry `AND is_locked = 0`:

| Path | Effect on a locked message |
|---|---|
| Admin bulk **Delete** (`deleteMessages`) | Kept. The count returned excludes it |
| Age **Purge** (`deleteMessagesBefore`) | Kept, however old it is |

Purge immunity is the point of the feature: a monitor that fired on the day something went
wrong stays after the surrounding noise is cleared. A locked message is removed by
unlocking it first — there is no force-delete, by choice.

## No new indexes

`module` is read by a grid that already loads the whole queue and filters in the view, and
`is_locked` is tested only inside the two DELETE predicates — driven by an explicit id list
or by a `created_at` range `idx_messages_created_at` already covers.

An index on either would cost every INSERT, and the Hello, world! job inserts a row a
minute, to speed up a scan nothing performs.

## What this migration does NOT do

- **No `DEFAULT_MODULES` change.** No module is being registered; `sys_messages` stays an
  application-wide `sys_` table.
- **No scheduled prune.** 0109 noted the queue grows until an admin clears it, and that is
  still true. This migration gives an admin a way to protect rows from that clearing, not
  a timer that performs it.
- **No change to the header bell.** It marks read and cannot delete, so the lock does not
  constrain it and it shows no lock glyph.

## Rollback

SQLite supports `ALTER TABLE … DROP COLUMN` from 3.35. If the linked build is older, the
rollback is the standard rebuild: create `sys_messages` at its 0109 shape, copy the six
original columns across, drop the old table, rename, and recreate both 0109 indexes.

Dropping `is_locked` silently un-protects every locked message — nothing else holds that
state, so the locks are lost rather than merely hidden.
