"use client";

// The home screen's module picker: a coverflow of large module graphics, one
// selected at a time.
//
// Replaced the grid of `ModuleCard`s. The trade is deliberate — a grid shows
// everything at once and reads as a list; this shows one module at a time,
// large, and reads as a choice. With only a handful of modules the neighbours
// stay on screen either side, so nothing is actually hidden.
//
// Pure presentation: the page supplies the modules, this renders them. The
// selected graphic is a real `<Link>`, so a module is still an ordinary
// navigation with working middle-click, ⌘-click and hover preview.

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { ModuleIcon } from "./module-icons";
import { useIconSet } from "./icon-set-context";
import { useIsCompact } from "./viewport-context";

export interface CarouselModule {
  /** Stable key, and the key the image route is addressed by. */
  slug: string;
  /** Shown above the graphic. */
  name: string;
  /** Shown below it. Optional — plenty of modules have none. */
  description?: string;
  /** Module icon key, e.g. "chart". The fallback when there's no image. */
  icon: string;
  href: string;
  /**
   * Whether an uploaded graphic exists. **Not the bytes** — those are fetched by
   * the browser from `/api/modules/<slug>/carousel-image`, which is what keeps a
   * multi-megabyte image out of every page's payload.
   */
  hasImage?: boolean;
  /**
   * Cache-buster for the image URL. The route sends a 5-minute max-age, so
   * without this a replaced graphic keeps showing the old bytes until it expires.
   */
  imageVersion?: string;
}

export interface ModuleCarouselProps {
  modules: CarouselModule[];
  /** Which module starts selected. Clamped; defaults to the first. */
  initialIndex?: number;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/**
 * How far each ring of neighbours sits from the centre, and how small it gets.
 *
 * Offsets are **pixels, not percentages**: a percentage translate resolves
 * against the element's own width, so the gap silently changed with the tile
 * size and the neighbours ended up overlapping the centre. Index 0 is the
 * centre; only two rings either side are drawn.
 */
const RING = [
  { offset: 0, scale: 1, opacity: 1, blur: false },
  { offset: 170, scale: 0.6, opacity: 0.6, blur: true },
  { offset: 285, scale: 0.4, opacity: 0.28, blur: true },
] as const;

/**
 * Ring offsets sized for the tile, which is smaller on a compact layout.
 *
 * These are pixels, so unlike the Tailwind classes around them they don't adapt
 * on their own — at 390px the full-size offsets pushed the neighbours past the
 * edge and gave the whole page 57px of horizontal scroll.
 */
const COMPACT_RING = [
  { offset: 0, scale: 1, opacity: 1, blur: false },
  { offset: 104, scale: 0.55, opacity: 0.55, blur: true },
  { offset: 168, scale: 0.36, opacity: 0.24, blur: true },
] as const;

/** Signed distance from `index` to `selected`, taking the short way round. */
function ringDistance(index: number, selected: number, count: number): number {
  const raw = index - selected;
  const half = count / 2;
  if (raw > half) return raw - count;
  if (raw < -half) return raw + count;
  return raw;
}

/**
 * On an even wheel the item directly opposite the selection is equidistant both
 * ways, so it can't be placed on a side without looking lopsided — with four
 * modules it sat alone out to the right with nothing mirroring it. It's the back
 * of the wheel, so it isn't drawn.
 *
 * Not applied below four, where hiding the antipode would leave a two-module
 * carousel showing one module.
 */
function isBackOfWheel(distance: number, count: number): boolean {
  return count > 3 && count % 2 === 0 && Math.abs(distance) === count / 2;
}

function ArrowButton({
  direction,
  onClick,
  label,
}: {
  direction: "prev" | "next";
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="z-20 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-paper-raised text-xl text-muted transition-colors hover:border-brass/50 hover:text-brass-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
    >
      {/* The same chevron the rest of the app uses, pointed along the axis. */}
      <span className={direction === "prev" ? "inline-block rotate-180" : "inline-block"} aria-hidden>
        &rsaquo;
      </span>
    </button>
  );
}

export function ModuleCarousel({ modules, initialIndex = 0, className = "" }: ModuleCarouselProps) {
  const count = modules.length;
  const [selectedIndex, setSelected] = useState(() =>
    count === 0 ? 0 : Math.min(Math.max(initialIndex, 0), count - 1),
  );
  // Clamped during render rather than synced in an effect. A module list can
  // shrink under us (access revoked, a module hidden) and leave the stored index
  // past the end; correcting it here costs nothing, where an effect would mean a
  // second render pass and a cascading-update lint error.
  const selected = count === 0 ? 0 : Math.min(selectedIndex, count - 1);
  const { colorful } = useIconSet();
  const isCompact = useIsCompact();
  const rings = isCompact ? COMPACT_RING : RING;
  const touchStartX = useRef<number | undefined>(undefined);

  // Wraps, because with a handful of modules you hit an end almost immediately
  // and a dead arrow reads as a bug.
  const rotate = useCallback(
    (step: number) => setSelected((current) => (current + step + count) % count),
    [count],
  );

  // Left/right anywhere on the strip (compact view only). Scoped to the container rather than the
  // document so it can't steal the arrow keys from a focused control elsewhere.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!isCompact) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      rotate(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      rotate(1);
    }
  };

  if (count === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">
        No modules are available to you yet.
      </p>
    );
  }

  // Full view: show grid layout
  if (!isCompact) {
    return (
      <section aria-label="Modules" className={`${className}`}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {modules.map((appModule) => {
            const tileClass = colorful
              ? "bg-paper border border-line"
              : "bg-brass text-paper border border-brass-dark/40";

            return (
              <Link
                key={appModule.slug}
                href={appModule.href}
                className="flex flex-col items-center gap-3 p-4 rounded-2xl hover:bg-paper-raised transition-colors"
              >
                <span
                  className={`flex h-32 w-32 items-center justify-center overflow-hidden rounded-2xl ${
                    appModule.hasImage ? "border border-line bg-paper" : tileClass
                  } shadow-md hover:shadow-lg transition-shadow`}
                >
                  {appModule.hasImage ? (
                    <img
                      src={`/api/modules/${encodeURIComponent(appModule.slug)}/carousel-image?v=${encodeURIComponent(appModule.imageVersion ?? "")}`}
                      alt={appModule.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ModuleIcon name={appModule.icon} className="h-16 w-16" />
                  )}
                </span>
                <div className="text-center">
                  <h3 className="font-semibold text-sm text-ink">{appModule.name}</h3>
                  {appModule.description && (
                    <p className="text-xs text-muted mt-1">{appModule.description}</p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    );
  }

  const active = modules[selected];
  // Monochrome sets get the solid accent tile with a knocked-out glyph; colour
  // sets carry their own fills, so they get a neutral surface that lets the
  // artwork read. Same rule the old card and the sidebar badge use.
  const tileClass = colorful
    ? "bg-paper border border-line"
    : "bg-brass text-paper border border-brass-dark/40";

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Modules"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onTouchStart={(event) => {
        touchStartX.current = event.touches[0]?.clientX;
      }}
      onTouchEnd={(event) => {
        const start = touchStartX.current;
        const end = event.changedTouches[0]?.clientX;
        touchStartX.current = undefined;
        if (start == null || end == null) return;
        // Enough to be a swipe rather than a tap that drifted.
        if (Math.abs(end - start) < 40) return;
        rotate(end < start ? 1 : -1);
      }}
      className={`flex flex-col items-center rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${className}`}
    >
      {/* Title above the graphic. Keyed so it re-renders per module, and given a
          fixed min-height so a one-line name and a two-line name don't shunt
          the artwork up and down as you rotate. 3D perspective with drop shadow. */}
      <h2 className="flex min-h-[2.5rem] items-end text-center font-display text-2xl font-semibold text-ink transform-gpu" style={{ perspective: "1000px", transformStyle: "preserve-3d" }}>
        <span
          className="drop-shadow-lg"
          style={{
            transform: "translateZ(20px) rotateX(2deg)",
            transformStyle: "preserve-3d",
          }}
        >
          {active.name}
        </span>
      </h2>

      {/* Capped so the arrows sit either side of the artwork rather than out at
          the window edges on a wide screen. */}
      <div className="mt-4 flex w-full max-w-3xl items-center justify-center gap-4">
        <ArrowButton direction="prev" onClick={() => rotate(-1)} label="Previous module" />

        {/* The stage. Fixed height because its children are absolutely
            positioned — without it the row would collapse. */}
        <div className="relative h-56 flex-1 overflow-hidden sm:h-64 max-lg:h-40">
          {modules.map((appModule, index) => {
            const distance = ringDistance(index, selected, count);
            const ring = rings[Math.abs(distance)];
            // Beyond the second ring, or round the back, it isn't drawn at all —
            // offscreen nodes that are still focusable are worse than absent ones.
            if (!ring || isBackOfWheel(distance, count)) return null;

            const isActive = distance === 0;
            const style = {
              transform: `translate(-50%, -50%) translateX(${distance * ring.offset}px) scale(${ring.scale})`,
              opacity: ring.opacity,
              zIndex: 10 - Math.abs(distance),
            };

            // An uploaded graphic gets a neutral tile whatever the icon set is —
            // the accent tile exists to make a monochrome glyph legible, and
            // tinting somebody's artwork would be wrong.
            const graphic = (
              <span
                className={`flex h-40 w-40 items-center justify-center overflow-hidden rounded-3xl sm:h-48 sm:w-48 max-lg:h-28 max-lg:w-28 ${
                  appModule.hasImage ? "border border-line bg-paper" : tileClass
                } ${
                  isActive
                    ? "shadow-[0_18px_40px_-16px_rgba(0,0,0,0.5)]"
                    : "shadow-[0_8px_20px_-12px_rgba(0,0,0,0.4)]"
                }`}
              >
                {appModule.hasImage ? (
                  // eslint-disable-next-line @next/next/no-img-element -- DB-backed route, not a static asset next/image can optimize.
                  <img
                    src={`/api/modules/${encodeURIComponent(appModule.slug)}/carousel-image?v=${encodeURIComponent(appModule.imageVersion ?? "")}`}
                    alt=""
                    // Only the centre is worth fetching eagerly; the neighbours
                    // are one rotation away at most.
                    loading={isActive ? "eager" : "lazy"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ModuleIcon
                    name={appModule.icon}
                    className="h-24 w-24 sm:h-28 sm:w-28 max-lg:h-16 max-lg:w-16"
                  />
                )}
              </span>
            );

            return (
              <div
                key={appModule.slug}
                style={style}
                aria-hidden={!isActive}
                className={`absolute left-1/2 top-1/2 transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none ${
                  ring.blur ? "blur-[1px]" : ""
                }`}
              >
                {isActive ? (
                  // The centre is the launch target; the sides only select.
                  <Link
                    href={appModule.href}
                    title={`Open ${appModule.name}`}
                    className="block rounded-3xl transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass focus-visible:ring-offset-4 focus-visible:ring-offset-paper motion-reduce:transition-none motion-reduce:hover:scale-100"
                  >
                    {graphic}
                  </Link>
                ) : (
                  <button
                    type="button"
                    // Not reachable by Tab: the arrows and the dots already
                    // cover keyboard selection, and four extra stops on the way
                    // to the launch link is noise.
                    tabIndex={-1}
                    onClick={() => setSelected(index)}
                    aria-label={`Show ${appModule.name}`}
                    className="block cursor-pointer rounded-3xl focus-visible:outline-none"
                  >
                    {graphic}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <ArrowButton direction="next" onClick={() => rotate(1)} label="Next module" />
      </div>

      {/* Description below the graphic. Fixed min-height for the same reason as
          the title — the dots shouldn't jump as descriptions change length. */}
      <p className="mt-4 flex min-h-[3.5rem] max-w-xl items-start justify-center text-center text-sm leading-relaxed text-muted">
        {active.description}
      </p>

      <div className="mt-1 flex items-center gap-2">
        {modules.map((appModule, index) => (
          <button
            key={appModule.slug}
            type="button"
            onClick={() => setSelected(index)}
            aria-label={`Show ${appModule.name}`}
            aria-current={index === selected}
            className={`h-2.5 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass motion-reduce:transition-none ${
              index === selected ? "w-6 bg-brass" : "w-2.5 bg-line hover:bg-brass/50"
            }`}
          />
        ))}
      </div>

      <p className="mt-3 text-xs text-muted">
        Click the icon to open {active.name}, or use{" "}
        <span aria-hidden>&larr;</span> <span aria-hidden>&rarr;</span> to browse.
      </p>
    </section>
  );
}
