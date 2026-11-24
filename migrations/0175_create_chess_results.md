# Migration 0175: chess results per level

**Date:** 2026-11-24
**Type:** one new table (`gam_chess_results`)

## What this does

Records whether each finished chess game was a win, a loss or a draw, and which level
it was against — so the game can show "12–3–1 against Intermediate" before you pick a
level, and so a record survives the scoreboard.

## Why `gam_scores` could not answer this

It records a **score**, not a result, and for chess those are different facts:

- A loss scores 0 and a draw scores 0, so the two are indistinguishable.
- A win can also score 0, once enough hints and takebacks have been charged against it
  (`CHESS_ASSIST_PENALTY_FRACTION`). So a 0 might be any of the three.
- The level is not stored at all. Chess posts every level under the one `chess` key —
  deliberately, because three keys would mean three Arcade cards and three separate
  scoreboards, which is the shape Arrow Clearing had to withdraw in migration 0077.

Adding a `level` column to `gam_scores` was considered and rejected: that table is
shared by fourteen games and the column would be null for thirteen of them.

## The table

| Column | Meaning |
|---|---|
| `user_id` | Whose game. A record is personal; the scoreboard is the shared thing. |
| `level` | `beginner`, `intermediate` or `advanced`, validated against `CHESS_LEVELS`. |
| `result` | `win`, `loss` or `draw`, from the player's point of view. |
| `moves` | Full moves played, as `gam_scores.moves` records. |
| `score` | What it was worth, so a record and the scoreboard can be compared. |
| `played_at` | When it finished. |

No unique index: a player can legitimately play the same level to the same result any
number of times, and every one of them is a row.

## Not covered

- **Nothing is backfilled.** Games played before this ran left no record of their
  result, so a record starts empty and counts from here. The screen says so rather
  than implying a fresh player has never won.
- **Other games.** The table is chess-specific by name and by its `level` column.
- No `DEFAULT_MODULES` change: Games is already registered (0075).
