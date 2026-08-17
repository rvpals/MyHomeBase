-- Authentication audit trail: one row per login attempt (success or failure) and
-- per logout. Until now the application recorded nothing about who tried to sign
-- in — sys_sessions.created_at was the only trace of a successful login, and it is
-- deleted on logout, so a failed attempt left no evidence at all.
--
-- Deliberately NOT a page-view/traffic log. Auth events are low volume and high
-- value; page views are the opposite, and would bloat the file for a question this
-- install does not need answered.
--
-- sys_ prefix per coding-guide.md: this is a platform concern, not a feature
-- module, so it gets no new three-letter prefix of its own.
--
-- attempted_username stores what was TYPED, not a resolved account: a failure may
-- name an account that does not exist, which is exactly the interesting case. It is
-- TEXT NOT NULL with the empty string as the "nothing was typed" sentinel, matching
-- STARTUP_MESSAGE (0041) and sys_user_preferences (0044) — blank rather than NULL so
-- no caller has to test for both, and so relaxing NOT NULL later never needs a
-- create-copy-drop-rename rebuild. Known and accepted: people sometimes type their
-- password into the username field, so a failure row can contain a real secret. The
-- write truncates to 200 characters and no read exposes it outside the admin screen;
-- hashing it instead would make the log unreadable for the one job it has.
--
-- user_id is nullable because it is genuinely unknown on most failures — an
-- unrecognised username resolves to no user. It is set on success, and on the
-- failures where the account was found but rejected (wrong password, disabled
-- account), which is what makes "repeated attempts against MY account" answerable.
-- No DB-level foreign key, per project convention: deleting a user must not delete
-- the evidence, so unlike sys_user_preferences there is deliberately no cascade
-- obligation in code either. The row keeps attempted_username and becomes an orphan
-- pointing at a departed id, which is the correct outcome for an audit trail.
--
-- failure_reason records WHY, even though the browser is told only "Invalid username
-- or password." That split is the point: the response must not leak which usernames
-- exist, while the operator reading this table needs to tell a typo from a
-- systematic guess. Blank on success and on logout.
--
-- reviewed_at is NULL until an admin acknowledges the failure on the security
-- screen. That is what drives the home-screen warning: the alert asks "are there
-- unreviewed failures", not "was a message dismissed", so it cannot be lost by one
-- user clicking OK and it reappears the moment a new failure lands.
--
-- ip_address is advisory only. Behind the NAS reverse proxy it comes from
-- x-forwarded-for, which is only as trustworthy as the proxy in front of it; the
-- adapter records the first hop. Do not treat it as identity.
--
-- No UNIQUE index anywhere, and specifically none spanning created_at. Per
-- coding-guide.md a unique index may only span columns that identify a row exactly,
-- and two identical failed attempts in the same second are a real event worth
-- counting twice — deduping them would hide precisely the burst this table exists to
-- show.
CREATE TABLE sys_auth_events (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type         TEXT    NOT NULL CHECK (event_type IN ('login_success', 'login_failure', 'logout')),
  attempted_username TEXT    NOT NULL DEFAULT '', -- what was typed; blank when nothing was
  user_id            INTEGER,                     -- -> sys_users.id; NULL when unresolved
  failure_reason     TEXT    NOT NULL DEFAULT '' CHECK (
                       failure_reason IN ('', 'unknown_user', 'bad_password', 'account_disabled', 'invalid_input')
                     ),
  ip_address         TEXT    NOT NULL DEFAULT '', -- advisory: first x-forwarded-for hop
  user_agent         TEXT    NOT NULL DEFAULT '',
  reviewed_at        TEXT,                        -- NULL = not yet acknowledged by an admin
  created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The security screen reads newest-first, and the 90-day prune deletes by age.
CREATE INDEX auth_events_created_at_idx ON sys_auth_events (created_at DESC);

-- Serves the home-screen alert, which runs on every admin's home-screen render and
-- must stay cheap as the table grows. Partial, so it indexes only the handful of
-- rows that are actually unreviewed.
CREATE INDEX auth_events_unreviewed_idx ON sys_auth_events (reviewed_at) WHERE reviewed_at IS NULL;

-- Answers "recent failures for this account" without scanning, for the per-user
-- counts on the security screen.
CREATE INDEX auth_events_user_id_idx ON sys_auth_events (user_id);

-- Last successful sign-in, denormalised onto the user for the user-management
-- screen. Nullable on purpose: "has never signed in" is a real, distinct state, so
-- the blank-sentinel rule that applies to settings text does not apply here — a
-- blank timestamp would be a lie, NULL is the truth. Existing rows get NULL and
-- fill in as people sign in.
ALTER TABLE sys_users ADD COLUMN last_login_at TEXT;
