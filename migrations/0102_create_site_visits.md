# Migration 0102: the root-arrival log

**Date:** 2026-09-21
**Type:** new table (1)

## What this does

Adds `sys_site_visits`, the storage behind **Admin → Security → Visit**: one row each
time somebody opens the site root without a valid session.

It answers a question `sys_auth_events` (0045) structurally cannot. That table records
people who reached the sign-in form and *typed something*. A scanner that requests `/`
and leaves, or a stranger who opens `mhb.rvpals80.synology.me` and never attempts a
password, produced no row anywhere in the database before today.

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PK AUTOINCREMENT` | |
| `ip_address` | `TEXT NOT NULL DEFAULT ''` | First `x-forwarded-for` hop. **Advisory** |
| `user_agent` | `TEXT NOT NULL DEFAULT ''` | The strongest single suspicion signal |
| `referer` | `TEXT NOT NULL DEFAULT ''` | Blank = typed or bookmarked, the common case |
| `path` | `TEXT NOT NULL DEFAULT '/'` | Only `'/'` is written today |
| `suspicion` | `TEXT NOT NULL DEFAULT 'normal'` | `normal` \| `watch` \| `suspicious`, scored at write |
| `reviewed_at` | `TEXT` | `NULL` until an admin acknowledges it |
| `created_at` | `TEXT NOT NULL` | |

## Only logged-out arrivals, and only the root

The scope was the first decision and it is the one that keeps this table readable.

A row is written when, and only when, a request reaches the site root carrying no valid
session. Signed-in arrivals write nothing at all — so every row is, by construction,
somebody who was not the reader at the moment they arrived.

The alternative was a general access log. Rejected for the reason 0045 gives for
rejecting a page-view table: on a public hostname, logging every request means logging
every static asset, every `_next` chunk and every icon, which is thousands of rows a day
to answer a question nobody asked. The narrow version produces a handful of rows a day
and every one of them is worth a look.

`path` is stored anyway, defaulted to `'/'`. Widening the hook later to other
unauthenticated entry points is a one-line change in the layout, and a blank-defaulted
column added now is free where a table rebuild then is not.

## Why the verdict is stored, not computed

`suspicion` is scored before the `INSERT` rather than derived on read.

The screen groups ninety days of rows by week and then by day. Re-running the heuristics
over every row on every render would make the page cost grow with the table, and the
home-screen alert — which fires on every admin's home render — would become a scan
instead of an indexed count.

The cost is that a stored verdict can go stale: the rules change, or an address is added
to the allowlist. Both paths re-score the affected rows explicitly rather than hoping,
which is exactly why the column is plain and updatable rather than `GENERATED`. See
0103.

Three verdicts, `CHECK`-constrained, no free text. `watch` exists so that a single weak
signal — an odd user agent and nothing else — has somewhere to land that is not a red
flag. Most such rows are harmless, and flagging them all would train the reader to
ignore the column, which is the failure mode worth designing against.

## The IP is advisory, and here that matters more

Same warning as 0045, restated because this table's entire purpose is to point a finger.

Behind the NAS reverse proxy the value comes from `x-forwarded-for`, which is only as
trustworthy as the proxy in front of it. A direct caller can put anything in that
header. The adapter records the first hop and nothing validates it.

Treat it as a triage aid — *look at this one first* — never as identity, and never as an
input to an authorisation decision.

## No unique index, deliberately

Specifically none spanning `created_at` or `ip_address`.

Two identical requests in the same second from the same address are a real event worth
counting twice. That burst **is** the signal the table exists to show, and deduping it
would erase precisely the thing worth seeing. This is the same reasoning, and the same
conclusion, as 0045.

## Indexes

| Index | Serves |
|---|---|
| `site_visits_created_at_idx` | The newest-first read, the week bucketing, and the 90-day prune |
| `site_visits_ip_idx` | Per-IP rollups, and the re-score when an allowlist entry changes |
| `site_visits_unreviewed_suspicious_idx` | The home-screen alert — partial on `reviewed_at IS NULL AND suspicion = 'suspicious'`, so `normal` and `watch` rows never enter it |

## Retention

Ninety days, pruned by the same runner pattern as `sys_auth_events`. Admins can also
delete rows directly from the Visit tab, individually or in bulk.

## Reversal

`DROP TABLE sys_site_visits;` — it is referenced by no other table and no foreign key
points at it.
