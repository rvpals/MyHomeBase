-- Games module: the custom Pictionary word bank.
--
-- The FIRST table in this module that holds content rather than a result. The game
-- catalogue stays in code (src/lib/games/catalogue.ts) and so does the built-in word
-- list (src/lib/games/pictionary-words.ts) -- see the .md log for why those two are
-- different from this one.

CREATE TABLE gam_pictionary_words (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  word       TEXT    NOT NULL,
  -- 'easy' | 'medium' | 'hard'. Not a lookup table: the three tiers are a closed set
  -- fixed by the scoring constants in `types.ts`, so a fourth could not be scored.
  -- Validated by the module's zod schema on the way in, as every other enum here is.
  tier       TEXT    NOT NULL,
  -- No REFERENCES clause, per project convention (see migration 0074's log): deleting
  -- a user who imported words would otherwise fail outright rather than leaving rows
  -- whose importer is simply unknown.
  created_by INTEGER NOT NULL,               -- -> sys_users.id
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- A word is unique per tier, case-insensitively: importing the same list twice should
-- be a no-op rather than doubling every prompt's odds of coming up. The same word MAY
-- appear in two different tiers -- one household's "easy" is another's "hard", and the
-- picker only ever reads one tier at a time.
CREATE UNIQUE INDEX idx_gam_pictionary_words_unique
  ON gam_pictionary_words (tier, word COLLATE NOCASE);

-- The only read the game makes: every word in one tier.
CREATE INDEX idx_gam_pictionary_words_tier ON gam_pictionary_words (tier);
