"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import {
  ARROW_DIFFICULTY_SETUP,
  clearArrow,
  generatePuzzle,
  isBlocked,
  isSolved,
  scoreBoard,
  unblockedArrows,
  type Arrow,
  type ArrowBoard,
  type ArrowDifficulty,
  type Direction,
} from "@/lib/games";
import { saveScoreAction } from "./games-actions";

// The Arrow Clearing board. A client component that owns only presentation state —
// every rule (what blocks what, how a board is generated, what a solve scores) comes
// from @/lib/games (src/lib/games/game-arrows.ts), so nothing here decides the game.
//
// Arrows are absolutely positioned over a CSS grid rather than placed *in* it: a
// cleared arrow slides the whole way off the board, which means animating a transform
// far outside its own cell. A grid child would be clipped at the container and would
// reflow its neighbours on the way out.

/** How long a fly-off animation runs, in ms. Matches the CSS duration below. */
const FLY_MS = 260;

/** How long the blocked shake runs, in ms. */
const SHAKE_MS = 320;

/** Arrow glyph per direction. A plain character: it rotates with the piece, and it
 *  reads correctly at every board size without an icon set. */
const HEAD_GLYPH: Record<Direction, string> = {
  up: "▲",
  down: "▼",
  left: "◀",
  right: "▶",
};

/** How far off the board a flying arrow travels — far enough to leave any 9x9. */
const FLY_DISTANCE = "1000%";

function flyTransform(direction: Direction): string {
  switch (direction) {
    case "up":
      return `translateY(-${FLY_DISTANCE})`;
    case "down":
      return `translateY(${FLY_DISTANCE})`;
    case "left":
      return `translateX(-${FLY_DISTANCE})`;
    case "right":
      return `translateX(${FLY_DISTANCE})`;
  }
}

/* ---------------------------------------------------------------------------------
   Sound. Synthesized rather than loaded, so the game ships no audio files.
--------------------------------------------------------------------------------- */

/**
 * A tiny Web Audio beeper.
 *
 * The AudioContext is created on the first *user gesture*, never on mount: browsers
 * refuse to start one without an interaction, and an autoplay-blocked context logs a
 * console warning on every load. Held in a ref because a context is expensive and a
 * page may see hundreds of clicks.
 */
function useSounds(enabled: boolean) {
  const contextRef = useRef<AudioContext | null>(null);

  const context = useCallback((): AudioContext | undefined => {
    if (!enabled) return undefined;
    if (!contextRef.current) {
      const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return undefined;
      contextRef.current = new Ctor();
    }
    return contextRef.current;
  }, [enabled]);

  // Release the hardware when the game is closed; a leaked context keeps the audio
  // device awake for the life of the tab.
  useEffect(() => {
    return () => {
      void contextRef.current?.close();
      contextRef.current = null;
    };
  }, []);

  const tone = useCallback(
    (startHz: number, endHz: number, durationMs: number, type: OscillatorType = "sine") => {
      const audio = context();
      if (!audio) return;

      const now = audio.currentTime;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();

      oscillator.type = type;
      oscillator.frequency.setValueAtTime(startHz, now);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endHz), now + durationMs / 1000);

      // A quick attack and a ramp to (near) silence: a gain that stops at a non-zero
      // value clicks audibly, and exponentialRamp cannot reach exactly 0.
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.09, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);

      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(now);
      oscillator.stop(now + durationMs / 1000 + 0.02);
    },
    [context],
  );

  return useMemo(
    () => ({
      /** A rising whoosh as the piece leaves. */
      clear: () => tone(420, 980, 180, "triangle"),
      /** A short low thud for a piece that could not move. */
      bump: () => tone(180, 90, 140, "square"),
      /** Three rising notes on a cleared board. */
      win: () => {
        tone(523, 523, 140, "triangle");
        window.setTimeout(() => tone(659, 659, 140, "triangle"), 130);
        window.setTimeout(() => tone(784, 784, 260, "triangle"), 260);
      },
    }),
    [tone],
  );
}

/* ---------------------------------------------------------------------------------
   The board.
--------------------------------------------------------------------------------- */

interface Snapshot {
  board: ArrowBoard;
  misses: number;
}

export function GameArrowsView({
  difficulty,
  bestScore,
}: {
  difficulty: ArrowDifficulty;
  bestScore: number;
}) {
  const setup = ARROW_DIFFICULTY_SETUP[difficulty];

  // Undefined until the mount effect deals a board. The opening layout is random, so
  // generating it during SSR would render different markup on the server than on the
  // client and trip a hydration mismatch — the same trade `game-2048-view.tsx` makes.
  const [board, setBoard] = useState<ArrowBoard | undefined>(undefined);
  const [misses, setMisses] = useState(0);
  const [cleared, setCleared] = useState(0);
  const [soundOn, setSoundOn] = useState(true);
  const [saveNote, setSaveNote] = useState<string | undefined>(undefined);
  const [showWin, setShowWin] = useState(false);

  // Pieces mid-animation, by id. They have already left `board`, so they are drawn
  // from here until their transition ends.
  const [flying, setFlying] = useState<Arrow[]>([]);
  const [bumping, setBumping] = useState<number | undefined>(undefined);
  const [hinted, setHinted] = useState<number | undefined>(undefined);

  // One entry per cleared arrow, for Undo. Misses are recorded too, so undoing a
  // move restores the score it would have produced.
  const [history, setHistory] = useState<Snapshot[]>([]);

  const sounds = useSounds(soundOn);

  // Guards the one-shot save; `showWin` alone would re-fire on every re-render.
  const savedRef = useRef(false);
  // Timers for in-flight animations, so a New game mid-flight cannot fire a stale
  // setState against a board that no longer exists.
  const timersRef = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current = [];
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    const timer = window.setTimeout(fn, ms);
    timersRef.current.push(timer);
  }, []);

  const newGame = useCallback(() => {
    clearTimers();
    setBoard(generatePuzzle(difficulty, Math.random).board);
    setMisses(0);
    setCleared(0);
    setHistory([]);
    setFlying([]);
    setBumping(undefined);
    setHinted(undefined);
    setSaveNote(undefined);
    setShowWin(false);
    savedRef.current = false;
  }, [clearTimers, difficulty]);

  // Deals the opening board on mount, and re-deals when the difficulty changes —
  // each difficulty is its own game, so switching starts a fresh puzzle.
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
       Seeding client-only random state on mount; a lazy initialiser would run during
       SSR and render different markup on the server than on the client. */
    newGame();
  }, [newGame]);

  useEffect(() => clearTimers, [clearTimers]);

  const onArrowClick = useCallback(
    (arrowId: number) => {
      if (!board) return;
      // Ignore a second click on a piece already on its way out.
      if (flying.some((entry) => entry.id === arrowId)) return;

      setHinted(undefined);

      if (isBlocked(board, arrowId)) {
        setMisses((value) => value + 1);
        setBumping(arrowId);
        sounds.bump();
        later(() => setBumping(undefined), SHAKE_MS);
        return;
      }

      const arrow = board.arrows.find((entry) => entry.id === arrowId);
      const result = clearArrow(board, arrowId);
      if (!result.cleared || !arrow) return;

      setHistory((entries) => [...entries, { board, misses }]);
      setBoard(result.board);
      setCleared((value) => value + 1);
      setFlying((entries) => [...entries, arrow]);
      sounds.clear();

      // Drop the piece once its slide has finished.
      later(() => setFlying((entries) => entries.filter((entry) => entry.id !== arrowId)), FLY_MS);

      if (isSolved(result.board)) {
        sounds.win();
        // Let the last arrow finish leaving before the overlay covers the board.
        later(() => setShowWin(true), FLY_MS + 120);
      }
    },
    [board, flying, later, misses, sounds],
  );

  const undo = useCallback(() => {
    setHistory((entries) => {
      const previous = entries[entries.length - 1];
      if (!previous) return entries;

      setBoard(previous.board);
      setMisses(previous.misses);
      setCleared((value) => Math.max(0, value - 1));
      setHinted(undefined);
      return entries.slice(0, -1);
    });
  }, []);

  const hint = useCallback(() => {
    if (!board) return;
    const options = unblockedArrows(board);
    if (options.length === 0) return;
    // Any unblocked arrow is a legal next move — see game-arrows.ts on why a board in
    // play always has one — so the hint picks at random rather than revealing the
    // generator's own solution order, which would walk the player through the puzzle.
    const pick = options[Math.floor(Math.random() * options.length)];
    setHinted(pick.id);
    later(() => setHinted(undefined), 1200);
  }, [board, later]);

  // Save once, when the board is empty. In an effect rather than in the click handler
  // because the final miss count is only known after React applies the state update.
  const finalScore = scoreBoard(cleared, misses);
  useEffect(() => {
    if (!showWin || savedRef.current) return;
    savedRef.current = true;

    void saveScoreAction(setup.gameKey, finalScore, cleared + misses).then((result) => {
      setSaveNote(
        result.ok
          ? result.best
            ? "New record — saved to the board."
            : "Score saved."
          : result.error,
      );
    });
  }, [showWin, finalScore, cleared, misses, setup.gameKey]);

  const remaining = board?.arrows.length ?? 0;
  const shownBest = Math.max(bestScore, showWin ? finalScore : 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <Stat label="Left" value={remaining.toLocaleString()} />
          <Stat label="Cleared" value={cleared.toLocaleString()} />
          <Stat label="Misses" value={misses.toLocaleString()} />
          <Stat label="Best" value={shownBest.toLocaleString()} />
        </div>

        {/* Controls wrap to their own row on a phone rather than squeezing. */}
        <div className="flex flex-wrap gap-2">
          <Button onClick={undo} variant="secondary" size="sm" disabled={history.length === 0}>
            Undo
          </Button>
          <Button onClick={hint} variant="secondary" size="sm" disabled={remaining === 0}>
            Hint
          </Button>
          <Button
            onClick={() => setSoundOn((value) => !value)}
            variant="secondary"
            size="sm"
            title={soundOn ? "Mute sound effects" : "Unmute sound effects"}
          >
            {soundOn ? "Sound on" : "Sound off"}
          </Button>
          <Button onClick={newGame} variant="secondary" size="sm">
            New board
          </Button>
        </div>
      </div>

      {/*
        The board is a square that scales with the viewport rather than reflowing:
        `min(32rem, 90vw)` keeps it inside a phone width and caps it on a desktop.
        Sizing the wrapper (not the cells) keeps the grid square at every width, so no
        `max-lg:` grid override is needed.
      */}
      <div className="mx-auto w-full" style={{ maxWidth: "min(32rem, 90vw)" }}>
        <div
          className="relative aspect-square rounded-xl border border-line bg-paper-raised p-2"
          role="group"
          aria-label={`Arrow Clearing board, ${setup.size} by ${setup.size}`}
        >
          {/*
            The grid area. `overflow-hidden` is what makes a fly-off read as leaving
            the board: the piece is clipped at this edge rather than sailing across the
            rest of the page.

            No `gap` here, deliberately. The pieces are positioned in percentages of
            this box, and a gap would make each cell's true offset differ from
            `index / size` by an accumulating fraction of the gap — so every piece
            would drift further out of alignment the further down the board it sat.
            Cells are separated by their own inner padding instead.
          */}
          <div className="relative h-full w-full overflow-hidden">
            <div
              className="grid h-full w-full"
              style={{
                gridTemplateColumns: `repeat(${setup.size}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${setup.size}, minmax(0, 1fr))`,
              }}
              aria-hidden="true"
            >
              {Array.from({ length: setup.size * setup.size }, (_, index) => (
                <div key={index} className="p-[3px]">
                  <div className="h-full w-full rounded bg-paper/60" />
                </div>
              ))}
            </div>

            {/* The pieces, laid over the grid. */}
            {board?.arrows.map((arrow) => (
              <ArrowPiece
                key={arrow.id}
                arrow={arrow}
                size={setup.size}
                state={bumping === arrow.id ? "blocked" : "idle"}
                isHinted={hinted === arrow.id}
                onClick={() => onArrowClick(arrow.id)}
              />
            ))}

            {/* Pieces that have left the board and are still sliding away. */}
            {flying.map((arrow) => (
              <ArrowPiece
                key={`flying-${arrow.id}`}
                arrow={arrow}
                size={setup.size}
                state="flying"
              />
            ))}
          </div>
        </div>
      </div>

      <div aria-live="polite" className="min-h-6 text-center text-sm">
        {remaining === 0 && !showWin && <span className="text-brass">Board clear.</span>}
        {saveNote && <span className="ml-2 text-muted">{saveNote}</span>}
      </div>

      <p className="text-center text-xs text-muted">
        Tap an arrow to send it off the board. It only moves if nothing stands between its
        head and the edge.
      </p>

      {showWin && (
        <Modal
          title="Board clear"
          description={`${setup.label} — solved with ${misses} wasted ${
            misses === 1 ? "click" : "clicks"
          }.`}
          onClose={() => setShowWin(false)}
          size="sm"
          footer={
            <>
              <Button onClick={() => setShowWin(false)} variant="secondary">
                Close
              </Button>
              <Button onClick={newGame}>New board</Button>
            </>
          }
        >
          <div className="flex flex-col items-center gap-2 py-2">
            <div className="font-display text-4xl tabular-nums text-brass">
              {finalScore.toLocaleString()}
            </div>
            <div className="text-xs uppercase tracking-wide text-muted">points</div>
            <p className="mt-2 text-center text-sm text-muted">
              {cleared} {cleared === 1 ? "arrow" : "arrows"} cleared.{" "}
              {misses === 0 ? "A perfect solve." : "A clean solve scores the full 100 per arrow."}
            </p>
            {saveNote && <p className="text-center text-xs text-muted">{saveNote}</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * One arrow, positioned over the grid in percentage units.
 *
 * Percentages rather than pixels so the piece tracks the board as it scales with the
 * viewport — no resize listener and no measured cell size.
 */
function ArrowPiece({
  arrow,
  size,
  state,
  isHinted = false,
  onClick,
}: {
  arrow: Arrow;
  size: number;
  state: "idle" | "flying" | "blocked";
  isHinted?: boolean;
  onClick?: () => void;
}) {
  // The bounding box of the piece. `cells` is head-first and always a straight run, so
  // the box is the min/max of its rows and columns.
  const rows = arrow.cells.map((cell) => cell.row);
  const cols = arrow.cells.map((cell) => cell.col);
  const top = Math.min(...rows);
  const left = Math.min(...cols);
  const height = Math.max(...rows) - top + 1;
  const width = Math.max(...cols) - left + 1;

  // Head at the leading edge: the flex direction puts cells[0] where it belongs.
  const flexDirection =
    arrow.direction === "up"
      ? "flex-col"
      : arrow.direction === "down"
        ? "flex-col-reverse"
        : arrow.direction === "left"
          ? "flex-row"
          : "flex-row-reverse";

  const cellPercent = 100 / size;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state === "flying"}
      aria-label={`${arrow.cells.length}-cell arrow pointing ${arrow.direction}`}
      className={`absolute flex items-stretch p-[3px] ${flexDirection} ${
        state === "flying" ? "pointer-events-none" : "cursor-pointer"
      } ${state === "blocked" ? "animate-arrow-bump" : ""}`}
      style={{
        // Straight percentages of the (gapless) grid box, so a piece lands exactly on
        // its cells at every board width without measuring anything.
        top: `${top * cellPercent}%`,
        left: `${left * cellPercent}%`,
        width: `${width * cellPercent}%`,
        height: `${height * cellPercent}%`,
        transform: state === "flying" ? flyTransform(arrow.direction) : undefined,
        // Only the fly-off animates. An idle piece has no transition, so a New game
        // that re-deals the board snaps into place rather than sliding every piece in
        // from wherever the previous board's arrow with that id happened to be.
        transitionProperty: state === "flying" ? "transform, opacity" : "none",
        transitionDuration: `${FLY_MS}ms`,
        transitionTimingFunction: "cubic-bezier(0.4, 0, 1, 1)",
        opacity: state === "flying" ? 0 : 1,
      }}
    >
      {/*
        One body per cell, the head marked with a glyph. Built from the `brass` token
        at two opacities rather than from literal colors, so the piece reads correctly
        in all eight themes including the light ones — the same reasoning as the 2048
        tile ramp.
      */}
      {arrow.cells.map((cell, index) => {
        const isHead = index === 0;
        return (
          <div
            key={`${cell.row},${cell.col}`}
            className={`flex flex-1 items-center justify-center ${
              isHead ? "bg-brass text-paper" : "bg-brass/35 text-brass-dark"
            } ${isHinted ? "ring-2 ring-inset ring-brass-dark" : ""} ${headRounding(
              arrow.direction,
              isHead,
              arrow.cells.length === 1,
            )}`}
          >
            {isHead && (
              <span
                className={`leading-none ${
                  size >= 9 ? "text-[0.7rem]" : size >= 7 ? "text-sm" : "text-base"
                }`}
                aria-hidden="true"
              >
                {HEAD_GLYPH[arrow.direction]}
              </span>
            )}
          </div>
        );
      })}
    </button>
  );
}

/**
 * Rounds the leading corners of the head and the trailing corners of the tail, so a
 * multi-cell arrow reads as one capsule pointing somewhere rather than a row of boxes.
 */
function headRounding(direction: Direction, isHead: boolean, isSingle: boolean): string {
  if (isSingle) return "rounded-md";

  const leading: Record<Direction, string> = {
    up: "rounded-t-md",
    down: "rounded-b-md",
    left: "rounded-l-md",
    right: "rounded-r-md",
  };
  const trailing: Record<Direction, string> = {
    up: "rounded-b-md",
    down: "rounded-t-md",
    left: "rounded-r-md",
    right: "rounded-l-md",
  };

  return isHead ? leading[direction] : trailing[direction];
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-paper-raised px-3 py-1.5 text-center">
      <div className="text-[0.65rem] uppercase tracking-wide text-muted">{label}</div>
      <div className="font-display text-lg tabular-nums text-ink">{value}</div>
    </div>
  );
}
