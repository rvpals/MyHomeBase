"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import { SlotIcon } from "@/components/slot-icon";
import {
  formatScore,
  type ArrowDifficulty,
  type GameSummary,
} from "@/lib/games";
import { gameSlotId, getIconSlot } from "@/lib/icons";
import { GameRules, hasGameRules } from "./games-instructions";
import { Game2048View } from "./game-2048-view";
import { GameBlackjackView } from "./game-blackjack-view";
import { GameBridgeView } from "./game-bridge-view";
import { GameArrowsView } from "./game-arrows-view";
import { GameMahjongMatchView } from "./game-mahjong-match-view";
import { GameMahjongView } from "./game-mahjong-view";
import { GameMinesweeperView } from "./game-minesweeper-view";
import { GamePacmanView } from "./game-pacman-view";
import { GameSudokuView } from "./game-sudoku-view";
import { GameTetrisView } from "./game-tetris-view";

// The Arcade: the list of games, and the selected game played full-bleed over it.
//
// Play opens the game in a `Modal size="full"` rather than a card below the list.
// A board squeezed into the content column — beside the module rail, under the
// section panel and the instruction card — was the whole screen's least prominent
// element, which is backwards for the one thing the page exists to do. Full-bleed
// gives the board the viewport and drops the surrounding chrome while playing.
//
// A dialog rather than a route, deliberately. `modules.md` says anything a screen
// should survive a refresh or a bookmark on belongs in the URL — but a game in
// progress does NOT survive a refresh (the board is client state and is intentionally
// not persisted), so a route would be bookmarkable and would reopen an empty board,
// implying otherwise. `Modal` also brings Escape, the focus trap and the body-scroll
// lock, all of which a hand-rolled overlay would have to re-solve.

/**
 * The icon for one game, or nothing when the catalogue has an entry the registry
 * doesn't. Renders `null` rather than throwing: a missing glyph should cost a card its
 * decoration, not the whole Arcade — the name below it still carries the meaning.
 * `slots.test.ts` asserts the two lists agree, so this shouldn't fire in practice.
 */
function GameIcon({ gameKey, className }: { gameKey: string; className?: string }) {
  const slot = getIconSlot(gameSlotId(gameKey));
  if (!slot) return null;
  return <SlotIcon slot={slot} className={className} />;
}

/** The `id` the Rules button points `aria-controls` at. A constant because both the
 *  button and the panel need it and only one Bridge board is ever open. */
const RULES_PANEL_ID = "game-rules-panel";

export function GamesArcadeView({
  games,
  arrowBests,
}: {
  games: GameSummary[];
  /** Best score per Arrow Clearing tier. One card, three scoreboards — see below. */
  arrowBests: Record<ArrowDifficulty, number>;
}) {
  const [openKey, setOpenKey] = useState<string | undefined>(undefined);
  // Whether the Bridge board is showing its rules. Owned here rather than in
  // `GameBridgeView` because the button that toggles it lives in the `Modal` header,
  // which this component renders — pushing the state down would mean handing a callback
  // up through the board for no gain. Resets whenever a game is opened or closed, so
  // the panel never reappears over a fresh hand.
  const [isRulesOpen, setIsRulesOpen] = useState(false);
  const open = games.find((entry) => entry.game.key === openKey);

  /*
    While the rules are open, swallow the keys the games steer with.

    Every real-time board binds its controls to `window` (Tetris and Pac-Man both do),
    so without this a player reading the rules is still silently driving: arrows move
    the piece they cannot see, and Pac-Man's Space fires the bazooka they just looked
    up. Both games also `preventDefault` those keys, so Space would not even scroll
    the panel they are reading.

    A capture-phase listener on `window` is what reaches them first — the games' own
    handlers are bubble-phase on the same target, so nothing else can intercept. Only
    the gameplay keys are taken: Escape still closes the dialog, and Tab still moves
    through the panel, because swallowing those would trap the reader.

    This is deliberately NOT a pause. Pausing would mean threading a prop through all
    ten game views, and the two that keep a clock already offer their own Pause button
    a few pixels away — stopping the input is the part the player cannot do for
    themselves.
  */
  useEffect(() => {
    if (!isRulesOpen) return;

    const swallowed = new Set([
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      " ",
      "w",
      "a",
      "s",
      "d",
      "W",
      "A",
      "S",
      "D",
    ]);

    function onKeyDownCapture(event: KeyboardEvent) {
      if (!swallowed.has(event.key)) return;
      // Typing in a field inside the panel is not steering. No game here has one
      // today, but a rules panel that ate a reader's keystrokes would be a bizarre
      // bug to track down later.
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.stopPropagation();
    }

    window.addEventListener("keydown", onKeyDownCapture, true);
    return () => window.removeEventListener("keydown", onKeyDownCapture, true);
  }, [isRulesOpen]);

  function openGame(key: string) {
    setIsRulesOpen(false);
    setOpenKey(key);
  }

  function closeGame() {
    setIsRulesOpen(false);
    setOpenKey(undefined);
  }

  return (
    <div className="flex flex-col gap-6">
      {/*
        Two across on a desktop and three on a wide one, one on a phone. `max-lg:`
        first, so the desktop classes are untouched and a wide screen cannot regress.
        Two rather than three at the base width because the content column beside the
        module rail is not wide enough for more, and two divides the catalogue evenly
        more often than three does as games are added.
      */}
      <ul className="grid grid-cols-2 gap-4 xl:grid-cols-3 max-lg:grid-cols-1">
        {games.map((entry) => (
          <li key={entry.game.key}>
            <GameCard summary={entry} onOpen={() => openGame(entry.game.key)} />
          </li>
        ))}
      </ul>

      {open && (
        <Modal
          title={open.game.name}
          titleIcon={<GameIcon gameKey={open.game.key} className="h-5 w-5 text-brass-dark" />}
          description={open.game.description}
          onClose={closeGame}
          size="full"
          // Every game carries a Rules button, showing that game's own rules.
          //
          // This began as Bridge's alone, on the reasoning that its rules are the ones
          // you need *during* a hand rather than before one. That was true of Bridge
          // and wrong as a rule: the instruction card on the section page is the only
          // other copy, and reaching it means closing the game — so a player who
          // forgets what Clyde does, or which key fires the bazooka, has to abandon the
          // board to find out. The text is the same components the card composes (see
          // `RULES_BY_GAME`), so there is one copy of each game's rules and this is a
          // second way in rather than a second version.
          //
          // Gated on `hasGameRules` rather than offered unconditionally: a button that
          // opened an empty panel would be worse than no button.
          titleAction={
            hasGameRules(open.game.key) ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setIsRulesOpen((shown) => !shown)}
                ariaExpanded={isRulesOpen}
                ariaControls={RULES_PANEL_ID}
              >
                Rules
              </Button>
            ) : undefined
          }
          // No `footer`, deliberately: `Modal` omits the whole bottom bar when it is
          // absent, which gives a full-bleed game the extra ~50px and drops a row of
          // chrome from under the board. Leaving the game is still three ways available
          // — the header's ✕, Escape, and an overlay click — so a dedicated "back"
          // button was a second copy of an exit that was never missing.
        >
          {/*
            Centred in the dialog body, which is `flex-1 overflow-auto`. `min-h-full`
            with `justify-center` rather than a fixed height: the board centres in the
            space available on a desktop, and on a short phone the controls stay
            reachable by scrolling instead of being clipped.
          */}
          <div className="relative flex min-h-full flex-col items-center justify-center">
            {/*
              The rules, over the board rather than beside it. A nested `Modal` was the
              obvious call and is the wrong one — two stacked dialogs share Escape and
              the focus trap, and both would restore `body.overflow` on close, which is
              the same reason the Bridge board's own result panel is a plain div. This
              is `absolute` within the scrolling body, so it covers the board without
              moving it: a panel that pushed the board down would reflow the very game
              you are reading the rules *about* — and on a timed game like Tetris or
              Pac-Man, which keep ticking, that reflow lands mid-move.

              Desktop: a right-hand column, so the board stays visible beside it.
              `max-lg:` makes it full-width, because a board at 390px has no room to
              give half its width away.
            */}
            {isRulesOpen && (
              <div
                id={RULES_PANEL_ID}
                className="absolute inset-y-0 right-0 z-10 w-full max-w-md overflow-auto border-l border-line bg-paper-raised px-4 py-3 card-raised max-lg:max-w-none max-lg:border-l-0"
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h4 className="font-display text-base text-ink">Rules</h4>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setIsRulesOpen(false)}
                    ariaLabel="Close the rules"
                  >
                    Close
                  </Button>
                </div>
                <GameRules gameKey={open.game.key} />
              </div>
            )}
            <div className="w-full max-w-3xl">
              {/* One branch per playable game. A new game adds a case here and an
                  entry to GAME_CATALOGUE — no schema change, no nav change. */}
              {open.game.key === "2048" && <Game2048View bestScore={open.best?.score ?? 0} />}
              {/* One key for all three Arrow Clearing boards, as with Sudoku and
                  Minesweeper — the tier is picked inside the game. Unlike those, each
                  tier keeps its own scoreboard, so the bests are handed in per tier
                  rather than read from this card's single `best`. */}
              {open.game.key === "arrow-clearing-hard" && (
                <GameArrowsView difficulty="hard" arrowBests={arrowBests} />
              )}
              {open.game.key === "tetris" && (
                <GameTetrisView bestScore={open.best?.score ?? 0} />
              )}
              {/* One key for all three Sudoku boards -- the difficulty is picked inside
                  the game, so unlike Arrow Clearing there is no key to map back here. */}
              {open.game.key === "sudoku" && (
                <GameSudokuView bestScore={open.best?.score ?? 0} />
              )}
              {open.game.key === "blackjack" && (
                <GameBlackjackView bestScore={open.best?.score ?? 0} />
              )}
              {/* One key for all three Minesweeper boards, as with Sudoku -- the
                  difficulty is picked inside the game. */}
              {open.game.key === "minesweeper" && (
                <GameMinesweeperView bestScore={open.best?.score ?? 0} />
              )}
              {/* One key for all three Mahjong Match boards, as with Sudoku and
                  Minesweeper — the difficulty is picked inside the game. */}
              {open.game.key === "mahjong-match" && (
                <GameMahjongMatchView bestScore={open.best?.score ?? 0} />
              )}
              {/* The four-player game against three bots, distinct from Mahjong Match
                  above — they share the tile set and nothing else. */}
              {open.game.key === "mahjong" && (
                <GameMahjongView bestScore={open.best?.score ?? 0} />
              )}
              {/* The second card game, sharing the deck in `playing-cards.ts` with
                  Blackjack above — the split that module documents made this cheap. */}
              {open.game.key === "bridge" && <GameBridgeView bestScore={open.best?.score ?? 0} />}
              {/* The maze game. The arcade's second real-time one after Tetris, and
                  the first where the opponents move on the clock as well. */}
              {open.game.key === "pacman" && <GamePacmanView bestScore={open.best?.score ?? 0} />}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function GameCard({ summary, onOpen }: { summary: GameSummary; onOpen: () => void }) {
  const { game, best, played } = summary;
  const playable = game.status === "available";

  return (
    <article className="flex h-full flex-col justify-between rounded-xl border border-line bg-paper-raised p-4">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="flex items-center gap-2 font-display text-base text-ink">
            {/* `shrink-0` so a long game name wraps rather than squashing the glyph. */}
            <GameIcon gameKey={game.key} className="h-4 w-4 shrink-0 text-brass-dark" />
            {game.name}
          </h3>
          {!playable && (
            <span className="rounded bg-brass-soft px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide text-brass-dark">
              Soon
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted">{game.description}</p>
      </div>

      <div className="mt-4">
        <dl className="flex gap-4 text-xs text-muted">
          <div>
            <dt className="uppercase tracking-wide">Record</dt>
            <dd className="mt-0.5 font-display text-sm tabular-nums text-ink">
              {/* A never-played game shows an em dash rather than "0 pts", which
                  would read as somebody having scored nothing. */}
              {best ? formatScore(game.key, best.score) : "—"}
            </dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide">Played</dt>
            <dd className="mt-0.5 font-display text-sm tabular-nums text-ink">{played}</dd>
          </div>
        </dl>

        {best && <p className="mt-2 truncate text-xs text-muted">Held by {best.userName}</p>}

        {playable && (
          <Button onClick={onOpen} size="sm" className="mt-3 w-full">
            Play
          </Button>
        )}
      </div>
    </article>
  );
}
