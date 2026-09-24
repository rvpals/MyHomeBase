# Migration 0109: an application-wide message queue

**Date:** 2026-09-23
**Type:** one new table

## What this does

Adds `sys_messages`, a household-wide queue of notices the app has filed.

| Object | Shape | Notes |
|---|---|---|
| `sys_messages` | `id` PK, `created_at`, `read_at` (nullable), `title`, `body`, `source` | One row per message; `read_at IS NULL` means unread |
| `idx_messages_unread` | partial, `(created_at DESC) WHERE read_at IS NULL` | What the Unread tab rides |
| `idx_messages_created_at` | `(created_at DESC)` | The Read tab, and the counts |

## The problem it solves

Every notice the app produces today is tied to a screen that happens to be
open — the refresh control's status line, the startup message, the suspicious
visit banner. That is fine for something the reader is watching happen, and
useless for anything else.

The Investments monitors added in migration 0110 are the case that forced this.
A monitor fires part way through a price refresh, which is exactly the moment
the reader is least likely to be reading a progress line, and there was nowhere
for "NVDA is approaching your $10,000 target" to go that would survive the page
closing. A queue is that place.

## Household-wide, not per reader

There is one queue and one read state. Marking a message read marks it read for
everybody.

This follows what the app already is. The Investments module's holdings are
"ours" rather than any one person's, and a household site with a handful of
readers does not have a meaningful notion of *your* copy of a portfolio alert.
The cost of the alternative is real: a per-reader queue is a message table plus
a `sys_message_reads` join keyed by `(message_id, user_id)`, and every read of
the unread half becomes a `LEFT JOIN … WHERE read_at IS NULL` against a row that
may not exist yet.

The premise to check this against, in the sense `migrations/0092` records: *does
any message mean something different to two different readers?* Today none does
— they are all facts about shared data. If one ever does (a message addressed to
one person, say), the shape to move to is this table minus `read_at`, with the
read state in its own join table. That is a migration, not a rewrite, which is
what makes the simpler choice safe to make now.

## `read_at` is nullable, on purpose

`coding-guide.md` says *a settings value is blank, never NULL*, so a nullable
column deserves an explicit defence.

That rule is about `sys_app_settings.value` — a `TEXT NOT NULL` key/value store
where modelling "nothing set" as NULL would mean the full create-copy-drop-rename
rebuild for no behavioural gain. None of that applies here:

- The column is a **timestamp**, not a setting. NULL is the honest encoding of
  "this has not happened yet", and the sentinel alternative would be a fake date.
- The **partial index depends on it.** `WHERE read_at IS NULL` is what lets the
  Unread tab read only the unread rows. A `''` sentinel would work in a predicate
  too, but it would mean the column's type says timestamp while its contents
  sometimes say otherwise.

The mapping to the domain type happens once, in the repository: SQLite's NULL
becomes `undefined`, so `SystemMessage.readAt?: string` has exactly one spelling
of "not read" and nothing downstream tests for two.

## Why a partial index

The unread half is the half the reader opens, and on a queue that has been
running for a year it is the small half of a large table. Indexing it partially
means that query touches only unread rows instead of scanning and filtering.

The full `created_at DESC` index is there for the Read tab and the counts, which
genuinely do want the whole table.

## `source` is free text and not a foreign key

`source` records who filed a message — `Investments monitor`, say. It is
deliberately not a reference to anything.

A message outlives the thing that wrote it. Deleting a monitor next week must
not delete, or orphan, the messages it filed while it existed; the record that
something was reported at a point in time is the whole value of a queue. This is
the same call `exp_post_import_rules.type_name` makes for the same reason —
text keeps the row readable on its own in a SQL Explorer query, with no join.

Blank means unattributed, following the module's usual convention.

## No retention policy

Nothing deletes messages yet. A household queue grows by a handful of rows a
week, so this is not a table that needs pruning on any timescale worth building
for now, and a policy that silently destroys records is much easier to add later
than to take back. When it does need one, the shape is a scheduled job deleting
read messages past some age — not an unbounded cap, which would drop unread ones.
