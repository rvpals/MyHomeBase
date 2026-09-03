import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISUALIZER_MODE,
  isVisualizerMode,
  spectrumBars,
  waveformPoints,
} from "./spectrum";

// The visualizer's arithmetic, pinned away from the canvas that draws it.
//
// The cases worth having are the degenerate ones: silence must look like silence, a
// stored settings row can hold anything, and the bar count is a prop somebody will
// eventually pass a zero to.

/** A frequency array where every bin is the same value. */
function flatBins(length: number, value: number): Uint8Array {
  return new Uint8Array(length).fill(value);
}

describe("spectrumBars", () => {
  it("returns exactly the requested number of bars", () => {
    expect(spectrumBars(flatBins(1024, 100), 48)).toHaveLength(48);
    expect(spectrumBars(flatBins(1024, 100), 1)).toHaveLength(1);
  });

  it("reports silence as all zeros", () => {
    const bars = spectrumBars(flatBins(1024, 0), 32);

    expect(bars).toHaveLength(32);
    expect(bars.every((bar) => bar === 0)).toBe(true);
  });

  it("reports a full-scale signal as all ones", () => {
    const bars = spectrumBars(flatBins(1024, 255), 32);

    expect(bars.every((bar) => bar === 1)).toBe(true);
  });

  it("keeps every bar inside 0..1", () => {
    const bins = new Uint8Array(1024);
    for (let index = 0; index < bins.length; index += 1) bins[index] = index % 256;

    const bars = spectrumBars(bins, 48);

    expect(bars.every((bar) => bar >= 0 && bar <= 1)).toBe(true);
  });

  it("leaves no empty bar when there are more bars than usable bins", () => {
    // 20 bins -> 12 usable after the 60% cut, split across 48 bars: most buckets are
    // empty, and every one of them must still report its bin rather than a hole.
    const bars = spectrumBars(flatBins(20, 200), 48);

    expect(bars).toHaveLength(48);
    expect(bars.every((bar) => bar > 0)).toBe(true);
  });

  it("spreads low frequencies across many bars rather than one", () => {
    // Energy only in the bottom bins -- a bass note. Under linear bucketing this lights
    // one bar; the logarithmic split is supposed to give it several.
    const bins = new Uint8Array(1024);
    for (let index = 1; index < 16; index += 1) bins[index] = 255;

    const bars = spectrumBars(bins, 48);
    const lit = bars.filter((bar) => bar > 0.1).length;

    expect(lit).toBeGreaterThan(3);
  });

  it("returns nothing for a non-positive bar count", () => {
    expect(spectrumBars(flatBins(1024, 100), 0)).toEqual([]);
    expect(spectrumBars(flatBins(1024, 100), -5)).toEqual([]);
  });

  it("reports zeros when the analyser gave back no bins", () => {
    expect(spectrumBars(new Uint8Array(0), 4)).toEqual([0, 0, 0, 0]);
  });
});

describe("waveformPoints", () => {
  it("returns exactly the requested number of points", () => {
    expect(waveformPoints(flatBins(2048, 128), 200)).toHaveLength(200);
  });

  it("draws silence as a flat line down the middle", () => {
    // 128 is the time-domain midpoint, not zero -- silence is centred, not at the floor.
    const points = waveformPoints(flatBins(2048, 128), 100);

    expect(points.every((point) => point === 128 / 255)).toBe(true);
  });

  it("carries full-scale extremes through to 0 and 1", () => {
    expect(waveformPoints(flatBins(64, 255), 8).every((point) => point === 1)).toBe(true);
    expect(waveformPoints(flatBins(64, 0), 8).every((point) => point === 0)).toBe(true);
  });

  it("keeps the peak rather than averaging an oscillation away", () => {
    // A symmetric square wave: every window averages back to the midpoint, so an
    // averaging implementation would render this as silence.
    const samples = new Uint8Array(64);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = index % 2 === 0 ? 255 : 0;
    }

    const points = waveformPoints(samples, 8);

    expect(points.every((point) => point === 0 || point === 1)).toBe(true);
  });

  it("repeats points instead of reading past the end when samples are scarce", () => {
    const points = waveformPoints(flatBins(4, 200), 16);

    expect(points).toHaveLength(16);
    expect(points.every((point) => point === 200 / 255)).toBe(true);
  });

  it("returns nothing for a non-positive width", () => {
    expect(waveformPoints(flatBins(2048, 128), 0)).toEqual([]);
  });

  it("centres the line when the analyser gave back no samples", () => {
    expect(waveformPoints(new Uint8Array(0), 3)).toEqual([0.5, 0.5, 0.5]);
  });
});

describe("isVisualizerMode", () => {
  it("accepts the two real modes", () => {
    expect(isVisualizerMode("bars")).toBe(true);
    expect(isVisualizerMode("wave")).toBe(true);
  });

  it("rejects anything a hand-edited settings row might hold", () => {
    expect(isVisualizerMode("")).toBe(false);
    expect(isVisualizerMode("Bars")).toBe(false);
    expect(isVisualizerMode("spectrum")).toBe(false);
  });

  it("defaults to bars", () => {
    expect(DEFAULT_VISUALIZER_MODE).toBe("bars");
  });
});
