-- The Floating Calculator's tape: one row per completed calculation, per person.
--
-- WHY `sys_` AND NOT A NEW PREFIX. `coding-guide.md` prescribes `sys_` for a
-- "Platform / cross-cutting" table, and a floating component is platform furniture --
-- it is available on every page and belongs to no feature module, exactly like
-- `sys_user_preferences` and `ico_slot_overrides`. A `clc_` namespace was considered and
-- rejected: history is the calculator's entire domain, so the prefix would be a
-- namespace with nothing else to ever put in it. That is the mistake the guide calls out
-- by name when it explains why the Picture Gallery's prefix is `pho_` (the module's
-- domain) rather than `alb_` (the first table that needed one).
--
-- WHY PER-USER, WHEN `gam_scores` IS SHARED. A high-score board is meant to be seen by
-- the household -- that is what makes it a board. A calculator tape is private
-- working-out: what someone was adding up is nobody else's business, and two people
-- using the app at once must not see each other's sums interleaved. So `user_id` is part
-- of every query's identity and the repository exposes no method that reads across
-- users.
--
-- WHY IT IS A TABLE AND NOT A USER PREFERENCE. The calculator's *settings* (angle mode)
-- and its last result do live in `sys_user_preferences` as key/value rows -- they are
-- single scalars, read whole. History is a growing list that has to be ordered, capped
-- and cleared, which is a table's job; storing 50 calculations as a JSON blob in one
-- preference row would mean rewriting the whole list on every `=`.
--
-- No DB-level foreign key on `user_id`, per project convention -- the repository
-- maintains the link. Deleting an account leaves rows behind, which
-- `deleteForUser`-style cleanup handles the same way the other per-user tables do.
CREATE TABLE sys_calculator_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,                        -- -> sys_users.id

  -- The expression as the reader typed it, e.g. "3 + sin(45)". Stored verbatim rather
  -- than normalised: the tape's job is to show what was asked, and a reader looking for
  -- a calculation they made recognises their own typing, not a canonicalised form.
  expression TEXT    NOT NULL,

  -- The result as a FORMATTED STRING, not a REAL.
  --
  -- This is the load-bearing decision in the table and it is deliberate. The tape is a
  -- record of what the reader *saw*. Storing 0.30000000000000004 and re-formatting it on
  -- every read would mean a later change to the display precision silently rewrote
  -- history, and an entry that showed "0.3" at the time would start showing something
  -- else. Storing the string freezes it. Nothing arithmetic is ever done with this
  -- column -- it is display data, and treating it as such is what keeps it honest.
  result     TEXT    NOT NULL,

  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The only read this table serves: "my calculations, newest first."
--
-- Ordered by `id DESC` rather than `created_at DESC`, and that is not interchangeable
-- here. `datetime('now')` has one-second resolution, so several calculations in the same
-- second carry an identical timestamp and would come back in an arbitrary order -- and
-- the 50-row prune, which runs on every insert, could then drop the wrong row. The id is
-- monotonic and unambiguous, so both the listing and the prune use it.
CREATE INDEX idx_sys_calculator_history_recent
  ON sys_calculator_history (user_id, id DESC);
