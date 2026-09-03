"use client";

// A canvas that draws whatever an audio analyser is currently reading.
//
// Pure presentation in the strictest sense available to something animated: it is handed
// a function that fills a byte buffer, and it draws. It does not know what a track is,
// cannot start or stop audio, and holds no preference of its own -- the mode is a prop,
// because deciding which visualizer someone wants is the page's business, not a
// canvas's.
//
// The frame loop deliberately does NOT go through React state. A visualizer updates
// sixty times a second, and a `setState` per frame would re-render the player screen --
// lyrics panel and all -- sixty times a second to animate a decoration. So the loop
// reads into a buffer it owns and paints; nothing above it re-renders at all.

import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  DEFAULT_VISUALIZER_MODE,
  spectrumBars,
  waveformPoints,
  type VisualizerMode,
} from "@/lib/music";

// `spectrum.ts` holds no React and no state -- it is arithmetic over a byte array -- so
// importing it here keeps the bucketing where it has tests rather than inlining it into
// a canvas that cannot be tested.

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export interface AudioSpectrumProps {
  /**
   * Fills the given buffer with the current reading, returning false when there is
   * nothing to read. Supplied by whoever owns the audio graph.
   */
  readSpectrum: (into: Uint8Array<ArrayBuffer>, kind: "frequency" | "waveform") => boolean;
  /** How many bytes `readSpectrum` fills. 0 means no analyser, so nothing renders. */
  spectrumSize: number;
  /** Which visualizer to draw. */
  mode?: VisualizerMode;
  /** Pauses the loop. A paused visualizer costs nothing rather than drawing silence. */
  isPlaying: boolean;
  /** Bars across the width, in `"bars"` mode. */
  barCount?: number;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

export function AudioSpectrum({
  readSpectrum,
  spectrumSize,
  mode = DEFAULT_VISUALIZER_MODE,
  isPlaying,
  barCount = 48,
  className = "",
}: AudioSpectrumProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Decorative motion, so it stops entirely under reduced motion -- design.md's first
  // case. "Something is playing" is already said by the transport and the scrubber, so
  // nothing is lost by holding still.
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || spectrumSize === 0) return;

    const context = canvas.getContext("2d");
    if (context === null) return;

    // Read once: `:root` defines a single fixed dark theme with no runtime swapping, so
    // re-reading per frame would be sixty style recalculations a second for a constant.
    const styles = getComputedStyle(document.documentElement);
    const brass = styles.getPropertyValue("--brass").trim() || "#33e2b8";
    const brassDark = styles.getPropertyValue("--brass-dark").trim() || "#1c8a71";

    // The component owns its buffer, allocated once. Allocating per frame is how a
    // visualizer becomes the thing that makes a page stutter.
    const buffer = new Uint8Array(spectrumSize);

    let frame = 0;
    let width = 0;
    let height = 0;

    // Backing store in device pixels, CSS box in layout pixels -- without this the
    // canvas is soft on every phone and most laptops.
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const box = canvas.getBoundingClientRect();
      width = box.width;
      height = box.height;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const draw = () => {
      context.clearRect(0, 0, width, height);

      const kind = mode === "wave" ? "waveform" : "frequency";
      if (!readSpectrum(buffer, kind)) {
        frame = requestAnimationFrame(draw);
        return;
      }

      if (mode === "wave") drawWave(context, buffer, width, height, brass);
      else drawBars(context, buffer, width, height, barCount, brass, brassDark);

      frame = requestAnimationFrame(draw);
    };

    // A paused player and a reduced-motion preference both mean the same thing here:
    // no loop, and an empty canvas rather than a frozen last frame, which would read
    // as a stuck UI rather than a deliberate blank.
    if (isPlaying && !reduceMotion) frame = requestAnimationFrame(draw);
    else context.clearRect(0, 0, width, height);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [readSpectrum, spectrumSize, mode, isPlaying, barCount, reduceMotion]);

  // Nothing to say to a screen reader: it conveys no information the transport does not
  // already carry, which is exactly why it is safe to drop under reduced motion.
  if (spectrumSize === 0) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`h-16 w-full max-lg:h-10 ${className}`}
    />
  );
}

/**
 * Whether the viewer has asked for less motion.
 *
 * Subscribed rather than read once, so flipping the OS setting takes effect without a
 * reload -- and returned as a value it becomes a dependency of the draw effect, which
 * then starts and stops the loop with no branch of its own.
 *
 * `useSyncExternalStore` rather than `useState` + an effect: a media query IS an
 * external store, and reading one into state from an effect means a second render on
 * every mount (which is what `react-hooks/set-state-in-effect` objects to). The server
 * snapshot is false, so the markup matches a first client paint that has not measured
 * anything yet.
 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeToReducedMotion, getReducedMotion, () => false);
}

function subscribeToReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Frequency bars, rising from the bottom edge. */
function drawBars(
  context: CanvasRenderingContext2D,
  buffer: Uint8Array,
  width: number,
  height: number,
  barCount: number,
  brass: string,
  brassDark: string,
): void {
  const bars = spectrumBars(buffer, barCount);
  const slot = width / barCount;
  // A hairline gap, but never so wide that a narrow canvas loses the bar itself.
  const barWidth = Math.max(1, slot - Math.min(2, slot * 0.3));

  const gradient = context.createLinearGradient(0, height, 0, 0);
  gradient.addColorStop(0, brassDark);
  gradient.addColorStop(1, brass);
  context.fillStyle = gradient;

  for (let index = 0; index < bars.length; index += 1) {
    // A floor of 1px: a silent band still shows where the bar lives, so the row reads
    // as a visualizer at rest rather than as a rendering failure.
    const barHeight = Math.max(1, (bars[index] ?? 0) * height);
    context.fillRect(index * slot, height - barHeight, barWidth, barHeight);
  }
}

/** The waveform, as a line through the vertical middle. */
function drawWave(
  context: CanvasRenderingContext2D,
  buffer: Uint8Array,
  width: number,
  height: number,
  brass: string,
): void {
  // One point per CSS pixel: more would be sub-pixel detail nobody sees.
  const points = waveformPoints(buffer, Math.max(1, Math.round(width)));

  context.beginPath();
  context.lineWidth = 2;
  context.strokeStyle = brass;
  context.lineJoin = "round";

  for (let index = 0; index < points.length; index += 1) {
    const x = (index / Math.max(1, points.length - 1)) * width;
    // The helper centres silence on 0.5, so this maps straight onto the canvas.
    const y = (1 - (points[index] ?? 0.5)) * height;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }

  context.stroke();
}
