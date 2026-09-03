"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import { arrowDifficultyOf, formatScore, type GameSummary } from "@/lib/games";
import { Game2048View } from "./game-2048-view";
import { GameBlackjackView } from "./game-blackjack-view";
import { GameArrowsView } from "./game-arrows-view";
import { GameMinesweeperView } from "./game-minesweeper-view";
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

export function GamesArcadeView({ games }: { games: GameSummary[] }) {
  const [openKey, setOpenKey] = useState<string | undefined>(undefined);
  const open = games.find((entry) => entry.game.key === openKey);
  const arrowDifficulty = open ? arrowDifficultyOf(open.game.key) : undefined;

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
            <GameCard summary={entry} onOpen={() => setOpenKey(entry.game.key)} />
          </li>
        ))}
      </ul>

      {open && (
        <Modal
          title={open.game.name}
          description={open.game.description}
          onClose={() => setOpenKey(undefined)}
          size="full"
          footer={
            <Button onClick={() => setOpenKey(undefined)} variant="secondary">
              Back to the arcade
            </Button>
          }
        >
          {/*
            Centred in the dialog body, which is `flex-1 overflow-auto`. `min-h-full`
            with `justify-center` rather than a fixed height: the board centres in the
            space available on a desktop, and on a short phone the controls stay
            reachable by scrolling instead of being clipped.
          */}
          <div className="flex min-h-full flex-col items-center justify-center">
            <div className="w-full max-w-3xl">
              {/* One branch per playable game. A new game adds a case here and an
                  entry to GAME_CATALOGUE — no schema change, no nav change. */}
              {open.game.key === "2048" && <Game2048View bestScore={open.best?.score ?? 0} />}
              {/* The three Arrow Clearing keys are three boards of the same game, so
                  they share one view and pass their own difficulty. `arrowDifficultyOf`
                  maps the key back, keeping that mapping in the library beside the
                  keys. */}
              {arrowDifficulty && (
                <GameArrowsView difficulty={arrowDifficulty} bestScore={open.best?.score ?? 0} />
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
          <h3 className="font-display text-base text-ink">{game.name}</h3>
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
