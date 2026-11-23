-- Games module: named chess games a player keeps and comes back to.
--
-- Many rows per player, unlike gam_saved_runs (0171), which holds one row per player
-- per game key. Chess uses both: that table carries the chess autosave ("put me back
-- where I was"), this one carries the library of named games ("keep this one").
-- Both store the same ChessSave JSON — see src/lib/games/chess-save.ts.

CREATE TABLE gam_chess_saves (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  -- No REFERENCES clause, per project convention (see migration 0074's log).
  user_id        INTEGER NOT NULL,               -- -> sys_users.id
  -- What the player called this game. Shown in the Load dialog, and the key a repeated
  -- Save replaces on.
  name           TEXT    NOT NULL,
  -- The save format inside state_json. A row whose version the code no longer reads is
  -- reported as unreadable, never migrated and never silently deleted.
  format_version INTEGER NOT NULL,
  -- The game as JSON: the starting FEN, the player's colour, the level, and the moves
  -- in coordinate form. The moves rather than a board snapshot, so loading replays them
  -- through the rules and refuses a game that was edited into an impossible position.
  state_json     TEXT    NOT NULL,
  saved_at       TEXT    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One save per player per name, case-insensitively: "Sunday game" and "sunday game" are
-- the same save. That is what makes saving an upsert, so pressing Save twice on a game
-- in progress updates it rather than filling the list with copies.
--
-- This spans columns that identify the row exactly (coding-guide.md: never a DATE in a
-- unique index), and the repository's lookup-by-name uses the same COLLATE NOCASE, so
-- the two cannot disagree about what a duplicate is.
CREATE UNIQUE INDEX idx_gam_chess_saves_user_name
  ON gam_chess_saves (user_id, name COLLATE NOCASE);
