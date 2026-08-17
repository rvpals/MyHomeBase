# Migration 0045: create the authentication audit trail

**Date:** 2026-08-16
**Type:** new table + one added column
**Table(s) affected:** `sys_auth_events` (new), `sys_users` (adds `last_login_at`)

## What this does

Records every login attempt — succeeded or failed — and every logout, so a failed
sign-in leaves evidence. Before this migration the application recorded **nothing**:
`verifyCredentials` returned `undefined` and the visitor got a red line of text, with
no console line, no row, no counter, no IP. The only trace of a *successful* login was
`sys_sessions.created_at`, and that row is deleted on logout.

Also denormalises the last successful sign-in onto `sys_users.last_login_at`, so the
user-management screen can answer "when did this person last get in" without touching
the event table.

### `sys_auth_events`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `event_type` | TEXT NOT NULL | `login_success` \| `login_failure` \| `logout`, CHECK-constrained. |
| `attempted_username` | TEXT NOT NULL DEFAULT `''` | What was **typed**, not a resolved account. Blank = nothing typed. |
| `user_id` | INTEGER, nullable | Set on success, and on failures where the account was found but rejected. NULL when the username matched nothing. |
| `failure_reason` | TEXT NOT NULL DEFAULT `''` | `unknown_user` \| `bad_password` \| `account_disabled` \| `invalid_input`; blank on success and logout. CHECK-constrained (blank included in the allowed set). |
| `ip_address` | TEXT NOT NULL DEFAULT `''` | First `x-forwarded-for` hop. **Advisory only.** |
| `user_agent` | TEXT NOT NULL DEFAULT `''` | Truncated on write. |
| `reviewed_at` | TEXT, nullable | NULL until an admin acknowledges it. Drives the home-screen alert. |
| `created_at` | TEXT NOT NULL DEFAULT `(datetime('now'))` | |

Indexes: `auth_events_created_at_idx` (DESC — the screen reads newest-first and the
prune deletes by age), `auth_events_unreviewed_idx` (**partial**, `WHERE reviewed_at
IS NULL`, so the per-render alert query indexes only the few unreviewed rows), and
`auth_events_user_id_idx`.

## Why the log records the failure reason when the UI refuses to

`src/lib/auth/auth.ts` documents that `login` deliberately does not distinguish
"unknown username" from "wrong password", to avoid leaking which usernames exist.
That is right for the **response to the browser** and is unchanged by this work — the
visitor still gets one generic `Invalid username or password.` for every failure,
including a validation failure.

It is useless for an audit trail, though. "Someone failed" with no username and no
reason tells an operator nothing; distinguishing a typo from a systematic guess
against a known account is the entire job. So the reason travels *inward* to the
recorder while the generic message travels *outward* to the browser. This is the
conventional split, and it is why `verifyCredentials` gained a result-returning
sibling (`verifyCredentialsDetailed`) rather than having its blind signature changed —
existing callers keep the safe shape.

## Rejected alternatives

**A page-view / visitor-traffic table.** Considered and dropped for now. The only
per-navigation hook is `src/proxy.ts`, so it is *possible*, but page views are high
volume and low value for a self-hosted family app, and they are what would bloat the
SQLite file. Auth events answer the question actually being asked. A traffic table
would be an independent migration and does not disturb this one.

**Hashing `attempted_username`.** Rejected. People do type their password into the
username field, so a failure row can contain a real secret — but hashing the column
makes the log unreadable for its one purpose (spotting which account is being
guessed). Mitigation instead: truncate to 200 characters on write, and expose it only
on the admin-gated security screen. Documented rather than hidden.

**Reusing the `STARTUP_MESSAGE` setting for the warning.** Rejected. It is a single
app-wide row: the first person to click OK clears it for everyone, non-admins would
see a warning they cannot act on, its modal is titled "Deployment notice", and a
deployment message and a security warning would overwrite each other. The alert
queries `reviewed_at IS NULL` instead, so it is per-fact rather than per-message.

**A failure counter on `sys_users`.** Rejected. A counter cannot answer "from where,
when, how fast", and attempts against a *non-existent* username have no user row to
count on.

**Rate limiting / account lockout.** Explicitly out of scope, not merely deferred.
Once the events exist, lockout is a query plus a check in `login()`, but it carries
its own failure mode — locking the owner out of their own house — and is better
designed against real data.

## Obligations SQL cannot enforce

- **No cascade on user delete, deliberately.** Unlike `sys_user_preferences` (0044),
  `SqliteUserRepository.deleteUser` must **not** delete these rows. Destroying the
  audit trail when the account it concerns is removed defeats the purpose; the row
  keeps `attempted_username` and its `user_id` becomes an orphan pointing at a
  departed id. That is the correct outcome, and the reason there is no FK here is the
  same project-wide convention, not an oversight.
- **Retention is enforced in code, not by the schema.** Rows older than 90 days are
  deleted by the `[auth-events prune]` heartbeat in `src/instrumentation.ts`, using
  the same pattern as the expense CSV auto-import. Successes prune on the same
  schedule; `sys_users.last_login_at` already answers the long-term question.
- **`ip_address` is not identity.** Behind the NAS reverse proxy it is whatever
  `x-forwarded-for` claims.
- **`last_login_at` is denormalised.** It is written in the same use-case that records
  a `login_success` event; the two must not drift.

## Seed data

None. An empty table is the correct starting state, and there is no
`DEFAULT_MODULES`/`DEFAULT_APP_SETTINGS` entry to mirror — the security screen lives
in the admin area, which is gated by `isAdmin` and registered as a `TreeNode` in
`src/app/(protected)/admin/nav.ts` rather than as a module.

## Rollback

```sql
DROP INDEX IF EXISTS auth_events_user_id_idx;
DROP INDEX IF EXISTS auth_events_unreviewed_idx;
DROP INDEX IF EXISTS auth_events_created_at_idx;
DROP TABLE IF EXISTS sys_auth_events;
```

`sys_users.last_login_at` is left in place: SQLite's `DROP COLUMN` cannot remove a
column that an index or trigger references, and dropping it is a full
create-copy-drop-rename rebuild for a nullable column that costs nothing to keep. If
it truly must go, rebuild the table and recreate `users_set_updated_at` (0007) plus
the `google_email` partial unique index (0010) afterwards.
