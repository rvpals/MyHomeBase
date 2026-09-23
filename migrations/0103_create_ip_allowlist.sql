-- Addresses the reader has vouched for. An allowlisted IP always scores 'normal' in
-- sys_site_visits, no matter what the heuristics would otherwise say about its user
-- agent or its request rate.
--
-- The problem it solves: a phone on mobile data whose session cookie has expired
-- arrives logged-out, repeatedly, from an address that changes shape over time. Every
-- one of those is a root hit with no sign-in following it, which is precisely the
-- pattern the scoring calls suspicious. Without a way to say "this one is me", the
-- alert cries wolf daily and stops being read.
--
-- An allowlist suppresses ALARM, never EVIDENCE. Visits from an allowlisted address
-- are still recorded in full — same row, same columns, same 90-day retention. Only
-- the verdict changes. Anything else would mean adding an address blinds the log to
-- it, which is backwards for an audit trail: the one thing a compromised "known good"
-- address must not do is become invisible.
--
-- sys_ prefix per coding-guide.md: platform, not a feature module.
--
-- This table is NOT an authorisation input, and nothing in src/lib may treat it as
-- one. The addresses come from x-forwarded-for behind the NAS reverse proxy, where a
-- direct caller can set the header to any value — so an allowlisted address is
-- trivially spoofable and must never grant access, skip a password, or shorten a
-- check. Its only consumer is the suspicion scorer, whose output is a colour on an
-- admin screen. Wiring this into the session path would convert a display heuristic
-- into an auth bypass.
--
-- ip_address is UNIQUE, and unlike sys_auth_events (0045, which deliberately has no
-- unique index anywhere) that passes the coding-guide rule cleanly: the column
-- identifies the row exactly. One address is either vouched for or it is not, there
-- is no second row to add, and the uniqueness is what makes "add if missing" safe to
-- call repeatedly from the bulk action.
--
-- label is the reason, in the reader's own words — "my phone on 5G", "the office".
-- Blank-string sentinel per the project convention (0041, 0044, 0045) rather than
-- NULL, so no caller tests for both. An unlabelled entry is useful but forgettable,
-- which is its own argument for filling it in; the UI suggests one and never requires
-- it.
--
-- added_by_user_id has no DB-level foreign key, per project convention and for the
-- same reason 0045 gives: deleting a user must not delete the record of a decision
-- they made. The row survives as an orphan pointing at a departed id, and the screen
-- falls back to showing the id. Nullable because the CLI can add an entry with no
-- session behind it.
CREATE TABLE sys_ip_allowlist (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_address       TEXT    NOT NULL UNIQUE,
  label            TEXT    NOT NULL DEFAULT '', -- why it is trusted, in plain words
  added_by_user_id INTEGER,                     -- -> sys_users.id; NULL when added by CLI
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The allowlist is read on EVERY site-visit write, to decide the verdict before the
-- row is inserted. It is expected to hold a handful of rows, so this is belt and
-- braces rather than a hot-path necessity — but the UNIQUE constraint above already
-- creates an index on ip_address, so the lookup is covered either way and no second
-- index is declared here.
