# 0074 — Create `gam_scores`

Adds the Games module's only table: the shared high-score board. New table prefix
`gam_`.

## What changed

`gam_scores` — one row per finished game, plus three indexes.

## Why it is shaped this way

**The catalogue of games is code, not a table.** There is deliberately no
`gam_games`. A game is only playable if the React view that draws it exists in the
build, so a row could name a game this deployment cannot run — and an admin could
"add a game" by inserting a row and get a card that goes nowhere. `GAME_CATALOGUE`
in `src/lib/games/catalogue.ts` is the registry, exactly as `HOME_WIDGET_IDS`
(0067) and the symbol list in `src/lib/market-indexes` are. The rule this follows:
*what the app can do is code; what the user did is data.*

**`game_key` is therefore not a foreign key.** It references a catalogue key. The
consequence is intentional: a score outlives its game being retired from the
catalogue. Deleting someone's high score because a game was withdrawn would be
worse than a scoreboard row whose game is no longer listed, so `formatScore` and the
views both tolerate an unknown key rather than throwing. `recordScoreSchema`
validates against the catalogue on the way *in*, which is where the check belongs —
that is what stops a crafted request writing scores for a game that does not exist.

**The board is shared, not per-user.** `user_id` records *whose* score it is, but no
read filters by the viewer: the board answers "who is best at this". Same call as
`stk_ticker_favorites` (0058), which is also shared.

**`user_id` carries no `REFERENCES` clause, and every read LEFT JOINs `sys_users`.**
This table was first written with `REFERENCES sys_users(id)` and that was a bug,
caught by exercising `deleteUser` against a scratch database. `better-sqlite3`
enables `PRAGMA foreign_keys` on every connection it opens — the app never sets it
either way — so the constraint was live, and deleting a user who had ever finished a
game failed with `SQLITE_CONSTRAINT_FOREIGNKEY`. That would have broken Admin → User
Management for any player, which is a worse outcome than an orphaned row.

It is also against convention: **no other table in this project declares a foreign
key to `sys_users`.** `sys_sessions` (0009), `exp_transactions` (0029),
`sys_user_preferences` (0044), `att_attendance_records` (0047) and
`mus_play_events` (0056) all store a plain `INTEGER` with a `-- -> sys_users.id`
comment, and `SqliteUserRepository.deleteUser` says so out loud: *"No FK to cascade
(project convention)"* — it clears the rows it owns by hand.

So the integrity rule is the LEFT JOIN instead: a missing user renders as "Unknown
player" rather than dropping the row, which is what keeps a deleted account from
silently emptying a shared board.

**`played_at` is not in a unique index** — `coding-guide.md` warns against putting a
date column in one, and here it would be actively wrong: the same player can finish
two games in the same second, and both are real scores.

**A score is immutable.** There is no update path and no `updated_at`: a finished
game is a historical fact. That also means this table will never need the
create-copy-drop-rename rebuild that a primary-key change forces (0035) — nothing
about a completed game can be edited.

`played_at` is written by the use-case, never by the client. A caller-supplied
timestamp would let a crafted request backdate a score and win every tie-break in
the board's `score DESC, played_at ASC` ordering.

## Indexes

- `idx_gam_scores_game_score (game_key, score DESC)` — the scoreboard query.
- `idx_gam_scores_played_at (played_at DESC)` — the "latest games" list.
- `idx_gam_scores_user (user_id)` — a per-user history, not yet a screen, but the
  column is the one a future "my games" view would filter on.
