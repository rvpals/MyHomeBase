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

/** How a visualizer reads the analyser. Mirrors `SpectrumKind` in the player provider. */
export type VisualizerMode = "bars" | "wave";

/** The mode used when nothing is stored, or when a stored value is unrecognised. */
export const DEFAULT_VISUALIZER_MODE: VisualizerMode = "bars";

/** Narrows an arbitrary string to a mode, for reading a settings row back. */
export function isVisualizerMode(value: string): value is VisualizerMode {
  return value === "bars" || value === "wave";
}

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

/** Holds an index inside the array, so a read can never fall off the end. */
function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(index, 0), Math.max(0, length - 1));
}

/** Holds a value inside 0..1, so a caller can multiply by a height without checking. */
function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}
