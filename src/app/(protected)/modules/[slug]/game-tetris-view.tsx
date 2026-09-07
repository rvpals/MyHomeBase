"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/button";
import { useGameSounds } from "@/components/use-game-sounds";
import {
  BUFFER_ROWS,
  PLAYFIELD_HEIGHT,
  PLAYFIELD_WIDTH,
  PREVIEW_COUNT,
  cellsOf,
  dropIntervalMs,
  ghostPiece,
  hardDrop,
  holdPiece,
  moveHorizontal,
  renderRows,
  rotate,
  softDrop,
  spawnPiece,
  startGame,
  tick,
  type LineClear,
  type PieceKind,
  type TetrisState,
} from "@/lib/games";
import { saveScoreAction } from "./games-actions";

// The Tetris board. A client component that owns only presentation state and the
// clock — every rule comes from @/lib/games (src/lib/games/game-tetris.ts), so
// nothing here decides what a move does.
//
// This is the arcade's first real-time game: 2048 and Arrow Clearing both advance
// only when the player acts. The clock lives here rather than in the library because
// a `setInterval` is a browser concern, but its *period* is not — `dropIntervalMs`
// owns the difficulty curve, and this file just obeys it.

const GAME_KEY = "tetris";

/**
 * How long a line clear is shown before the board settles, in milliseconds.
 *
 * Gravity is suspended for exactly this long, so it is a gameplay number as much as a
 * cosmetic one — long enough to register a four-row clear, short enough that a player
 * at level 12 does not feel the game pause on them. The CSS reads the same value
 * through the `--tetris-clear-ms` custom property, so the two cannot drift apart.
 */
const LINE_CLEAR_MS = 320;

/**
 * Piece fills, by kind.
 *
 * **The classic tetromino palette, as fixed literal colours** — cyan I, yellow O,
 * purple T, green S, red Z, blue J, orange L. This is the one place in the app where
 * a literal colour beats a theme token, for the reason `design.md` records under
 * *Exception — semantic red/green stays literal*: these seven colours are a
 * thirty-year-old convention, not a brand accent. A player reads "cyan means the long
 * bar" the way they read red as "down" on a stock, and recolouring the set per theme
 * would break that recognition to serve a palette nobody is looking at while a piece
 * is falling.
 *
 * Shades are 300–500 rather than 600–700 on the same reasoning design.md gives for
 * the semantic pair: the darker end reads as mud on the dark themes, which most of
 * them are. Borders go one step darker than the fill for the bevel the empty cells
 * and the 2048 tiles both have.
 *
 * (Superseded the previous seven-strengths-of-`brass` ramp, which followed the theme
 * but left S, Z, J and L nearly indistinguishable at low opacity.)
 */
const PIECE_STYLES: Record<PieceKind, string> = {
  I: "bg-cyan-400 border-cyan-600",
  O: "bg-yellow-300 border-yellow-500",
  T: "bg-purple-400 border-purple-600",
  S: "bg-emerald-400 border-emerald-600",
  Z: "bg-red-400 border-red-600",
  J: "bg-blue-400 border-blue-600",
  L: "bg-orange-400 border-orange-600",
};

/** The empty-cell treatment, matching 2048's board so the arcade reads as one app. */
const EMPTY_STYLE = "bg-paper border-line";

/* ---------------------------------------------------------------------------------
   Sound. Synthesized rather than loaded, so the game ships no audio files.
--------------------------------------------------------------------------------- */

/**
 * Tetris's cue vocabulary, over the arcade's shared beeper.
 *
 * `useGameSounds` owns the audio context and the envelope; what lives here is only
 * *what a Tetris event sounds like*, which is the part no other game can share.
 */
function useSounds(enabled: boolean) {
  const sounds = useGameSounds(enabled);

  return useMemo(
    () => ({
      /*
        Every cue here is filtered and none uses `square` or `sawtooth`.

        The first pass did use them, and it sounded metallic and noisy — for four
        reasons worth recording, because they are easy to reintroduce:

          1. `square`/`sawtooth` carry harmonics all the way up. At low volume through
             laptop speakers that upper content is most of what you hear, and it reads
             as electronic harshness rather than as a pitch.
          2. A 40ms cue is too short to *be* a note. You hear the attack transient
             instead, which is broadband — i.e. noise.
          3. Nothing rolled off the top, so every harmonic arrived intact.
          4. A 10ms attack is itself a click, whatever waveform is underneath it.

        So: sine and triangle only, cutoffs low enough to leave the fundamental and a
        couple of harmonics, lengths roughly doubled, and softer attacks. Still short
        enough not to drone when a key is held.
      */
      /** A soft, woody tick as the piece steps sideways. */
      move: () =>
        sounds.play({
          startHz: 200,
          endHz: 185,
          durationMs: 70,
          type: "sine",
          peak: 0.03,
          cutoffHz: 700,
          attackMs: 16,
        }),
      /** A rotation: same character, pitched up so the two stay distinguishable. */
      turn: () =>
        sounds.play({
          startHz: 330,
          endHz: 300,
          durationMs: 80,
          type: "triangle",
          peak: 0.032,
          cutoffHz: 1100,
          attackMs: 16,
        }),
      /** A piece coming to rest: a low, rounded thud. */
      lock: () =>
        sounds.play({
          startHz: 150,
          endHz: 95,
          durationMs: 150,
          type: "sine",
          peak: 0.055,
          cutoffHz: 600,
          attackMs: 14,
        }),
      /**
       * A hard drop.
       *
       * Was `sawtooth` — the single harshest cue in the game, and the one that fires
       * hardest. A filtered triangle keeps the weight and drops the buzz.
       */
      slam: () =>
        sounds.play({
          startHz: 190,
          endHz: 55,
          durationMs: 220,
          type: "triangle",
          peak: 0.07,
          cutoffHz: 900,
          attackMs: 12,
        }),
      /** Swapping into the hold slot: a short two-note flick. */
      hold: () =>
        sounds.playSequence([
          { startHz: 460, endHz: 460, durationMs: 90, type: "sine", peak: 0.04, cutoffHz: 1600, attackMs: 14 },
          {
            startHz: 620,
            endHz: 620,
            durationMs: 110,
            type: "sine",
            peak: 0.04,
            cutoffHz: 1800,
            attackMs: 14,
            afterMs: 70,
          },
        ]),
      /**
       * A cleared line: bells.
       *
       * Notes from a pentatonic scale (C–D–E–G–A), which has no semitone clashes — so
       * however many ring together, and however much they overlap as they decay, the
       * result stays consonant. A regular major scale would put a second next to a third
       * and sour the four-row peal, which is the one that most needs to sound like a
       * reward.
       *
       * The peal grows with the clear: one row is a single struck bell, four rows are
       * four rising ones with the last held longest. Brightness rises with the run too,
       * so the top of a tetris sparkles rather than merely being higher.
       */
      clear: (rows: number) => {
        const notes = [523.25, 587.33, 659.25, 783.99, 880.0];
        const count = Math.min(Math.max(rows, 1), 4);
        // A bigger clear starts higher up the scale as well as ringing more bells, so
        // a tetris opens brighter than a single instead of merely lasting longer.
        const from = count - 1;

        for (let index = 0; index < count; index += 1) {
          const last = index === count - 1;
          sounds.playBell({
            hz: notes[Math.min(from + index, notes.length - 1)],
            // The final bell rings on after the others have faded — that tail is what
            // makes a peal feel finished rather than cut off.
            durationMs: last ? 1100 : 620,
            peak: last ? 0.085 : 0.06,
            brightness: 0.4 + index * 0.12,
            afterMs: index * 110,
          });
        }
      },
      /** Two rising notes on reaching a new level. */
      levelUp: () =>
        sounds.playSequence([
          { startHz: 620, endHz: 620, durationMs: 130, type: "sine", peak: 0.06, cutoffHz: 2000, attackMs: 14 },
          {
            startHz: 930,
            endHz: 930,
            durationMs: 260,
            type: "sine",
            peak: 0.06,
            cutoffHz: 2600,
            attackMs: 14,
            afterMs: 120,
          },
        ]),
      /**
       * A top-out.
       *
       * The one place a little grit still earns its keep, but heavily filtered — a bare
       * sawtooth here was closer to a fault buzzer than to a game over.
       */
      gameOver: () =>
        sounds.play({
          startHz: 320,
          endHz: 55,
          durationMs: 800,
          type: "triangle",
          peak: 0.08,
          cutoffHz: 700,
          attackMs: 25,
        }),
    }),
    [sounds],
  );
}

export function GameTetrisView({ bestScore }: { bestScore: number }) {
  // Lazily initialised, and only ever on the client.
  //
  // The opening pieces are random, so building them during SSR would render different
  // markup on the server than on the client and trip a hydration mismatch. The state
  // therefore starts `undefined` — which renders as an empty board, identical on both
  // sides — and is seeded by the mount effect below. Same trade as `Game2048View`.
  const [state, setState] = useState<TetrisState | undefined>(undefined);
  const [paused, setPaused] = useState(false);
  const [saveNote, setSaveNote] = useState<string | undefined>(undefined);
  const [soundOn, setSoundOn] = useState(true);

  const sounds = useSounds(soundOn);

  // Guards the one-shot save: `outcome` alone would re-fire on every re-render after
  // the game ends, posting the same score repeatedly.
  const savedRef = useRef(false);

  const newGame = useCallback(() => {
    setState(startGame(Math.random));
    setPaused(false);
    setSaveNote(undefined);
    savedRef.current = false;
  }, []);

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
       Seeding client-only random state on mount; a lazy initialiser would run during
       SSR and render different markup on the server than the client. */
    newGame();
  }, [newGame]);

  const over = state?.outcome !== undefined;

  /**
   * The clear currently being animated, or `undefined`.
   *
   * Mirrored into local state rather than read straight off `state.lastClear`, because
   * the two have different lifetimes: `lastClear` persists until the next lock, but the
   * animation must end after `LINE_CLEAR_MS` regardless. Holding it separately is also
   * what lets the board keep drawing the *pre-clear* rows while the animation runs.
   */
  const [clearing, setClearing] = useState<LineClear | undefined>(undefined);

  // Starts the animation whenever a lock reports a clear. Keyed on `lastClear.id` —
  // the piece count at the lock — so two identical clears in a row still re-fire.
  const clearId = state?.lastClear?.id;
  useEffect(() => {
    const clear = state?.lastClear;
    if (!clear) return;

    /* eslint-disable-next-line react-hooks/set-state-in-effect --
       Starting a timed animation in response to a state change is exactly what an
       effect is for; there is no render-time equivalent. */
    setClearing(clear);
    // The cue rides the same effect as the animation, so the two are always in step —
    // and it is keyed on `clearId` for the same reason, so a repeated clear re-fires.
    sounds.clear(clear.rows.length);
    const timer = window.setTimeout(() => setClearing(undefined), LINE_CLEAR_MS);
    return () => window.clearTimeout(timer);
    // `clearId` only: depending on the object would restart the timer on every
    // unrelated state change and the animation would never finish.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearId]);

  /**
   * Gravity.
   *
   * Re-created whenever the level changes, which is what makes the game speed up: the
   * interval's period is read from `dropIntervalMs` at that moment. Cleared while
   * paused or after a top-out so a finished board does not keep ticking.
   *
   * Also suspended while a clear is animating. Without that the next piece starts
   * falling over the top of the animation, which both looks wrong and means a fast
   * level never shows the effect at all — the freeze is short enough (`LINE_CLEAR_MS`)
   * that it reads as the game acknowledging the clear rather than as a stall.
   */
  useEffect(() => {
    if (!state || over || paused || clearing) return;

    const id = setInterval(() => {
      setState((current) => (current ? tick(current, Math.random) : current));
    }, dropIntervalMs(state.level));

    return () => clearInterval(id);
    // `state.level` only: re-subscribing on every state change would restart the
    // interval on each keypress, letting a player postpone gravity indefinitely by
    // holding a key down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.level, over, paused, clearing, state === undefined]);

  /**
   * The cues that belong to events rather than to keypresses.
   *
   * A lock, a level change and a top-out are all things the *game* does — gravity can
   * cause any of them with no input at all — so they are detected by comparing against
   * the previous state rather than fired from a control handler. `pieces` increments on
   * every lock, which makes it the one counter that catches a piece coming to rest
   * however it got there.
   *
   * A lock that completed a line stays silent: `clear` fires for that same transition
   * and the thud only muddies it.
   */
  const previousRef = useRef<{ pieces: number; level: number; over: boolean } | undefined>(
    undefined,
  );

  /*
    A hard drop locks the piece in the same transition, so `pieces` increments and the
    lock cue would land on top of the slam. The slam is the heavier, more specific sound
    of the two, so it wins and swallows the thud that follows it. Set by `slam` below,
    consumed by the effect here.
  */
  const slamLockRef = useRef(false);
  useEffect(() => {
    if (!state) {
      previousRef.current = undefined;
      return;
    }

    const previous = previousRef.current;
    previousRef.current = { pieces: state.pieces, level: state.level, over };

    // First observation of a new game: nothing to compare against, and a cue here would
    // fire on mount before the player has touched anything.
    if (!previous) return;

    if (over && !previous.over) {
      sounds.gameOver();
      return;
    }
    const locked = state.pieces > previous.pieces;
    const slammed = slamLockRef.current;
    if (locked) slamLockRef.current = false;
    if (locked && !slammed && !state.lastClear) sounds.lock();
    if (state.level > previous.level) sounds.levelUp();
  }, [state, over, sounds]);

  // Save once, when the game ends. In an effect rather than inside the tick because
  // the final score is only known after React has applied the state update.
  useEffect(() => {
    if (!state || !over || savedRef.current) return;
    savedRef.current = true;

    void saveScoreAction(GAME_KEY, state.score, state.pieces).then((result) => {
      if (!result.ok) {
        setSaveNote(result.error);
        return;
      }
      setSaveNote(result.best ? "New record — saved to the board." : "Score saved.");
    });
  }, [over, state]);

  /**
   * Applies one pure rule to the current state. Every control goes through here.
   *
   * `onApplied` fires only when the rule actually changed something. Every refusing
   * rule in `game-tetris.ts` — a move into a wall, a rotation with no kick that fits, a
   * second hold — returns the *same object* it was handed, so referential inequality is
   * an exact test for "the move happened". That is what keeps a piece pressed against
   * the left wall silent instead of ticking ten times a second.
   *
   * The cue is fired from inside the updater, which React may invoke twice under Strict
   * Mode. Playing a 40ms click twice is inaudible, and the alternative — threading the
   * result back out through an effect — would cost a render per keypress on the one
   * screen in the app with a 60fps budget.
   */
  const apply = useCallback(
    (
      rule: (current: TetrisState, random: () => number) => TetrisState,
      onApplied?: () => void,
    ) => {
      setState((current) => {
        if (!current || current.outcome) return current;
        const next = rule(current, Math.random);
        if (next !== current) onApplied?.();
        return next;
      });
    },
    [],
  );

  const moveLeft = useCallback(
    () => apply((s) => moveHorizontal(s, -1), sounds.move),
    [apply, sounds],
  );
  const moveRight = useCallback(
    () => apply((s) => moveHorizontal(s, 1), sounds.move),
    [apply, sounds],
  );
  const rotateCw = useCallback(() => apply((s) => rotate(s, 1), sounds.turn), [apply, sounds]);
  const rotateCcw = useCallback(() => apply((s) => rotate(s, -1), sounds.turn), [apply, sounds]);
  // Soft drop is silent by design: gravity moves the piece down anyway, so a cue here
  // would fire on a held Down key at the drop rate and drown out everything else. The
  // lock thud at the end of the fall is the feedback.
  const drop = useCallback(() => apply(softDrop), [apply]);
  const slam = useCallback(
    () =>
      apply(hardDrop, () => {
        slamLockRef.current = true;
        sounds.slam();
      }),
    [apply, sounds],
  );
  const hold = useCallback(() => apply(holdPiece, sounds.hold), [apply, sounds]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Space and the arrows both scroll the page; every key handled here is
      // prevented, and anything else is left to the browser.
      const handled: Record<string, () => void> = {
        ArrowLeft: moveLeft,
        a: moveLeft,
        ArrowRight: moveRight,
        d: moveRight,
        ArrowDown: drop,
        s: drop,
        ArrowUp: rotateCw,
        w: rotateCw,
        x: rotateCw,
        z: rotateCcw,
        " ": slam,
        c: hold,
        Shift: hold,
      };

      // Pause is the one control that must work while paused, so it sits outside the
      // table above — which is gated on the game running.
      if (event.key === "p" || event.key === "P") {
        event.preventDefault();
        setPaused((value) => !value);
        return;
      }

      const action = handled[event.key];
      if (!action || paused) return;
      event.preventDefault();
      action();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moveLeft, moveRight, drop, rotateCw, rotateCcw, slam, hold, paused]);

  // While a clear is animating the board shows the board as it was WITH the completed
  // rows on it, so there is something to destroy; the settled board takes over when
  // the timer above clears `clearing`. Also suppresses the ghost outline and the
  // active piece for those frames — both belong to the next piece, and drawing them
  // over a clear makes the animation look like a rendering glitch.
  const rows = clearing
    ? visibleRows(clearing.field)
    : state
      ? renderRows(state)
      : undefined;
  const ghost = state && !clearing ? ghostCells(state) : undefined;
  const clearingRows = clearing
    ? new Set(clearing.rows.map((row) => row - BUFFER_ROWS))
    : undefined;
  const isQuad = clearing?.rows.length === 4;
  const shownBest = Math.max(bestScore, state?.score ?? 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <Stat label="Score" value={(state?.score ?? 0).toLocaleString()} />
          <Stat label="Best" value={shownBest.toLocaleString()} />
          <Stat label="Lines" value={(state?.lines ?? 0).toLocaleString()} />
          <Stat label="Level" value={(state?.level ?? 1).toLocaleString()} />
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setPaused((value) => !value)} variant="secondary" size="sm" disabled={over}>
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button onClick={newGame} variant="secondary" size="sm">
            New game
          </Button>
          {/* Worded exactly as Arrow Clearing's, so the arcade's two noisy games
              present the same control. */}
          <Button
            onClick={() => setSoundOn((value) => !value)}
            variant="secondary"
            size="sm"
            title={soundOn ? "Mute sound effects" : "Unmute sound effects"}
          >
            {soundOn ? "Sound on" : "Sound off"}
          </Button>
        </div>
      </div>

      {/*
        Board and side panel. Side by side on a desktop; on a phone the panel drops
        above the board as a single row, since a 10-wide board plus a column beside it
        leaves neither enough width.
      */}
      <div className="flex items-start justify-center gap-4 max-lg:flex-col max-lg:items-center">
        <aside className="flex flex-col gap-3 max-lg:w-full max-lg:flex-row max-lg:justify-center">
          <MiniBoard label="Hold" kind={state?.hold} />
          <div className="flex flex-col gap-3 max-lg:flex-row">
            {(state?.queue ?? []).slice(0, PREVIEW_COUNT).map((kind, index) => (
              <MiniBoard key={index} label={index === 0 ? "Next" : ""} kind={kind} />
            ))}
          </div>
        </aside>

        {/*
          The board is a 10x20 grid that scales with the viewport rather than
          reflowing. Sizing the wrapper (not the cells) keeps the aspect ratio at
          every width.

          Three terms, because the game plays full-bleed and each binds on a different
          screen: `18rem` caps it on a large monitor, `78vw` keeps it inside a phone,
          and `52vh` is the one that matters in the dialog — a tall board capped only
          by width overflows a short landscape window and pushes the controls
          off-screen. The board is half as wide as it is tall, so the `vh` term is
          halved to convert a height budget into a width.
        */}
        <div className="w-full" style={{ maxWidth: "min(18rem, 78vw, 26vh)" }}>
          <div
            // `relative` so the sweep bars can be absolutely positioned over the rows
            // they belong to. A four-row clear also flashes the whole board's edge.
            className={`relative grid gap-px rounded-xl border border-line bg-paper-raised p-2 ${
              isQuad ? "animate-tetris-quad" : ""
            }`}
            style={{
              gridTemplateColumns: `repeat(${PLAYFIELD_WIDTH}, minmax(0, 1fr))`,
              aspectRatio: "1 / 2",
              // One source of truth for the duration: the CSS keyframes read this
              // rather than hardcoding a second copy of LINE_CLEAR_MS.
              ["--tetris-clear-ms" as string]: `${LINE_CLEAR_MS}ms`,
            }}
            role="grid"
            aria-label="Tetris board"
          >
            {(rows ?? emptyRows()).map((row, rowIndex) =>
              row.map((cell, colIndex) => {
                const isGhost = !cell && ghost?.has(`${rowIndex},${colIndex}`);
                const isClearing = clearingRows?.has(rowIndex) ?? false;

                return (
                  <div
                    // Index as key is correct here and only here: a cell is a fixed
                    // position on the board, not a block that travels between them.
                    key={`${rowIndex},${colIndex}`}
                    role="gridcell"
                    aria-label={cell ?? "empty"}
                    className={`rounded-[2px] border ${
                      isClearing
                        ? `${cell ? PIECE_STYLES[cell] : EMPTY_STYLE} animate-tetris-cell`
                        : cell
                          ? PIECE_STYLES[cell]
                          : isGhost
                            ? "border-brass/40 bg-transparent"
                            : EMPTY_STYLE
                    }`}
                    style={
                      isClearing
                        ? {
                            // Stagger outward from the middle of the row, so the clear
                            // travels rather than blinking out in lockstep. Scaled to
                            // finish well inside the animation's own duration.
                            ["--tetris-cell-delay" as string]: `${
                              Math.abs(colIndex - (PLAYFIELD_WIDTH - 1) / 2) * 18
                            }ms`,
                          }
                        : undefined
                    }
                  />
                );
              }),
            )}

            {/*
              The light bar that sweeps each clearing row. Positioned in percentages of
              the board rather than added to the grid, so it can span the full width
              without disturbing the ten-column layout underneath it.

              `pointer-events-none` because it sits over the board while the touch pad
              is live; without it a tap landing during a clear would hit the overlay.
            */}
            {clearing?.rows.map((row) => {
              const visibleRow = row - BUFFER_ROWS;
              if (visibleRow < 0) return null;

              // Inset by the board's own padding (`p-2` = 0.5rem) so the bar spans the
              // playfield rather than the border, and positioned against the padded
              // box rather than the element — otherwise every row sits slightly high.
              const band = {
                top: `calc(0.5rem + ${visibleRow} * ((100% - 1rem) / ${PLAYFIELD_HEIGHT}))`,
                height: `calc((100% - 1rem) / ${PLAYFIELD_HEIGHT})`,
              };

              // Two absolutely-positioned siblings rather than a wrapper: a wrapping
              // element would be a GRID ITEM, taking a cell in the ten-column layout
              // and pushing the last row along. `absolute` takes these out of the flow
              // entirely, so the grid underneath is untouched.
              return [
                /* The row's own glow, collapsing as it goes. */
                <span
                  key={`glow-${row}`}
                  aria-hidden
                  className="animate-tetris-line pointer-events-none absolute left-2 right-2 bg-brass/70"
                  style={band}
                />,
                /* The bar of light travelling across it. */
                <span
                  key={`sweep-${row}`}
                  aria-hidden
                  className="animate-tetris-sweep pointer-events-none absolute left-2 right-2 bg-gradient-to-r from-transparent via-ink to-transparent"
                  style={band}
                />,
              ];
            })}
          </div>
        </div>
      </div>

      {/*
        The touch pad. `max-lg:` only, so it is absent on a desktop where the keyboard
        is the input and the buttons would be clutter — and the desktop classes are
        provably untouched.
      */}
      <div className="hidden max-lg:flex max-lg:flex-col max-lg:gap-2">
        <div className="flex justify-center gap-2">
          <PadButton label="←" onPress={moveLeft} name="Move left" />
          <PadButton label="↓" onPress={drop} name="Soft drop" />
          <PadButton label="→" onPress={moveRight} name="Move right" />
        </div>
        <div className="flex justify-center gap-2">
          <PadButton label="⟲" onPress={rotateCcw} name="Rotate left" />
          <PadButton label="⟳" onPress={rotateCw} name="Rotate right" />
          <PadButton label="⤓" onPress={slam} name="Hard drop" />
          <PadButton label="Hold" onPress={hold} name="Hold piece" />
        </div>
      </div>

      <div aria-live="polite" className="min-h-6 text-center text-sm">
        {over && <span className="text-ink">Topped out — game over.</span>}
        {!over && paused && <span className="text-muted">Paused.</span>}
        {saveNote && <span className="ml-2 text-muted">{saveNote}</span>}
      </div>

      {/*
        A plain bordered div, NOT a Modal. Two Modals nested both register their
        Escape handler on `document` in the capture phase, so the outer one wins and
        Escape would close the whole game instead of this panel — and the two focus
        traps would fight over one tree. modules.md records this.
      */}
      {over && (
        <div className="mx-auto max-w-sm rounded-xl border border-line bg-paper-raised p-4 text-center">
          <h3 className="font-display text-base text-ink">Game over</h3>
          <p className="mt-1 text-sm text-muted">
            {(state?.lines ?? 0).toLocaleString()} lines cleared over{" "}
            {(state?.pieces ?? 0).toLocaleString()} pieces, reaching level{" "}
            {(state?.level ?? 1).toLocaleString()}.
          </p>
          <Button onClick={newGame} size="sm" className="mt-3">
            Play again
          </Button>
        </div>
      )}

      <p className="text-center text-xs text-muted max-lg:hidden">
        Arrows or WASD to move and rotate; Space to hard-drop, C to hold, P to pause.
      </p>
    </div>
  );
}

/** The cells the active piece would land on, as a lookup for the ghost outline. */
function ghostCells(state: TetrisState): Set<string> {
  const landed = ghostPiece(state.field, state.active);
  const active = new Set(cellsOf(state.active).map((cell) => `${cell.row},${cell.col}`));

  const cells = new Set<string>();
  for (const cell of cellsOf(landed)) {
    // Skip cells the piece already occupies, so the outline does not draw over it.
    if (active.has(`${cell.row},${cell.col}`)) continue;
    // Board coordinates are offset by the hidden buffer rows, which `renderRows` drops.
    cells.add(`${cell.row - BUFFER_ROWS},${cell.col}`);
  }
  return cells;
}

/**
 * A raw field split into the visible rows, dropping the hidden spawn buffer.
 *
 * `renderRows` does this for a live state, but a clear animates the *pre-clear* field
 * — a bare `Playfield` with no active piece to merge in, since the piece that
 * completed the row is already part of it.
 */
function visibleRows(field: readonly (PieceKind | undefined)[]): (PieceKind | undefined)[][] {
  const rows: (PieceKind | undefined)[][] = [];
  for (let row = BUFFER_ROWS; row < BUFFER_ROWS + PLAYFIELD_HEIGHT; row += 1) {
    rows.push([...field.slice(row * PLAYFIELD_WIDTH, row * PLAYFIELD_WIDTH + PLAYFIELD_WIDTH)]);
  }
  return rows;
}

/** An empty board for the pre-mount render, matching what the server produced. */
function emptyRows(): (PieceKind | undefined)[][] {
  return Array.from({ length: PLAYFIELD_HEIGHT }, () =>
    new Array<PieceKind | undefined>(PLAYFIELD_WIDTH).fill(undefined),
  );
}

/** The hold slot and the next-piece previews: one small 4x4 board each. */
function MiniBoard({ label, kind }: { label: string; kind: PieceKind | undefined }) {
  const cells = new Set<string>();
  if (kind) {
    // Drawn at spawn orientation in its own 4x4 box, normalised to the top-left so a
    // piece does not sit off-centre in the preview.
    const piece = { ...spawnPiece(kind), row: 0, col: 0 };
    const occupied = cellsOf(piece);
    const minRow = Math.min(...occupied.map((cell) => cell.row));
    const minCol = Math.min(...occupied.map((cell) => cell.col));
    for (const cell of occupied) cells.add(`${cell.row - minRow},${cell.col - minCol}`);
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[0.65rem] uppercase tracking-wide text-muted">{label || " "}</span>
      <div
        className="grid gap-px rounded-lg border border-line bg-paper-raised p-1"
        style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", width: "4rem" }}
        aria-label={kind ? `${label || "Next"}: ${kind} piece` : `${label || "Next"}: empty`}
      >
        {Array.from({ length: 16 }, (_, index) => {
          const key = `${Math.floor(index / 4)},${index % 4}`;
          const filled = cells.has(key);
          return (
            <div
              key={index}
              className={`aspect-square rounded-[2px] border ${
                filled && kind ? PIECE_STYLES[kind] : "border-transparent bg-transparent"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * One touch control.
 *
 * `onPointerDown` rather than `onClick`, with the default prevented: a click fires
 * only on release, which makes a control pad feel a beat behind the board, and the
 * default would also focus the button and let a subsequent Space keypress re-trigger
 * it instead of hard-dropping.
 */
function PadButton({ label, onPress, name }: { label: string; onPress: () => void; name: string }) {
  return (
    <button
      type="button"
      aria-label={name}
      onPointerDown={(event) => {
        event.preventDefault();
        onPress();
      }}
      className="min-w-14 rounded-lg border border-line bg-paper-raised px-3 py-3 font-display text-lg text-ink active:bg-brass/20"
    >
      {label}
    </button>
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
