# Migration 0173: named chess saves

**Date:** 2026-11-22
**Type:** one new table (`gam_chess_saves`)

## What this does

Lets a player keep a chess game under a name and load it back later, on any device.
Chess also autosaves after every move, and that half needs no migration — it reuses
`gam_saved_runs` (0171) under the game key `chess`.

## The table

| Column | Meaning |
|---|---|
| `user_id` | Whose game. Saves are private: a player only ever reads their own. |
| `name` | What the player called it. Shown in the Load dialog; also the key a repeated Save replaces on. |
| `format_version` | The version of the JSON in `state_json`. |
| `state_json` | The game: starting FEN, the player's colour, the level, and the moves in coordinate form (`ChessSave` in `src/lib/games/types.ts`). About 2 KB for a long game. |
| `saved_at` | When it was last written. |
| `created_at` | When the game was first kept — left alone by an update, so it still says when this game began. |

`UNIQUE (user_id, name COLLATE NOCASE)`: one save per player per name. Saving is an
`INSERT ... ON CONFLICT DO UPDATE`.

## Why two stores and not one

They answer different questions, and collapsing them would have made one of the two
worse:

- **The autosave** is "put me back where I was" — one per player, replaced constantly,
  disposable. `gam_saved_runs` exists for exactly that and already has the upsert, the
  per-player scoping and the Resume prompt precedent from Arrow Clearing.
- **A named save** is "keep this game" — many per player, written deliberately, and
  **not** disposable.

Putting named saves in `gam_saved_runs` would have meant breaking its
`UNIQUE (user_id, game_key)` invariant, which is the thing that makes an autosave a
single upsert. Putting the autosave in this table would have meant a reserved name, or
a nullable column in a unique index — and in SQLite two NULLs are distinct, so the
"one autosave" rule would not have been enforced by anything.

The cost is one shared format across two stores, which is paid once:
`buildChessSave` / `restoreChessGame` are the only code that reads or writes either.

## Why the moves, not a board snapshot

Loading replays the moves through the game's own rules. That rebuilds the move list,
the repetition keys and the status without storing any of them, and it **rejects a save
whose moves are not all legal** — so a damaged or hand-edited row cannot put an
impossible position on screen. The same argument 0171 records for Arrow Clearing, and
it costs less here: a long game is a couple of hundred moves.

Storing a FEN of the current position alone was rejected for a second reason: it would
lose the move list, so undo, the move history panel, threefold repetition and PGN
export would all stop working on a loaded game.

## A damaged named save is kept, not deleted

`loadArrowRun` deletes a stored run it cannot restore, because an unresumable autosave
would otherwise show the player the same failure forever. **Named saves do the
opposite**: an unreadable row is listed as unreadable and reported on load, never
removed. A game somebody named and kept is not disposable, and deleting it because this
build could not read it would destroy it with no way back. The chess *autosave* follows
the Arrows rule, since it is the same kind of thing.

## Not covered

- **A per-player cap of 20**, enforced in the use-case (`MAX_CHESS_SAVES_PER_PLAYER`),
  not by the schema. Saving over an existing name is always allowed, so the cap can
  never block finishing a game already in progress.
- **Two devices playing the same game**: the last save wins, as in 0171.
- **Sharing a saved game between players.** Saves are private; PGN export is how a game
  leaves this machine.
- No `DEFAULT_MODULES` change: Games is already registered (0075).
