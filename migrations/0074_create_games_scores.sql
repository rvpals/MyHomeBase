-- Games module: the shared high-score board.
--
-- One table for the whole module. The catalogue of games is code
-- (src/lib/games/catalogue.ts), not data -- see the .md log for why.

CREATE TABLE gam_scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  game_key   TEXT    NOT NULL,
  -- No REFERENCES clause, per project convention (see the .md log): better-sqlite3
  -- enforces foreign keys, so one here would make deleting a user who has played
  -- fail outright rather than leaving a row the scoreboard renders as "Unknown
  -- player". Every other table records a user the same way.
  user_id    INTEGER NOT NULL,               -- -> sys_users.id
  score      INTEGER NOT NULL,
  moves      INTEGER NOT NULL DEFAULT 0,
  played_at  TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The scoreboard's only query shape: best-first within one game.
CREATE INDEX idx_gam_scores_game_score ON gam_scores (game_key, score DESC);

-- "Latest games" across every game, and a cheap per-user history later.
CREATE INDEX idx_gam_scores_played_at ON gam_scores (played_at DESC);
CREATE INDEX idx_gam_scores_user ON gam_scores (user_id);
