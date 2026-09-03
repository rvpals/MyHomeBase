"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import {
  MINESWEEPER_DIFFICULTIES,
  MINESWEEPER_SETUP,
  canChord,
  chord,
  minesRemaining,
  renderMinesweeperRows,
  revealCell,
  scoreMinesweeper,
  startMinesweeper,
  tickMinesweeper,
  toggleFlag,
  type MinesweeperDifficulty,
  type MinesweeperState,
} from "@/lib/games";
import { saveScoreAction } from "./games-actions";

// The Minesweeper board. A client component that owns only presentation state — the
// flag-mode toggle, the long-press timer and the clock. Every rule comes from
// @/lib/games (src/lib/games/game-minesweeper.ts), so nothing here decides what a
// click does, where the mines go, or what a clear is worth.
//
// The clock runs here for the reason it does in Tetris and Sudoku: a `setInterval` is
// a browser concern, but what a second *costs* is not — `scoreMinesweeper` owns that,
// and this file only reports elapsed seconds into the state.

const GAME_KEY = "minesweeper";

/** How long a touch must be held to count as a flag rather than a reveal. */
const LONG_PRESS_MS = 400;

/** `m:ss`, so a nine-minute clear does not read as 540. */
function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The colour of each number, by mine count.
 *
 * The classic palette is the one thing about this game everyone already knows — 1 is
 * blue, 2 is green, 3 is red — and it is genuinely functional: at expert density you
 * read the board by colour long before you read the digits. Literal Tailwind colours
 * rather than theme tokens, deliberately and for the same reason `game-arrows-view.tsx`
 * uses a literal red for a blocked arrow: the theme carries one accent family, and
 * eight game-specific signal colours are not tokens the design system should own.
 */
const NUMBER_COLOURS: Record<number, string> = {
  1: "text-blue-500",
  2: "text-green-600",
  3: "text-red-500",
  4: "text-indigo-600",
  5: "text-amber-700",
  6: "text-cyan-600",
  7: "text-ink",
  8: "text-muted",
};

export function GameMinesweeperView({ bestScore }: { bestScore: number }) {
  // Built during render rather than seeded in a mount effect, unlike Sudoku: a fresh
  // Minesweeper board is deterministic — the mines are not laid until the first click
  // — so the server and client render identical markup and there is no hydration
  // mismatch to dodge.
  const [state, setState] = useState<MinesweeperState>(() => startMinesweeper("beginner"));
  const [flagMode, setFlagMode] = useState(false);
  const [saveNote, setSaveNote] = useState<string | undefined>(undefined);

  // Guards the one-shot save: `outcome` alone would re-fire on every re-render after
  // the clear, posting the same score repeatedly.
  const savedRef = useRef(false);

  // A long press on a touchscreen flags. The timer id lives in a ref rather than
  // state because changing it must not re-render — a re-render mid-press would be a
  // new button and the pointerup would land on a different element.
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Set when the long press fires, so the pointerup that follows does not also
  // reveal the cell it just flagged.
  const longPressed = useRef(false);

  const newGame = useCallback((level: MinesweeperDifficulty) => {
    setState(startMinesweeper(level));
    setFlagMode(false);
    setSaveNote(undefined);
    savedRef.current = false;
  }, []);

  const finished = state.outcome !== undefined;
  const cleared = state.outcome === "cleared";

  // Whether the clock should be running. `tickMinesweeper` also refuses to advance an
  // unmined or finished board, so this is about not holding a pointless interval open.
  const running = state.mined && !finished;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setState((current) => tickMinesweeper(current)), 1000);
    return () => clearInterval(timer);
  }, [running]);

  // Clears a pending long-press timer when the board goes away mid-press, so it cannot
  // fire a flag onto the next game.
  useEffect(() => () => clearTimeout(pressTimer.current), []);

  // Save once, when the board is cleared. In an effect rather than inside the reveal
  // because the final time is only known after React has applied the state update.
  // `moves` carries the flag count, which is what the scoreboard shows in its moves
  // column for this game — the nearest thing Minesweeper has to a move count, since
  // reveals cascade and one click can uncover two hundred cells.
  useEffect(() => {
    if (!cleared || savedRef.current) return;
    savedRef.current = true;

    void saveScoreAction(GAME_KEY, scoreMinesweeper(state), state.flags).then((result) => {
      if (!result.ok) {
        setSaveNote(result.error);
        return;
      }
      setSaveNote(result.best ? "New record — saved to the board." : "Score saved.");
    });
  }, [cleared, state]);

  /**
   * A click on a cell: chord it if that is the available move, otherwise reveal it.
   *
   * Chording is folded into the plain click rather than given its own modifier. The
   * classic game puts it on a middle click or both buttons at once, neither of which
   * exists on a phone, and `canChord` already answers "is this a chord" precisely — a
   * revealed number whose flags are satisfied and which still has covered neighbours.
   * A revealed cell has no other meaningful click, so nothing is being overridden.
   */
  const open = useCallback((index: number) => {
    setState((current) => {
      if (current.outcome) return current;
      if (canChord(current, index)) return chord(current, index, Math.random);
      return revealCell(current, index, Math.random);
    });
  }, []);

  const flag = useCallback((index: number) => {
    setState((current) => toggleFlag(current, index));
  }, []);

  /** A tap or click. Flag mode turns every press into a flag, for touch without a hold. */
  const handleClick = useCallback(
    (index: number) => {
      if (longPressed.current) {
        longPressed.current = false;
        return;
      }
      if (flagMode) {
        flag(index);
        return;
      }
      open(index);
    },
    [flag, flagMode, open],
  );

  const startPress = useCallback(
    (index: number) => {
      longPressed.current = false;
      pressTimer.current = setTimeout(() => {
        longPressed.current = true;
        flag(index);
      }, LONG_PRESS_MS);
    },
    [flag],
  );

  const endPress = useCallback(() => clearTimeout(pressTimer.current), []);

  const rows = renderMinesweeperRows(state);
  const remaining = minesRemaining(state);
  const liveScore = scoreMinesweeper(state);
  const setup = MINESWEEPER_SETUP[state.difficulty];

  return (
    <div className="flex flex-col gap-4">
      {/* The stat strip and the controls, matching Sudoku and Tetris so the arcade
          reads as one app. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Stat label="Time" value={formatClock(state.elapsedSeconds)} />
          {/* What is left to find, which can go negative when over-flagged — see
              `toggleFlag`. Not clamped: a negative number is the honest signal that
              more flags are down than there are mines. */}
          <Stat label="Mines" value={String(remaining)} />
          <Stat label="Best" value={bestScore.toLocaleString()} />
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Difficulty as three buttons rather than a select, for the reason Sudoku
              gives: there are exactly three, they are the first decision of every
              game, and each one deals immediately rather than arming a separate
              "New game" press. */}
          {MINESWEEPER_DIFFICULTIES.map((level) => (
            <Button
              key={level}
              onClick={() => newGame(level)}
              variant={level === state.difficulty ? "primary" : "secondary"}
              size="sm"
            >
              {MINESWEEPER_SETUP[level].label}
            </Button>
          ))}
        </div>
      </div>

      {/*
        The board scrolls horizontally rather than shrinking below a tappable cell.

        Expert is 30 columns wide. Scaling it to fit a phone the way the Sudoku board
        scales would put each cell near 3mm, which is under any usable touch target and
        would make a misclick — an instant loss here — a matter of luck rather than
        judgement. So cells have a floor of 1.75rem on a narrow screen and the board
        scrolls sideways instead. The alternative was hiding Expert on a phone, which
        would make its record unreachable from one.

        `w-fit` and `mx-auto` keep a board that *does* fit centred, so beginner and
        intermediate are not pinned to the left edge on a desktop.
      */}
      <div className="-mx-2 overflow-x-auto px-2">
        <div
          className="mx-auto grid w-fit gap-px rounded-xl border border-line bg-paper-raised p-2"
          style={{
            gridTemplateColumns: `repeat(${state.cols}, minmax(1.75rem, 1fr))`,
          }}
          role="grid"
          aria-label={`Minesweeper board, ${setup.label}`}
        >
          {rows.map((row, rowIndex) =>
            row.map((cell, colIndex) => {
              const index = rowIndex * state.cols + colIndex;
              // A mine is only ever drawn on a finished board — the state carries the
              // whole minefield (see `MinesweeperCell`), so it is this condition that
              // keeps it off the screen mid-game.
              const showMine = cell.revealed && cell.mine;
              // The mine that ended it, picked out from the others uncovered with it.
              const chordable = !finished && canChord(state, index);

              return (
                <button
                  // Index as key is correct here and only here: a cell is a fixed
                  // position on the board, not a value that travels between them.
                  key={index}
                  type="button"
                  role="gridcell"
                  aria-label={describeCell(cell, rowIndex, colIndex)}
                  disabled={finished}
                  onClick={() => handleClick(index)}
                  // Right-click flags, the way the desktop game always has. The
                  // context menu is suppressed only over the board.
                  onContextMenu={(event) => {
                    event.preventDefault();
                    flag(index);
                  }}
                  onPointerDown={() => startPress(index)}
                  onPointerUp={endPress}
                  onPointerLeave={endPress}
                  onPointerCancel={endPress}
                  className={[
                    "flex aspect-square items-center justify-center rounded-[2px] font-display tabular-nums",
                    // Touch targets have a floor; on a desktop the cell is whatever
                    // the grid column gives it.
                    "min-h-[1.75rem] min-w-[1.75rem]",
                    "text-[min(0.95rem,3vw)] leading-none",
                    cell.revealed
                      ? // An uncovered cell is flat and recedes; the covered ones are
                        // raised. That contrast is the whole read of the board.
                        showMine
                        ? "bg-red-500/25 text-red-400"
                        : "bg-paper"
                      : "border border-line bg-paper-raised hover:bg-brass/10",
                    // A satisfied number is worth pointing out — it is a move the
                    // player can make right now, the way Arrow Clearing hints.
                    chordable ? "ring-1 ring-inset ring-brass/50" : "",
                    !cell.revealed && cell.flagged ? "text-brass-dark" : "",
                    cell.revealed && !cell.mine ? NUMBER_COLOURS[cell.adjacent] ?? "" : "",
                  ].join(" ")}
                >
                  {renderFace(cell)}
                </button>
              );
            }),
          )}
        </div>
      </div>

      {/*
        Shown at both widths. On a desktop right-click flags and this is redundant, but
        a mode toggle is also the only discoverable way to flag with a trackpad, and
        hiding it narrow would leave a phone player relying on a long press nothing
        told them about.
      */}
      <div className="flex justify-center gap-2">
        <Button
          onClick={() => setFlagMode((value) => !value)}
          variant={flagMode ? "primary" : "secondary"}
          size="sm"
          aria-pressed={flagMode}
          disabled={finished}
        >
          Flag mode
        </Button>
        <Button onClick={() => newGame(state.difficulty)} variant="secondary" size="sm">
          New board
        </Button>
      </div>

      <div aria-live="polite" className="min-h-6 text-center text-sm">
        {cleared && <span className="text-ink">Cleared!</span>}
        {state.outcome === "hit-mine" && <span className="text-muted">Hit a mine.</span>}
        {!finished && flagMode && <span className="text-muted">Flag mode on.</span>}
        {saveNote && <span className="ml-2 text-muted">{saveNote}</span>}
      </div>

      {/*
        A plain bordered div, NOT a Modal — two nested Modals both register their
        Escape handler on `document` in the capture phase, so the outer one would win
        and Escape would close the whole game instead of this panel. modules.md
        records this.
      */}
      {finished && (
        <div className="mx-auto max-w-sm rounded-xl border border-line bg-paper-raised p-4 text-center">
          <h3 className="font-display text-base text-ink">
            {cleared ? "Cleared" : "Hit a mine"}
          </h3>
          <p className="mt-1 text-sm text-muted">
            {cleared ? (
              <>
                {setup.label} board in {formatClock(state.elapsedSeconds)} —{" "}
                {liveScore.toLocaleString()} pts.
              </>
            ) : (
              <>
                {state.revealed.toLocaleString()} of{" "}
                {(state.cols * state.rows - state.mines).toLocaleString()} safe squares
                uncovered. A lost board scores nothing.
              </>
            )}
          </p>
          <Button onClick={() => newGame(state.difficulty)} size="sm" className="mt-3">
            Play again
          </Button>
        </div>
      )}

      <p className="text-center text-xs text-muted max-lg:hidden">
        Click to uncover, right-click to flag, and click a satisfied number to clear
        around it.
      </p>
      <p className="hidden text-center text-xs text-muted max-lg:block">
        Tap to uncover, hold to flag, and tap a satisfied number to clear around it.
      </p>
    </div>
  );
}

/**
 * What a cell shows: a mine, a flag, a number, or nothing.
 *
 * Glyphs rather than an icon component. These are game pieces, not places in the app,
 * so they are not slot icons — the same call the other games make for their state
 * marks (`coding-guide.md`: row actions and state glyphs stay as they are).
 */
function renderFace(cell: { revealed: boolean; flagged: boolean; mine: boolean; adjacent: number }) {
  if (!cell.revealed) return cell.flagged ? "⚑" : "";
  if (cell.mine) return "✷";
  // A blank cell is left empty rather than showing a 0 — the classic board does, and a
  // grid of zeroes would drown out the numbers that actually carry information.
  return cell.adjacent === 0 ? "" : cell.adjacent;
}

/** The screen-reader description of a cell. The board is unreadable without it. */
function describeCell(
  cell: { revealed: boolean; flagged: boolean; mine: boolean; adjacent: number },
  row: number,
  col: number,
): string {
  const where = `Row ${row + 1}, column ${col + 1}`;
  if (!cell.revealed) return `${where}: ${cell.flagged ? "flagged" : "covered"}`;
  if (cell.mine) return `${where}: mine`;
  return `${where}: ${cell.adjacent === 0 ? "empty" : `${cell.adjacent} adjacent`}`;
}

/** One figure in the strip above the board. Matches Sudoku's and Tetris's. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-paper-raised px-3 py-1.5 text-center">
      <div className="text-[0.65rem] uppercase tracking-wide text-muted">{label}</div>
      <div className="font-display text-lg tabular-nums text-ink">{value}</div>
    </div>
  );
}
