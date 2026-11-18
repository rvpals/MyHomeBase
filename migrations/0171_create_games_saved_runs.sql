-- Games module: runs in progress that a player can leave and resume.
--
-- One row per player per game. Saving again replaces the row. Arrow Clearing is the
-- first game to use it, and its three tiers have separate game keys, so a player can
-- keep one Hard, one Harder and one Nightmare run going at once.

CREATE TABLE gam_saved_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  -- No REFERENCES clause, per project convention (see migration 0074's log).
  user_id        INTEGER NOT NULL,               -- -> sys_users.id
  -- Validated against the code catalogue by the zod schema, like gam_scores.game_key.
  game_key       TEXT    NOT NULL,
  -- The save format inside state_json. A row whose version the code no longer reads is
  -- deleted the next time it is loaded, never migrated.
  format_version INTEGER NOT NULL,
  -- The game's own save as JSON. Only that game's code reads inside it
  -- (src/lib/games/arrow-save.ts for Arrows).
  state_json     TEXT    NOT NULL,
  saved_at       TEXT    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One save per player per game, which makes a save a single upsert. It also serves the
-- only lookup the game makes: one player's save for one game key.
CREATE UNIQUE INDEX idx_gam_saved_runs_user_game ON gam_saved_runs (user_id, game_key);
