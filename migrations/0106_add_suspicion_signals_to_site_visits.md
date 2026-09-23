# Migration 0106: why a visit looked suspicious

**Date:** 2026-09-23
**Type:** one added column

## What this does

Adds `sys_site_visits.signals` — the reasons behind the verdict that 0102 already
stores in `suspicion`.

| Column | Type | Notes |
|---|---|---|
| `signals` | `TEXT NOT NULL DEFAULT ''` | Comma-separated signal keys, `''` when none |

## The problem it solves

`scoreSuspicion` has always returned **two** things:

```ts
{ level: "suspicious", signals: ["scanner_user_agent", "auth_failures"] }
```

Only `level` was persisted. `recordSiteVisit` destructured `{ level }` and let the
reasons fall on the floor, and `describeSignal` — a function written specifically to
render them as English — had no call sites anywhere in the app.

So Administration → Security → Visits showed a red **Suspicious** pill and nothing
else. "Identified itself as a scanner" and "Also has failed sign-in attempts" are
different enough events that the reader's next action differs, and the screen gave
them no way to tell which had happened without re-deriving it by eye from the
user-agent column.

This migration is not new detection. It stores an answer that was already being
computed and thrown away.

## Keys, not sentences

The column holds signal **keys** (`scanner_user_agent`), never the rendered wording
(`Identified itself as a scanner`).

The wording lives in `describeSignal` and is presentation. Storing sentences would
mean that improving a phrase either leaves old rows reading the old way or requires a
data migration to rewrite history — and a row from last month should pick up today's
wording on its next render, because the wording is about how clearly the reason is
explained, not about what happened.

## Comma-separated, not JSON

`'scanner_user_agent,auth_failures'`, split on `,`.

The value set is a closed seven-member enum; no member contains a comma, a quote or a
space; nothing queries *into* the list (there is no "find every visit with signal X"
screen, and if one is ever wanted it is a `LIKE` on a table bounded to ninety days);
and the Visit tab's CSV export shows the raw column, where a JSON array would render
as escaped noise. JSON would add parsing ceremony and buy nothing.

The split is defensive on the way out: unknown keys are dropped rather than thrown on,
so a row written by a future version with an extra signal still renders on an older
build instead of failing the whole page's read validation.

## No backfill

Existing rows get `''` and render as "—" in the Why column.

Deliberate. The signals cannot be re-derived from a stored row: three of the six
original signals (`burst`, `never_signs_in`, `auth_failures`) are facts about the
address's history *at the moment of the visit*, and that history has since moved on.
Re-scoring an old row would produce a confident-looking reason that was not the reason
the verdict was actually assigned. A blank that says "we didn't record this" is
honest; a fabricated reason is worse than no reason.

The same limit is already acknowledged in `disallowIpAddress`, which re-scores a
removed address's rows to `watch` precisely because it cannot re-run the full scorer.

## The seventh signal: `allowlist_removed`

Removing an address from the allowlist (0103) re-scores its past visits to `watch`,
and could not explain why — leaving an amber badge with a blank reason, which reads
like a bug.

`allowlist_removed` is written to those rows, rendering as *"Was trusted until an
admin removed the address from the allowlist"*. It is a marker, not a heuristic:
`scoreSuspicion` never produces it, and it records an **admin action**, which is the
one kind of reason that survives being re-derived after the fact.

It is excluded from `levelFromSignals`' damning set on purpose. A removed allowlist
entry means "look at this again", not "this is an attack" — the address's own
behaviour has to earn `suspicious` on its own terms.

## Allowlisting clears it

Adding an address to the allowlist re-scores its rows to `normal` **and blanks
`signals`**, in the same statement.

Without that, a vouched-for address would show a grey "Normal" verdict beside a list
of reasons it was once suspicious — which invites exactly the second-guessing that
vouching exists to end. The allowlist short-circuit in `scoreSuspicion` already
returns `{ level: "normal", signals: [] }` for a live visit; this keeps stored rows
consistent with that.

Evidence is untouched, as 0103 insists: the row, its address, its user agent and its
timestamp all remain. Only the alarm and its explanation are cleared.

## Rollback

```sql
ALTER TABLE sys_site_visits DROP COLUMN signals;
```

Safe. `suspicion` is independent and keeps working; the Why column loses its data and
every row reads "—". Nothing branches on `signals` — it is display-only, and no
authorisation, retention or alert path reads it.
