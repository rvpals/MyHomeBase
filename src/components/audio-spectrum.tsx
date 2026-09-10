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
  BAR_STYLES,
  type BarStyle,
  DEFAULT_VISUALIZER_MODE,
  energyBand,
  galaxyParticles,
  galaxyPosition,
  type GalaxyParticle,
  spectrumBars,
  spectrumKindFor,
  waveformPoints,
  type VisualizerMode,
} from "@/lib/music";

// `spectrum.ts` holds no React and no state -- it is arithmetic over a byte array -- so
// importing it here keeps the bucketing where it has tests rather than inlining it into
// a canvas that cannot be tested.

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Particles in the galaxy field.
 *
 * Enough to read as a disc, few enough that the per-frame cost is a couple of hundred
 * `arc` calls -- which is nothing next to the compositing the browser is already doing
 * for a fullscreen canvas.
 */
const GALAXY_PARTICLE_COUNT = 220;

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
  /**
   * Fills its container instead of drawing as a fixed-height strip. For the
   * fullscreen view, where the canvas is the whole screen.
   */
  fill?: boolean;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

export function AudioSpectrum({
  readSpectrum,
  spectrumSize,
  mode = DEFAULT_VISUALIZER_MODE,
  isPlaying,
  fill = false,
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
    // "fire" draws in its own palette rather than brass -- see the --flame-* block in
    // globals.css for why it is deliberately a different material.
    const flameBase = styles.getPropertyValue("--flame-base").trim() || "#7a1803";
    const flameMid = styles.getPropertyValue("--flame-mid").trim() || "#e8590c";
    const flameTip = styles.getPropertyValue("--flame-tip").trim() || "#ffd43a";
    const galaxyCore = styles.getPropertyValue("--galaxy-core").trim() || "#9df5e0";
    const galaxyRim = styles.getPropertyValue("--galaxy-rim").trim() || "#2b7fd4";

    // The component owns its buffer, allocated once. Allocating per frame is how a
    // visualizer becomes the thing that makes a page stutter.
    const buffer = new Uint8Array(spectrumSize);

    // The galaxy's field is fixed for the life of the mount: built once here, moved
    // per frame by `galaxyPosition`. Building it every frame would allocate 200
    // objects sixty times a second to draw the same dots in new places.
    const particles = mode === "galaxy" ? galaxyParticles(GALAXY_PARTICLE_COUNT) : [];
    // Wall clock rather than a frame counter, so the rotation runs at the same speed
    // on a 60Hz and a 144Hz screen.
    const startedAt = performance.now();

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

      if (!readSpectrum(buffer, spectrumKindFor(mode))) {
        frame = requestAnimationFrame(draw);
        return;
      }

      if (mode === "wave") drawWave(context, buffer, width, height, brass);
      else if (mode === "fire")
        drawBars(context, buffer, width, height, BAR_STYLES.fire, [
          flameBase,
          flameMid,
          flameTip,
        ]);
      else if (mode === "circular")
        drawCircular(context, buffer, width, height, brassDark, brass);
      else if (mode === "galaxy")
        drawGalaxy(
          context,
          buffer,
          width,
          height,
          particles,
          (performance.now() - startedAt) / 1000,
          galaxyCore,
          galaxyRim,
        );
      else
        drawBars(context, buffer, width, height, BAR_STYLES.bars, [brassDark, brass]);

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
  }, [readSpectrum, spectrumSize, mode, isPlaying, reduceMotion]);

  // Nothing to say to a screen reader: it conveys no information the transport does not
  // already carry, which is exactly why it is safe to drop under reduced motion.
  if (spectrumSize === 0) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      // `fill` drops the strip height so a caller can size the box instead -- the
      // fullscreen view wants the whole screen, and Tailwind cannot be relied on to
      // resolve `h-16` vs `h-full` by source order.
      className={`w-full ${fill ? "h-full" : "h-16 max-lg:h-10"} ${className}`}
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

/**
 * Frequency bars, rising from the bottom edge -- both the `bars` and `fire` modes.
 *
 * One function for the two of them because they differ only in geometry and palette,
 * which are exactly the two things passed in. `style` comes from `BAR_STYLES`, where
 * the numbers sit next to the mode they describe.
 *
 * `ramp` is bottom-to-top colour stops, spread evenly: two for brass, three for flame.
 */
function drawBars(
  context: CanvasRenderingContext2D,
  buffer: Uint8Array,
  width: number,
  height: number,
  style: BarStyle,
  ramp: readonly string[],
): void {
  const bars = spectrumBars(buffer, style.count);
  const slot = width / style.count;
  // Floored at half a pixel so a narrow canvas still draws something -- canvas renders
  // a sub-pixel rect as a faint line, which for the thin style is the look anyway.
  const barWidth = Math.max(0.5, slot * style.widthFraction);

  const gradient = context.createLinearGradient(0, height, 0, 0);
  for (let stop = 0; stop < ramp.length; stop += 1) {
    // Evenly spaced, so a 2-stop ramp is 0/1 and a 3-stop ramp is 0/0.5/1 with no
    // special case for either.
    gradient.addColorStop(stop / Math.max(1, ramp.length - 1), ramp[stop] ?? "");
  }
  context.fillStyle = gradient;

  for (let index = 0; index < bars.length; index += 1) {
    // A floor of 1px: a silent band still shows where the bar lives, so the row reads
    // as a visualizer at rest rather than as a rendering failure.
    const barHeight = Math.max(1, (bars[index] ?? 0) * height);
    // Centred in its slot, so the gap sits evenly either side rather than all of it
    // trailing to the right.
    const x = index * slot + (slot - barWidth) / 2;
    context.fillRect(x, height - barHeight, barWidth, barHeight);
  }
}

/**
 * The spectrum wrapped into a ring, bars radiating outward.
 *
 * Same log buckets as `drawBars` -- only the coordinate maths differs. The ring's
 * radius comes from the *smaller* axis so the circle stays a circle on any aspect,
 * which is the whole reason this mode is fullscreen-only: in a 64px strip the smaller
 * axis is 64px and the "circle" is a bracelet.
 *
 * Bars are drawn as thick line segments rather than rotated rects: a stroked line from
 * the ring outward is one call and needs no save/restore per bar.
 */
function drawCircular(
  context: CanvasRenderingContext2D,
  buffer: Uint8Array,
  width: number,
  height: number,
  innerColor: string,
  outerColor: string,
): void {
  const bars = spectrumBars(buffer, CIRCULAR_BAR_COUNT);
  const centreX = width / 2;
  const centreY = height / 2;
  // The ring sits at 30% of the available half-axis, leaving the outer 70% for bars
  // at full deflection -- so a loud passage reaches the edge without clipping.
  const limit = Math.min(width, height) / 2;
  const innerRadius = limit * 0.3;
  const maxBarLength = limit * 0.62;

  const gradient = context.createRadialGradient(
    centreX,
    centreY,
    innerRadius,
    centreX,
    centreY,
    innerRadius + maxBarLength,
  );
  gradient.addColorStop(0, innerColor);
  gradient.addColorStop(1, outerColor);
  context.strokeStyle = gradient;
  context.lineCap = "round";
  // Just under the angular pitch, so neighbours nearly touch without overlapping.
  context.lineWidth = Math.max(1, ((Math.PI * 2 * innerRadius) / CIRCULAR_BAR_COUNT) * 0.7);

  context.beginPath();
  for (let index = 0; index < bars.length; index += 1) {
    // Start at -90deg so bar zero points up; a spectrum that starts at 3 o'clock
    // reads as rotated by mistake.
    const angle = (index / bars.length) * Math.PI * 2 - Math.PI / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // A floor, as in `drawBars`: silence should still show the ring's shape.
    const length = Math.max(1, (bars[index] ?? 0) * maxBarLength);

    context.moveTo(centreX + cos * innerRadius, centreY + sin * innerRadius);
    context.lineTo(
      centreX + cos * (innerRadius + length),
      centreY + sin * (innerRadius + length),
    );
  }
  // One stroke for every bar: batching the whole ring into a single path is what keeps
  // this cheap at 60fps.
  context.stroke();
}

/** Bars around the circular visualizer's ring. */
const CIRCULAR_BAR_COUNT = 128;

/**
 * An orbiting particle field that breathes with the music.
 *
 * The placement arithmetic lives in `spectrum.ts` (`galaxyParticles` / `galaxyPosition`)
 * where it is tested; this function is the paint. Bass drives the radius, treble the
 * brightness, so the low end moves the shape and the high end lights it.
 */
function drawGalaxy(
  context: CanvasRenderingContext2D,
  buffer: Uint8Array,
  width: number,
  height: number,
  particles: readonly GalaxyParticle[],
  elapsedSeconds: number,
  coreColor: string,
  rimColor: string,
): void {
  // Bottom tenth is the bass; the top third is where cymbals and air live.
  const bass = energyBand(buffer, 0, 0.1);
  const treble = energyBand(buffer, 0.6, 1);
  const centreX = width / 2;
  const centreY = height / 2;
  const limit = Math.min(width, height) / 2;
  // Never quite to the edge: a particle clipped by the canvas edge reads as a
  // rendering fault rather than as an orbit.
  const maxRadius = limit * 0.88;

  // `lighter` is what makes overlapping particles pool into a brighter core, which is
  // the difference between a galaxy and a scatter plot.
  const previousComposite = context.globalCompositeOperation;
  context.globalCompositeOperation = "lighter";

  for (const particle of particles) {
    const { x, y } = galaxyPosition(particle, elapsedSeconds, bass);
    // `galaxyPosition` returns -1..1, so one multiply puts it on the canvas.
    const screenX = centreX + x * maxRadius;
    const screenY = centreY + y * maxRadius;

    // Inner particles take the core colour, outer ones the rim colour. Stepped rather
    // than a true gradient per dot: two fillStyle values across the whole field costs
    // nothing, a per-particle gradient object would cost an allocation each.
    context.fillStyle = particle.orbit < 0.55 ? coreColor : rimColor;
    // Treble lifts the whole field's opacity, with a floor so it never vanishes in a
    // quiet passage.
    context.globalAlpha = 0.25 + treble * 0.65;

    const dotRadius = Math.max(0.5, particle.size * limit * 0.012);
    context.beginPath();
    context.arc(screenX, screenY, dotRadius, 0, Math.PI * 2);
    context.fill();
  }

  // Reset both: a canvas context is shared with the next frame's draw, and leaving
  // `lighter` set would make every other mode glow.
  context.globalAlpha = 1;
  context.globalCompositeOperation = previousComposite;
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
  context.lineWidth = 1;
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
