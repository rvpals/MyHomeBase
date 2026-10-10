"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/button";
import { useGameSounds } from "@/components/use-game-sounds";
import {
  PACMAN_COLS,
  PACMAN_ROWS,
  mazeTileAt,
  pacmanTickIntervalMs,
  fireBazooka,
  queueDirection,
  renderPacmanRows,
  startPacman,
  tickPacman,
  type Ghost,
  type GhostName,
  type PacmanDirection,
  type PacmanState,
  type PacmanTile,
} from "@/lib/games";
import { saveScoreAction } from "./games-actions";

// The Pac-Man maze. A client component that owns only presentation state and the
// clock — every rule comes from @/lib/games (src/lib/games/game-pacman.ts), so
// nothing here decides what a move does or where a ghost goes.
//
// The arcade's second real-time game after Tetris, and the first where the *opponents*
// move on the clock too. The clock lives here rather than in the library because a
// `setInterval` is a browser concern, but its period is not — `pacmanTickIntervalMs`
// owns the difficulty curve and this file just obeys it, exactly as the Tetris view
// obeys `dropIntervalMs`.
//
// The library steps whole tiles per tick (see the note at the top of `game-pacman.ts`).
// The glide the player sees is a CSS transition on the sprites, applied here — which is
// the right side of the line: the rules are comparable between ticks, and the smoothing
// is presentation.

const GAME_KEY = "pacman";

/**
 * How long the death sequence is shown before the next life starts, in milliseconds.
 *
 * Gameplay as much as cosmetics, like Tetris's `LINE_CLEAR_MS`: the clock is suspended
 * for exactly this long, which is the beat that lets the player register what happened
 * before four ghosts start moving again. The CSS reads the same value through
 * `--pacman-death-ms`, so the two cannot drift apart.
 */
const DEATH_MS = 900;

/**
 * Ghost colours, as fixed literal values.
 *
 * **The arcade's own palette** — red Blinky, pink Pinky, cyan Inky, orange Clyde. This
 * is the same exception `design.md` grants the tetromino colours and for the same
 * reason: these four are not decoration that a theme may restyle, they are how the
 * player tells one ghost's *behaviour* from another's. Recolouring Inky to a brand
 * token would make the game unreadable in the precise sense that matters — you would
 * no longer know which one is about to cut you off.
 */
const GHOST_COLOURS: Record<GhostName, string> = {
  blinky: "#ff0000",
  pinky: "#ffb8de",
  inky: "#00ffff",
  clyde: "#ffb847",
};

/** The frightened blue every ghost turns, and the white it flashes before time is up. */
const FRIGHTENED_BLUE = "#2121de";
const FRIGHTENED_WHITE = "#f8f8f8";

/**
 * Ticks of frightened time left at which the ghosts start flashing.
 *
 * The warning that the power pellet is running out, and the reason an experienced
 * player breaks off a chase rather than being caught mid-pounce.
 */
const FLASH_FROM = 12;

/**
 * How many tiles of fire follow Pac-Man.
 *
 * Five is the length at which the trail reads as a comet rather than as a smear: it
 * spans most of a corridor without reaching all the way round a corner, so it still
 * shows *which way he came from*, which is the thing it is actually for. Longer and
 * the maze fills with glow and the pellets stop being readable underneath it.
 */
const TRAIL_LENGTH = 5;

/**
 * Ticks of a bazooka's life left at which it starts flashing.
 *
 * The only warning the player gets that a pickup is about to expire, which is what
 * turns the TTL into a visible deadline rather than something that vanishes without
 * explanation. Roughly three seconds at the level-1 tick rate.
 */
const BAZOOKA_EXPIRY_WARNING = 15;

/**
 * The board sizes the player can pick between, as multipliers on the default cap.
 *
 * A multiplier rather than a pixel size, because the board is already capped by three
 * competing terms (see the wrapper's `maxWidth`) and each binds on a different screen.
 * Scaling the whole expression keeps all three relationships intact — a 2x board is
 * still held inside a phone's width and a short window's height, it just stops being
 * limited by the comfortable desktop cap first.
 *
 * `1` is the default rather than the smallest: the maze at 28x31 is legible at the
 * base size and 2x is for a big monitor or for sitting further back, so the useful
 * range is upward. A size below 1 would make the pellets sub-pixel.
 */
const BOARD_SCALES = [1, 1.5, 2] as const;

type BoardScale = (typeof BOARD_SCALES)[number];

/** Where the chosen board size is remembered between sessions. */
const SCALE_STORAGE_KEY = "mhb.pacman.boardScale";

/** A stored value is untrusted input, so it is matched against the list, not cast. */
function parseBoardScale(stored: string | null): BoardScale | undefined {
  const value = Number(stored);
  return BOARD_SCALES.find((scale) => scale === value);
}

/**
 * How Pac-Man is turned to face his direction of travel.
 *
 * The mouth in `.pacman-toy` is cut pointing along +X, so the sprite is rotated and
 * the CSS never has to know which way he is going. Travelling left is a vertical flip
 * on top of the half-turn — a plain 180° rotation would stand him on his head and put
 * the eye underneath. `"none"` keeps the last real facing, which is why a Pac-Man
 * stopped against a wall still points the way the player is holding.
 */
function facingStyle(direction: PacmanDirection): { rotate: string; flip: boolean } {
  switch (direction) {
    case "up":
      return { rotate: "-90deg", flip: false };
    case "down":
      return { rotate: "90deg", flip: false };
    case "left":
      return { rotate: "180deg", flip: true };
    default:
      return { rotate: "0deg", flip: false };
  }
}

/* ---------------------------------------------------------------------------------
   Sound.
--------------------------------------------------------------------------------- */

/**
 * Pac-Man's cue vocabulary, over the arcade's shared beeper.
 *
 * `useGameSounds` owns the audio context and the envelope; what lives here is only
 * *what a Pac-Man event sounds like*, which is the part no other game can share.
 *
 * **Everything is synthesized, nothing is sampled.** The arcade's actual waka, siren
 * and death spiral are recordings and they are Namco's; these are the same gestures
 * rebuilt out of oscillators. That also means this game ships no audio assets and
 * makes no network requests, which is the property `use-game-sounds.ts` exists to keep.
 *
 * The cues follow the lesson the Tetris vocabulary records in its own comment: sine and
 * triangle only, every one filtered, attacks soft enough not to click. A square wave
 * would be more faithful to a 1980 cabinet and would sound like a fault buzzer through
 * a laptop speaker.
 */
function useSounds(enabled: boolean) {
  const sounds = useGameSounds(enabled);

  return useMemo(
    () => ({
      /**
       * The chomp — the signature sound of the game.
       *
       * Alternates between two pitches on successive pellets, which is the whole
       * trick: *waka-waka* is not one sound repeated, it is two sounds alternating,
       * and a single pitch here reads as a stutter rather than as eating. The caller
       * passes which half of the pair this is.
       *
       * Kept very quiet (0.022) and very short — it fires up to ten times a second at
       * speed, and anything louder becomes the only thing you can hear.
       */
      waka: (high: boolean) =>
        sounds.play({
          startHz: high ? 440 : 330,
          endHz: high ? 330 : 240,
          durationMs: 55,
          type: "triangle",
          peak: 0.022,
          cutoffHz: 900,
          attackMs: 8,
        }),
      /**
       * A power pellet: a low, swelling throb that says the tables have turned.
       *
       * Deliberately the lowest cue in the game, and the only one that rises rather
       * than falls — every other pitch here descends, so an ascending sweep reads
       * immediately as something good.
       */
      power: () =>
        sounds.playSequence([
          { startHz: 70, endHz: 160, durationMs: 260, type: "triangle", peak: 0.07, cutoffHz: 700, attackMs: 20 },
          {
            startHz: 110,
            endHz: 240,
            durationMs: 320,
            type: "sine",
            peak: 0.06,
            cutoffHz: 1100,
            attackMs: 22,
            afterMs: 150,
          },
        ]),
      /**
       * Eating a ghost: a fast rising sweep, pitched up for each one in the same
       * pellet so the 200/400/800/1600 ladder is *audible* as well as scored. By the
       * fourth it is almost a shriek, which is the reward for chasing all four.
       */
      eatGhost: (index: number) => {
        const base = 220 * Math.pow(1.5, Math.min(index, 3));
        sounds.playSequence([
          { startHz: base, endHz: base * 2.4, durationMs: 150, type: "triangle", peak: 0.07, cutoffHz: 2400, attackMs: 10 },
          {
            startHz: base * 2.4,
            endHz: base * 3.2,
            durationMs: 180,
            type: "sine",
            peak: 0.06,
            cutoffHz: 2800,
            attackMs: 12,
            afterMs: 120,
          },
        ]);
      },
      /**
       * The death spiral — the most recognisable sound in the game after the chomp.
       *
       * A long tumbling descent built as six overlapping downward sweeps rather than
       * one, because the original's character comes from the *steps*: it falls, catches,
       * falls again. A single smooth glide down reads as a slide whistle.
       */
      death: () => {
        const steps = [520, 440, 360, 290, 220, 160];
        sounds.playSequence(
          steps.map((hz, index) => ({
            startHz: hz,
            endHz: hz * 0.55,
            durationMs: 180,
            type: "triangle" as const,
            peak: 0.075,
            cutoffHz: 1400,
            attackMs: 10,
            afterMs: index * 115,
          })),
        );
      },
      /** An extra life: a bright two-bell flourish, the only bells in this game. */
      extraLife: () => {
        sounds.playBell({ hz: 784, durationMs: 700, peak: 0.07, brightness: 0.6 });
        sounds.playBell({ hz: 1046.5, durationMs: 1000, peak: 0.08, brightness: 0.7, afterMs: 140 });
      },
      /**
       * Collecting the bazooka: a bright mechanical two-note *clack-chink*.
       *
       * Deliberately metallic where every other pickup cue in this game is round —
       * a pellet is soft and a power pellet throbs, so the weapon wants to sound
       * like hardware rather than food. The short square-ish attack is the one place
       * a harder edge is right here.
       */
      pickupBazooka: () =>
        sounds.playSequence([
          { startHz: 300, endHz: 420, durationMs: 70, type: "triangle", peak: 0.055, cutoffHz: 2200, attackMs: 6 },
          {
            startHz: 880,
            endHz: 1180,
            durationMs: 180,
            type: "sine",
            peak: 0.06,
            cutoffHz: 3200,
            attackMs: 8,
            afterMs: 80,
          },
        ]),
      /**
       * Firing: a low thump and a departing whoosh.
       *
       * Two voices because a launch is two events — the charge leaving the tube and
       * the shell travelling away. The descending sweep is what sells the departure;
       * a single thump reads as a door closing.
       */
      fire: () =>
        sounds.playSequence([
          { startHz: 150, endHz: 60, durationMs: 190, type: "triangle", peak: 0.08, cutoffHz: 800, attackMs: 6 },
          {
            startHz: 1300,
            endHz: 280,
            durationMs: 260,
            type: "sine",
            peak: 0.05,
            cutoffHz: 2600,
            attackMs: 10,
            afterMs: 40,
          },
        ]),
      /**
       * A ghost destroyed by the shell: the impact.
       *
       * Heavier and lower than `eatGhost`, and falling rather than rising — eating a
       * ghost is a reward you chased down, where this is something you *did to* it.
       * The two must not be confused, since they score differently.
       */
      explode: () =>
        sounds.playSequence([
          { startHz: 420, endHz: 70, durationMs: 300, type: "triangle", peak: 0.09, cutoffHz: 1200, attackMs: 5 },
          {
            startHz: 220,
            endHz: 45,
            durationMs: 420,
            type: "sine",
            peak: 0.07,
            cutoffHz: 600,
            attackMs: 12,
            afterMs: 90,
          },
        ]),
      /** Clearing a board: a short rising peal, pentatonic so it cannot sour. */
      levelClear: () => {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((hz, index) =>
          sounds.playBell({
            hz,
            durationMs: index === notes.length - 1 ? 1000 : 520,
            peak: index === notes.length - 1 ? 0.08 : 0.055,
            brightness: 0.45 + index * 0.1,
            afterMs: index * 120,
          }),
        );
      },
    }),
    [sounds],
  );
}

/* ---------------------------------------------------------------------------------
   The view.
--------------------------------------------------------------------------------- */

export function GamePacmanView({ bestScore }: { bestScore: number }) {
  // Lazily initialised and only ever on the client, for the reason `GameTetrisView`
  // records: `startPacman()` is deterministic, but seeding on mount keeps this view
  // the same shape as its siblings and the board renders identically either way.
  const [state, setState] = useState<PacmanState | undefined>(undefined);
  const [paused, setPaused] = useState(false);
  const [saveNote, setSaveNote] = useState<string | undefined>(undefined);
  const [soundOn, setSoundOn] = useState(true);
  /** Set while the death sequence plays, which also suspends the clock. */
  const [dying, setDying] = useState(false);

  /**
   * How big the board is drawn, remembered between sessions.
   *
   * `localStorage` rather than a `sys_module_settings` key: this is a per-player
   * display preference on one screen, and the Games module deliberately has no
   * settings table (see `games-configuration-view.tsx`). Persisting it in the
   * database would mean a migration and would also make it shared, when the right
   * size depends on whose monitor is in front of it.
   */
  const [boardScale, setBoardScale] = useState<BoardScale>(1);
  const scaleLoadedRef = useRef(false);

  // Read on mount, not in the initialiser: `localStorage` does not exist on the
  // server, so reading it during render would make the first client render disagree
  // with the server's HTML. The board therefore draws once at 1x before a stored
  // preference lands, which is the same trade `chart-toolbar.tsx` makes.
  useEffect(() => {
    try {
      const stored = parseBoardScale(window.localStorage.getItem(SCALE_STORAGE_KEY));
      /* eslint-disable-next-line react-hooks/set-state-in-effect --
         Syncing from an external system (localStorage) on mount, not reacting to
         React state. Same pattern as the chart toolbar's stored display. */
      if (stored) setBoardScale(stored);
    } catch {
      // Storage can be unavailable (private browsing). 1x still applies.
    }
    scaleLoadedRef.current = true;
  }, []);

  // Guarded by `scaleLoadedRef` so this does not write 1x back over the stored value
  // on the first pass, before the read above has run.
  useEffect(() => {
    if (!scaleLoadedRef.current) return;
    try {
      window.localStorage.setItem(SCALE_STORAGE_KEY, String(boardScale));
    } catch {
      // Not worth surfacing — the session still honours the choice.
    }
  }, [boardScale]);

  const sounds = useSounds(soundOn);

  /**
   * The cue set and the latched facing, as refs.
   *
   * Both exist so `fire` can stay a stable `useCallback` with no dependencies. The
   * keyboard handler closes over the render it was attached in, so reading either of
   * these from a captured value would mean firing along a stale direction, or
   * through a muted cue set, after the player had already changed it.
   */
  const cuesRef = useRef(sounds);
  const facingRef = useRef<PacmanDirection>("right");

  // Mirrored in an effect rather than assigned during render: a ref written mid-render
  // is not safe under Strict Mode or a concurrent re-render, and the cue only has to
  // be current by the time a key is actually pressed.
  useEffect(() => {
    cuesRef.current = sounds;
  }, [sounds]);

  // Guards the one-shot save: `outcome` alone would re-fire on every re-render after
  // the game ends, posting the same score repeatedly.
  const savedRef = useRef(false);

  const newGame = useCallback(() => {
    setState(startPacman());
    setPaused(false);
    setDying(false);
    setSaveNote(undefined);
    savedRef.current = false;
  }, []);

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
       Seeding client-only state on mount, matching the other arcade views. */
    newGame();
  }, [newGame]);

  const over = state?.outcome !== undefined;

  /**
   * The clock.
   *
   * Re-created whenever the level changes, which is what makes the game speed up: the
   * period is read from `pacmanTickIntervalMs` at that moment. Cleared while paused,
   * during the death sequence, and after the run ends, so a finished maze does not
   * keep ticking.
   */
  useEffect(() => {
    if (!state || over || paused || dying) return;

    const id = setInterval(() => {
      setState((current) => (current ? tickPacman(current, Math.random) : current));
    }, pacmanTickIntervalMs(state.level));

    return () => clearInterval(id);
    // `state.level` only: re-subscribing on every state change would restart the
    // interval on each keypress, letting a player postpone the ghosts indefinitely by
    // holding a key down. Same trap as the Tetris gravity effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.level, over, paused, dying, state === undefined]);

  /**
   * The cues that belong to events rather than to keypresses.
   *
   * Everything audible in this game is something the *game* did — the clock moves
   * Pac-Man into a pellet, and the ghosts move themselves — so every cue is detected
   * by comparing against the previous state rather than fired from a handler. That is
   * the same shape as the Tetris lock/level/top-out effect, and for the same reason:
   * there is no input to hang them off.
   */
  const previousRef = useRef<
    | {
        score: number;
        pelletsLeft: number;
        lives: number;
        level: number;
        frightened: number;
        ghostsEaten: number;
      }
    | undefined
  >(undefined);

  /** Flips on each pellet, so the chomp alternates pitch. See `waka`. */
  const wakaHighRef = useRef(false);

  useEffect(() => {
    if (!state) {
      previousRef.current = undefined;
      return;
    }

    const previous = previousRef.current;
    previousRef.current = {
      score: state.score,
      pelletsLeft: state.pelletsLeft,
      lives: state.lives,
      level: state.level,
      frightened: state.frightenedTicks,
      ghostsEaten: state.ghostsEatenThisPower,
    };

    // First observation of a new game: nothing to compare against, and a cue here
    // would fire on mount before the player has touched anything.
    if (!previous) return;

    // Death wins over everything else in the same transition — it is the loudest
    // thing that can happen and the other cues would only muddy it.
    if (state.dying) {
      sounds.death();
      return;
    }

    if (state.level > previous.level) {
      sounds.levelClear();
      return;
    }

    // An extra life is awarded by score, so it can land on the same tick as a pellet.
    // It is the rarer and more important of the two, so it speaks alone.
    if (state.lives > previous.lives) {
      sounds.extraLife();
      return;
    }

    if (state.ghostsEatenThisPower > previous.ghostsEaten) {
      sounds.eatGhost(previous.ghostsEaten);
      return;
    }

    // A power pellet is a pellet too, so this is tested first and returns — otherwise
    // the throb and the chomp fire together and the throb loses.
    if (state.frightenedTicks > previous.frightened) {
      sounds.power();
      return;
    }

    // Both of these are one-tick flags the library sets, so they are read directly
    // rather than diffed — there is no previous value to compare against.
    if (state.shotGhost) {
      sounds.explode();
      return;
    }

    if (state.collectedBazooka) {
      sounds.pickupBazooka();
      return;
    }

    if (state.pelletsLeft < previous.pelletsLeft) {
      wakaHighRef.current = !wakaHighRef.current;
      sounds.waka(wakaHighRef.current);
    }
  }, [state, sounds]);

  /**
   * The death pause.
   *
   * Keyed on `dying`, which the library sets for exactly one tick — so this starts
   * once per death rather than restarting while the flag happens to be true. The
   * clock effect above is suspended for the duration.
   */
  const isDying = state?.dying ?? false;
  useEffect(() => {
    if (!isDying) return;
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
       Starting a timed sequence in response to a state change is what an effect is
       for; there is no render-time equivalent. */
    setDying(true);
    const timer = window.setTimeout(() => setDying(false), DEATH_MS);
    return () => window.clearTimeout(timer);
  }, [isDying]);

  // Save once, when the run ends. In an effect rather than inside the tick because the
  // final score is only known after React has applied the state update.
  useEffect(() => {
    if (!state || !over || savedRef.current) return;
    savedRef.current = true;

    void saveScoreAction(GAME_KEY, state.score, state.moves).then((result) => {
      if (!result.ok) {
        setSaveNote(result.error);
        return;
      }
      setSaveNote(result.best ? "New record — saved to the board." : "Score saved.");
    });
  }, [over, state]);

  /**
   * Asks for a turn. Every control goes through here.
   *
   * Unlike the Tetris equivalent this fires no cue, because a turn is not an event in
   * this game — `queueDirection` only records intent, and whether it becomes a move is
   * decided by the clock one tick later. The chomp that follows is the feedback.
   */
  const steer = useCallback((direction: PacmanDirection) => {
    setState((current) => (current ? queueDirection(current, direction) : current));
  }, []);

  /**
   * Fires the bazooka along the way Pac-Man is facing.
   *
   * The facing is read from the state inside the updater rather than from
   * `facingDirection` above, and that matters: the keyboard handler closes over
   * whatever render it was attached in, so a captured value would fire along a stale
   * direction after a fast turn. `current.direction` is the authority, with the
   * latched facing only as the fallback for a Pac-Man stopped against a wall — he
   * should still be able to shoot the ghost he is cornered by.
   */
  const fire = useCallback(() => {
    setState((current) => {
      if (!current) return current;
      const facing = current.direction === "none" ? facingRef.current : current.direction;
      const next = fireBazooka(current, facing);
      // `fireBazooka` returns the same object when it refuses (no ammo, shell already
      // out), so this is an exact test for "the shot happened" — the same referential
      // signal the Tetris rules use.
      if (next !== current) cuesRef.current?.fire();
      return next;
    });
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const handled: Record<string, () => void> = {
        ArrowLeft: () => steer("left"),
        a: () => steer("left"),
        ArrowRight: () => steer("right"),
        d: () => steer("right"),
        ArrowUp: () => steer("up"),
        w: () => steer("up"),
        ArrowDown: () => steer("down"),
        s: () => steer("down"),
        // Space fires. It also scrolls the page, which `preventDefault` below stops.
        " ": fire,
        f: fire,
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
      // The arrows scroll the page; every key handled here is prevented and anything
      // else is left to the browser.
      event.preventDefault();
      action();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [steer, fire, paused]);

  /**
   * The fire trail: the tiles Pac-Man has just left, newest first.
   *
   * Derived from the position history rather than from the state, because the rules
   * do not record where he has been — and should not. The trail cannot catch a ghost,
   * light a pellet or change a collision; it is drawn from positions the library
   * already produced, which is exactly why it lives here and not in `game-pacman.ts`.
   *
   * Rebuilt on each tile change rather than on each render: a render that does not
   * move him (a pause, a sound toggle) must not age the fire, or the trail would
   * evaporate while the game sat still.
   */
  const [trail, setTrail] = useState<readonly { row: number; col: number; key: number }[]>([]);
  const trailKeyRef = useRef(0);

  const pacRow = state?.pacman.row;
  const pacCol = state?.pacman.col;
  useEffect(() => {
    if (pacRow === undefined || pacCol === undefined) return;
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
       The trail is a history of a value that only exists tick by tick; there is no
       render-time way to know the previous tile. */
    setTrail((current) => {
      const head = current[0];
      // The same tile again — he is stopped against a wall, and a stopped Pac-Man
      // should not keep stacking embers on one square.
      if (head && head.row === pacRow && head.col === pacCol) return current;
      trailKeyRef.current += 1;
      const next = [{ row: pacRow, col: pacCol, key: trailKeyRef.current }, ...current];
      return next.slice(0, TRAIL_LENGTH);
    });
  }, [pacRow, pacCol]);

  // A fresh life or a new board teleports him, and a trail left hanging across the
  // maze would draw a line between where he died and where he restarted.
  const livesLeft = state?.lives;
  const levelNow = state?.level;
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
       Clearing a presentation history in response to a discontinuity in the game. */
    setTrail([]);
  }, [livesLeft, levelNow]);

  /**
   * The direction the toy is drawn facing.
   *
   * The library reports `"none"` the moment he is pressed into a wall, and turning him
   * back to face right on every bump would make him spin at a dead end. So the last
   * *real* direction is held and reused — he keeps pointing the way he was going,
   * which is both what the arcade does and what the player expects to see.
   *
   * State rather than a ref written during render: this value is *drawn*, so it has to
   * be something React re-renders on, and a ref mutated mid-render is not.
   */
  const [facingDirection, setFacingDirection] = useState<PacmanDirection>("right");
  const liveDirection = state?.direction;
  useEffect(() => {
    if (!liveDirection || liveDirection === "none") return;
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
       Latching the last non-stopped direction; there is no render-time equivalent
       because the value has to survive ticks where the library reports "none". */
    setFacingDirection(liveDirection);
  }, [liveDirection]);
  // The ref mirrors the state so `fire` (which has no dependencies) always sees the
  // current facing. Written in an effect rather than during render, for the reason
  // the state exists at all.
  useEffect(() => {
    facingRef.current = facingDirection;
  }, [facingDirection]);
  const facing = facingStyle(facingDirection);

  /**
   * The board's width cap, and the moulding depth derived from it.
   *
   * Built once and used twice, because the two must agree: `--sprite-unit` is a
   * fraction of a tile, and a tile is a twenty-eighth of this width. Writing the
   * expression out a second time would be a copy to keep in step on every change to
   * the zoom or the caps.
   *
   * `boardScale` multiplies all three terms rather than replacing them, so every
   * relationship the cap encodes survives the zoom: 2x is still held inside a phone's
   * width and a short window's height, it has just stopped being limited by the
   * comfortable desktop cap first. Multiplying only `34rem` would let a 2x board
   * overflow a laptop window, which is the bug this shape avoids.
   *
   * The height clamp is `87vh` converted through the board's own ratio, and the
   * conversion is the point: this cap is a *width*, but the maze is taller than it is
   * wide (31/28). A raw `96vh` width budget would draw a board 96 × 31/28 ≈ 106vh
   * tall — taller than the window, which is exactly how a 2x board overflowed a
   * laptop before the ratio was applied.
   */
  const boardMaxWidth = `min(${34 * boardScale}rem, min(${94 * boardScale}vw, 100vw), min(${
    56 * boardScale
  }vh, ${((87 * PACMAN_COLS) / PACMAN_ROWS).toFixed(2)}vh))`;
  const boardUnit = `calc(${boardMaxWidth} / ${PACMAN_COLS} / 20)`;

  const rows = state ? renderPacmanRows(state) : undefined;
  const shownBest = Math.max(bestScore, state?.score ?? 0);
  const frightened = (state?.frightenedTicks ?? 0) > 0;
  const flashing = frightened && (state?.frightenedTicks ?? 0) <= FLASH_FROM;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <Stat label="Score" value={(state?.score ?? 0).toLocaleString()} />
          <Stat label="Best" value={shownBest.toLocaleString()} />
          <Stat label="Lives" value={(state?.lives ?? 0).toLocaleString()} />
          <Stat label="Level" value={(state?.level ?? 1).toLocaleString()} />
          {/* Only once he is armed. A permanent "Ammo 0" would be four-fifths of a
              board's worth of dead chrome, and the pickup is occasional. */}
          {(state?.ammo ?? 0) > 0 && <Stat label="Ammo" value="1" />}
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setPaused((value) => !value)} variant="secondary" size="sm" disabled={over}>
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button onClick={newGame} variant="secondary" size="sm">
            New game
          </Button>
          {/* Worded exactly as Tetris's and Arrow Clearing's, so the arcade's noisy
              games all present the same control. */}
          <Button
            onClick={() => setSoundOn((value) => !value)}
            variant="secondary"
            size="sm"
            title={soundOn ? "Mute sound effects" : "Unmute sound effects"}
          >
            {soundOn ? "Sound on" : "Sound off"}
          </Button>
          {/*
            Board size. A cycling button rather than a select, because there are only
            three steps and the control sits in a row of buttons — a dropdown here
            would be the one element needing two interactions instead of one.
          */}
          <Button
            onClick={() =>
              setBoardScale(
                (current) =>
                  BOARD_SCALES[(BOARD_SCALES.indexOf(current) + 1) % BOARD_SCALES.length],
              )
            }
            variant="secondary"
            size="sm"
            title="Change the board size"
          >
            Size {boardScale}&times;
          </Button>
        </div>
      </div>

      <div className="flex flex-col items-center gap-4">
        {/*
          The maze scales with the viewport rather than reflowing — sizing the wrapper,
          not the tiles, keeps the aspect ratio at every width. The same three-term cap
          Tetris uses, and each term binds on a different screen: `34rem` caps it on a
          large monitor, `94vw` keeps it inside a phone, and the `vh` term is the one
          that matters in a full-bleed dialog, where a board capped only by width
          overflows a short landscape window and pushes the pad off-screen.

          That last term converts a height budget into a width, carrying the board's
          own ratio: at 28x31 the maze is 28/31 ≈ 0.90 as wide as it is tall, so a 62vh
          allowance becomes `56vh` of width.
        */}
        {/* The cap and its reasoning are on `boardMaxWidth` above, where the derived
            `--sprite-unit` can be seen to share the same expression. */}
        <div className="w-full" style={{ maxWidth: boardMaxWidth }}>
          <div
            className="relative rounded-xl border border-line bg-black p-2"
            style={{
              // From the constants rather than literals, so the maze cannot end up
              // drawn at a different shape from the one the rules are played on.
              aspectRatio: `${PACMAN_COLS} / ${PACMAN_ROWS}`,
              ["--pacman-death-ms" as string]: `${DEATH_MS}ms`,
              /*
                The depth unit every sprite's moulding is measured in: one twentieth
                of a tile. The rim shadows, the drop shadows and the flame blur are
                all multiples of this rather than fixed pixels, so a 2x board gets
                proportionally deeper moulding instead of the same 2px rim spread over
                a tile twice the size — which would read as flatter the bigger it got.

                This repeats the width expression rather than using `100% / COLS`,
                and it has to: `box-shadow` offsets and `blur()` take a <length>, and
                a percentage there is invalid — the whole declaration would be dropped
                and every sprite would render flat. Percentages are only legal for the
                *sizes* above, which is why those still use them.
              */
              ["--sprite-unit" as string]: boardUnit,
            }}
            role="img"
            aria-label={`Pac-Man maze, ${state?.pelletsLeft ?? 0} pellets left`}
          >
            {/*
              The maze itself, as one absolutely-positioned grid. Walls and pellets are
              drawn as grid cells; the four ghosts and Pac-Man are positioned over the
              top in percentages so they can transition smoothly between tiles rather
              than jumping on each tick.
            */}
            <div
              className="grid h-full w-full"
              style={{
                gridTemplateColumns: `repeat(${PACMAN_COLS}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${PACMAN_ROWS}, minmax(0, 1fr))`,
              }}
            >
              {(rows ?? emptyMaze()).map((row, rowIndex) =>
                row.map((tile, colIndex) => (
                  <div
                    // Index as key is correct here and only here: a cell is a fixed
                    // position in the maze, not a thing that travels between them.
                    key={`${rowIndex},${colIndex}`}
                    className="flex items-center justify-center"
                  >
                    {tile === "wall" && (
                      <span className="h-full w-full rounded-[1px] bg-[#1919a6]" />
                    )}
                    {tile === "door" && <span className="h-[2px] w-full bg-[#ffb8de]" />}
                    {tile === "pellet" && (
                      <span className="h-[18%] w-[18%] rounded-full bg-[#ffb897]" />
                    )}
                    {tile === "power" && (
                      <span className="h-[55%] w-[55%] animate-pacman-power rounded-full bg-[#ffb897]" />
                    )}
                  </div>
                )),
              )}
            </div>

            {/* Pac-Man and the ghosts, over the maze. */}
            {state && (
              <>
                {/*
                  The bazooka on the floor. Drawn before everything else so Pac-Man
                  and the ghosts pass over it rather than under it.

                  It flashes for its last couple of seconds, which is the only warning
                  the player gets that it is about to expire — and the thing that makes
                  the TTL a deadline rather than a surprise.
                */}
                {state.bazooka && (
                  <Sprite row={state.bazooka.row} col={state.bazooka.col}>
                    <span
                      className={`pacman-bazooka ${
                        state.bazooka.ttl <= BAZOOKA_EXPIRY_WARNING ? "pacman-bazooka-fading" : ""
                      }`}
                    />
                  </Sprite>
                )}

                {/* The shell. Over the floor, under nothing — it should read as
                    passing in front of the maze, because it is moving fastest. */}
                {state.projectile && (
                  <Sprite row={state.projectile.row} col={state.projectile.col}>
                    <span className="pacman-shell" />
                  </Sprite>
                )}

                {/*
                  The fire trail, drawn BEFORE Pac-Man so he sits on top of his own
                  embers rather than behind them. Skipped while he is dying: a comet
                  tail under a death spin reads as a bug, and the trail's job — showing
                  which way he is travelling — is over once he has stopped.
                */}
                {!dying &&
                  trail.map((spot, index) => {
                    // Age from 0 (the tile just left) to 1 (the last ember). Drives
                    // both the size and the colour temperature, so a flame cools and
                    // shrinks together the way a real one does.
                    const age = trail.length > 1 ? index / (trail.length - 1) : 0;
                    const scale = 0.82 - age * 0.46;
                    return (
                      <Sprite key={spot.key} row={spot.row} col={spot.col}>
                        <span
                          className="pacman-flame"
                          style={{
                            // Centred in the tile at its own size, so a shrinking
                            // ember fades from the middle rather than from a corner.
                            inset: `${((1 - scale) / 2) * 100}%`,
                            // Each stop cools and thins with age. The core outlasts
                            // the edge, which is why a dying ember goes orange-red
                            // rather than simply transparent.
                            ["--flame-core" as string]: `${0.95 - age * 0.62}`,
                            ["--flame-mid" as string]: `${0.78 - age * 0.55}`,
                            ["--flame-edge" as string]: `${0.5 - age * 0.38}`,
                            // Offset each flame's flicker so the trail shimmers along
                            // its length instead of pulsing as one block.
                            animationDelay: `${index * 55}ms`,
                          }}
                        />
                      </Sprite>
                    );
                  })}

                <Sprite row={state.pacman.row} col={state.pacman.col}>
                  {/*
                    Two nested elements, deliberately. The outer one carries the
                    facing rotation and the death spin; the inner carries the moulded
                    body and the chomp. Combining them would mean the death animation
                    fought the facing transform for the same property.
                  */}
                  <span
                    className={`relative block h-full w-full ${
                      dying ? "animate-pacman-death" : ""
                    }`}
                    style={{
                      transform: `rotate(${facing.rotate})${facing.flip ? " scaleY(-1)" : ""}`,
                      // Turning is instant in the arcade and should be here too — an
                      // eased rotation makes a corner look like a skid.
                      transition: "transform 60ms linear",
                    }}
                  >
                    <span className="pacman-toy" />
                    <span className="pacman-eye" />
                  </span>
                </Sprite>

                {state.ghosts.map((ghost) => (
                  <Sprite key={ghost.name} row={ghost.row} col={ghost.col}>
                    <Ghost3D ghost={ghost} flashing={flashing} />
                  </Sprite>
                ))}
              </>
            )}

            {/*
              Paused and game-over states, over the board. `pointer-events-none` on the
              paused overlay so it cannot swallow a tap meant for the pad underneath.
            */}
            {paused && !over && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-black/70">
                <p className="font-display text-xl text-[#ffff00]">Paused</p>
              </div>
            )}
            {over && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-black/80 px-4 text-center">
                <p className="font-display text-xl text-[#ffff00]">Game over</p>
                <p className="text-sm text-white/80">
                  {(state?.score ?? 0).toLocaleString()} points on level{" "}
                  {(state?.level ?? 1).toLocaleString()}
                </p>
                {saveNote && <p className="text-xs text-white/70">{saveNote}</p>}
              </div>
            )}
          </div>
        </div>

        {/*
          The touch pad. Shown only narrow — on a desktop the keyboard is the control
          and a button pad would be dead chrome under the board. A D-pad cross rather
          than a row, because four directions in a line is the one layout nobody can
          use without looking at it.
        */}
        <div className="hidden max-lg:flex max-lg:flex-col max-lg:items-center max-lg:gap-2">
          <PadButton label="↑" name="Up" onPress={() => steer("up")} />
          <div className="flex gap-2">
            <PadButton label="←" name="Left" onPress={() => steer("left")} />
            <PadButton label="↓" name="Down" onPress={() => steer("down")} />
            <PadButton label="→" name="Right" onPress={() => steer("right")} />
          </div>
          {/* Shown only when armed, like the stat — a permanently dead Fire key
              under the pad would be the largest unusable control on the screen. */}
          {(state?.ammo ?? 0) > 0 && (
            <PadButton label="Fire" name="Fire the bazooka" onPress={fire} />
          )}
        </div>

        <p className="text-center text-xs text-muted max-lg:hidden">
          Arrow keys or WASD to steer, P to pause.
        </p>
      </div>
    </div>
  );
}

/**
 * How far a ghost's pupils shift to look where it is going, as a percentage of the eye.
 *
 * The cheapest trick in the whole sprite: four identical shapes with centred pupils
 * drift, and the same four with pupils aimed along their heading read as *hunting*.
 * It is also genuinely useful information — a glance tells you which way a ghost is
 * about to leave a junction.
 *
 * Returned as a pair of CSS percentages for `.ghost-pupil` to consume. A stopped
 * ghost (which only happens in the house) looks straight ahead.
 */
function pupilOffset(direction: PacmanDirection): { x: string; y: string } {
  switch (direction) {
    case "up":
      return { x: "0%", y: "-34%" };
    case "down":
      return { x: "0%", y: "30%" };
    case "left":
      return { x: "-34%", y: "0%" };
    case "right":
      return { x: "34%", y: "0%" };
    default:
      return { x: "0%", y: "0%" };
  }
}

/**
 * One ghost, as a moulded 3D toy.
 *
 * Three states, which are genuinely different drawings rather than one drawing
 * recoloured:
 *
 *   - **Hunting** — its own colour, eyes aimed along its heading, and teeth. The
 *     teeth are what make it read as a threat rather than a mascot.
 *   - **Frightened** — blue (flashing white as the pellet runs out), eyes still
 *     aiming, and **no teeth**. That last part is deliberate: the blue state exists
 *     to say "this one is fleeing and edible", and a snarling blue ghost would
 *     contradict the only thing it needs to communicate.
 *   - **Eaten** — eyes alone, drifting home. No body, because there is nothing there
 *     to catch; drawing one would say otherwise.
 *
 * The body colour is handed to the CSS as `--ghost-body` because it is the one thing
 * that varies; every highlight and shadow in `.ghost-toy` is black or white at low
 * opacity, so one rule set serves all six colours without a variant each.
 */
function Ghost3D({ ghost, flashing }: { ghost: Ghost; flashing: boolean }) {
  const pupil = pupilOffset(ghost.direction);
  const eyeVars = {
    ["--pupil-x" as string]: pupil.x,
    ["--pupil-y" as string]: pupil.y,
  };

  if (ghost.mode === "eaten") {
    return (
      <span className="ghost-eyes-only">
        <span className="ghost-eye">
          <span className="ghost-pupil" style={eyeVars} />
        </span>
        <span className="ghost-eye">
          <span className="ghost-pupil" style={eyeVars} />
        </span>
      </span>
    );
  }

  const frightened = ghost.mode === "frightened";
  const body = frightened
    ? flashing
      ? FRIGHTENED_WHITE
      : FRIGHTENED_BLUE
    : GHOST_COLOURS[ghost.name];

  return (
    <span
      // `relative` because the dome, the hem, the teeth and the eyes are all
      // absolutely positioned against this box.
      className="relative block h-full w-full"
      style={{ ["--ghost-body" as string]: body }}
    >
      {/* The dome and the hem, drawn first so the face sits over them. */}
      <span className="ghost-toy" />
      <span className="ghost-skirt">
        <span className="ghost-scallop" />
        <span className="ghost-scallop" />
        <span className="ghost-scallop" />
      </span>

      {/* The teeth sit under the eyes in the stack but over the body. Hunting only. */}
      {!frightened && <span className="ghost-teeth" />}

      <span className="ghost-eye ghost-eye-left">
        <span className="ghost-pupil" style={eyeVars} />
      </span>
      <span className="ghost-eye ghost-eye-right">
        <span className="ghost-pupil" style={eyeVars} />
      </span>
    </span>
  );
}

/**
 * One sprite, positioned over the maze in percentages of the board.
 *
 * Percentages rather than grid placement, because a grid cell cannot be transitioned
 * between — moving a child from one cell to another is a reflow, which jumps. Position
 * is what carries the CSS transition that smooths the library's whole-tile steps into
 * a glide, and `linear` is right here where an ease would make a constant-speed chase
 * look like it was surging.
 *
 * The transition is deliberately a touch shorter than the fastest tick interval (90ms,
 * see `pacmanTickIntervalMs`), so a sprite always arrives before it is asked to leave.
 */
function Sprite({
  row,
  col,
  children,
}: {
  row: number;
  col: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="pointer-events-none absolute transition-[top,left] duration-[80ms] ease-linear"
      style={{
        // Inset by the board's own `p-2` padding, so a sprite sits on the maze rather
        // than over the border. The percentages are of the padded box.
        top: `calc(0.5rem + ${(row / PACMAN_ROWS) * 100}% - ${(row / PACMAN_ROWS) * 1}rem)`,
        left: `calc(0.5rem + ${(col / PACMAN_COLS) * 100}% - ${(col / PACMAN_COLS) * 1}rem)`,
        width: `calc((100% - 1rem) / ${PACMAN_COLS})`,
        height: `calc((100% - 1rem) / ${PACMAN_ROWS})`,
      }}
    >
      {children}
    </div>
  );
}

/** An empty maze, for the frame before the state is seeded on mount. */
function emptyMaze(): PacmanTile[][] {
  const out: PacmanTile[][] = [];
  for (let row = 0; row < PACMAN_ROWS; row += 1) {
    const cells: PacmanTile[] = [];
    for (let col = 0; col < PACMAN_COLS; col += 1) {
      // The walls, and nothing else: the pellets are state and the server has none.
      // Drawing them here would be markup the client immediately replaces.
      cells.push(mazeTileAt(row, col) === "wall" ? ("wall" as const) : ("empty" as const));
    }
    out.push(cells);
  }
  return out;
}

/**
 * One direction button, for touch.
 *
 * `onPointerDown` rather than `onClick`, as the Tetris pad does: a click fires on
 * release, which on a game this fast means the turn is requested a beat after the
 * player asked for it. `preventDefault` stops the tap also scrolling the dialog.
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
