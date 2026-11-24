-- Games module: the outcome of every finished chess game, per player and level.
--
-- gam_scores already records a *score*, but a chess loss and a draw both score 0, and
-- so does a win played with enough hints — so the scoreboard cannot tell them apart and
-- "my record against Advanced" is unanswerable from it. This table records the result
-- itself, which is a different fact from what the result was worth.

CREATE TABLE gam_chess_results (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  -- No REFERENCES clause, per project convention (see migration 0074's log).
  user_id    INTEGER NOT NULL,               -- -> sys_users.id
  -- Which computer the game was against: beginner, intermediate or advanced. Validated
  -- by the zod schema against CHESS_LEVELS, the way gam_scores.game_key is.
  level      TEXT    NOT NULL,
  -- win, loss or draw, from the player's point of view. A resignation is a loss and a
  -- flag is whatever the clock made it.
  result     TEXT    NOT NULL,
  -- Carried so a record can be read without joining gam_scores, and so the two can be
  -- compared if they ever disagree.
  moves      INTEGER NOT NULL DEFAULT 0,
  score      INTEGER NOT NULL DEFAULT 0,
  played_at  TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The only question asked of this table: one player's record, grouped by level.
CREATE INDEX idx_gam_chess_results_user_level ON gam_chess_results (user_id, level);
