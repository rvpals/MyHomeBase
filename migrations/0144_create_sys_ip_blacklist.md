# Migration 0144: the IP blacklist

**Date:** 2026-10-13
**Type:** new table (1)

## What this does

Adds `sys_ip_blacklist`, the addresses the reader has explicitly distrusted. A
blacklisted IP always scores `suspicious` in `sys_site_visits` (0102), whatever the
heuristics would otherwise say about its user agent or its request rate.

It is the exact mirror of `sys_ip_allowlist` (0103), pointing the other way — same
columns, same `UNIQUE` on `ip_address`, same re-score-on-change behaviour, same
blank-string sentinel on `label`.

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PK AUTOINCREMENT` | |
| `ip_address` | `TEXT NOT NULL UNIQUE` | The distrusted address |
| `label` | `TEXT NOT NULL DEFAULT ''` | Why — "scanning /wp-admin all week" |
| `added_by_user_id` | `INTEGER` | → `sys_users.id`, no FK. `NULL` when added by CLI |
| `created_at` | `TEXT NOT NULL` | |

## The problem it solves

The heuristics in `src/lib/site-visits/suspicion.ts` are deliberately conservative. A
bare `curl` with no history scores `watch`, not `suspicious`, because the reader might
have run it themselves — the asymmetry that file's doc comment describes at length.

That is the right default for a scorer with no context, and the wrong answer once the
reader has *looked* at an address and formed a judgement the scorer cannot reach: a
netblock they recognise, a hosting range nothing legitimate ever reaches them from, an
address whose pattern of arrivals reads as hostile to a person and as unremarkable to a
rule set. Without somewhere to put that judgement, the same address is re-triaged by
hand every time it comes back.

The allowlist already solved the symmetric problem — *this one is me, stop shouting* —
and left this half unbuilt.

## It marks, it does not block

**Nothing in this migration refuses a request.** A blacklisted address is served
exactly as before. The only things that change are the verdict stored on its visits,
the colour of its row on Admin → Security → Visit, and the reason printed beside it.

This was a deliberate choice over an actual blocking gate, for two reasons:

- **Blocking on a forgeable header stops nothing determined.** The address comes from
  `x-forwarded-for` behind the NAS reverse proxy, where a direct caller sets the header
  to whatever it likes. An attacker changes a header or arrives from a different hop and
  is through. The only traffic reliably stopped by a spoofable-header blacklist is
  traffic that was not attacking you.
- **Blocking can lock the reader out.** The household's own traffic arrives through the
  same proxy. One wrong entry shuts the front door from the inside, with the admin
  screen that would undo it on the far side of the lock.

If a blocking gate is ever wanted it belongs in the reverse proxy on the NAS, where the
connection is real and the operator has a way back in. The table is shaped so that
could be built on top of it later without a migration — but it is not built here, and
`src/lib` has no code path from this table to an access decision.

## This is not an authorisation input

The same rule 0103 states for the allowlist, and it binds harder here. A blacklist is
exactly the shape of thing a future reader will be tempted to wire into the request
path, which is why the `.sql` file says so at length and why this section repeats it.

Its only consumer is the suspicion scorer, whose entire output is a colour on an admin
screen.

## An address is never on both lists

"Always trust" and "always suspect" are a contradiction, and encoding a precedence
would mean the screen shows an address on two cards while the scorer silently honours
one of them.

Instead the invariant is maintained by the two use-cases: `blockIpAddress` deletes any
`sys_ip_allowlist` row for the address in the same call, and `allowIpAddress` deletes
any `sys_ip_blacklist` row for it. Moving an address from one list to the other is one
action, not two, and the Visit tab can only ever show it in one place.

This cannot be expressed as a database constraint because it spans two tables, so it
is tested in `site-visits.test.ts` in both directions rather than left to a comment.

## Re-scoring on change

Mirrors 0103 exactly, which is the half that is easy to forget and obvious when
missing.

- **Blocking** re-scores that address's existing `sys_site_visits` rows to `suspicious`
  with the single signal `blacklisted`, and leaves `reviewed_at` alone. Deliberately
  *not* marked reviewed: blocking an address says "keep showing me this", the opposite
  of what vouching says, so the unreviewed count must not drop when a block is added.
- **Unblocking** re-scores its rows to `watch` with the signal `blacklist_removed`, the
  same shape `disallowIpAddress` uses. Not `normal`: the reader distrusted this address
  once, and silently greening its history on removal would erase the reason they were
  looking at it. Not a fresh heuristic score either — the stored row carries no history
  to re-run the scorer against, the accepted limit 0103 already documents.

## Two new suspicion signals

`blacklisted` and `blacklist_removed` join the `SuspicionSignal` union, and neither is
produced by `scoreSuspicion`'s heuristics — they are written by the two use-cases above,
the same way `allowlist_removed` is (0106).

`levelFromSignals` treats `blacklist_removed` as non-corroborating, exactly as it
already treats `allowlist_removed` and for the identical reason: it records an admin
decision, not an observation about the request, so it must not pair with one weak
signal to manufacture a `suspicious`.

`blacklisted` does not go through that path at all — `scoreSuspicion` short-circuits on
a blacklisted address before any signal is gathered, mirroring the allowlist
short-circuit above it.

## Reversal

`DROP TABLE sys_ip_blacklist;` — nothing references it by foreign key. Existing
`sys_site_visits` rows keep whatever verdict they were last scored with, and any
`blacklisted` / `blacklist_removed` signal still stored on them decodes to nothing once
the keys leave `KNOWN_SIGNALS`, which `decodeSignals` already handles by design (0106).
