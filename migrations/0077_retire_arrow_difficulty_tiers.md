# 0077 — Retire the Arrow Clearing difficulty tiers

**Date:** 2026-08-30
**Type:** data only (one `DELETE`) — no schema change

## What this does

Deletes `gam_scores` rows for `arrow-clearing-easy` and `arrow-clearing-medium`, the two
board sizes withdrawn from `GAME_CATALOGUE` in the same change.

No table, column, index or trigger is touched. Nothing needs to be added to
`DEFAULT_MODULES` — the Games module registration from `0075` is unchanged, since a game
is a catalogue entry in code rather than a row.

## Why the tiers went

Arrow Clearing shipped with three boards (5x5 Easy, 7x7 Medium, 9x9 Hard). Even the 9x9
was barely a puzzle, so easier boards beneath it had no purpose, and three cards on the
Arcade implied a difficulty ladder the game did not really have.

The difficulty problem was **not** the board size, which is why removing tiers alone
would not have fixed anything. Measured over 40 generated 9x9 boards, roughly **12 of 22
arrows were already clearable on the first move** — and 421 of the 448 such arrows had
their head sitting on the board edge, where `pathAhead` is empty and nothing can ever
block them. A third of every board could be cleared in any order, so there was almost
nothing to deduce.

Both real causes were in the generator, and both were fixed alongside this migration:

- Arrows were short straight sticks of up to 4 cells. They are now **winding paths** of
  up to 8, which is what makes a board read as the maze it is meant to be.
- Placements were taken in shuffled order, which favours heads with clear exits — i.e.
  exactly the arrows that block nothing. `findPlacement` now scores candidates on the
  depth of the head plus the length of the run, which pushes heads inward.

After both changes a board comes out ~92% full with ~5 arrows free at the start rather
than ~12, and the generator's solvability guarantee is untouched — it never depended on
*which* legal placement was chosen.

## Why this one deletes scores

This goes against the rule stated in `src/lib/games/catalogue.ts`, so it is worth being
explicit. `gam_scores.game_key` is deliberately **not** a foreign key so that a retired
game's scores survive: deleting somebody's high score because a game was withdrawn is a
worse outcome than a scoreboard row naming a game that is no longer listed. Left alone,
these rows would simply stop being displayed.

They are deleted because they are scores against a *materially easier, different game*
that shared a name, posted during the few hours the tiers existed. Keeping them would
place trivially-won rows on a shared board beside real ones with nothing to distinguish
them.

**This does not generalise.** A game withdrawn after a real span of play should keep its
scores, and the next retirement should default to leaving them.

## Reversibility

Not reversible — the rows are gone once it runs. Back the database up before applying, as
the release checklist requires anyway. The tiers themselves could be restored by adding
the two catalogue entries back (`ARROW_DIFFICULTIES` is kept as a one-element list rather
than deleted for exactly that reason), but their old scores would not come back.

## Verification

```sql
-- Should return no rows after the migration.
SELECT game_key, COUNT(*) FROM gam_scores
WHERE game_key IN ('arrow-clearing-easy', 'arrow-clearing-medium')
GROUP BY game_key;

-- Should be untouched.
SELECT COUNT(*) FROM gam_scores WHERE game_key = 'arrow-clearing-hard';
```
