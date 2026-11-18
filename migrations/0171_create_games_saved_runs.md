# Migration 0171: saved runs for the Games module

**Date:** 2026-11-17
**Type:** one new table (`gam_saved_runs`)

## What this does

Lets a player leave an Arrow Clearing board and come back to it later, on any device.
The run is saved a couple of seconds after each move. The next time that tier is
opened, the game asks **Resume** or **New board**. The save is deleted when the run is
won or lost, or when the player chooses a new board.

## The table

| Column | Meaning |
|---|---|
| `user_id` | Whose run. Runs are private: a player only ever loads their own. |
| `game_key` | Which game, and for Arrows which tier: each tier has its own key, so each keeps its own save. |
| `format_version` | The version of the JSON in `state_json`. |
| `state_json` | The game's own save. For Arrows this is the board as dealt plus a log of moves (`ArrowRunSave` in `src/lib/games/types.ts`), about 25 KB at most. |
| `saved_at` | When it was last written, shown in the resume prompt. |

`UNIQUE (user_id, game_key)`: one save per player per game. Saving is an
`INSERT ... ON CONFLICT DO UPDATE`.

## Why a table and not `localStorage` or `sys_user_preferences`

- **`localStorage`** keeps the run in one browser, so a board started on the phone
  couldn't be finished on the desktop. That was the main thing wanted.
- **`sys_user_preferences`** holds small values, and the home page reads all of one
  user's rows on every visit. A 25 KB save there would load on every home screen.

## Why the board plus a move log, not a snapshot

Restoring replays the moves with the game's own rules. That rebuilds the full undo
history, and it rejects a save if any clear wasn't legal at that point, so a damaged or
edited row can't put an impossible board on screen. Saving only a random seed and the
moves was rejected: the board generator gets re-tuned, and any change would make every
saved seed produce a different board.

The same check runs when the server receives a save, so only runs that can be resumed
get written.

## Not covered

- Two devices playing the same run: the last save wins. Agreed as acceptable.
- Other games. The table takes any game key, but only Arrows has save/restore code.
- No `DEFAULT_MODULES` change: Games is already registered (0075).
