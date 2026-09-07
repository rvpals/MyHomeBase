"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/button";
import { useGameSounds } from "@/components/use-game-sounds";
import {
  BOARD_SIZE,
  applyMove,
  hasWon,
  highestTile,
  isGameOver,
  spawnTile,
  startBoard,
  type Board,
  type Direction,
} from "@/lib/games";
import { saveScoreAction } from "./games-actions";

// The 2048 board. A client component that owns only presentation state — the rules
// all come from @/lib/games (src/lib/games/game-2048.ts), so nothing here decides
// what a move does.

const GAME_KEY = "2048";

/**
 * Tile styling, by value.
 *
 * There are only 9 theme tokens and a 2048 board needs 11 distinguishable tiles, so
 * the ramp is built from ONE token — `brass` — at increasing opacity, rather than by
 * inventing colors. Two consequences, both deliberate: it reads correctly in all
 * eight themes including the light ones (which a hardcoded beige ramp would not), and
 * "bigger tile = stronger accent" survives a theme swap. `text-ink` flips to
 * `text-paper` on the strongest tiles so the numeral keeps its contrast once the
 * accent is near-solid.
 */
const TILE_STYLES: Record<number, string> = {
  0: "bg-paper border-line",
  2: "bg-brass/10 border-brass/20 text-ink",
  4: "bg-brass/20 border-brass/30 text-ink",
  8: "bg-brass/30 border-brass/40 text-ink",
  16: "bg-brass/40 border-brass/50 text-ink",
  32: "bg-brass/50 border-brass/60 text-ink",
  64: "bg-brass/60 border-brass/70 text-ink",
  128: "bg-brass/70 border-brass/80 text-paper",
  256: "bg-brass/80 border-brass/90 text-paper",
  512: "bg-brass/90 border-brass text-paper",
  1024: "bg-brass border-brass text-paper",
  2048: "bg-brass border-brass-dark text-paper ring-2 ring-brass-dark",
};

function tileStyle(value: number): string {
  // Anything above 2048 keeps the winning tile's treatment rather than falling back
  // to the empty-cell style — a 4096 is rare but must not render as a hole.
  return TILE_STYLES[value] ?? TILE_STYLES[2048];
}

/** Longer numerals get a smaller type size so a 1024 still fits its tile. */
function tileTextSize(value: number): string {
  if (value >= 1024) return "text-xl max-lg:text-lg";
  if (value >= 128) return "text-2xl max-lg:text-xl";
  return "text-3xl max-lg:text-2xl";
}

const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  // WASD as well: on a laptop the arrow keys are often the least comfortable reach,
  // and these cost nothing to support.
  w: "up",
  a: "left",
  s: "down",
  d: "right",
};

/** How far a touch must travel before it counts as a swipe rather than a tap. */
const SWIPE_THRESHOLD_PX = 30;

/* ---------------------------------------------------------------------------------
   Sound. Synthesized rather than loaded, so the game ships no audio files.
--------------------------------------------------------------------------------- */

/** What a single move turned out to be, as the thing worth hearing about it. */
type MoveSound = "slide" | "merge" | "bigMerge" | "promote" | "win" | "over";

/**
 * 2048's cue vocabulary, over the arcade's shared beeper.
 *
 * `useGameSounds` owns the audio context and the envelope; what lives here is only
 * *what a 2048 event sounds like*.
 */
function useSounds(enabled: boolean) {
  const sounds = useGameSounds(enabled);

  return useMemo(
    () => ({
      /** A soft tick as the tiles slide with nothing combining. */
      slide: () =>
        sounds.play({ startHz: 240, endHz: 210, durationMs: 45, type: "sine", peak: 0.03 }),
      /** Two tiles combining: a short rising blip. */
      merge: () =>
        sounds.play({ startHz: 440, endHz: 660, durationMs: 110, type: "triangle", peak: 0.05 }),
      /** A move that combined several tiles at once, or one large pair. */
      bigMerge: () =>
        sounds.playSequence([
          { startHz: 440, endHz: 660, durationMs: 110, type: "triangle", peak: 0.06 },
          { startHz: 660, endHz: 880, durationMs: 140, type: "triangle", peak: 0.06, afterMs: 80 },
        ]),
      /** A new highest tile — the run's real progress marker. */
      promote: () =>
        sounds.playSequence([
          { startHz: 587, endHz: 587, durationMs: 100, type: "sine", peak: 0.06 },
          { startHz: 880, endHz: 880, durationMs: 200, type: "sine", peak: 0.06, afterMs: 95 },
        ]),
      /** Reaching 2048. */
      win: () =>
        sounds.playSequence(
          [523, 659, 784, 1047].map((hz, index) => ({
            startHz: hz,
            endHz: hz,
            durationMs: index === 3 ? 300 : 120,
            type: "triangle" as OscillatorType,
            peak: 0.08,
            afterMs: index * 95,
          })),
        ),
      /** No moves left. */
      over: () =>
        sounds.play({ startHz: 320, endHz: 60, durationMs: 640, type: "sawtooth", peak: 0.08 }),
    }),
    [sounds],
  );
}

export function Game2048View({ bestScore }: { bestScore: number }) {
  // Lazily initialised, and only ever on the client.
  //
  // The opening tiles are random, so building them during SSR would render different
  // markup on the server than on the client and trip a hydration mismatch. The board
  // therefore starts `undefined` — which renders as 16 empty cells, identical on both
  // sides — and is seeded by the mount effect below. A lazy `useState(() => …)` would
  // be tidier but runs during SSR too, which is exactly what has to be avoided.
  const [board, setBoard] = useState<Board | undefined>(undefined);
  const [score, setScore] = useState(0);
  const [moves, setMoves] = useState(0);
  const [won, setWon] = useState(false);
  const [over, setOver] = useState(false);
  const [saveNote, setSaveNote] = useState<string | undefined>(undefined);
  const [soundOn, setSoundOn] = useState(true);

  const sounds = useSounds(soundOn);

  // Guards the one-shot save: `over` alone would re-fire on every re-render after the
  // game ends, posting the same score repeatedly.
  const savedRef = useRef(false);

  /**
   * The cue a move earned, parked until after the render that move caused.
   *
   * `move` decides what happened inside a `setState` updater, which is the only place
   * the pre-move board and the result are both in scope — but React may run an updater
   * twice under Strict Mode, and playing there would double every sound. So the updater
   * only *records*, and the effect below plays it once the state has settled.
   */
  const pendingRef = useRef<MoveSound[]>([]);
  const [flushId, setFlushId] = useState(0);

  useEffect(() => {
    const queued = pendingRef.current;
    pendingRef.current = [];
    for (const cue of queued) sounds[cue]();
    // `flushId` only: `sounds` changes identity when the toggle flips, and replaying the
    // last move's cues on a mute press would be a bug rather than a feature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flushId]);

  const newGame = useCallback(() => {
    setBoard(startBoard(Math.random));
    setScore(0);
    setMoves(0);
    setWon(false);
    setOver(false);
    setSaveNote(undefined);
    savedRef.current = false;
  }, []);

  // Deals the opening board on mount. Same trade as `data-grid.tsx` makes when it
  // reads localStorage: the initial value cannot be computed during SSR — here
  // because it is random rather than because the API is missing — so it is applied
  // once on the client instead of in a lazy initialiser.
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
       Seeding client-only random state on mount; a lazy initialiser would run during
       SSR and render different markup on the server than the client. */
    newGame();
  }, [newGame]);

  const move = useCallback((direction: Direction) => {
    setBoard((current) => {
      if (!current || isGameOver(current)) return current;

      const result = applyMove(current, direction);
      // A move into a wall must not spawn a tile — otherwise holding a key against
      // an edge fills the board for free.
      //
      // Note `result.moved` rather than a reference check: `applyMove` allocates a new
      // board on every call, refused or not, so `result.board !== current` is always
      // true and would make a wall bump sound like a slide.
      if (!result.moved) return current;

      const next = spawnTile(result.board, Math.random);
      setScore((value) => value + result.gained);
      setMoves((value) => value + 1);
      if (hasWon(next)) setWon(true);
      if (isGameOver(next)) setOver(true);

      // Recorded, not played — see `pendingRef`. Each move earns exactly one movement
      // cue, plus at most one event cue on top of it.
      //
      // *Assigned* rather than appended: a Strict Mode double-invocation runs this
      // block twice for one real move, and appending would queue every cue twice.
      // Overwriting is idempotent — the second pass computes the same list.
      const cues: MoveSound[] = [];
      // `gained` is the sum of the merged tiles, so a big number means either one large
      // pair or several at once; both deserve the fuller sound.
      if (result.gained === 0) cues.push("slide");
      else cues.push(result.gained >= 64 ? "bigMerge" : "merge");
      // Against `current`, not `next`: the spawned tile is a 2 or a 4 and can never be
      // the new maximum, but comparing to `next` would still be misleading on a board
      // whose only 2 just merged away.
      if (highestTile(result.board) > highestTile(current)) cues.push("promote");
      if (hasWon(next) && !hasWon(current)) cues.push("win");
      if (isGameOver(next)) cues.push("over");
      pendingRef.current = cues;

      return next;
    });
    // Wakes the flush effect. Outside the updater, so it runs once per real move even
    // if the updater itself was invoked twice.
    setFlushId((value) => value + 1);
  }, []);

  // Save once, when the game ends. In an effect rather than inside `move` because the
  // final score is only known after React has applied the state update.
  useEffect(() => {
    if (!over || savedRef.current) return;
    savedRef.current = true;

    void saveScoreAction(GAME_KEY, score, moves).then((result) => {
      if (!result.ok) {
        setSaveNote(result.error);
        return;
      }
      setSaveNote(result.best ? "New record — saved to the board." : "Score saved.");
    });
  }, [over, score, moves]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const direction = KEY_DIRECTIONS[event.key];
      if (!direction) return;
      // Stops the arrow keys scrolling the page while playing.
      event.preventDefault();
      move(direction);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [move]);

  const touchStart = useRef<{ x: number; y: number } | undefined>(undefined);

  function onTouchStart(event: React.TouchEvent) {
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(event: React.TouchEvent) {
    const start = touchStart.current;
    if (!start) return;
    touchStart.current = undefined;

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;

    // The dominant axis wins, so a slightly diagonal swipe still reads as one
    // direction rather than doing nothing.
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < SWIPE_THRESHOLD_PX) return;
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      move(deltaX > 0 ? "right" : "left");
    } else {
      move(deltaY > 0 ? "down" : "up");
    }
  }

  const shownBest = Math.max(bestScore, score);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-3">
          <Stat label="Score" value={score.toLocaleString()} />
          <Stat label="Best" value={shownBest.toLocaleString()} />
          <Stat label="Moves" value={moves.toLocaleString()} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={newGame} variant="secondary" size="sm">
            New game
          </Button>
          {/* Worded as the other games' toggle, so the arcade presents one control. */}
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
        The board is a square that scales with the viewport rather than reflowing.
        Sizing the wrapper (not the cells) is what keeps the grid square at every
        width, so no `max-lg:` grid override is needed.

        Three terms, because the game plays full-bleed and each one binds on a
        different screen: `34rem` caps it on a large monitor, `88vw` keeps it inside a
        phone, and `58vh` is the one that matters in the dialog — a square capped only
        by width overflows a short landscape window vertically and pushes the score
        row and the New game button off-screen.
      */}
      <div
        className="mx-auto w-full"
        style={{ maxWidth: "min(34rem, 88vw, 58vh)" }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div
          className="grid aspect-square gap-2 rounded-xl border border-line bg-paper-raised p-2"
          style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, minmax(0, 1fr))` }}
          role="grid"
          aria-label="2048 board"
        >
          {(board ?? new Array(BOARD_SIZE * BOARD_SIZE).fill(0)).map((value, index) => (
            <div
              // Index as key is correct here and only here: a cell is a fixed
              // position on the board, not a tile that travels between them.
              key={index}
              role="gridcell"
              aria-label={value === 0 ? "empty" : String(value)}
              className={`flex items-center justify-center rounded-lg border font-display tabular-nums ${tileStyle(
                value,
              )} ${tileTextSize(value)}`}
            >
              {value === 0 ? "" : value}
            </div>
          ))}
        </div>
      </div>

      <div aria-live="polite" className="min-h-6 text-center text-sm">
        {over && <span className="text-ink">No moves left — game over.</span>}
        {!over && won && <span className="text-brass">You reached 2048. Keep going.</span>}
        {saveNote && <span className="ml-2 text-muted">{saveNote}</span>}
      </div>

      <p className="text-center text-xs text-muted">
        Arrow keys or WASD to move; swipe on a touchscreen.
      </p>
    </div>
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
