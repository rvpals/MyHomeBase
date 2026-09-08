"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/button";
import { MahjongTile, TILE_FLY_MS, type TileFly } from "@/components/mahjong-tile";
import { useGameSounds } from "@/components/use-game-sounds";
import {
  MAHJONG_FIGURES,
  MAHJONG_MATCH_DIFFICULTIES,
  MAHJONG_MATCH_SETUP,
  boardBounds,
  canShuffle,
  findPair,
  freeTiles,
  hasMove,
  paintOrder,
  reshuffle,
  scoreMahjongMatch,
  selectTile,
  startMahjongMatch,
  takeHint,
  tickMahjongMatch,
  tilesLeft,
  undoMahjongMatch,
  type MahjongLayoutName,
  type MahjongMatchDifficulty,
  type MahjongMatchState,
} from "@/lib/games";
import { saveScoreAction } from "./games-actions";

// The Mahjong Match board. A client component that owns only presentation state — the
// hint highlight, the clock and the sound toggle. Every rule comes from @/lib/games
// (src/lib/games/game-mahjong-match.ts), so nothing here decides which tiles are free,
// what matches what, or what a clear is worth.
//
// The clock runs here for the reason it does in Sudoku and Minesweeper: a `setInterval`
// is a browser concern, but what a second *costs* is not — `scoreMahjongMatch` owns
// that, and this file only reports elapsed seconds into the state.

const GAME_KEY = "mahjong-match";

/** How long a hinted pair stays highlighted. Long enough to look, short enough not to linger. */
const HINT_MS = 2500;

/**
 * The pickers' options, derived from the library's own tables rather than retyped.
 *
 * Both catalogues already carry the label, so these are a rename into `{ key, label }`
 * and not a second source of truth. Built once at module scope because neither depends
 * on state.
 */
const DIFFICULTY_OPTIONS: readonly { key: MahjongMatchDifficulty; label: string }[] =
  MAHJONG_MATCH_DIFFICULTIES.map((level) => ({
    key: level,
    label: MAHJONG_MATCH_SETUP[level].label,
  }));

const FIGURE_OPTIONS: readonly { key: MahjongLayoutName; label: string }[] =
  MAHJONG_FIGURES.map((entry) => ({ key: entry.layout, label: entry.label }));

/**
 * The pickers' `<select>` skin — the same one photo-viewer and chart-toolbar use.
 *
 * Copied rather than shared: it is three utilities, and the alternative is a registered
 * component for two dropdowns on one game screen.
 */
const SELECT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/**
 * Half a tile, in pixels. The unit the layout's coordinates are in.
 *
 * Exactly half an `md` `MahjongTile`'s box (48x64), because a `TilePosition` is in
 * half-steps and a tile spans two of them. It has to agree with `mahjong-tile.tsx`'s
 * `SIZES` or the board's tiles overlap or gap — the one real coupling between this view
 * and that component, and the reason it is a named constant rather than a number inline.
 *
 * Only the `md` figure exists, deliberately. Below 1024px `MahjongTile` steps itself
 * down to its `sm` box through its own `max-lg:` classes, so the tiles shrink inside a
 * container that keeps its size — the board simply has room to spare, and the layout
 * arithmetic does not need a second set of numbers per breakpoint.
 */
const HALF_STEP = { x: 24, y: 32 };

/** How far each layer is drawn up and left, in pixels — the stack's parallax. */
const LAYER_OFFSET = 4;

/** `m:ss`, so a nine-minute clear does not read as 540. */
function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Mahjong Match's cue vocabulary, over the arcade's shared beeper.
 *
 * `useGameSounds` owns the audio context and the envelope; what lives here is only
 * *what a Mahjong Match event sounds like*. Tiles are hard little blocks, so the
 * palette is woodier and shorter than Sudoku's — a click rather than a tone.
 */
function useSounds(enabled: boolean) {
  const sounds = useGameSounds(enabled);

  return useMemo(
    () => ({
      /** Picking a tile up: a dry click. */
      pick: () =>
        sounds.play({ startHz: 440, endHz: 400, durationMs: 35, type: "square", peak: 0.03 }),
      /**
       * A pair coming off the board — the game's main reward.
       *
       * Pitched up as the board empties, so the last few pairs sound like an ending.
       * `progress` is 0 at a full board and 1 at an empty one.
       */
      match: (progress: number) =>
        sounds.play({
          startHz: 520 + progress * 260,
          endHz: 780 + progress * 400,
          durationMs: 110,
          type: "triangle",
          peak: 0.05,
        }),
      /** Two tiles that do not go together. Low and brief — a correction, not a buzzer. */
      reject: () =>
        sounds.play({ startHz: 220, endHz: 180, durationMs: 90, type: "sawtooth", peak: 0.03 }),
      /** A hint. Deliberately a little apologetic. */
      hint: () =>
        sounds.play({ startHz: 660, endHz: 880, durationMs: 130, type: "sine", peak: 0.035 }),
      /** Tiles being re-dealt: a longer sweep, so it reads as the board changing under you. */
      shuffle: () =>
        sounds.play({ startHz: 300, endHz: 620, durationMs: 260, type: "triangle", peak: 0.045 }),
      /** Taking a pair back. The match cue, reversed. */
      undo: () =>
        sounds.play({ startHz: 620, endHz: 420, durationMs: 100, type: "sine", peak: 0.03 }),
      /**
       * The board cleared. A two-note rise, through `playSequence` rather than two
       * `play` calls — `afterMs` schedules the second note on the audio clock, where a
       * `setTimeout` would land it a few frames late and turn a flick into a stumble.
       */
      win: () =>
        sounds.playSequence([
          { startHz: 520, endHz: 780, durationMs: 160, type: "sine", peak: 0.05 },
          { startHz: 780, endHz: 1180, durationMs: 260, type: "sine", peak: 0.045, afterMs: 150 },
        ]),
    }),
    [sounds],
  );
}

export function GameMahjongMatchView({ bestScore }: { bestScore: number }) {
  // Lazily initialised, and only ever on the client — the board is random, so building
  // it during SSR would render different markup on the server than the client and trip a
  // hydration mismatch. Starts `undefined` (an empty frame, identical on both sides) and
  // is seeded by the mount effect. Same trade as `GameSudokuView`.
  const [state, setState] = useState<MahjongMatchState | undefined>(undefined);
  const [difficulty, setDifficulty] = useState<MahjongMatchDifficulty>("classic");
  const [figure, setFigure] = useState<MahjongLayoutName>("turtle");
  const [hinted, setHinted] = useState<readonly number[]>([]);
  /**
   * The pair currently flying off the board, by tile index.
   *
   * Purely presentational, and deliberately separate from the game state: the library
   * has already cleared these tiles, and the board is fully playable underneath while
   * they travel. Holding them here for the flight's duration is what keeps them mounted
   * long enough to animate — a cleared tile is otherwise unmounted on the same frame it
   * is matched, and an element that never renders cannot animate out.
   */
  const [flyingPair, setFlyingPair] = useState<readonly number[]>([]);
  const [saveNote, setSaveNote] = useState<string | undefined>(undefined);
  const [soundOn, setSoundOn] = useState(true);

  // Guards the one-shot save: `outcome` alone would re-fire on every re-render after the
  // clear, posting the same score repeatedly.
  const savedRef = useRef(false);
  // Drives the match/reject cues, which are read off the change in state rather than
  // fired from the handler — the handler does not know whether a tap paired or not,
  // because the library decides that.
  const previousCleared = useRef(0);

  const sounds = useSounds(soundOn);

  const newGame = useCallback((level: MahjongMatchDifficulty, shape: MahjongLayoutName) => {
    setState(startMahjongMatch(level, Math.random, shape));
    setDifficulty(level);
    setFigure(shape);
    setHinted([]);
    setFlyingPair([]);
    setSaveNote(undefined);
    savedRef.current = false;
    previousCleared.current = 0;
  }, []);

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
       Seeding client-only random state on mount; a lazy initialiser would run during
       SSR and render different markup on the server than the client. */
    newGame("classic", "turtle");
  }, [newGame]);

  // The clock. One interval for the whole run, torn down and rebuilt only when the run
  // starts or ends.
  //
  // The two flags are extracted rather than written inline in the dependency array,
  // because `state?.outcome` there is an expression the lint rule cannot check
  // statically — and the effect genuinely does not want to re-run on every state change,
  // which depending on `state` itself would cause: a new interval every second.
  // `setState`'s updater form is what lets it read the current state without closing
  // over it.
  const running = Boolean(state) && !state?.outcome;

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(
      () => setState((current) => (current ? tickMahjongMatch(current) : current)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [running]);

  // The pair/reject cues, from the change in `pairsCleared`.
  useEffect(() => {
    if (!state) return;
    if (state.pairsCleared > previousCleared.current) {
      const progress = 1 - tilesLeft(state) / state.tiles.length;
      sounds.match(progress);
    }
    previousCleared.current = state.pairsCleared;
  }, [state?.pairsCleared, state, sounds]);

  useEffect(() => {
    if (state?.outcome === "cleared") sounds.win();
  }, [state?.outcome, sounds]);

  // Saves once, when the board is cleared. `moves` carries the pair count, which is what
  // the scoreboard shows in its moves column for this game.
  useEffect(() => {
    if (!state || state.outcome !== "cleared" || savedRef.current) return;
    savedRef.current = true;

    void saveScoreAction(GAME_KEY, scoreMahjongMatch(state), state.pairsCleared).then((result) => {
      if (!result.ok) {
        setSaveNote(result.error);
        return;
      }
      setSaveNote(result.best ? "New record — saved to the board." : "Score saved.");
    });
  }, [state?.outcome, state]);

  // Clears a hint highlight after a moment. Keyed on the highlight itself, so a second
  // hint restarts the timer rather than inheriting the first one's remaining time.
  useEffect(() => {
    if (hinted.length === 0) return;
    const timer = window.setTimeout(() => setHinted([]), HINT_MS);
    return () => window.clearTimeout(timer);
  }, [hinted]);

  const onTile = useCallback(
    (index: number) => {
      setState((current) => {
        if (!current) return current;
        const next = selectTile(current, index);
        // The library returns the same object for a tap it ignored (a buried tile), and
        // a *different* selection for a mismatch. Distinguishing them here is what lets
        // the two cues differ.
        if (next === current) return current;
        if (next.selected === index && current.selected !== undefined) sounds.reject();
        else if (next.selected === index) sounds.pick();
        // A pair just cleared: `history` gained the two indexes the library lifted, which
        // is exactly the pair to fly. Reading it from `history` rather than reconstructing
        // it from `current.selected` and `index` keeps the view agreeing with the library
        // about which tiles left, including after an undo.
        if (next.pairsCleared > current.pairsCleared) {
          setFlyingPair(next.history[next.history.length - 1]);
        }
        return next;
      });
      setHinted([]);
    },
    [sounds],
  );

  // Drops the flying pair once the animation has run. Keyed on the pair itself, so a
  // fast player clearing a second pair mid-flight restarts the timer for the new one
  // rather than having the old timeout cut it short.
  useEffect(() => {
    if (flyingPair.length === 0) return;
    const timer = window.setTimeout(() => setFlyingPair([]), TILE_FLY_MS);
    return () => window.clearTimeout(timer);
  }, [flyingPair]);

  const onHint = useCallback(() => {
    if (!state) return;
    const pair = findPair(state);
    if (!pair) return;
    setHinted(pair);
    setState(takeHint(state));
    sounds.hint();
  }, [state, sounds]);

  const onShuffle = useCallback(() => {
    setState((current) => (current ? reshuffle(current, Math.random) : current));
    setHinted([]);
    // Cancel any flight: the tiles under it are being re-dealt, and a tile still exiting
    // would finish its arc carrying a face that has since moved elsewhere.
    setFlyingPair([]);
    sounds.shuffle();
  }, [sounds]);

  const onUndo = useCallback(() => {
    setState((current) => (current ? undoMahjongMatch(current) : current));
    setHinted([]);
    // The pair being undone may be the one in flight — it is coming back, so the exit
    // has to stop or it would land back on the board mid-fade.
    setFlyingPair([]);
    sounds.undo();
  }, [sounds]);

  const free = useMemo(() => (state ? new Set(freeTiles(state)) : new Set<number>()), [state]);
  const stuck = state ? !state.outcome && !hasMove(state) : false;
  const cleared = state?.outcome === "cleared";

  return (
    <div className="flex flex-col items-center gap-4">
      {/* The stats row. `flex-wrap` so it stacks rather than overflowing on a phone. */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Stat label="Tiles" value={state ? String(tilesLeft(state)) : "—"} />
        <Stat label="Time" value={state ? formatClock(state.elapsedSeconds) : "0:00"} />
        <Stat label="Score" value={state ? scoreMahjongMatch(state).toLocaleString() : "0"} />
        <Stat label="Best" value={bestScore.toLocaleString()} />
      </div>

      {/*
        Difficulty and figure, as dropdowns at every width.

        Buttons before: eight of them across two rows, which on a phone ate a third of
        the board's height and on a desktop was still a wall of chrome above the game.
        A board figure is a *setting* you pick once and forget, not a mode you flip
        between mid-run, so a compact picker is the honest control for it — and the
        board wants every pixel it can get.

        Picking either one starts a fresh board, which is why these are `newGame` calls
        rather than plain setters. The figure picker is hidden on Easy: that is the
        72-tile beginner board, which has no alternative shapes, so all five options
        would rebuild the same board.
      */}
      <div className="flex flex-wrap items-end justify-center gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-muted">Difficulty</span>
          <select
            value={difficulty}
            onChange={(event) => newGame(event.target.value as MahjongMatchDifficulty, figure)}
            className={SELECT_CLASS}
          >
            {DIFFICULTY_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {difficulty !== "easy" && (
          <label className="text-sm">
            <span className="mb-1 block text-muted">Figure</span>
            <select
              value={figure}
              onChange={(event) => newGame(difficulty, event.target.value as MahjongLayoutName)}
              className={SELECT_CLASS}
            >
              {FIGURE_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <Board
        state={state}
        free={free}
        hinted={hinted}
        flyingPair={flyingPair}
        onTile={onTile}
      />

      {/* The aids. Undo is free; a hint and a shuffle both cost points, which is why the
          counts are shown on the buttons rather than hidden in the score. */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={onHint} variant="secondary" disabled={!state || cleared || stuck}>
          Hint{state && state.hints > 0 ? ` (${state.hints})` : ""}
        </Button>
        <Button
          onClick={onUndo}
          variant="secondary"
          disabled={!state || state.history.length === 0 || cleared}
        >
          Undo
        </Button>
        <Button
          onClick={onShuffle}
          // Highlighted when the board is dead, because at that moment it is the only
          // move available and the player has nothing else to try.
          variant={stuck ? "primary" : "secondary"}
          disabled={!state || !canShuffle(state)}
        >
          Shuffle{state && state.shuffles > 0 ? ` (${state.shuffles})` : ""}
        </Button>
        <Button onClick={() => setSoundOn((on) => !on)} variant="secondary">
          {soundOn ? "Sound on" : "Sound off"}
        </Button>
      </div>

      {/* Status. A dead board is a nudge, not an ending — shuffles are unlimited. */}
      {stuck && (
        <p className="text-sm text-muted">
          No matching pair is free. Shuffle to re-deal what is left.
        </p>
      )}
      {cleared && (
        <p className="font-display text-lg text-brass-dark">
          Board cleared in {formatClock(state?.elapsedSeconds ?? 0)}.
        </p>
      )}
      {saveNote && <p className="text-sm text-muted">{saveNote}</p>}
    </div>
  );
}

/**
 * The board: every tile absolutely positioned from its layout coordinates.
 *
 * Absolute rather than a grid, because the layers are half-offset from each other and a
 * CSS grid cannot express a tile that straddles two columns. The coordinates arrive in
 * half-steps and are multiplied by `HALF_STEP` here — the one place the geometry meets
 * pixels.
 *
 * **Phone behaviour**, per the plan: the whole board scales down and pans rather than
 * relaying out. A 144-tile turtle is 15 tiles wide, which no phone fits at a usable tile
 * size, and a different layout per breakpoint would mean a second set of coordinates and
 * a second set of blocking relationships — the geometry *is* the game, so changing it
 * would change what the puzzle is. So below 1024px the tiles step down to `sm` (via
 * `MahjongTile`'s own `max-lg:`) and the container scrolls both ways.
 */
function Board({
  state,
  free,
  hinted,
  flyingPair,
  onTile,
}: {
  state: MahjongMatchState | undefined;
  free: ReadonlySet<number>;
  hinted: readonly number[];
  flyingPair: readonly number[];
  onTile: (index: number) => void;
}) {
  // An empty frame before the mount effect seeds the board, so the server and the client
  // render the same markup. Sized from the turtle so the page does not jump when the
  // real board arrives.
  if (!state) {
    return (
      <div
        aria-hidden
        className="rounded-xl border border-line bg-paper-raised"
        style={{ width: 15 * HALF_STEP.x * 2, height: 9 * HALF_STEP.y * 2 }}
      />
    );
  }

  const bounds = boardBounds(state);
  const order = paintOrder(state);
  const step = HALF_STEP;
  const offset = LAYER_OFFSET;

  return (
    // `overflow-auto` is the phone story: the board keeps its true geometry and the
    // viewport moves over it. `max-w-full` so it does not force the dialog wider.
    <div className="max-w-full overflow-auto rounded-xl border border-line bg-paper-raised p-4">
      <div
        className="relative mx-auto"
        style={{
          width: bounds.cols * step.x + bounds.layers * offset,
          height: bounds.rows * step.y + bounds.layers * offset,
        }}
      >
        {order.map((index) => {
          const entry = state.tiles[index];
          const flyingAt = flyingPair.indexOf(index);
          // A cleared tile is normally unmounted at once. One that is still flying stays
          // in the tree until its animation is done — that is the only reason the
          // exit is visible at all, and why `flyingPair` is view state rather than
          // something read off the board.
          if (entry.cleared && flyingAt === -1) return null;

          const { layer, col, row } = entry.position;

          return (
            <div
              key={index}
              className="absolute"
              style={{
                // Normalised against `minCol`/`minRow`, so the turtle's head — which
                // sits at a negative column — is inside the box rather than clipped.
                left: (col - bounds.minCol) * step.x + (bounds.layers - layer) * offset,
                top: (row - bounds.minRow) * step.y + (bounds.layers - layer) * offset,
                // Higher layers paint over lower ones. `paintOrder` already emits them
                // bottom-first, so this only guards against a stacking context the
                // absolute positioning would otherwise leave to document order.
                zIndex: layer + 1,
              }}
            >
              <MahjongTile
                tile={entry.tile}
                size="md"
                free={free.has(index)}
                selected={state.selected === index}
                hinted={hinted.includes(index)}
                lifted={state.selected === index}
                // Only a free tile is clickable. A buried one is still drawn — the
                // board's shape is the puzzle — but it is not a button, so a screen
                // reader and a keyboard both skip it rather than offering a dead action.
                onClick={
                  free.has(index) && !entry.cleared ? () => onTile(index) : undefined
                }
                flying={flyingAt === -1 ? undefined : flightFor(state, flyingPair, index)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Which way one half of a matched pair flies.
 *
 * The two tiles leave **outward** — the left-hand one exits left, the right-hand one
 * right — which is what makes the exit read as *those two went together* rather than as
 * two tiles that happened to vanish at once. Comparing the pair's own columns is what
 * decides which is which, so a pair stacked vertically still splits sensibly (the tie
 * breaks on row, then on index, so the two never pick the same direction).
 *
 * The spin mirrors the direction too. Both tiles spinning the same way looked like a
 * conveyor belt; mirrored, they read as being flicked apart.
 */
function flightFor(
  state: MahjongMatchState,
  pair: readonly number[],
  index: number,
): TileFly {
  const [a, b] = pair;
  const other = index === a ? b : a;
  const mine = state.tiles[index].position;
  const theirs = state.tiles[other]?.position;

  // `<=` with the index tiebreak, so exactly one of the two is the "left" one even when
  // both sit in the same column.
  const goesLeft = theirs
    ? mine.col < theirs.col ||
      (mine.col === theirs.col && (mine.row < theirs.row || index < other))
    : true;

  return {
    x: goesLeft ? "-4.5rem" : "4.5rem",
    y: "-3.5rem",
    spinDeg: goesLeft ? -28 : 28,
  };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-paper-raised px-3 py-1.5 text-center">
      <div className="text-[0.65rem] uppercase tracking-wide text-muted">{label}</div>
      <div className="font-display text-lg tabular-nums text-ink">{value}</div>
    </div>
  );
}
