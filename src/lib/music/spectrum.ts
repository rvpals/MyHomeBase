// Turning an analyser's raw bytes into something drawable.
//
// The player's visualizer reads a Web Audio `AnalyserNode` sixty times a second, but
// none of the arithmetic below needs Web Audio to exist -- both functions take a byte
// array and return numbers. That is deliberate: it keeps the only real *logic* in the
// feature out of the canvas component, where it could not be tested, and puts it here
// where it can. The component is left holding a draw call.
//
// Both functions return values in 0..1 with the caller's requested length, so a canvas
// can multiply by its own height and know nothing about FFT bin counts.

/**
 * How a visualizer reads the analyser. Mirrors `SpectrumKind` in the player provider.
 *
 * `bars` and `fire` are the same arithmetic drawn at different widths -- see
 * `BAR_STYLES` -- while `wave` is the only one that reads the time domain.
 */
export type VisualizerMode = "bars" | "fire" | "wave" | "circular" | "galaxy";

/** The modes, in the order a picker should list them. */
export const VISUALIZER_MODES: readonly VisualizerMode[] = [
  "bars",
  "fire",
  "wave",
  "circular",
  "galaxy",
];

/** The mode used when nothing is stored, or when a stored value is unrecognised. */
export const DEFAULT_VISUALIZER_MODE: VisualizerMode = "bars";

/** Narrows an arbitrary string to a mode, for reading a settings row back. */
export function isVisualizerMode(value: string): value is VisualizerMode {
  return (VISUALIZER_MODES as readonly string[]).includes(value);
}

/**
 * The modes that only make sense filling a screen.
 *
 * A circle and an orbiting particle field both need height as much as width, and the
 * inline visualizer is a 64px strip (40px on a phone) -- squashed into that, a circle
 * is an ellipse and a galaxy is a smear. Rather than resize the player's layout around
 * the mode, these two render only in the fullscreen view, and the strip falls back to
 * `INLINE_FALLBACK_MODE` while one of them is selected.
 */
export const FULLSCREEN_ONLY_MODES: readonly VisualizerMode[] = ["circular", "galaxy"];

/** What the inline strip draws when the chosen mode cannot render there. */
export const INLINE_FALLBACK_MODE: VisualizerMode = "bars";

/** Whether `mode` can be drawn in the short inline strip. */
export function isInlineMode(mode: VisualizerMode): boolean {
  return !FULLSCREEN_ONLY_MODES.includes(mode);
}

/**
 * The mode the inline strip should actually draw, given the chosen one.
 *
 * Returning a drawable mode rather than "nothing" is deliberate: a strip that empties
 * itself when you pick `galaxy` reads as a bug, and the player still wants *something*
 * moving next to the transport.
 */
export function inlineModeFor(mode: VisualizerMode): VisualizerMode {
  return isInlineMode(mode) ? mode : INLINE_FALLBACK_MODE;
}

/** Which time-domain / frequency reading a mode needs from the analyser. */
export function spectrumKindFor(mode: VisualizerMode): "frequency" | "waveform" {
  return mode === "wave" ? "waveform" : "frequency";
}

/**
 * How a bar-drawing mode lays its bars out.
 *
 * Here rather than in the canvas because it is the entire difference between `bars`
 * and `fire`: same buckets, same draw call, different geometry. Keeping the numbers
 * beside the mode they belong to means adding a third bar style is a row in this
 * record, not another branch in a draw function.
 *
 * `widthFraction` is the share of each bar's slot that the bar itself fills; the
 * remainder is the gap. Wide bars with a hairline gap read as a chart, narrow bars
 * with a wide gap read as flame.
 */
export interface BarStyle {
  /** Bars across the full width. */
  count: number;
  /** 0..1 -- how much of its slot each bar fills. */
  widthFraction: number;
}

export const BAR_STYLES: Record<"bars" | "fire", BarStyle> = {
  bars: { count: 48, widthFraction: 0.7 },
  fire: { count: 96, widthFraction: 0.4 },
};

/**
 * Buckets frequency magnitudes into `barCount` bars, each 0..1.
 *
 * **Logarithmically**, not linearly, and that is the whole reason this function exists.
 * An FFT spreads its bins evenly across the frequency range, but music does not: with
 * a 2048-point FFT at 48kHz, everything below 1kHz -- which is most of what you hear as
 * "the song" -- lands in the first ~4% of the bins. Split those bins into equal groups
 * and you get two bars that move and forty-six that sit flat near zero, which is exactly
 * what a dead-looking visualizer is. Grouping by octaves instead gives each bar a
 * roughly equal share of what the ear treats as range.
 *
 * Bytes are 0..255 straight from `getByteFrequencyData`, already log-scaled to decibels
 * by the analyser, so the only conversion needed here is the divide.
 *
 * A bucket that lands empty (more bars than bins at the bottom of the range, where the
 * octaves are narrowest) reports the bin it started from rather than zero -- a gap in
 * the middle of a spectrum reads as a glitch, not as silence.
 */
export function spectrumBars(frequencies: Uint8Array, barCount: number): number[] {
  if (barCount <= 0) return [];
  if (frequencies.length === 0) return new Array<number>(barCount).fill(0);

  // The top of the range is mostly inaudible hiss that never moves; including it wastes
  // a third of the width on flat bars. 60% of the bins is about 14kHz at a 48kHz rate.
  const usable = Math.max(1, Math.floor(frequencies.length * 0.6));
  const bars: number[] = [];

  for (let index = 0; index < barCount; index += 1) {
    // Exponential edges: each bar covers a constant *ratio* of the range, so bar 40
    // spans many more bins than bar 1.
    const start = binEdge(index, barCount, usable);
    const end = binEdge(index + 1, barCount, usable);

    let total = 0;
    let counted = 0;
    for (let bin = start; bin < end; bin += 1) {
      total += frequencies[bin] ?? 0;
      counted += 1;
    }

    // Empty bucket: borrow the single bin at this position instead of reporting a hole.
    const average = counted > 0 ? total / counted : (frequencies[start] ?? 0);
    bars.push(clampUnit(average / 255));
  }

  return bars;
}

/**
 * The exponential bin boundary for bar `index` of `barCount`, over `binCount` bins.
 *
 * Starts at bin 1, not 0: bin 0 is the DC offset, which carries no pitch and sits at a
 * constant value that would peg the first bar.
 */
function binEdge(index: number, barCount: number, binCount: number): number {
  const ratio = index / barCount;
  const edge = Math.floor(binCount ** ratio);
  return Math.min(Math.max(edge, 1), binCount);
}

/**
 * Resamples a time-domain waveform to `width` points, each 0..1 with 0.5 as silence.
 *
 * `getByteTimeDomainData` centres its samples on 128 rather than 0, so silence is a
 * flat line down the middle and not along the bottom -- the 0.5 midpoint here preserves
 * that, and lets a caller draw by multiplying against its height with no further
 * arithmetic.
 *
 * Each output point takes the sample **furthest from the midpoint** in its window, not
 * the average. Averaging a waveform is how you erase it: a symmetric oscillation sums
 * back to the midpoint, so an averaged loud passage looks identical to silence. Peak
 * picking keeps the envelope, which is the part worth seeing.
 */
export function waveformPoints(samples: Uint8Array, width: number): number[] {
  if (width <= 0) return [];
  if (samples.length === 0) return new Array<number>(width).fill(0.5);

  const points: number[] = [];
  // Fewer samples than requested points is legitimate -- a small FFT against a wide
  // canvas -- and then windows are narrower than one sample. Clamping the read into
  // range makes those points repeat the nearest sample, which is the right picture: a
  // stretched waveform, not a line that drops to the midpoint wherever the window
  // happened to fall between two samples.
  const windowSize = samples.length / width;

  for (let index = 0; index < width; index += 1) {
    const start = clampIndex(Math.floor(index * windowSize), samples.length);
    // At least one sample per point, however narrow the window.
    const windowEnd = clampIndex(Math.floor((index + 1) * windowSize), samples.length);
    const end = Math.max(windowEnd, start + 1);

    let peak = 128;
    let peakDistance = -1;
    for (let position = start; position < end; position += 1) {
      const sample = samples[position] ?? 128;
      const distance = Math.abs(sample - 128);
      if (distance > peakDistance) {
        peakDistance = distance;
        peak = sample;
      }
    }

    points.push(clampUnit(peak / 255));
  }

  return points;
}

/**
 * The average level across a slice of the spectrum, 0..1.
 *
 * `from`/`to` are fractions of the *usable* range, so `energyBand(bytes, 0, 0.1)` is
 * "the bottom tenth" -- roughly the bass -- without a caller needing to know the FFT
 * size. Both visualizers below drive their motion from this rather than from a single
 * bin, because one bin is noisy enough to make a ring jitter.
 */
export function energyBand(frequencies: Uint8Array, from: number, to: number): number {
  if (frequencies.length === 0) return 0;

  const usable = Math.max(1, Math.floor(frequencies.length * 0.6));
  const start = clampIndex(Math.floor(usable * clampUnit(from)), usable);
  const end = Math.max(clampIndex(Math.ceil(usable * clampUnit(to)), usable), start + 1);

  let total = 0;
  for (let bin = start; bin < end; bin += 1) total += frequencies[bin] ?? 0;

  return clampUnit(total / (end - start) / 255);
}

/** One particle's fixed place in the galaxy -- the part that never changes. */
export interface GalaxyParticle {
  /** 0..1 of the maximum radius. */
  orbit: number;
  /** Starting angle, radians. */
  phase: number;
  /** Relative angular speed. Inner particles orbit faster, as in a real disc. */
  speed: number;
  /** 0..1, so a field does not look stamped from one dot. */
  size: number;
}

/**
 * Builds the galaxy's particle field.
 *
 * Deterministic from `seed` rather than `Math.random()`: a fixed field can be built
 * once and reused every frame, and a test can assert on it. The alternative -- random
 * per mount -- would also mean the layout changed every time you opened the view,
 * which reads as instability rather than as variety.
 *
 * `sqrt` on the orbit spreads particles evenly over the *disc's area*; a linear radius
 * would crowd them all into the middle, because a ring's circumference grows with r.
 */
export function galaxyParticles(count: number, seed = 1): GalaxyParticle[] {
  const particles: GalaxyParticle[] = [];
  let state = seed;

  // A small LCG. Not a good random number generator, and it does not need to be --
  // it needs to be the same sequence every time and cheap.
  const next = (): number => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };

  for (let index = 0; index < Math.max(0, count); index += 1) {
    const orbit = Math.sqrt(next());
    particles.push({
      orbit,
      phase: next() * Math.PI * 2,
      // Keplerian-ish: closer in, faster round. Floored so the outermost still drifts.
      speed: 0.35 + (1 - orbit) * 0.9,
      size: 0.4 + next() * 0.6,
    });
  }

  return particles;
}

/**
 * Where a particle sits at a given moment, in unit coordinates centred on 0.
 *
 * `bass` pushes the whole field outward -- the ring breathes with the low end, which
 * is the part of a track a listener already feels. Returned as -1..1 so the caller
 * multiplies by its own radius and this stays free of canvas dimensions.
 */
export function galaxyPosition(
  particle: GalaxyParticle,
  elapsedSeconds: number,
  bass: number,
): { x: number; y: number } {
  const angle = particle.phase + elapsedSeconds * particle.speed;
  // Capped expansion: at full bass the field grows by half, not without limit, so a
  // loud passage cannot fling every particle off the canvas.
  const radius = clampUnit(particle.orbit * (1 + clampUnit(bass) * 0.5));

  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

/** Holds an index inside the array, so a read can never fall off the end. */
function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(index, 0), Math.max(0, length - 1));
}

/** Holds a value inside 0..1, so a caller can multiply by a height without checking. */
function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}
