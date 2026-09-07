"use client";

// A tiny Web Audio beeper for the arcade's games.
//
// This is a browser API, so it cannot live under src/lib/ — nothing there may depend on
// the browser or React. Same reasoning as `use-current-position.ts`: the hook is the
// adapter, and the game rules it accompanies stay pure in `src/lib/games/`.
//
// Deliberately NOT the music player. `MusicPlayerProvider` models "the thing the user is
// listening to" — one `<audio>` element, a queue, a now-playing bar. A game cue is the
// opposite: dozens a second, no source file, nothing to show in a UI. Playing them
// through the player would fight its state on every keypress.
//
// Tones are **synthesized rather than loaded**, so a game that uses this ships no audio
// assets and adds no network requests.

import { useCallback, useEffect, useMemo, useRef } from "react";

/** The shape a cue takes: a pitch sweep over a duration, at a fixed timbre and volume. */
export interface ToneSpec {
  /** Starting frequency in hertz. */
  startHz: number;
  /**
   * Ending frequency in hertz. The sweep is exponential, so this is the pitch the tone
   * arrives at rather than passes through. Equal to `startHz` for a steady note.
   */
  endHz: number;
  /** How long the tone lasts, in milliseconds. */
  durationMs: number;
  /**
   * Oscillator timbre. `sine` is soft and flute-like, `triangle` slightly brighter,
   * `square` reads as a click or a chiptune blip, `sawtooth` as a buzz or a slam.
   */
  type?: OscillatorType;
  /**
   * Peak gain, 0–1. **Keep this low.** A cue that fires on every keypress wants
   * something around `0.03`; a once-per-game fanfare can go to `0.09`. Anything much
   * above that clips against the rest of the app's audio.
   */
  peak?: number;
  /**
   * Low-pass cutoff in hertz. Omit for none.
   *
   * **This is the knob that decides whether a cue sounds warm or metallic.** A raw
   * `square` or `sawtooth` carries harmonics all the way up, and at the 40–80ms lengths
   * a game cue wants, those high partials read as a harsh electronic *tick* rather than
   * as a pitch. Rolling them off leaves the fundamental and the first few harmonics —
   * the part that actually carries the note.
   *
   * Rough guide: `800`–`1200` for something soft and woody, `2000`–`3000` to take the
   * edge off while keeping it bright, above `6000` for barely any effect.
   */
  cutoffHz?: number;
  /**
   * Attack in milliseconds — how long the tone takes to reach `peak`. Defaults to 10.
   *
   * The other half of "metallic". A near-instant attack is itself a click, whatever the
   * waveform underneath it, because the discontinuity is broadband. Stretching it to
   * 15–30ms turns a tick into a soft onset; much beyond that and a short cue never gets
   * loud enough to hear.
   */
  attackMs?: number;
}

/**
 * One struck bell.
 *
 * A bell is not a filtered sine, which is why it needs its own voice rather than a
 * `ToneSpec` with the right numbers. Two properties make the ear hear "bell":
 *
 *   - **Inharmonic partials.** A struck bell's overtones are not whole-number multiples
 *     of its fundamental — the classic set sits near 2.0, 2.4, 3.0, 4.5 and 5.4 times
 *     it. Harmonic multiples give you an organ; those slightly "wrong" ratios are what
 *     read as struck metal.
 *   - **Per-partial decay.** The high partials die away faster than the low ones, so a
 *     bell is bright at the strike and warm as it rings out. A single envelope over all
 *     of them sounds like a synth pad with a bell-ish spectrum.
 *
 * Both need several oscillators sounding *at once* with independent envelopes, which is
 * exactly what `play` and `playSequence` cannot express.
 */
export interface BellSpec {
  /** Fundamental in hertz — the pitch you hear. */
  hz: number;
  /**
   * How long the longest partial takes to fade, in milliseconds.
   *
   * A small hand bell rings for 600–1200ms; much shorter and it reads as a chime or a
   * click, much longer and it will still be ringing over the next one.
   */
  durationMs?: number;
  /** Peak gain of the fundamental, 0–1. The partials are scaled beneath it. */
  peak?: number;
  /**
   * Brightness, 0–1. How much of the upper, more clangorous partials to mix in.
   *
   * At `0` you get something close to a tuned chime; at `1` a fuller, more metallic
   * strike. Around `0.5` is a clean jingle bell.
   */
  brightness?: number;
  /** Delay before the strike, in milliseconds from now. */
  afterMs?: number;
}

/**
 * The partials of a struck bell, as multiples of the fundamental.
 *
 * `gain` is relative to the fundamental, and `decay` is a fraction of the bell's total
 * duration — note it *falls* as the ratios rise, which is the "bright strike, warm ring"
 * behaviour described on `BellSpec`. The 2.4 and 5.4 entries are the inharmonic ones
 * doing most of the work; drop them and this becomes a pipe organ.
 *
 * `upper` marks the partials that `brightness` scales, so one number can move the voice
 * between a soft chime and a full strike.
 */
const BELL_PARTIALS: readonly { ratio: number; gain: number; decay: number; upper: boolean }[] = [
  { ratio: 1, gain: 1, decay: 1, upper: false },
  { ratio: 2, gain: 0.6, decay: 0.62, upper: false },
  { ratio: 2.4, gain: 0.45, decay: 0.5, upper: true },
  { ratio: 3, gain: 0.3, decay: 0.36, upper: true },
  { ratio: 4.5, gain: 0.18, decay: 0.24, upper: true },
  { ratio: 5.4, gain: 0.12, decay: 0.16, upper: true },
];

export interface GameSounds {
  /** Plays one tone now. A no-op when muted, or where Web Audio is unavailable. */
  play: (spec: ToneSpec) => void;
  /**
   * Plays a sequence of tones, each after its own delay in milliseconds from now.
   *
   * For arpeggios and two-note flicks. The delays are absolute rather than cumulative,
   * so reading a sequence tells you when each note lands without adding up the ones
   * before it.
   */
  playSequence: (steps: readonly (ToneSpec & { afterMs?: number })[]) => void;
  /** Strikes one bell. See `BellSpec` for why this is a separate voice. */
  playBell: (spec: BellSpec) => void;
}

/**
 * A muted, inert set of cues.
 *
 * Returned when sound is off, so callers never branch on `enabled` themselves.
 */
const SILENT: GameSounds = { play: () => {}, playSequence: () => {}, playBell: () => {} };

/**
 * The arcade's sound effects.
 *
 * The AudioContext is created on the first *cue*, never on mount: browsers refuse to
 * start one without a user gesture, and an autoplay-blocked context logs a console
 * warning on every page load. By the time a game plays anything the player has pressed
 * a key, so the context starts cleanly. It is held in a ref because a context is
 * expensive to build and a game may fire hundreds of cues.
 *
 * ```tsx
 * const [soundOn, setSoundOn] = useState(true);
 * const sounds = useGameSounds(soundOn);
 *
 * const cues = useMemo(
 *   () => ({
 *     move: () => sounds.play({ startHz: 220, endHz: 200, durationMs: 40, type: "square", peak: 0.025 }),
 *   }),
 *   [sounds],
 * );
 * ```
 *
 * Each game defines its own cue vocabulary on top of this — a "line cleared" means
 * nothing here. What's shared is the context lifecycle and the envelope, which is the
 * part that's fiddly to get right twice.
 *
 * @param enabled Whether to make sound. Flipping this to `false` releases the audio
 *   device immediately; flipping it back builds a fresh context on the next cue.
 */
export function useGameSounds(enabled: boolean): GameSounds {
  const contextRef = useRef<AudioContext | null>(null);
  // Every pending `playSequence` timer, so a sequence in flight can be cut off when the
  // player mutes or leaves. Without this, muting mid-arpeggio still plays the rest.
  const timersRef = useRef<number[]>([]);

  const release = useCallback(() => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current = [];
    void contextRef.current?.close();
    contextRef.current = null;
  }, []);

  // Muting releases the hardware rather than just going quiet: a "muted" game that still
  // holds the audio device open is the thing a laptop battery notices.
  useEffect(() => {
    if (enabled) return;
    release();
  }, [enabled, release]);

  // And again when the game closes; a leaked context keeps the device awake for the life
  // of the tab.
  useEffect(() => release, [release]);

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

  const play = useCallback(
    ({
      startHz,
      endHz,
      durationMs,
      type = "sine",
      peak = 0.09,
      cutoffHz,
      attackMs = 10,
    }: ToneSpec) => {
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

      // The attack is capped at a third of the cue so a short tone still reaches full
      // volume before it has to start fading; without that, a 40ms cue with a 30ms
      // attack would be inaudible.
      const seconds = durationMs / 1000;
      const attack = Math.min(attackMs / 1000, seconds / 3);

      // A gain that stops at a non-zero value clicks audibly, and exponentialRamp
      // cannot reach exactly 0 — hence the near-silent floor at both ends.
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);

      // Oscillator → [filter] → gain → out. The filter is optional so the games written
      // before it existed keep their exact sound.
      if (cutoffHz === undefined) {
        oscillator.connect(gain);
      } else {
        const filter = audio.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(cutoffHz, now);
        // A gentle resonance. The default of 1 sounds flat and slightly dull; much above
        // this and the cutoff itself starts to whistle, which is the problem we came to
        // solve.
        filter.Q.setValueAtTime(0.7, now);
        oscillator.connect(filter).connect(gain);
      }

      gain.connect(audio.destination);
      oscillator.start(now);
      oscillator.stop(now + seconds + 0.02);
    },
    [context],
  );

  const playSequence = useCallback(
    (steps: readonly (ToneSpec & { afterMs?: number })[]) => {
      for (const { afterMs = 0, ...spec } of steps) {
        if (afterMs <= 0) {
          play(spec);
          continue;
        }
        const timer = window.setTimeout(() => {
          timersRef.current = timersRef.current.filter((id) => id !== timer);
          play(spec);
        }, afterMs);
        timersRef.current.push(timer);
      }
    },
    [play],
  );


  /**
   * Strikes a bell: every partial started together, each with its own decay.
   *
   * All the oscillators share one output gain so `peak` means the same thing it does on
   * `play`, and so the whole strike can be scheduled with a single `afterMs` rather than
   * six separate timers.
   */
  const playBell = useCallback(
    ({ hz, durationMs = 900, peak = 0.09, brightness = 0.5, afterMs = 0 }: BellSpec) => {
      const strike = () => {
        const audio = context();
        if (!audio) return;

        const now = audio.currentTime;
        const seconds = durationMs / 1000;

        const out = audio.createGain();
        out.gain.setValueAtTime(peak, now);
        out.connect(audio.destination);

        for (const partial of BELL_PARTIALS) {
          const level = partial.gain * (partial.upper ? brightness : 1);
          // Below this the partial is inaudible but still costs a node — and a strike
          // at brightness 0 would otherwise build four silent oscillators.
          if (level < 0.005) continue;

          const oscillator = audio.createOscillator();
          const gain = audio.createGain();

          // Sine for every partial: the spectrum is built here, from the ratios, so an
          // oscillator with harmonics of its own would smear it.
          oscillator.type = "sine";
          oscillator.frequency.setValueAtTime(hz * partial.ratio, now);

          // 3ms to full. A bell is a *strike* — this is the one place an abrupt attack
          // is right, and stretching it is what would make it sound synthetic.
          const decay = seconds * partial.decay;
          gain.gain.setValueAtTime(0.0001, now);
          gain.gain.exponentialRampToValueAtTime(level, now + 0.003);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);

          oscillator.connect(gain).connect(out);
          oscillator.start(now);
          oscillator.stop(now + decay + 0.02);
        }
      };

      if (afterMs <= 0) {
        strike();
        return;
      }
      const timer = window.setTimeout(() => {
        timersRef.current = timersRef.current.filter((id) => id !== timer);
        strike();
      }, afterMs);
      timersRef.current.push(timer);
    },
    [context],
  );

  return useMemo(
    () => (enabled ? { play, playSequence, playBell } : SILENT),
    [enabled, play, playSequence, playBell],
  );
}
