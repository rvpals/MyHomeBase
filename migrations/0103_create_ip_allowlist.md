# Migration 0103: the IP allowlist

**Date:** 2026-09-21
**Type:** new table (1)

## What this does

Adds `sys_ip_allowlist`, the addresses the reader has vouched for. An allowlisted IP
always scores `normal` in `sys_site_visits` (0102), whatever the heuristics would
otherwise say about its user agent or its request rate.

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PK AUTOINCREMENT` | |
| `ip_address` | `TEXT NOT NULL UNIQUE` | The vouched-for address |
| `label` | `TEXT NOT NULL DEFAULT ''` | Why it is trusted — "my phone on 5G" |
| `added_by_user_id` | `INTEGER` | → `sys_users.id`, no FK. `NULL` when added by CLI |
| `created_at` | `TEXT NOT NULL` | |

## The problem it solves

A phone on mobile data whose session cookie has expired arrives logged-out, repeatedly,
from an address that changes shape over time. Each of those is a root hit with no
sign-in following it — precisely the pattern the scoring calls suspicious.

Without a way to say *this one is me*, the home-screen alert fires daily on the reader's
own traffic and stops being read. An alert that is always on is an alert that is off.

## It suppresses alarm, never evidence

The single most important line in this migration.

Visits from an allowlisted address are still recorded in full: same row, same columns,
same ninety-day retention. **Only the verdict changes.**

The alternative — skipping the `INSERT` for allowlisted addresses — was rejected outright.
It would mean that adding an address blinds the log to it, and the one thing a
compromised "known good" address must not do is become invisible. An audit trail that
omits the entries you trust is an audit trail that cannot tell you when that trust was
misplaced.

## This is not an authorisation input

Nothing in `src/lib` may treat it as one, and nothing does.

The addresses come from `x-forwarded-for` behind the NAS reverse proxy, where a direct
caller can set the header to any value. An allowlisted address is therefore trivially
spoofable. It must never grant access, skip a password, or shorten a check.

Its only consumer is the suspicion scorer, whose entire output is a colour on an admin
screen. Wiring this table into the session path would convert a display heuristic into
an auth bypass — which is the specific mistake this paragraph exists to prevent a future
reader from making.

## Why `ip_address` is UNIQUE here but nothing is unique in 0045

`sys_auth_events` deliberately has no unique index anywhere, because two identical failed
attempts in the same second are two real events.

This table is the opposite kind of thing. `ip_address` identifies the row exactly: an
address is either vouched for or it is not, and there is no second row to add. That is
the coding-guide test for a unique index, and it passes cleanly.

The constraint also does real work — it makes "add if missing" safe to call repeatedly
from the bulk action, so ticking twenty rows that share four addresses inserts four
entries rather than failing or duplicating.

No separate index is declared: `UNIQUE` already creates one on `ip_address`, which is the
only lookup this table serves.

## Re-scoring on change

Adding an address re-scores its existing `sys_site_visits` rows to `normal` and marks
them reviewed, in one transaction — otherwise the reader would vouch for their own phone
and watch the old red rows sit there unchanged.

Removing an address re-scores its rows against the live heuristics, which may turn them
red again. Both directions are explicit lib functions, because a stored verdict that
silently disagrees with the rules is worse than no verdict.

## `added_by_user_id` has no foreign key

Project convention, and the same reasoning 0045 gives: deleting a user must not delete
the record of a decision they made. The row survives as an orphan pointing at a departed
id, and the screen falls back to showing the id.

Nullable because the CLI can add an entry with no session behind it.

## Reversal

`DROP TABLE sys_ip_allowlist;` — nothing references it. Existing `sys_site_visits` rows
keep whatever verdict they were last scored with; re-running the scorer would restore
the heuristic answer.
