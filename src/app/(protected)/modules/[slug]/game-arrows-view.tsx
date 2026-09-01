"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/button";
import {
  ARROW_DIFFICULTY_SETUP,
  ARROW_LIVES,
  clearArrow,
  generatePuzzle,
  isBlocked,
  isSolved,
  pathAhead,
  scoreBoard,
  unblockedArrows,
  type Arrow,
  type ArrowBoard,
  type ArrowDifficulty,
  type Cell,
} from "@/lib/games";
import { saveScoreAction } from "./games-actions";

// The Arrow Clearing board. A client component that owns only presentation state —
// every rule (what blocks what, how a board is generated, what a solve scores) comes
// from @/lib/games (src/lib/games/game-arrows.ts), so nothing here decides the game.
//
// Drawn as SVG rather than a grid of divs. An arrow is a winding path of up to eight
// cells, and a run of bordered divs cannot render a corner: the join between two cells
// heading different ways needs a mitred stroke, which `stroke-linejoin` gives for free.
// It also makes the clearing animation honest — the piece leaves along its own route by
// animating `stroke-dashoffset`, so a long path visibly snakes out head first rather
// than sliding bodily sideways as a block.

/**
 * How long a clearing arrow takes to slide off the board, in ms.
 *
 * Slow enough to read. At 420ms a piece crossing a 50-cell board was moving faster than
 * the eye tracks, so the clear registered as a blink rather than as travel.
 */
const CLEAR_MS = 700;

/** How long the blocked shake and its red route flash last, in ms. */
const BLOCKED_MS = 420;

/**
 * How long a legal route flashes before the piece starts moving, in ms.
 *
 * Deliberately brief, and the flash is faded out over it rather than held. Held for the
 * whole clear at 3x the arrow's stroke width, it simply covered the piece: the visible
 * event was a green blip where the arrow used to be, with the actual slide lost
 * underneath it.
 */
const ROUTE_FLASH_MS = 110;

/** SVG user units per board cell. Arbitrary — the viewBox scales to fit. */
const CELL = 10;

/**
 * Stroke width of an arrow path, in the same units.
 *
 * Deliberately thin — 16% of a cell, not the 52% this first shipped at. A thick bar
 * fills its cell, so neighbouring pieces touch and the board reads as a mass of blocks
 * with no visible gaps; the whole point of drawing these as lines is that a maze of thin
 * routes is legible at a glance. Keep it well under a third of `CELL`.
 */
const STROKE = 1.5;

/**
 * Stroke width of the optional cell lattice, in board units.
 *
 * Read in **board units, not pixels** — the trap that made this invisible twice. The
 * viewBox is `size * CELL` units (500 at 50x50) scaled into roughly 600 CSS pixels, so a
 * unit is about 1.2px and the original `0.12` landed near a seventh of a pixel. At 0.5 it
 * is a visible hairline that still sits well under the arrows' own weight.
 */
const GRID_STROKE = 0.5;

/** Zoom steps, as a multiple of "whole board visible". 1 is fit-to-board. */
const ZOOM_LEVELS = [1, 1.5, 2, 3, 4, 6] as const;

/**
 * How far a pointer may travel, in screen pixels, and still count as a tap.
 *
 * Above this the gesture is a pan and the arrow under the finger is left alone. No real
 * tap is perfectly still — particularly on a touchscreen — so a threshold of zero would
 * make the board unclearable, and one too large would let a short drag clear an arrow.
 */
const DRAG_SLOP = 6;

/** Unit step per direction, in grid coordinates. */
const DELTA = {
  up: { row: -1, col: 0 },
  down: { row: 1, col: 0 },
  left: { row: 0, col: -1 },
  right: { row: 0, col: 1 },
} as const;

/**
 * Half-size of the arrowhead chevron, in user units.
 *
 * Scaled to the cell rather than to the stroke — deriving it from the stroke width is
 * what made it invisible when the line was first thinned. Kept modest so that on a 20x20
 * board, where a cell is a small fraction of the screen, the chevrons read as direction
 * marks along the routes instead of merging into blobs.
 */
const HEAD = 2.4;

/** Rotation of the arrowhead glyph per direction, in degrees. */
const HEAD_ANGLE = { up: -90, down: 90, left: 180, right: 0 } as const;

/** Centre point of a cell, in SVG user units. */
function centre(cell: Cell): { x: number; y: number } {
  return { x: cell.col * CELL + CELL / 2, y: cell.row * CELL + CELL / 2 };
}

/** Cells as an SVG polyline `points` string. */
function pointsOf(cells: readonly Cell[]): string {
  return cells.map((cell) => `${centre(cell).x},${centre(cell).y}`).join(" ");
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
 * board may see hundreds of taps.
 */
function useSounds(enabled: boolean) {
  const contextRef = useRef<AudioContext | null>(null);

  const context = useCallback((): AudioContext | undefined => {
    if (!enabled) return undefined;
    if (!contextRef.current) {
      const Ctor =
        window.AudioContext ??
        (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(1, endHz),
        now + durationMs / 1000,
      );

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
      /** A rising whoosh as the piece snakes away. */
      clear: () => tone(360, 1020, 420, "triangle"),
      /** A short low thud for a piece that could not move. */
      bump: () => tone(180, 90, 150, "square"),
      /** A heavier descending tone when that thud also cost the last life. */
      gameOver: () => tone(300, 70, 620, "sawtooth"),
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
   The clearing animation.
--------------------------------------------------------------------------------- */

/**
 * The points of a clearing arrow, part-way through leaving the board.
 *
 * The piece does not translate rigidly — it **straightens as it goes**, like a tadpole
 * being drawn out of its bend: the head runs down its exit lane and each tail cell
 * follows the route the head took, so a U-shaped arrow ends up a straight line before it
 * finally slips off the edge. A rigid transform (the previous behaviour) slid the whole
 * bent shape sideways, which reads as the board's furniture being dragged rather than an
 * arrow escaping.
 *
 * The model is a fixed-length chain on a track. The track is the arrow's own cells
 * (head first) with the exit lane appended in front of them, so index 0 is the far end of
 * the lane and the tail is at the back. Advancing `progress` slides every cell of the
 * chain forward along that one track, which is exactly a snake moving through its own
 * body.
 *
 * `progress` is in cells, and may be fractional — the position between two track cells is
 * interpolated, so the motion is smooth rather than stepping cell to cell.
 */
function straightenedPoints(arrow: Arrow, size: number, progress: number): string {
  const delta = DELTA[arrow.direction];
  const head = arrow.cells[0];

  // The lane ahead of the head, plus enough beyond the edge for the whole tail to
  // follow the head off the board.
  const laneLength = pathAhead(arrow, size).length + 1 + arrow.cells.length;
  const lane: Cell[] = [];
  for (let index = laneLength; index >= 1; index -= 1) {
    lane.push({ row: head.row + delta.row * index, col: head.col + delta.col * index });
  }

  // One continuous track: lane (far end first) then the arrow, head at the join.
  const track = [...lane, ...arrow.cells];
  const headIndex = lane.length;

  const points: string[] = [];
  for (let offset = 0; offset < arrow.cells.length; offset += 1) {
    // Where this cell of the chain sits now: its own resting place, moved forward along
    // the track by `progress`.
    const at = headIndex + offset - progress;
    const low = Math.floor(at);
    const fraction = at - low;

    // Clamped rather than extrapolated: a cell that has run past the end of the track has
    // left the board, and pinning it to the final point keeps the line continuous while
    // the rest of the tail catches up.
    const first = track[Math.max(0, Math.min(track.length - 1, low))];
    const second = track[Math.max(0, Math.min(track.length - 1, low + 1))];

    const a = centre(first);
    const b = centre(second);
    points.push(`${a.x + (b.x - a.x) * fraction},${a.y + (b.y - a.y) * fraction}`);
  }

  return points.join(" ");
}

/**
 * Drives a clearing arrow's straighten-and-leave animation, returning the polyline
 * points for the current frame.
 *
 * requestAnimationFrame rather than CSS, because the shape changes: CSS can transition a
 * transform or an opacity, but it cannot interpolate a `points` attribute from one
 * geometry to another. The previous CSS-keyframe version is why the piece could only move
 * rigidly.
 *
 * Returns `undefined` while idle, so a resting arrow costs nothing — no frame loop, and
 * the static `points` are used instead.
 */
function useClearingPoints(
  arrow: Arrow,
  size: number,
  isClearing: boolean,
  durationMs: number,
  delayMs: number,
): string | undefined {
  const [points, setPoints] = useState<string | undefined>(undefined);

  useEffect(() => {
    // No reset branch here: the idle case is handled by ignoring `points` below rather
    // than by clearing it in an effect. Writing state in an effect just to undo it is
    // both a lint error and a wasted render.
    if (!isClearing) return;

    // The chain has to travel its own length plus the lane, so that the *tail* clears the
    // edge rather than the head.
    const distance = pathAhead(arrow, size).length + 1 + arrow.cells.length;

    /*
      Reduced motion: jump straight to gone rather than animating the travel.

      Handled here rather than in a `@media (prefers-reduced-motion)` CSS rule, because
      the motion is now driven by JS — the media query has nothing to attach to. The
      piece still disappears, and the route flash (which is CSS, and brief) still fires,
      so the move is confirmed without a shape crossing the viewport.
    */
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect --
         The reduced-motion path is a one-shot jump to the final geometry, and it depends
         on `window.matchMedia`, which does not exist during SSR. There is no render-time
         equivalent: the value cannot be derived without reading the media query. */
      setPoints(straightenedPoints(arrow, size, distance));
      return;
    }

    let frame = 0;
    let start: number | undefined;

    const tick = (now: number) => {
      start ??= now;
      const elapsed = now - start - delayMs;

      if (elapsed < 0) {
        // Still in the pre-roll while the route flash reads: hold the resting shape.
        setPoints(straightenedPoints(arrow, size, 0));
        frame = requestAnimationFrame(tick);
        return;
      }

      const ratio = Math.min(1, elapsed / durationMs);
      // Ease-in: the piece starts moving deliberately and accelerates off the board.
      const eased = ratio * ratio;
      setPoints(straightenedPoints(arrow, size, eased * distance));

      if (ratio < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [arrow, size, isClearing, durationMs, delayMs]);

  // Idle pieces report no animated geometry, whatever a previous clear left behind — so
  // an arrow that is re-rendered at rest always draws from its own cells.
  return isClearing ? points : undefined;
}

/* ---------------------------------------------------------------------------------
   The board.
--------------------------------------------------------------------------------- */

interface Snapshot {
  board: ArrowBoard;
  lives: number;
}

/** A route being flashed after a tap: the cells, and whether the move was legal. */
interface RouteFlash {
  cells: Cell[];
  ok: boolean;
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
  const [lives, setLives] = useState(ARROW_LIVES);
  const [cleared, setCleared] = useState(0);
  const [misses, setMisses] = useState(0);
  const [soundOn, setSoundOn] = useState(true);
  // Off by default: at 50x50 the lattice is 98 hairlines, which reads as a grey wash
  // behind the arrows. Useful when tracing exactly which row a head is sitting in, so
  // it is offered rather than removed.
  const [showGrid, setShowGrid] = useState(false);

  /*
    Zoom and pan.

    Both live in board units and feed the SVG `viewBox`, which is what makes this cheap:
    zooming is showing a smaller slice of the same coordinate space, so nothing about the
    arrows, the hit areas or the animation has to know it is happening. A CSS transform on
    a wrapper would have scaled the stroke widths and the tap targets along with it.

    `zoom` is an index into ZOOM_LEVELS rather than a free number, so the buttons step
    through predictable sizes and there is no half-pixel state to land on.
  */
  const [zoomIndex, setZoomIndex] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [saveNote, setSaveNote] = useState<string | undefined>(undefined);
  const [outcome, setOutcome] = useState<"won" | "lost" | undefined>(undefined);

  // Pieces mid-animation. A clearing arrow has already left `board`, so it is drawn
  // from here until its transition ends.
  const [clearing, setClearing] = useState<Arrow[]>([]);
  const [bumping, setBumping] = useState<number | undefined>(undefined);
  const [flash, setFlash] = useState<RouteFlash | undefined>(undefined);
  const [hinted, setHinted] = useState<number | undefined>(undefined);

  // One entry per cleared arrow, for Undo. Lives are recorded too, so undoing a move
  // that cost a life gives it back.
  const [history, setHistory] = useState<Snapshot[]>([]);

  const sounds = useSounds(soundOn);

  // Guards the one-shot save; `outcome` alone would re-fire on every re-render.
  const savedRef = useRef(false);
  // Timers for in-flight animations, so a New board mid-flight cannot fire a stale
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
    setLives(ARROW_LIVES);
    setCleared(0);
    setMisses(0);
    setHistory([]);
    setClearing([]);
    setBumping(undefined);
    setFlash(undefined);
    setHinted(undefined);
    setSaveNote(undefined);
    setOutcome(undefined);
    savedRef.current = false;
  }, [clearTimers, difficulty]);

  // Deals the opening board on mount, and re-deals when the difficulty changes.
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
       Seeding client-only random state on mount; a lazy initialiser would run during
       SSR and render different markup on the server than on the client. */
    newGame();
  }, [newGame]);

  useEffect(() => clearTimers, [clearTimers]);

  const onArrowClick = useCallback(
    (arrowId: number) => {
      if (!board || outcome) return;
      // Ignore a second tap on a piece already on its way out.
      if (clearing.some((entry) => entry.id === arrowId)) return;

      const arrow = board.arrows.find((entry) => entry.id === arrowId);
      if (!arrow) return;

      setHinted(undefined);

      // The route the piece would take out, flashed either way so a tap always explains
      // itself: green for "that was legal", red showing exactly what stood in the way.
      const route = [arrow.cells[0], ...pathAhead(arrow, board.size)];

      if (isBlocked(board, arrowId)) {
        const remainingLives = lives - 1;
        setLives(remainingLives);
        setMisses((value) => value + 1);
        setBumping(arrowId);
        setFlash({ cells: route, ok: false });
        later(() => setBumping(undefined), BLOCKED_MS);
        later(() => setFlash(undefined), BLOCKED_MS);

        if (remainingLives <= 0) {
          sounds.gameOver();
          later(() => setOutcome("lost"), BLOCKED_MS);
        } else {
          sounds.bump();
        }
        return;
      }

      const result = clearArrow(board, arrowId);
      if (!result.cleared) return;

      setHistory((entries) => [...entries, { board, lives }]);
      setFlash({ cells: route, ok: true });
      // Unmounted as soon as its own fade has finished, rather than held for the whole
      // slide: the point of the flash is to confirm the tap, and the arrow leaving is
      // what should hold the eye after that.
      later(() => setFlash(undefined), ROUTE_FLASH_MS + 200);

      setBoard(result.board);
      setCleared((value) => value + 1);
      setClearing((entries) => [...entries, arrow]);
      sounds.clear();

      // Drop the piece once it has snaked all the way out.
      later(
        () => setClearing((entries) => entries.filter((entry) => entry.id !== arrowId)),
        ROUTE_FLASH_MS + CLEAR_MS,
      );

      if (isSolved(result.board)) {
        sounds.win();
        // Let the last arrow finish leaving before the panel appears.
        later(() => setOutcome("won"), ROUTE_FLASH_MS + CLEAR_MS + 120);
      }
    },
    [board, clearing, later, lives, outcome, sounds],
  );

  const undo = useCallback(() => {
    setHistory((entries) => {
      const previous = entries[entries.length - 1];
      if (!previous) return entries;

      setBoard(previous.board);
      setLives(previous.lives);
      setCleared((value) => Math.max(0, value - 1));
      setHinted(undefined);
      setFlash(undefined);
      return entries.slice(0, -1);
    });
  }, []);

  const hint = useCallback(() => {
    if (!board || outcome) return;
    const options = unblockedArrows(board);
    if (options.length === 0) return;
    // Any unblocked arrow is a legal next move — see game-arrows.ts on why a board in
    // play always has one — so the hint picks at random rather than revealing the
    // generator's own solution order, which would walk the player through the puzzle.
    const pick = options[Math.floor(Math.random() * options.length)];
    setHinted(pick.id);
    later(() => setHinted(undefined), 1400);
  }, [board, later, outcome]);

  // Save once, when the run ends either way. In an effect rather than in the click
  // handler because the final counts are only known after React applies the update.
  const finalScore = scoreBoard(cleared, misses);
  useEffect(() => {
    if (!outcome || savedRef.current) return;
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
  }, [outcome, finalScore, cleared, misses, setup.gameKey]);

  const remaining = board?.arrows.length ?? 0;
  const shownBest = Math.max(bestScore, outcome ? finalScore : 0);
  const extent = setup.size * CELL;

  const zoom = ZOOM_LEVELS[zoomIndex];
  /** Side length of the visible window, in board units. */
  const viewSize = extent / zoom;

  /**
   * Pan is clamped so the window can never leave the board — at zoom 1 the only legal
   * offset is 0, which is why the drag handler is a no-op until you zoom in.
   */
  const maxPan = Math.max(0, extent - viewSize);
  const clampPan = useCallback(
    (value: { x: number; y: number }) => ({
      x: Math.min(maxPan, Math.max(0, value.x)),
      y: Math.min(maxPan, Math.max(0, value.y)),
    }),
    [maxPan],
  );

  /**
   * Steps the zoom, keeping the centre of the current view fixed.
   *
   * Zooming around the top-left (the naive version) throws away whatever you were
   * looking at every time you press +, which makes the control useless for its actual
   * purpose: getting a closer look at one part of a crowded board.
   */
  const stepZoom = useCallback(
    (direction: 1 | -1) => {
      setZoomIndex((current) => {
        const next = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, current + direction));
        if (next === current) return current;

        const before = extent / ZOOM_LEVELS[current];
        const after = extent / ZOOM_LEVELS[next];
        const shift = (before - after) / 2;
        const limit = Math.max(0, extent - after);

        setPan((value) => ({
          x: Math.min(limit, Math.max(0, value.x + shift)),
          y: Math.min(limit, Math.max(0, value.y + shift)),
        }));
        return next;
      });
    },
    [extent],
  );

  const resetView = useCallback(() => {
    setZoomIndex(0);
    setPan({ x: 0, y: 0 });
  }, []);

  /*
    Drag to pan, and the thing that makes it safe: a drag must never be mistaken for a
    tap that clears an arrow.

    `dragRef` records where a pointer went down and how far it has travelled. An arrow's
    click handler consults `draggedRef` and ignores the click when the pointer moved more
    than DRAG_SLOP, so dragging across the board pans it instead of clearing everything
    the finger passes over. The slop exists because no real tap is perfectly still —
    especially on a touchscreen.
  */
  /*
    The in-flight drag, or null when the pointer is up.

    Replaced wholesale on every write rather than mutated field by field — the same shape
    `modal.tsx` uses for its window drag, and what `react-hooks/immutability` allows: a
    ref whose fields are poked at from inside callbacks is how stale-closure bugs start,
    so the rule pushes toward treating the value as immutable.
  */
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  /**
   * How far the pointer has travelled since it went down, in screen pixels.
   *
   * Kept apart from `dragRef` and assigned as a whole object every time, never poked
   * field by field — `react-hooks/immutability` forbids re-writing a ref from a
   * render-scope function, and `modal.tsx` sets the house pattern of assigning a complete
   * value or null. The arrow click handler reads this to tell a tap from a pan.
   */
  const travelRef = useRef<{ distance: number } | null>(null);

  /**
   * Whether the gesture that just finished was a pan rather than a tap.
   *
   * A plain function, not a `useCallback`: `react-hooks/immutability` forbids modifying a
   * ref that has been captured by a hook's dependency closure, so `travelRef` must stay
   * out of every memoised callback. Keeping the check here — and calling it from the
   * arrow's `onClick` at the call site — is what lets the pointer handlers write to it.
   */
  function wasPan(): boolean {
    return (travelRef.current?.distance ?? 0) > DRAG_SLOP;
  }
  const svgRef = useRef<SVGSVGElement>(null);

  /*
    Plain functions rather than `useCallback`.

    They only ever write refs and call `setPan`, so memoising them buys nothing — and
    `react-hooks/immutability` forbids mutating a ref from inside a `useCallback`, which
    is the right rule (a memoised callback that mutates hidden state is how stale-closure
    bugs start) but does not fit a raw pointer handler. Nothing downstream depends on
    their identity: they are passed straight to DOM props on the <svg>.
  */
  function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    // Both cleared here rather than on pointerup — see `endDrag`.
    dragRef.current = null;
    travelRef.current = null;

    // Nothing to pan when the whole board is visible, so the drag never starts and taps
    // behave exactly as they did before zoom existed.
    if (maxPan <= 0) return;

    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const start = dragRef.current;
    if (!start) return;

    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Screen pixels to board units. Without this the board would slide at a different
    // speed than the finger at every zoom level.
    const unitsPerPixel = viewSize / rect.width;
    const dx = (event.clientX - start.x) * unitsPerPixel;
    const dy = (event.clientY - start.y) * unitsPerPixel;

    travelRef.current = {
      distance: Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y),
    };

    // Dragging right moves the *window* left, so the board follows the finger.
    setPan(clampPan({ x: start.panX - dx, y: start.panY - dy }));
  }

  /*
    Ends the drag but deliberately leaves `travelRef` alone.

    A click fires *after* pointerup, so zeroing the travel here would erase it a fraction
    of a millisecond before the arrow's click handler reads it — and every pan would end
    by clearing whatever arrow the finger happened to lift over. Both records are reset on
    the next pointerdown instead.
  */
  function endDrag() {
    dragRef.current = null;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Hearts lives={lives} />
          <Stat label="Left" value={remaining.toLocaleString()} />
          <Stat label="Cleared" value={cleared.toLocaleString()} />
          <Stat label="Best" value={shownBest.toLocaleString()} />
        </div>

        {/* Controls wrap to their own row on a phone rather than squeezing. */}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={undo}
            variant="secondary"
            size="sm"
            disabled={history.length === 0 || outcome !== undefined}
          >
            Undo
          </Button>
          <Button
            onClick={hint}
            variant="secondary"
            size="sm"
            disabled={remaining === 0 || outcome !== undefined}
          >
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
          {/*
            A one-off checkbox rather than a registered component: `components.md` has no
            checkbox yet, and one control inside one game is not the place to define the
            app's. A native input, so it keeps keyboard and screen-reader behaviour for
            free; `accent-brass` tints the tick to the theme.
          */}
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-paper-raised px-3 py-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={showGrid}
              onChange={(event) => setShowGrid(event.target.checked)}
              className="h-3.5 w-3.5 accent-brass"
            />
            Show grid lines
          </label>
          <Button onClick={newGame} variant="secondary" size="sm">
            New board
          </Button>

          {/*
            Zoom. A 50x50 board puts each cell at roughly 2% of the board's width, which
            is small to read and smaller to hit — so the density the game wants and the
            precision a tap needs are in direct conflict, and this is what resolves it.
            Fit-to-board stays the default: the overview is what makes the puzzle
            solvable, and zoom is for inspecting or tapping a crowded corner.
          */}
          <div className="flex items-center gap-1 rounded-lg border border-line bg-paper-raised px-1.5 py-0.5">
            <Button
              onClick={() => stepZoom(-1)}
              variant="secondary"
              size="sm"
              disabled={zoomIndex === 0}
              ariaLabel="Zoom out"
              title="Zoom out"
              className="border-0 shadow-none"
            >
              −
            </Button>
            {/* Tabular figures so the row does not jitter as the number changes width. */}
            <span className="min-w-10 text-center text-xs tabular-nums text-muted">
              {zoom}×
            </span>
            <Button
              onClick={() => stepZoom(1)}
              variant="secondary"
              size="sm"
              disabled={zoomIndex === ZOOM_LEVELS.length - 1}
              ariaLabel="Zoom in"
              title="Zoom in"
              className="border-0 shadow-none"
            >
              +
            </Button>
            <Button
              onClick={resetView}
              variant="secondary"
              size="sm"
              disabled={zoomIndex === 0 && pan.x === 0 && pan.y === 0}
              title="Fit the whole board"
              className="border-0 shadow-none"
            >
              Fit
            </Button>
          </div>
        </div>
      </div>

      {/*
        The board is a square that scales with the viewport rather than reflowing.

        Three terms, because the game plays full-bleed and each binds on a different
        screen: `40rem` caps it on a large monitor, `90vw` keeps it inside a phone, and
        `62vh` is the one that matters in the dialog — a square capped only by width
        overflows a short landscape window and pushes its own controls off-screen.

        The SVG needs no responsive handling of its own: the viewBox is in cell units and
        scales to whatever box this wrapper gives it.
      */}
      {/*
        A 50x50 board wants every pixel the dialog will give it: at 40rem each cell is
        about 13px, which is already small for a tap. The cap is raised and the `vh` term
        loosened accordingly — the game plays full-bleed, so there is height to use.
      */}
      <div className="mx-auto w-full" style={{ maxWidth: "min(56rem, 94vw, 74vh)" }}>
        <svg
          ref={svgRef}
          viewBox={`${pan.x} ${pan.y} ${viewSize} ${viewSize}`}
          className={`aspect-square w-full touch-none overflow-hidden rounded-xl border border-line bg-paper-raised ${
            maxPan > 0 ? "cursor-grab active:cursor-grabbing" : ""
          }`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          onPointerCancel={endDrag}
          role="group"
          aria-label={`Arrow Clearing board, ${setup.size} by ${setup.size}${
            zoom > 1 ? `, zoomed to ${zoom}x` : ""
          }`}
        >
          {/*
            The cell lattice, off by default.

            `stroke` is set from `var(--line)` directly rather than via a `text-*` class
            and `currentColor`. That indirection is what kept this invisible: the arrows
            get their colour from `text-brass`, a real colour utility, but the line token
            is used everywhere else in the app as `border-line`, and relying on it also
            producing a text colour for `currentColor` to pick up was a guess that did not
            hold. Naming the variable removes the question.
          */}
          {showGrid && (
            <g aria-hidden="true" stroke="var(--line)" strokeWidth={GRID_STROKE / zoom}>
              {Array.from({ length: setup.size - 1 }, (_, index) => {
                const at = (index + 1) * CELL;
                return (
                  <g key={index}>
                    <line x1={at} y1={0} x2={at} y2={extent} />
                    <line x1={0} y1={at} x2={extent} y2={at} />
                  </g>
                );
              })}
            </g>
          )}

          {/* The route flash, under the pieces so a clearing arrow draws over its trail. */}
          {flash && (
            <polyline
              points={pointsOf(flash.cells)}
              fill="none"
              stroke="currentColor"
              // Under the arrow's own width, so it reads as a lit lane behind the piece
              // rather than a bar drawn over it.
              strokeWidth={STROKE * 1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              className={flash.ok ? "text-emerald-400" : "text-red-400"}
              style={{
                // A blocked move holds its red long enough to be read; a legal one gets
                // out of the way of the slide it is announcing.
                animation: flash.ok
                  ? `arrow-route-flash ${ROUTE_FLASH_MS + 160}ms ease-out both`
                  : `arrow-route-hold ${BLOCKED_MS}ms ease-out both`,
              }}
              aria-hidden="true"
            />
          )}

          {/* Pieces still in play. */}
          {board?.arrows.map((arrow) => (
            <ArrowPiece
              key={arrow.id}
              arrow={arrow}
              size={setup.size}
              state={bumping === arrow.id ? "blocked" : "idle"}
              isHinted={hinted === arrow.id}
              // `wasPan()` guards here rather than inside `onArrowClick`, so that
              // dragging across the board pans it instead of clearing every arrow the
              // finger passes over.
              onClick={() => {
                if (wasPan()) return;
                onArrowClick(arrow.id);
              }}
            />
          ))}

          {/* Pieces that have left the board and are still snaking away. */}
          {clearing.map((arrow) => (
            <ArrowPiece
              key={`clearing-${arrow.id}`}
              arrow={arrow}
              size={setup.size}
              state="clearing"
            />
          ))}
        </svg>
      </div>

      <div aria-live="polite" className="min-h-6 text-center text-sm">
        {!outcome && remaining === 0 && <span className="text-brass">Board clear.</span>}
        {saveNote && <span className="ml-2 text-muted">{saveNote}</span>}
      </div>

      <p className="text-center text-xs text-muted">
        Tap an arrow to send it off the board. It only moves if the straight line from its
        head to the edge is clear — a wrong tap costs a life.
        {maxPan > 0 && " Drag the board to look around."}
      </p>

      {outcome && (
        <ResultPanel
          outcome={outcome}
          score={finalScore}
          cleared={cleared}
          misses={misses}
          remaining={remaining}
          saveNote={saveNote}
          onNewGame={newGame}
          onDismiss={() => setOutcome(undefined)}
        />
      )}
    </div>
  );
}

/**
 * One arrow, as an SVG polyline with an arrowhead at its leading end.
 *
 * The clearing animation is a `stroke-dashoffset` transition, not a transform, and that
 * choice is the whole effect: the stroke carries a single dash as long as the entire
 * line, so pushing the offset forward retracts it from the tail while the head runs on
 * past the edge. A winding piece therefore leaves along its **own route**, snaking out
 * the way it points, where a transform would slide the whole shape bodily sideways
 * through the cells its neighbours occupy.
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
  state: "idle" | "blocked" | "clearing";
  isHinted?: boolean;
  onClick?: () => void;
}) {
  const isClearing = state === "clearing";

  /*
    While clearing, the geometry is recomputed every frame so the piece straightens as it
    leaves — see `useClearingPoints`. At rest it is just the arrow's own cells, and no
    frame loop runs.
  */
  const clearingPoints = useClearingPoints(arrow, size, isClearing, CLEAR_MS, ROUTE_FLASH_MS);
  const bodyPoints = clearingPoints ?? pointsOf(arrow.cells);

  /*
    Where the head is this frame, so the chevron rides the front of the line rather than
    staying pinned to the cell the arrow started in. Parsed back out of the points string
    because that is the one place the current geometry exists — recomputing it here would
    be a second source of truth for the same number.
  */
  const headPoint = bodyPoints.split(" ")[0]?.split(",") ?? [];
  const head = {
    x: Number(headPoint[0] ?? 0),
    y: Number(headPoint[1] ?? 0),
  };


  return (
    <g
      onClick={onClick}
      className={`${isClearing ? "pointer-events-none" : "cursor-pointer"} ${
        state === "blocked" ? "animate-arrow-bump" : ""
      }`}
      // An SVG <g> is not a button, so the role, focusability and key handling have to
      // be spelled out rather than inherited.
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `${arrow.cells.length}-cell arrow pointing ${arrow.direction}` : undefined}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {/*
        The tap target. A 1.6-unit line is far too thin to hit on a phone — Apple and
        Google both put the minimum at around 44px — so an invisible stroke five times
        the width carries the pointer events and the visible line rides on top of it.
        `stroke` rather than `fill` because the shape is an open polyline: filling one
        would make a lumpy polygon out of the area *between* the path's turns, catching
        taps nowhere near the arrow.
      */}
      {onClick && (
        <polyline
          points={pointsOf(arrow.cells)}
          fill="none"
          stroke="transparent"
          strokeWidth={STROKE * 7}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        />
      )}

      {/* The hint halo, drawn under the body so it reads as a glow around it. */}
      {isHinted && (
        <polyline
          points={pointsOf(arrow.cells)}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE * 3.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-brass-dark"
          opacity={0.5}
          aria-hidden="true"
        />
      )}

      {/* The body: the arrow's own cells. The slide-off is on the group, not here. */}
      <polyline
        points={bodyPoints}
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-brass"
        opacity={0.9}
      />

      {/*
        The head: an open chevron in the same stroke as the body, so the piece reads as
        one drawn line rather than a bar with a blob stuck on the end.

        Sized from HEAD, not from STROKE. Deriving it from the stroke width is what made
        the first version invisible once the line was thinned — the glyph has to stay
        legible at a fixed fraction of a *cell* however thin the line gets.
      */}
      <polyline
        points={`${head.x - HEAD},${head.y - HEAD} ${head.x + HEAD * 0.55},${head.y} ${
          head.x - HEAD
        },${head.y + HEAD}`}
        transform={`rotate(${HEAD_ANGLE[arrow.direction]} ${head.x} ${head.y})`}
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-brass"
        aria-hidden="true"
      />
    </g>
  );
}

/** The remaining lives, as filled and hollow hearts. */
function Hearts({ lives }: { lives: number }) {
  return (
    <div
      className="flex items-center gap-1 rounded-lg border border-line bg-paper-raised px-3 py-1.5"
      // One label for the group rather than per heart, so a screen reader says
      // "3 of 5 lives left" instead of reading five separate glyphs.
      role="img"
      aria-label={`${Math.max(0, lives)} of ${ARROW_LIVES} lives left`}
    >
      {Array.from({ length: ARROW_LIVES }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={`text-sm leading-none ${
            index < lives ? "text-red-400" : "text-muted opacity-40"
          }`}
        >
          {index < lives ? "♥" : "♡"}
        </span>
      ))}
    </div>
  );
}

/** The end-of-run panel: a solved board, or one that ran out of lives. */
function ResultPanel({
  outcome,
  score,
  cleared,
  misses,
  remaining,
  saveNote,
  onNewGame,
  onDismiss,
}: {
  outcome: "won" | "lost";
  score: number;
  cleared: number;
  misses: number;
  remaining: number;
  saveNote: string | undefined;
  onNewGame: () => void;
  onDismiss: () => void;
}) {
  const won = outcome === "won";

  /*
    Inline rather than a `Modal`.

    The game already plays inside a full-bleed dialog, and a Modal inside a Modal is
    genuinely broken here rather than merely redundant: both register their Escape
    handler on `document` in the *capture* phase and call `stopPropagation`, so the outer
    one fires first and Escape would close the whole game instead of this panel, taking
    the score with it. Two focus traps fighting over one tree is the same story.
  */
  return (
    <div
      className={`rounded-xl border bg-paper-raised p-5 text-center ${
        won ? "border-brass" : "border-red-400"
      }`}
    >
      <h3 className="font-display text-lg text-ink">{won ? "Board clear" : "Out of lives"}</h3>
      <p className="mt-0.5 text-sm text-muted">
        {won
          ? `Solved with ${misses} wasted ${misses === 1 ? "tap" : "taps"}.`
          : `${remaining} ${remaining === 1 ? "arrow" : "arrows"} still on the board.`}
      </p>
      {/*
        Said explicitly on a loss, because the obvious reading of a half-finished board
        is that the game dealt something impossible. It never does — every board is
        solvable by construction and a careful solver clears all of them, which a test
        asserts — so the panel says so rather than leaving the player to suspect the
        generator.
      */}
      {!won && (
        <p className="mt-1 text-xs text-muted">
          This board did have a solution — every one does. Undo backs out of a mistake
          before it costs the run.
        </p>
      )}

      <div className="mt-3 font-display text-4xl tabular-nums text-brass">
        {score.toLocaleString()}
      </div>
      <div className="text-xs uppercase tracking-wide text-muted">points</div>

      <p className="mt-2 text-sm text-muted">
        {cleared} {cleared === 1 ? "arrow" : "arrows"} cleared.{" "}
        {won && misses === 0 ? "A perfect solve." : "Each clean clear is worth 100."}
      </p>
      {saveNote && <p className="mt-1 text-xs text-muted">{saveNote}</p>}

      <div className="mt-4 flex justify-center gap-2">
        {/* A lost run has nothing to go back and look at, so only a solved board offers
            a dismiss — on a loss the board is unfinished and the panel is the ending. */}
        {won && (
          <Button onClick={onDismiss} variant="secondary" size="sm">
            Dismiss
          </Button>
        )}
        <Button onClick={onNewGame} size="sm">
          New board
        </Button>
      </div>
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
