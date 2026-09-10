import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISUALIZER_MODE,
  isVisualizerMode,
  VISUALIZER_MODES,
  FULLSCREEN_ONLY_MODES,
  isInlineMode,
  inlineModeFor,
  spectrumKindFor,
  BAR_STYLES,
  energyBand,
  galaxyParticles,
  galaxyPosition,
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
  it("accepts the three real modes", () => {
    expect(isVisualizerMode("bars")).toBe(true);
    expect(isVisualizerMode("fire")).toBe(true);
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

  it("lists every mode it accepts, so a picker cannot fall out of step", () => {
    expect(VISUALIZER_MODES).toEqual(["bars", "fire", "wave", "circular", "galaxy"]);
    for (const mode of VISUALIZER_MODES) expect(isVisualizerMode(mode)).toBe(true);
  });
});

describe("BAR_STYLES", () => {
  it("draws fire as the narrower, denser of the two bar styles", () => {
    expect(BAR_STYLES.fire.count).toBeGreaterThan(BAR_STYLES.bars.count);
    expect(BAR_STYLES.fire.widthFraction).toBeLessThan(BAR_STYLES.bars.widthFraction);
  });

  it("keeps every width fraction inside a slot", () => {
    for (const style of Object.values(BAR_STYLES)) {
      expect(style.widthFraction).toBeGreaterThan(0);
      expect(style.widthFraction).toBeLessThanOrEqual(1);
      expect(style.count).toBeGreaterThan(0);
    }
  });
});

describe("inline vs fullscreen modes", () => {
  it("keeps the circle and the galaxy out of the strip", () => {
    expect(isInlineMode("circular")).toBe(false);
    expect(isInlineMode("galaxy")).toBe(false);
  });

  it("lets the three flat modes draw inline", () => {
    expect(isInlineMode("bars")).toBe(true);
    expect(isInlineMode("fire")).toBe(true);
    expect(isInlineMode("wave")).toBe(true);
  });

  it("substitutes a drawable mode rather than leaving the strip blank", () => {
    expect(inlineModeFor("galaxy")).toBe("bars");
    expect(inlineModeFor("circular")).toBe("bars");
  });

  it("leaves an inline mode alone", () => {
    expect(inlineModeFor("wave")).toBe("wave");
  });

  it("only ever falls back to something that can draw inline", () => {
    for (const mode of VISUALIZER_MODES) {
      expect(isInlineMode(inlineModeFor(mode))).toBe(true);
    }
  });

  it("every fullscreen-only mode is a real mode", () => {
    for (const mode of FULLSCREEN_ONLY_MODES) {
      expect(isVisualizerMode(mode)).toBe(true);
    }
  });
});

describe("spectrumKindFor", () => {
  it("reads the time domain only for the waveform", () => {
    expect(spectrumKindFor("wave")).toBe("waveform");
  });

  it("reads frequencies for everything else", () => {
    for (const mode of VISUALIZER_MODES.filter((m) => m !== "wave")) {
      expect(spectrumKindFor(mode)).toBe("frequency");
    }
  });
});

describe("energyBand", () => {
  it("reports silence as zero", () => {
    expect(energyBand(new Uint8Array(100), 0, 1)).toBe(0);
  });

  it("reports a full-scale band as one", () => {
    expect(energyBand(new Uint8Array(100).fill(255), 0, 1)).toBeCloseTo(1);
  });

  it("separates a loud low end from a quiet top", () => {
    // Loud in the first tenth of the usable range, silent above it.
    const bytes = new Uint8Array(100);
    for (let index = 0; index < 6; index += 1) bytes[index] = 255;

    expect(energyBand(bytes, 0, 0.1)).toBeGreaterThan(energyBand(bytes, 0.6, 1));
  });

  it("survives an empty reading rather than dividing by zero", () => {
    expect(energyBand(new Uint8Array(0), 0, 1)).toBe(0);
  });

  it("clamps a band given backwards or out of range", () => {
    const bytes = new Uint8Array(100).fill(128);
    expect(energyBand(bytes, -5, 99)).toBeGreaterThanOrEqual(0);
    expect(energyBand(bytes, -5, 99)).toBeLessThanOrEqual(1);
  });
});

describe("galaxyParticles", () => {
  it("builds the field it was asked for", () => {
    expect(galaxyParticles(50)).toHaveLength(50);
  });

  it("is deterministic, so the field does not reshuffle on every mount", () => {
    expect(galaxyParticles(20, 7)).toEqual(galaxyParticles(20, 7));
  });

  it("gives different seeds different fields", () => {
    expect(galaxyParticles(20, 1)).not.toEqual(galaxyParticles(20, 2));
  });

  it("keeps every particle inside the unit disc", () => {
    for (const particle of galaxyParticles(200)) {
      expect(particle.orbit).toBeGreaterThanOrEqual(0);
      expect(particle.orbit).toBeLessThanOrEqual(1);
      expect(particle.speed).toBeGreaterThan(0);
      expect(particle.size).toBeGreaterThan(0);
    }
  });

  it("returns nothing for a zero or negative count", () => {
    expect(galaxyParticles(0)).toEqual([]);
    expect(galaxyParticles(-5)).toEqual([]);
  });
});

describe("galaxyPosition", () => {
  const particle = { orbit: 0.5, phase: 0, speed: 1, size: 1 };

  it("starts a zero-phase particle out along the x axis", () => {
    const { x, y } = galaxyPosition(particle, 0, 0);
    expect(x).toBeCloseTo(0.5);
    expect(y).toBeCloseTo(0);
  });

  it("moves the particle round as time passes", () => {
    const start = galaxyPosition(particle, 0, 0);
    const later = galaxyPosition(particle, 1, 0);
    expect(later.x).not.toBeCloseTo(start.x);
  });

  it("pushes the field outward with the bass", () => {
    const quiet = galaxyPosition(particle, 0, 0);
    const loud = galaxyPosition(particle, 0, 1);
    expect(Math.hypot(loud.x, loud.y)).toBeGreaterThan(Math.hypot(quiet.x, quiet.y));
  });

  it("never flings a particle outside the unit circle", () => {
    for (const orbit of [0, 0.5, 1]) {
      for (const bass of [0, 0.5, 1, 5]) {
        const { x, y } = galaxyPosition({ ...particle, orbit }, 3, bass);
        expect(Math.hypot(x, y)).toBeLessThanOrEqual(1.0001);
      }
    }
  });
});
