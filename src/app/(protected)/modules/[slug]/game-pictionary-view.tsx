"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/button";
import { Progress3D } from "@/components/progress-3d";
import { useGameSounds } from "@/components/use-game-sounds";
import {
  PICTIONARY_DEFAULT_ROUNDS,
  PICTIONARY_MAX_NAME_LENGTH,
  PICTIONARY_MAX_PLAYERS,
  PICTIONARY_MAX_ROUNDS,
  PICTIONARY_MIN_PLAYERS,
  PICTIONARY_MIN_ROUNDS,
  PICTIONARY_TIERS,
  PICTIONARY_TURN_SECONDS,
  awardRound,
  beginTurn,
  currentDrawer,
  guessers,
  missRound,
  pictionaryStandings,
  roundNumber,
  skipRound,
  startPictionary,
  stopDrawing,
  tickPictionary,
  type PictionaryState,
  type PictionaryTier,
  type PictionaryWord,
} from "@/lib/games";

// The Pictionary table. A client component that owns only presentation state — the
// strokes on the canvas, the pen, the clock interval and the typed roster. Every rule
// comes from @/lib/games (src/lib/games/game-pictionary.ts), so nothing here decides
// what a round is worth, who draws next, or when a session ends.
//
// **Nothing is posted.** Players are typed names, so a session's scores never reach the
// server — there is no save action and no `bestScore` prop. See `PictionaryPlayer` in
// `src/lib/games/types.ts` for why that follows from how `gam_scores` names a player.
//
// The clock runs here for the reason it does in Minesweeper, Tetris and Sudoku: a
// `setInterval` is a browser concern, but what a second is *worth* is not —
// `roundPoints` owns that, and this file only reports ticks into the state.
//
// **The strokes are deliberately not state.** They are drawn straight onto the canvas
// and cleared when the turn ends. Keeping them in React would re-render the tree on
// every pointer move for no gain, and keeping them in the library would make the
// drawing a domain object — it isn't one. Nothing records what was drawn; see the
// Pictionary block in `src/lib/games/types.ts`.

/**
 * The pen's width in canvas pixels, and the eraser's.
 *
 * The eraser is much wider than the pen on purpose: it is used to take out a whole bad
 * limb under time pressure, not to tidy an edge, and a precise eraser on a phone is
 * just a slower pen.
 */
const PEN_WIDTH = 4;
const ERASER_WIDTH = 28;

/** The canvas's backing-store size. Fixed, and scaled to fit by CSS — see `drawTo`. */
const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 800;

/**
 * The sound cues, in one place so the view reads as a game rather than as a synth.
 *
 * `useGameSounds` owns the audio context and the envelope; what lives here is only
 * *what a Pictionary event sounds like*. Same split as every other board here.
 */
function useSounds(enabled: boolean) {
  const sounds = useGameSounds(enabled);

  return useMemo(
    () => ({
      /** The pen touching down. Very quiet — it fires on every stroke. */
      stroke: () =>
        sounds.play({ startHz: 180, endHz: 200, durationMs: 25, type: "sine", peak: 0.012 }),
      /** A turn begins: the clock is running. */
      start: () =>
        sounds.play({ startHz: 440, endHz: 660, durationMs: 120, type: "sine", peak: 0.04 }),
      /** Someone got it — the happy arpeggio. */
      correct: () =>
        sounds.playSequence([
          { startHz: 523, endHz: 523, durationMs: 90, type: "sine", peak: 0.045 },
          { startHz: 659, endHz: 659, durationMs: 90, type: "sine", peak: 0.045, afterMs: 90 },
          { startHz: 784, endHz: 784, durationMs: 160, type: "sine", peak: 0.05, afterMs: 180 },
        ]),
      /** The clock ran out. */
      timeout: () =>
        sounds.playSequence([
          { startHz: 330, endHz: 300, durationMs: 140, type: "square", peak: 0.03 },
          { startHz: 240, endHz: 200, durationMs: 220, type: "square", peak: 0.03, afterMs: 150 },
        ]),
      /** The last ten seconds, once a second. */
      urgent: () =>
        sounds.play({ startHz: 880, endHz: 880, durationMs: 50, type: "square", peak: 0.025 }),
      /** The session is over. */
      finish: () =>
        sounds.playSequence([
          { startHz: 523, endHz: 523, durationMs: 120, type: "sine", peak: 0.04 },
          { startHz: 659, endHz: 659, durationMs: 120, type: "sine", peak: 0.04, afterMs: 130 },
          { startHz: 784, endHz: 784, durationMs: 120, type: "sine", peak: 0.045, afterMs: 260 },
          { startHz: 1047, endHz: 1047, durationMs: 300, type: "sine", peak: 0.05, afterMs: 390 },
        ]),
    }),
    [sounds],
  );
}

/** Seconds as `m:ss`, so a 90-second turn doesn't read as "90". */
function clockText(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function GamePictionaryView({
  wordPool,
}: {
  /**
   * The prompts available per tier: the built-in bank plus anything added on the
   * Configuration screen, already joined on the server. The game draws from this and
   * cannot tell which words were imported — see `listPlayableWords`.
   */
  wordPool: Record<PictionaryTier, readonly PictionaryWord[]>;
}) {
  const [state, setState] = useState<PictionaryState | undefined>();
  const [soundOn, setSoundOn] = useState(true);
  const sounds = useSounds(soundOn);

  /*
    The roster: typed names, one box each.

    Starts with two empty boxes because two is the minimum and the common case; "Add
    player" appends up to `PICTIONARY_MAX_PLAYERS`. Blank boxes are dropped by
    `startGame`, so a third box left empty is a two-player session rather than an error.
  */
  const [names, setNames] = useState<readonly string[]>(["", ""]);
  const [tier, setTier] = useState<PictionaryTier>("easy");
  const [rounds, setRounds] = useState(PICTIONARY_DEFAULT_ROUNDS);

  /** What `startGame` refused, when it did. Cleared on the next attempt. */
  const [startError, setStartError] = useState<string>();

  const phase = state?.phase ?? "setup";
  const drawer = state ? currentDrawer(state) : undefined;

  /* ---------------------------------------------------------------------------------
     The canvas.

     Drawn to imperatively via a ref. `drawTo` converts a pointer event into
     backing-store coordinates, which is what makes the fixed 1200x800 buffer scale to
     any CSS size without the line drifting from the fingertip.
  --------------------------------------------------------------------------------- */
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [erasing, setErasing] = useState(false);

  const context = useCallback((): CanvasRenderingContext2D | undefined => {
    return canvasRef.current?.getContext("2d") ?? undefined;
  }, []);

  const clearCanvas = useCallback(() => {
    const ctx = context();
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }, [context]);

  /** A pointer event in backing-store coordinates. */
  const pointAt = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const box = canvas.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return undefined;
    return {
      x: ((event.clientX - box.left) / box.width) * CANVAS_WIDTH,
      y: ((event.clientY - box.top) / box.height) * CANVAS_HEIGHT,
    };
  }, []);

  const strokeStart = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (phase !== "drawing") return;
      const ctx = context();
      const point = pointAt(event);
      if (!ctx || !point) return;

      // Capture the pointer so a stroke that leaves the canvas mid-drag keeps drawing
      // and, more importantly, still ends — without this a pointerup outside the
      // element never arrives and the pen stays down.
      event.currentTarget.setPointerCapture(event.pointerId);
      drawingRef.current = true;

      ctx.globalCompositeOperation = erasing ? "destination-out" : "source-over";
      ctx.strokeStyle = "#000";
      ctx.lineWidth = erasing ? ERASER_WIDTH : PEN_WIDTH;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      // A dot, so a tap leaves a mark rather than nothing.
      ctx.lineTo(point.x + 0.01, point.y);
      ctx.stroke();
      sounds.stroke();
    },
    [context, erasing, phase, pointAt, sounds],
  );

  const strokeMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return;
      const ctx = context();
      const point = pointAt(event);
      if (!ctx || !point) return;
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    },
    [context, pointAt],
  );

  const strokeEnd = useCallback(() => {
    drawingRef.current = false;
  }, []);

  /* ---------------------------------------------------------------------------------
     The clock. One interval, running only while a turn is being drawn.
  --------------------------------------------------------------------------------- */
  useEffect(() => {
    if (phase !== "drawing") return;
    const timer = setInterval(() => setState((current) => (current ? tickPictionary(current) : current)), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // The last-ten-seconds pips and the buzzer. In an effect watching the clock rather
  // than inside `tick`, because what a second *sounds* like is presentation.
  const secondsLeft = state?.secondsLeft ?? 0;
  useEffect(() => {
    if (phase !== "drawing") return;
    if (secondsLeft > 0 && secondsLeft <= 10) sounds.urgent();
  }, [phase, secondsLeft, sounds]);

  const previousPhase = useRef(phase);
  useEffect(() => {
    const was = previousPhase.current;
    previousPhase.current = phase;

    // Time ran out: the library moved itself from `drawing` to `judging` at zero.
    if (was === "drawing" && phase === "judging" && secondsLeft === 0) sounds.timeout();
    if (was !== "summary" && phase === "summary") sounds.finish();
  }, [phase, secondsLeft, sounds]);

  // A new turn starts with a blank canvas. Keyed on the round so it fires once per
  // round rather than on every state change within one.
  const round = state ? roundNumber(state) : 0;
  useEffect(() => {
    if (phase === "handoff") clearCanvas();
  }, [clearCanvas, phase, round]);

  /* ---------------------------------------------------------------------------------
     Actions. Each one hands the current state to a library rule and keeps what comes
     back — no rule is reimplemented here.
  --------------------------------------------------------------------------------- */
  const newSession = useCallback(() => {
    setStartError(undefined);
    clearCanvas();

    // `startGame` throws on a roster it cannot seat (too few names, a duplicate, a name
    // too long). Caught rather than pre-checked here so the rule has exactly one home:
    // the library decides what a playable roster is, and this reports what it said.
    try {
      setState(
        startPictionary(
          names.map((name) => ({ name })),
          tier,
          rounds,
          Math.random,
          wordPool[tier],
        ),
      );
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Could not start that session.");
    }
  }, [clearCanvas, names, rounds, tier, wordPool]);

  const start = useCallback(() => {
    clearCanvas();
    setState((current) => (current ? beginTurn(current) : current));
    sounds.start();
  }, [clearCanvas, sounds]);

  const award = useCallback(
    (guesserName: string) => {
      sounds.correct();
      setState((current) => (current ? awardRound(current, guesserName, Math.random) : current));
    },
    [sounds],
  );

  const miss = useCallback(() => {
    setState((current) => (current ? missRound(current, Math.random) : current));
  }, []);

  const skip = useCallback(() => {
    setState((current) => (current ? skipRound(current, Math.random) : current));
  }, []);

  const stop = useCallback(() => {
    setState((current) => (current ? stopDrawing(current) : current));
  }, []);

  const setName = useCallback((index: number, value: string) => {
    setNames((current) => current.map((entry, at) => (at === index ? value : entry)));
  }, []);

  const addPlayer = useCallback(() => {
    setNames((current) => (current.length < PICTIONARY_MAX_PLAYERS ? [...current, ""] : current));
  }, []);

  const removePlayer = useCallback((index: number) => {
    // Never below the two boxes the minimum needs — clearing one is how you drop a
    // player, since a roster with a single box could not start anyway.
    setNames((current) =>
      current.length > PICTIONARY_MIN_PLAYERS
        ? current.filter((_, at) => at !== index)
        : current.map((entry, at) => (at === index ? "" : entry)),
    );
  }, []);

  /* ---------------------------------------------------------------------------------
     Render. One branch per phase — they are genuinely different screens, not one
     screen with things hidden, which is why the canvas only mounts for two of them.
  --------------------------------------------------------------------------------- */
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-4">
          {state && state.phase !== "setup" && (
            <span className="text-sm text-muted">
              Round <strong className="text-ink">{round}</strong> of {state.totalRounds}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setSoundOn((value) => !value)}
            ariaPressed={soundOn}
            title={soundOn ? "Mute sound effects" : "Unmute sound effects"}
          >
            {soundOn ? "Sound on" : "Sound off"}
          </Button>
          {state && (
            <Button size="sm" variant="secondary" onClick={() => setState(undefined)}>
              New session
            </Button>
          )}
        </div>
      </header>

      {phase === "setup" && (
        <SetupScreen
          names={names}
          onName={setName}
          onAddPlayer={addPlayer}
          onRemovePlayer={removePlayer}
          error={startError}
          tier={tier}
          onTier={setTier}
          wordCount={wordPool[tier]?.length ?? 0}
          rounds={rounds}
          onRounds={setRounds}
          onStart={newSession}
        />
      )}

      {state && phase === "handoff" && drawer && (
        <HandoffScreen
          drawerName={drawer.name}
          roundNumber={round}
          totalRounds={state.totalRounds}
          onStart={start}
          onSkip={skip}
        />
      )}

      {state && (phase === "drawing" || phase === "judging") && drawer && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">
                {drawer.name} is drawing
              </p>
              {/* The word stays on screen while drawing — the drawer needs it, and they
                  are the one holding the device. It is hidden in `judging` so the
                  guessers can be shown the screen again. */}
              {phase === "drawing" && (
                <p className="font-display text-2xl text-ink max-lg:text-xl">
                  {state.current?.word}
                </p>
              )}
            </div>

            <div className="text-right">
              <p
                className={`font-display text-3xl tabular-nums max-lg:text-2xl ${
                  secondsLeft <= 10 && phase === "drawing" ? "text-red-400" : "text-ink"
                }`}
              >
                {clockText(secondsLeft)}
              </p>
            </div>
          </div>

          <Progress3D
            value={secondsLeft}
            max={PICTIONARY_TURN_SECONDS[state.tier]}
            size="sm"
            tone={secondsLeft <= 10 ? "negative" : "accent"}
            ariaLabel="Time left in this turn"
          />

          <DrawingBoard
            canvasRef={canvasRef}
            disabled={phase !== "drawing"}
            erasing={erasing}
            onErasing={setErasing}
            onClear={clearCanvas}
            onPointerDown={strokeStart}
            onPointerMove={strokeMove}
            onPointerUp={strokeEnd}
          />

          {phase === "drawing" && (
            <div className="flex justify-end">
              <Button onClick={stop}>Someone got it</Button>
            </div>
          )}

          {phase === "judging" && (
            <JudgingScreen
              word={state.current?.word ?? ""}
              guessers={guessers(state)}
              onAward={award}
              onMiss={miss}
            />
          )}
        </div>
      )}

      {state && phase === "summary" && (
        <SummaryScreen state={state} onAgain={() => setState(undefined)} />
      )}
    </div>
  );
}

/* -----------------------------------------------------------------------------------
   Screens. Local to this file: each is one phase of one game and reuses nothing else,
   so none of them is a registry component. `components.md` was checked first — `Button`,
   `Button` and `Progress3D` are reused above rather than rebuilt here.
----------------------------------------------------------------------------------- */

function SetupScreen({
  names,
  onName,
  onAddPlayer,
  onRemovePlayer,
  error,
  tier,
  onTier,
  wordCount,
  rounds,
  onRounds,
  onStart,
}: {
  names: readonly string[];
  onName: (index: number, value: string) => void;
  onAddPlayer: () => void;
  onRemovePlayer: (index: number) => void;
  /** What the library refused the roster for, if anything. */
  error?: string;
  tier: PictionaryTier;
  onTier: (tier: PictionaryTier) => void;
  /** How many prompts the chosen tier has, built-in plus imported. */
  wordCount: number;
  rounds: number;
  onRounds: (rounds: number) => void;
  onStart: () => void;
}) {
  // Enough names to play. The authoritative check is `startGame`'s — this only decides
  // whether the button is worth offering, so it deliberately repeats nothing else.
  const filled = names.filter((name) => name.trim().length > 0).length;
  const ready = filled >= PICTIONARY_MIN_PLAYERS;

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="mb-1 font-display text-lg text-ink">Who is playing?</h3>
        <p className="mb-3 text-sm text-muted">
          Type everyone&rsquo;s name. Each takes a turn drawing while the others guess out
          loud; points go to whoever guesses and to whoever drew it.
        </p>

        <div className="flex flex-col gap-2">
          {names.map((name, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="w-6 text-sm tabular-nums text-muted">{index + 1}</span>
              <input
                type="text"
                value={name}
                onChange={(event) => onName(index, event.target.value)}
                maxLength={PICTIONARY_MAX_NAME_LENGTH}
                placeholder={index === 0 ? "e.g. Min" : "Name"}
                aria-label={`Player ${index + 1} name`}
                className="w-full max-w-xs rounded-lg border border-line bg-paper-raised px-3 py-2 text-ink placeholder:text-muted"
              />
              <button
                type="button"
                onClick={() => onRemovePlayer(index)}
                aria-label={`Remove player ${index + 1}`}
                title="Remove this player"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-brass-soft hover:text-brass-dark"
              >
                &times;
              </button>
            </div>
          ))}
        </div>

        {names.length < PICTIONARY_MAX_PLAYERS && (
          <div className="mt-2">
            <Button size="sm" variant="secondary" onClick={onAddPlayer}>
              Add player
            </Button>
          </div>
        )}

        {!ready && (
          <p className="mt-2 text-sm text-muted">
            Name at least {PICTIONARY_MIN_PLAYERS} players &mdash; someone has to guess.
          </p>
        )}
      </section>

      <section className="flex flex-wrap gap-6">
        <div>
          <h3 className="mb-2 font-display text-lg text-ink">How hard?</h3>
          <div className="flex gap-2">
            {PICTIONARY_TIERS.map((entry) => (
              <Button
                key={entry}
                size="sm"
                variant={entry === tier ? "primary" : "secondary"}
                onClick={() => onTier(entry)}
                ariaPressed={entry === tier}
              >
                {entry === "easy" ? "Easy" : entry === "medium" ? "Medium" : "Hard"}
              </Button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            {PICTIONARY_TURN_SECONDS[tier]} seconds a turn. Harder words score more.
            {wordCount > 0 && ` ${wordCount} words available.`}
          </p>
        </div>

        <div>
          <h3 className="mb-2 font-display text-lg text-ink">How many rounds?</h3>
          <input
            type="number"
            min={PICTIONARY_MIN_ROUNDS}
            max={PICTIONARY_MAX_ROUNDS}
            value={rounds}
            onChange={(event) => {
              // Clamped here as well as in the library: a number input lets anything be
              // typed, and a session of 0 rounds would finish before it started.
              const next = Number(event.target.value);
              if (!Number.isFinite(next)) return;
              onRounds(Math.min(PICTIONARY_MAX_ROUNDS, Math.max(PICTIONARY_MIN_ROUNDS, next)));
            }}
            className="w-24 rounded-lg border border-line bg-paper-raised px-3 py-2 text-ink"
            aria-label="Rounds in this session"
          />
        </div>
      </section>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div>
        <Button onClick={onStart} disabled={!ready}>
          Start playing
        </Button>
        <p className="mt-2 text-xs text-muted">
          Scores stay on this screen &mdash; Pictionary doesn&rsquo;t post to the
          high-score board, since players are names rather than accounts.
        </p>
      </div>
    </div>
  );
}

/**
 * The pass-the-device screen.
 *
 * Deliberately shows the next drawer's name and *not* the word: this is the one screen
 * everyone in the room is allowed to look at, so revealing the prompt here would end the
 * round before it started. See `PictionaryPhase`.
 */
function HandoffScreen({
  drawerName,
  roundNumber: round,
  totalRounds,
  onStart,
  onSkip,
}: {
  drawerName: string;
  roundNumber: number;
  totalRounds: number;
  onStart: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-line bg-paper-raised p-10 text-center max-lg:p-6">
      <p className="text-xs uppercase tracking-wide text-muted">
        Round {round} of {totalRounds}
      </p>
      <h3 className="font-display text-3xl text-ink max-lg:text-2xl">Pass to {drawerName}</h3>
      <p className="max-w-md text-sm text-muted">
        {drawerName}, take the device and tap below — everyone else, look away. The word
        appears on the next screen and the clock starts with it.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={onStart}>I&rsquo;m {drawerName} — show the word</Button>
        <Button variant="secondary" onClick={onSkip} title="Swap this word for another">
          Skip this word
        </Button>
      </div>
    </div>
  );
}

/** The canvas plus its pen controls. */
function DrawingBoard({
  canvasRef,
  disabled,
  erasing,
  onErasing,
  onClear,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  disabled: boolean;
  erasing: boolean;
  onErasing: (erasing: boolean) => void;
  onClear: () => void;
  onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {/* White rather than `bg-paper-raised`: this is paper being drawn on, and the ink
          is black on every theme. A themed surface would make the drawing invisible on
          the dark themes unless the pen were themed too, and a "pen that changes colour
          with the theme" is a worse answer than a sheet of paper that doesn't. */}
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`mx-auto h-auto w-full rounded-xl border border-line bg-white ${
          disabled ? "pointer-events-none opacity-60" : "cursor-crosshair touch-none"
        }`}
        /*
          `touch-none` above stops a drag from scrolling the page instead of drawing, and
          the aspect ratio keeps the CSS box matching the backing store so strokes land
          under the fingertip.

          The height is capped against `vh` as well as width, per `modules.md`: this view
          renders inside `Modal size="full"`, and a board capped only by width overflows a
          short landscape window and pushes the pen controls off-screen. Three terms, as
          every other board here uses — a rem cap for a big monitor, and a vh term for
          the dialog.
        */
        style={{
          aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`,
          // `maxWidth` rather than `maxHeight`: with `aspectRatio` set, capping the
          // height on a `w-full` element squashes the drawing (the CSS box stops
          // matching the 1200x800 backing store and every stroke lands off the
          // fingertip). Capping the WIDTH lets the ratio set the height, so the board
          // stays square-true and still fits a short window.
          maxWidth: `min(100%, calc(min(32rem, 55vh) * ${CANVAS_WIDTH / CANVAS_HEIGHT}))`,
        }}
      />

      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={erasing ? "secondary" : "primary"}
            onClick={() => onErasing(false)}
            ariaPressed={!erasing}
          >
            Pen
          </Button>
          <Button
            size="sm"
            variant={erasing ? "primary" : "secondary"}
            onClick={() => onErasing(true)}
            ariaPressed={erasing}
          >
            Eraser
          </Button>
          <Button size="sm" variant="secondary" onClick={onClear}>
            Clear
          </Button>
          <span className="text-xs text-muted max-lg:hidden">
            No letters, no numbers, no talking.
          </span>
        </div>
      )}
    </div>
  );
}

/** Who guessed it — one button per guesser, plus "nobody". */
function JudgingScreen({
  word,
  guessers: table,
  onAward,
  onMiss,
}: {
  word: string;
  guessers: readonly { name: string }[];
  onAward: (name: string) => void;
  onMiss: () => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-paper-raised p-4">
      <p className="text-sm text-muted">
        The word was <strong className="font-display text-ink">{word}</strong>.
      </p>
      <h4 className="mt-3 mb-2 font-display text-lg text-ink">Who guessed it?</h4>

      <div className="flex flex-wrap gap-2">
        {table.map((player) => (
          <Button key={player.name} size="sm" onClick={() => onAward(player.name)}>
            {player.name}
          </Button>
        ))}
        <Button size="sm" variant="secondary" onClick={onMiss}>
          Nobody got it
        </Button>
      </div>
    </div>
  );
}

/**
 * The standings and the words that were played.
 *
 * There is no Save button: a session's scores are not written anywhere, because players
 * are typed names and the shared board identifies a player by account. See
 * `PictionaryPlayer` in `src/lib/games/types.ts` for the full reasoning.
 */
function SummaryScreen({
  state,
  onAgain,
}: {
  state: PictionaryState;
  onAgain: () => void;
}) {
  const ranked = pictionaryStandings(state);

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl border border-line bg-paper-raised p-4">
        <h3 className="mb-3 font-display text-xl text-ink">Final scores</h3>
        <ol className="flex flex-col gap-2">
          {ranked.map((player, index) => (
            <li
              key={player.name}
              className="flex items-center justify-between gap-3 border-b border-line pb-2 last:border-0 last:pb-0"
            >
              <span className="flex items-center gap-2">
                <span className="w-5 text-sm tabular-nums text-muted">{index + 1}</span>
                <span className="text-ink">{player.name}</span>
                <span className="text-xs text-muted">
                  {player.turnsTaken} {player.turnsTaken === 1 ? "turn" : "turns"} drawing
                </span>
              </span>
              <strong className="font-display tabular-nums text-ink">
                {player.score.toLocaleString()}
              </strong>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-xl border border-line bg-paper-raised p-4">
        <h4 className="mb-2 font-display text-base text-ink">The words</h4>
        <ul className="flex flex-col gap-1 text-sm">
          {state.rounds.map((entry, index) => (
            <li key={`${entry.word}-${index}`} className="flex flex-wrap gap-x-2 text-muted">
              <span className="text-ink">{entry.word}</span>
              <span>&mdash; drawn by {entry.drawer},</span>
              <span>
                {entry.outcome === "guessed" && `guessed by ${entry.guesser}`}
                {entry.outcome === "missed" && "nobody got it"}
                {entry.outcome === "skipped" && "skipped"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onAgain}>Play again</Button>
        <span className="text-xs text-muted">
          These scores aren&rsquo;t saved anywhere &mdash; write them down if they matter.
        </span>
      </div>
    </div>
  );
}
