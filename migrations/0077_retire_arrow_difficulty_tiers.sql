-- Retires the Easy (5x5) and Medium (7x7) Arrow Clearing boards.
--
-- The two smaller tiers were withdrawn from GAME_CATALOGUE in the same change: even
-- the 9x9 board was no challenge, so a ladder of easier boards below it was pointless,
-- and three Arcade cards implied a difficulty progression the game did not have. The
-- real fix was to the level generator (winding paths, and placements scored so arrows
-- do not start unblocked) rather than to the board sizes.
--
-- WHY THIS DELETES RATHER THAN LEAVING THE ROWS
--
-- It normally would not. `catalogue.ts` is explicit that a score outlives its game
-- being retired — `game_key` is not a foreign key precisely so that a withdrawn game's
-- scores survive, because destroying somebody's high score is worse than a scoreboard
-- row whose game is no longer listed. Left alone, these rows would simply stop being
-- displayed and nothing would break.
--
-- They are deleted here because they were scores against a *different, easier game*
-- that happened to share a name, posted during the few hours the tiers existed. Keeping
-- them would put trivially-won rows on a shared board next to the real ones with no way
-- for a reader to tell them apart. That reasoning does not generalise: a game withdrawn
-- after real play should keep its scores.
--
-- The surviving key is still `arrow-clearing-hard`, even though its label no longer
-- says "Hard". Renaming it would orphan every score already posted against it.

DELETE FROM gam_scores
WHERE game_key IN ('arrow-clearing-easy', 'arrow-clearing-medium');
