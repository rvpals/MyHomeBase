"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { useGameSounds } from "@/components/use-game-sounds";
import {
  SUDOKU_DIFFICULTIES,
  SUDOKU_HINT_PENALTY,
  SUDOKU_SETUP,
  SUDOKU_SIZE,
  clearCell,
  digitCount,
  enterDigit,
  peersOf,
  renderSudokuRows,
  revealHint,
  scoreGame,
  startSudoku,
  sudokuCandidatesFor,
  tickSudoku,
  toggleNote,
  type SudokuDifficulty,
  type SudokuDigit,
  type SudokuState,
} from "@/lib/games";
import { saveScoreAction } from "./games-actions";

// The Sudoku board. A client component that owns only presentation state — the
// selected cell, the notes toggle and the clock. Every rule comes from @/lib/games
// (src/lib/games/game-sudoku.ts), so nothing here decides what an entry does or what
// a solve is worth.
//
// The clock runs here for the same reason it does in Tetris: a `setInterval` is a
// browser concern, but what a second *costs* is not — `scoreGame` owns that, and this
// file only reports elapsed seconds into the state.

const GAME_KEY = "sudoku";

/** The nine digits, for the pad. Typed as the grid's digit so no cast is needed below. */
const PAD_DIGITS: readonly SudokuDigit[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** `m:ss`, so a nine-minute solve does not read as 540. */
function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/* ---------------------------------------------------------------------------------
   Sound. Synthesized rather than loaded, so the game ships no audio files.
--------------------------------------------------------------------------------- */

/**
 * Sudoku's cue vocabulary, over the arcade's shared beeper.
 *
 * `useGameSounds` owns the audio context and the envelope; what lives here is only
 * *what a Sudoku event sounds like*.
 *
 * Quieter than the arcade's action games on purpose. This is a board people sit with
 * for twenty minutes, so the routine cues are near-subliminal and only a mistake or a
 * solve is allowed to be assertive.
 */
function useSounds(enabled: boolean) {
  const sounds = useGameSounds(enabled);

  return useMemo(
    () => ({
      /** A digit that matches the solution: a soft, clean placement. */
      place: () =>
        sounds.play({ startHz: 520, endHz: 560, durationMs: 60, type: "sine", peak: 0.035 }),
      /**
       * A wrong digit.
       *
       * The one cue the player must not be able to miss — it is the only feedback that
       * a mistake was scored, and the board shows it only as a colour.
       */
      mistake: () =>
        sounds.play({ startHz: 240, endHz: 150, durationMs: 220, type: "sawtooth", peak: 0.07 }),
      /** Clearing a cell. */
      erase: () =>
        sounds.play({ startHz: 320, endHz: 240, durationMs: 55, type: "sine", peak: 0.03 }),
      /** Pencilling a candidate in. */
      note: () =>
        sounds.play({ startHz: 700, endHz: 740, durationMs: 35, type: "square", peak: 0.02 }),
      /** Rubbing one out — the same tick, falling. */
      unnote: () =>
        sounds.play({ startHz: 740, endHz: 640, durationMs: 35, type: "square", peak: 0.02 }),
      /** A hint: the game filling a cell in for you, which should feel like a small debt. */
      hint: () =>
        sounds.playSequence([
          { startHz: 880, endHz: 880, durationMs: 70, type: "sine", peak: 0.045 },
          { startHz: 660, endHz: 660, durationMs: 150, type: "sine", peak: 0.045, afterMs: 70 },
        ]),
      /** A solved grid. */
      solved: () =>
        sounds.playSequence(
          [523, 659, 784, 1047, 1319].map((hz, index) => ({
            startHz: hz,
            endHz: hz,
            durationMs: index === 4 ? 360 : 120,
            type: "triangle" as OscillatorType,
            peak: 0.075,
            afterMs: index * 100,
          })),
        ),
    }),
    [sounds],
  );
}

/** Total pencilled candidates on the board. A note toggle moves this by exactly one. */
function countNotes(state: SudokuState): number {
  let total = 0;
  for (const cell of state.cells) total += cell.notes.length;
  return total;
}

export function GameSudokuView({ bestScore }: { bestScore: number }) {
  // Lazily initialised, and only ever on the client — the board is random, so building
  // it during SSR would render different markup on the server than the client and trip
  // a hydration mismatch. Starts `undefined` (an empty grid, identical on both sides)
  // and is seeded by the mount effect. Same trade as `GameTetrisView` and `Game2048View`.
  const [state, setState] = useState<SudokuState | undefined>(undefined);
  const [difficulty, setDifficulty] = useState<SudokuDifficulty>("easy");
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const [noteMode, setNoteMode] = useState(false);
  const [saveNote, setSaveNote] = useState<string | undefined>(undefined);

  // Guards the one-shot save: `outcome` alone would re-fire on every re-render after
  // the solve, posting the same score repeatedly.
  const savedRef = useRef(false);

  const [soundOn, setSoundOn] = useState(true);

  const sounds = useSounds(soundOn);

  /**
   * The cues, read off the change in state rather than fired from the handlers.
   *
   * Every rule returns one immutable `SudokuState`, so a diff of the counters says
   * exactly what a keystroke did — and it says it for `press`, `erase` and `hint`
   * alike, which between them use three different code paths into `setState`.
   *
   * Nothing here keys on `elapsedSeconds`: the clock produces a new state every second,
   * and a cue on "state changed" would tick through the whole puzzle.
   */
  const previousRef = useRef<SudokuState | undefined>(undefined);
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = state;

    // A new board replaces `solution` wholesale; comparing across that tells you
    // nothing, and the mount seed would otherwise cue on the opening grid.
    if (!state || !previous || previous.solution !== state.solution) return;

    if (!previous.outcome && state.outcome === "solved") {
      sounds.solved();
      return;
    }
    if (state.mistakes > previous.mistakes) {
      sounds.mistake();
      return;
    }
    if (state.hints > previous.hints) {
      sounds.hint();
      return;
    }

    // `filled` counts cells holding a digit, right or wrong, so it separates a
    // placement from an erase without having to find which cell moved.
    if (state.filled > previous.filled) {
      sounds.place();
      return;
    }
    if (state.filled < previous.filled) {
      sounds.erase();
      return;
    }

    // Nothing counted changed, so this was a note. Total them rather than hunting the
    // cell: a toggle moves exactly one candidate, and the sign is the whole story.
    const noteDelta = countNotes(state) - countNotes(previous);
    if (noteDelta > 0) sounds.note();
    else if (noteDelta < 0) sounds.unnote();
  }, [state, sounds]);

  const newGame = useCallback((level: SudokuDifficulty) => {
    // Generation runs a bounded backtracking solver per removed clue. It is fast
    // enough to stay inline (tens of milliseconds) — a worker would be the answer if
    // this ever grew, and the pure library would move into it unchanged.
    setState(startSudoku(level, Math.random));
    setDifficulty(level);
    setSelected(undefined);
    setNoteMode(false);
    setSaveNote(undefined);
    savedRef.current = false;
  }, []);

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
       Seeding client-only random state on mount; a lazy initialiser would run during
       SSR and render different markup on the server than the client. */
    newGame("easy");
  }, [newGame]);

  const solved = state?.outcome === "solved";

  // Whether a board exists to run the clock against. A boolean rather than `state`
  // itself in the effect's dependencies: depending on the state would tear down and
  // rebuild the interval on every entry, so the second in progress would restart and a
  // fast player could hold the timer near zero. Extracted to a variable because a
  // complex expression in a dependency array cannot be statically checked.
  const started = state !== undefined;

  // The clock. One second, stopped on a solve — `tickSudoku` also refuses to advance a
  // finished game, so the guard here is about not holding a pointless interval open.
  useEffect(() => {
    if (!started || solved) return;
    const timer = setInterval(
      () => setState((current) => (current ? tickSudoku(current) : current)),
      1000,
    );
    return () => clearInterval(timer);
  }, [solved, started]);

  // Save once, when the board is solved. In an effect rather than inside the entry
  // because the final time and mistake count are only known after React has applied
  // the state update. `moves` carries the mistake count, which is what the scoreboard
  // shows in its moves column for this game.
  useEffect(() => {
    if (!state || !solved || savedRef.current) return;
    savedRef.current = true;

    void saveScoreAction(GAME_KEY, scoreGame(state), state.mistakes).then((result) => {
      if (!result.ok) {
        setSaveNote(result.error);
        return;
      }
      setSaveNote(result.best ? "New record — saved to the board." : "Score saved.");
    });
  }, [solved, state]);

  /** Applies one pure rule at the selected cell. Every control goes through here. */
  const apply = useCallback(
    (rule: (current: SudokuState, index: number) => SudokuState) => {
      setState((current) => {
        if (!current || current.outcome || selected === undefined) return current;
        return rule(current, selected);
      });
    },
    [selected],
  );

  const press = useCallback(
    (digit: SudokuDigit) => {
      apply((current, index) =>
        noteMode ? toggleNote(current, index, digit) : enterDigit(current, index, digit),
      );
    },
    [apply, noteMode],
  );

  const erase = useCallback(() => apply(clearCell), [apply]);

  /**
   * Takes a hint. Not routed through `apply`, which requires a selected cell — a hint
   * works with nothing selected, in which case the library picks the cell. The revealed
   * cell is then selected so the player's eye lands on what changed.
   */
  const hint = useCallback(() => {
    setState((current) => {
      if (!current || current.outcome) return current;
      const next = revealHint(current, selected);
      // `revealHint` returns the same state when there is nothing to reveal — a given,
      // an already-correct cell — so nothing moves and no hint is charged.
      if (next === current) return current;
      const revealed = next.cells.findIndex(
        (cell, index) => cell.value !== current.cells[index].value,
      );
      if (revealed !== -1) setSelected(revealed);
      return next;
    });
  }, [selected]);

  /** Moves the selection by one cell, clamped to the grid. Arrow-key navigation. */
  const nudge = useCallback((rowStep: number, colStep: number) => {
    setSelected((current) => {
      if (current === undefined) return 0;
      const row = Math.floor(current / SUDOKU_SIZE) + rowStep;
      const col = (current % SUDOKU_SIZE) + colStep;
      if (row < 0 || row >= SUDOKU_SIZE || col < 0 || col >= SUDOKU_SIZE) return current;
      return row * SUDOKU_SIZE + col;
    });
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // The arrows scroll the page, so every key handled here is prevented and
      // anything else is left to the browser.
      const handled: Record<string, () => void> = {
        ArrowUp: () => nudge(-1, 0),
        ArrowDown: () => nudge(1, 0),
        ArrowLeft: () => nudge(0, -1),
        ArrowRight: () => nudge(0, 1),
        Backspace: erase,
        Delete: erase,
        // Space toggles notes, matching the on-screen button.
        " ": () => setNoteMode((value) => !value),
        n: () => setNoteMode((value) => !value),
        h: hint,
      };

      const action = handled[event.key];
      if (action) {
        event.preventDefault();
        action();
        return;
      }

      if (event.key >= "1" && event.key <= "9") {
        event.preventDefault();
        press(Number(event.key) as SudokuDigit);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [erase, hint, nudge, press]);

  const rows = state ? renderSudokuRows(state) : undefined;

  /**
   * The cells to highlight with the selection: its row, column and box.
   *
   * A Set of the library's `peersOf`, so the "which cells relate to this one" rule
   * lives in one place and the view only decides how to draw them.
   */
  const highlighted = useMemo(
    () => (selected === undefined ? undefined : new Set(peersOf(selected))),
    [selected],
  );

  /** The digit in the selected cell, so every copy of it can be picked out. */
  const selectedDigit = selected === undefined ? 0 : (state?.cells[selected]?.value ?? 0);

  /**
   * The candidates for the selected cell, for the Hint card.
   *
   * `undefined` when there is nothing to list — no selection, or a cell that already
   * holds a digit — which is what the card turns into its prompt. An empty array is a
   * different answer and stays one: the cell has no legal digit left, meaning something
   * already on the board is wrong.
   */
  const candidates = useMemo(
    () => (state && selected !== undefined ? sudokuCandidatesFor(state, selected) : undefined),
    [selected, state],
  );

  const liveScore = state ? scoreGame(state) : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* The stat strip and the controls, matching Tetris so the arcade reads as one app. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Stat label="Time" value={formatClock(state?.elapsedSeconds ?? 0)} />
          <Stat label="Mistakes" value={String(state?.mistakes ?? 0)} />
          <Stat label="Hints" value={String(state?.hints ?? 0)} />
          <Stat label="Best" value={bestScore.toLocaleString()} />
        </div>
        <div className="flex flex-wrap gap-2">
          {/*
            Difficulty as three buttons rather than a select: there are exactly three,
            they are the first decision of every game, and a dropdown would hide two of
            them behind a click. Starting a new board is what picking one *means*, so
            each one deals immediately rather than arming a separate "New game" press.
          */}
          {SUDOKU_DIFFICULTIES.map((level) => (
            <Button
              key={level}
              onClick={() => newGame(level)}
              variant={level === difficulty ? "primary" : "secondary"}
              size="sm"
            >
              {SUDOKU_SETUP[level].label}
            </Button>
          ))}
          {/* After the difficulty group, not inside it — this is a separate decision
              that happens to share the row. */}
          <Button
            onClick={() => setSoundOn((value) => !value)}
            variant="secondary"
            size="sm"
            aria-pressed={soundOn}
            title={soundOn ? "Mute sound effects" : "Unmute sound effects"}
          >
            {soundOn ? "Sound on" : "Sound off"}
          </Button>
        </div>
      </div>

      {/*
        The board is a 9x9 grid that scales with the viewport rather than reflowing —
        the same trade as the Tetris playfield, and the reason this needs no separate
        compact component. Three terms, each binding on a different screen: `22rem`
        caps it on a large monitor, `92vw` keeps it inside a phone, and `58vh` is the
        one that matters in the full-bleed dialog, where a board capped only by width
        overflows a short landscape window and pushes the number pad off-screen. The
        board is square, so the `vh` term needs no conversion.

        All three terms are raised together, deliberately. Each binds on a different
        screen, so lifting only the `rem` cap would grow the desktop board and leave
        a phone and a short landscape window exactly as they were. These match
        `game-2048-view.tsx`, the closest analogue — also a square grid with its
        controls stacked beneath it — so the two read as the same size of board.
      */}
      <div className="mx-auto w-full" style={{ maxWidth: "min(34rem, 92vw, 58vh)" }}>
        <div
          className="sudoku-board sudoku-box-seams relative grid gap-0 rounded-xl border border-line bg-paper-raised p-2"
          style={{
            gridTemplateColumns: `repeat(${SUDOKU_SIZE}, minmax(0, 1fr))`,
            aspectRatio: "1 / 1",
          }}
          role="grid"
          aria-label="Sudoku board"
        >
          {(rows ?? emptyRows()).map((row, rowIndex) =>
            row.map((cell, colIndex) => {
              const index = rowIndex * SUDOKU_SIZE + colIndex;
              const isSelected = selected === index;
              const isPeer = !isSelected && (highlighted?.has(index) ?? false);
              // A wrong digit is shown as wrong immediately. The library already
              // counted the mistake, so hiding it would only leave the player hunting
              // for an error the game has already charged them for.
              const wrong = cell.value !== 0 && cell.value !== state?.solution[index];
              // Every copy of the selected digit, which is how you scan for where the
              // next one goes. Not applied to the selected cell itself.
              const matching =
                !isSelected && selectedDigit !== 0 && cell.value === selectedDigit;

              return (
                <button
                  // Index as key is correct here and only here: a cell is a fixed
                  // position on the board, not a value that travels between them.
                  key={index}
                  type="button"
                  role="gridcell"
                  aria-label={`Row ${rowIndex + 1}, column ${colIndex + 1}: ${
                    cell.value === 0 ? "empty" : cell.value
                  }${cell.given ? ", given" : ""}${cell.hinted ? ", hinted" : ""}`}
                  aria-selected={isSelected}
                  onClick={() => setSelected(index)}
                  className={[
                    "relative flex items-center justify-center rounded-[2px] border border-line/50 font-display tabular-nums",
                    // The cell's own low bevel. The 3x3 box seams are NOT here: they
                    // are one continuous overlay on the board itself
                    // (`.sudoku-box-seams`), because a seam is a line on the board
                    // rather than a property of the cells either side of it. See the
                    // sudoku block in `globals.css`.
                    cell.given ? "sudoku-cell-given" : "sudoku-cell",
                    isSelected
                      ? "border-brass bg-brass/25"
                      : isPeer
                        ? "bg-brass/5"
                        : matching
                          ? "bg-brass/15"
                          : "bg-paper",
                    wrong
                      ? // The theme has no error token -- one accent family only. The
                        // arcade already marks a wrong move with this literal in
                        // `game-arrows-view.tsx`, so it matches rather than inventing one.
                        "text-red-400"
                      : cell.given
                        ? "text-ink"
                        : cell.hinted
                          ? // A hinted digit is drawn dimmer than the player's own work:
                            // it is correct, but it is not something they solved, and the
                            // board should still read as theirs at a glance.
                            "text-muted italic"
                          : // A player's own correct entry is tinted, so at a glance you
                            // can tell your work from the puzzle's clues.
                            "text-brass-dark",
                    // Text scales with the board, which is itself viewport-sized. Both
                    // terms track the board's own caps — a glyph size left behind when
                    // the board grew would sit small in the middle of a large cell.
                    "text-[min(2.1rem,3.6vw)]",
                  ].join(" ")}
                >
                  {cell.value !== 0 ? (
                    cell.value
                  ) : cell.notes.length > 0 ? (
                    /*
                      Pencilled candidates, in a 3x3 mini-grid so a note always sits in
                      the same spot in the cell — a wrapping row would move the 5 as
                      soon as a 2 was added, and the point of notes is scanning them.
                    */
                    <span
                      aria-hidden
                      className="grid h-full w-full grid-cols-3 grid-rows-3 text-[min(0.85rem,1.5vw)] leading-none text-muted"
                    >
                      {PAD_DIGITS.map((digit) => (
                        <span key={digit} className="flex items-center justify-center">
                          {cell.notes.includes(digit) ? digit : ""}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </button>
              );
            }),
          )}
        </div>
      </div>

      {/*
        The number pad. Shown at BOTH widths, unlike Tetris's touch pad: on a desktop
        the keyboard works, but a nine-digit pad is also the obvious way to play with a
        mouse, and hiding it would leave a desktop player with no visible way to enter
        anything. A count per digit greys out one that is fully placed.
      */}
      <div
        className="mx-auto flex w-full flex-col gap-2"
        /* The same cap as the board above, not a `max-w-*` step: the pad is read as
           the board's base, so a pad narrower than the board it sits under looks
           like a mistake. These two widths have to be changed together. */
        style={{ maxWidth: "min(34rem, 92vw, 58vh)" }}
      >
        <div className="grid grid-cols-9 gap-1.5 max-lg:gap-1">
          {PAD_DIGITS.map((digit) => {
            const placed = state ? digitCount(state, digit) >= SUDOKU_SIZE : false;
            return (
              <button
                key={digit}
                type="button"
                onClick={() => press(digit)}
                disabled={solved || placed}
                aria-label={`${noteMode ? "Note" : "Enter"} ${digit}`}
                className="rounded-lg border border-line bg-paper-raised py-2 font-display text-lg tabular-nums text-ink disabled:opacity-30 max-lg:py-3"
              >
                {digit}
              </button>
            );
          })}
        </div>
        <div className="flex justify-center gap-2">
          <Button
            onClick={() => setNoteMode((value) => !value)}
            variant={noteMode ? "primary" : "secondary"}
            size="sm"
            aria-pressed={noteMode}
          >
            Notes
          </Button>
          <Button onClick={erase} variant="secondary" size="sm" disabled={solved}>
            Erase
          </Button>
          {/*
            Hints are unlimited, so this is never disabled for having been used — only
            on a finished board. What stops a player leaning on it is the score: each
            hint costs `SUDOKU_HINT_PENALTY` and the first one removes the score floor,
            which the label states outright rather than springing at the end.
          */}
          <Button
            onClick={hint}
            variant="secondary"
            size="sm"
            disabled={solved}
            title={`Reveal one cell — costs ${SUDOKU_HINT_PENALTY} points`}
          >
            Hint
          </Button>
        </div>
      </div>

      {/*
        The Hint card: the candidates for whichever cell is selected — the same list a
        player would pencil in by hand, computed by `sudokuCandidatesFor` from the board
        as it stands. It costs nothing and is not counted as a hint, because it reveals
        no answer: unlike the Hint *button*, which fills in the solution's digit, this
        only restates what the board already implies. Collapsed by default, and it says
        outright what leaning on it does to the puzzle.
      */}
      <div className="mx-auto w-full max-w-md">
        <CollapsibleCard title="Hint">
          <p className="text-xs text-brass-dark">
            You&rsquo;re defeating the purpose if you keep looking at this.
          </p>

          <div className="mt-3">
            {candidates === undefined ? (
              <p className="text-sm text-muted">
                Tap an empty cell to see which digits could still go in it.
              </p>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted">
                Nothing fits here — a digit already on the board must be wrong.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {candidates.map((digit) => (
                    <span
                      key={digit}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-paper font-display text-base tabular-nums text-ink"
                    >
                      {digit}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted">
                  {candidates.length === 1
                    ? "One digit fits."
                    : `${candidates.length} digits fit.`}{" "}
                  Row {Math.floor((selected ?? 0) / SUDOKU_SIZE) + 1}, column{" "}
                  {((selected ?? 0) % SUDOKU_SIZE) + 1}.
                </p>
              </>
            )}
          </div>
        </CollapsibleCard>
      </div>

      <div aria-live="polite" className="min-h-6 text-center text-sm">
        {solved && <span className="text-ink">Solved!</span>}
        {!solved && noteMode && <span className="text-muted">Notes on.</span>}
        {saveNote && <span className="ml-2 text-muted">{saveNote}</span>}
      </div>

      {/*
        A plain bordered div, NOT a Modal. Two nested Modals both register their Escape
        handler on `document` in the capture phase, so the outer one wins and Escape
        would close the whole game instead of this panel — and the two focus traps
        would fight over one tree. modules.md records this.
      */}
      {solved && state && (
        <div className="mx-auto max-w-sm rounded-xl border border-line bg-paper-raised p-4 text-center">
          <h3 className="font-display text-base text-ink">Solved</h3>
          <p className="mt-1 text-sm text-muted">
            {SUDOKU_SETUP[state.difficulty].label} board in {formatClock(state.elapsedSeconds)} with{" "}
            {state.mistakes.toLocaleString()}{" "}
            {state.mistakes === 1 ? "mistake" : "mistakes"}
            {/* Hints are only mentioned when they were used — a clean solve should not
                be reminded of a button it did not need. */}
            {state.hints > 0 &&
              ` and ${state.hints.toLocaleString()} ${state.hints === 1 ? "hint" : "hints"}`}{" "}
            — {liveScore.toLocaleString()} pts.
          </p>
          <Button onClick={() => newGame(state.difficulty)} size="sm" className="mt-3">
            Play again
          </Button>
        </div>
      )}

      <p className="text-center text-xs text-muted max-lg:hidden">
        Arrows to move, 1-9 to enter a digit, Backspace to erase, N or Space for notes, H
        for a hint.
      </p>
    </div>
  );
}

/** A blank 9x9, drawn before the client-side board exists. Matches the SSR output. */
function emptyRows() {
  return Array.from({ length: SUDOKU_SIZE }, () =>
    Array.from({ length: SUDOKU_SIZE }, () => ({
      value: 0 as SudokuDigit,
      given: false,
      notes: [] as readonly number[],
      hinted: false,
    })),
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-paper-raised px-3 py-1.5 text-center">
      <div className="text-[0.65rem] uppercase tracking-wide text-muted">{label}</div>
      <div className="font-display text-lg tabular-nums text-ink">{value}</div>
    </div>
  );
}
