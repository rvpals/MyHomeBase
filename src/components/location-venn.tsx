"use client";

// Saved places arranged as a Venn diagram: two or three overlapping circles,
// each region holding the *names* of the places carrying exactly that
// combination of tags (or categories).
//
// A third shape for the Location Manager's View switch, beside List and Card.
// Those two answer "what is in my library"; this one answers "where do my tags
// overlap" — the same rows re-cut, which is why it lives under `ViewModeSwitch`
// and not behind a tab.
//
// Pure presentation. It is handed a layout (see `lib/sys-locations/venn-regions`)
// and renders it; it does no set math, no filtering and no editing. Clicking a
// name raises `onSelect` and nothing more.
//
// Compact forks to labelled groups rather than restyling the circles: three
// overlapping discs with readable names inside cannot fit a 390px phone at any
// font size, which is design.md's test for a genuine fork over a `max-lg:`
// variant.

import { useState } from "react";
import { Modal } from "@/components/modal";
import { useIsCompact } from "@/components/viewport-context";
import {
  findVennRegion,
  type SavedLocation,
  type VennLayout,
  type VennRegion,
} from "@/lib/sys-locations";

/**
 * How many names a region prints before folding the rest into "+N more".
 *
 * A lens is a fixed-size hole in a fixed-size picture, so this is a budget, not
 * a preference: past half a dozen the names either overflow the curve or shrink
 * below reading size. The overflow opens a modal listing the region in full, so
 * nothing is actually hidden.
 */
const NAMES_PER_REGION = 6;

/** Geometry of the diagram, in SVG user units. One square viewBox, 0–100. */
const CIRCLE_RADIUS = 30;

/**
 * Circle centres for the two- and three-set cases.
 *
 * Hand-placed rather than solved: these are the classic symmetric arrangements
 * (side by side, and an equilateral triangle), chosen so every region is a
 * usable size. The diagram is deliberately *not* area-proportional — the circles
 * are containers for names here, so a region sized by its count would shrink the
 * very lens whose names most need the room.
 */
const LAYOUTS: Record<2 | 3, { x: number; y: number }[]> = {
  2: [
    { x: 36, y: 50 },
    { x: 64, y: 50 },
  ],
  3: [
    { x: 50, y: 35 },
    { x: 35, y: 62 },
    { x: 65, y: 62 },
  ],
};

/**
 * Where each region's names sit, as a percentage of the box.
 *
 * Keyed by the region's set indices. These are the visual centroids of each
 * lens, nudged by eye so a label sits in the fat part of its region rather than
 * at its mathematical centre — the three-circle pairwise lenses are crescents,
 * and their centroids fall uncomfortably close to the middle.
 */
const REGION_ANCHORS: Record<string, Record<string, { x: number; y: number }>> = {
  2: {
    "0": { x: 26, y: 50 },
    "1": { x: 74, y: 50 },
    "0,1": { x: 50, y: 50 },
  },
  3: {
    "0": { x: 50, y: 25 },
    "1": { x: 25, y: 68 },
    "2": { x: 75, y: 68 },
    "0,1": { x: 35, y: 45 },
    "0,2": { x: 65, y: 45 },
    "1,2": { x: 50, y: 70 },
    "0,1,2": { x: 50, y: 53 },
  },
};

/**
 * One colour per circle, as CSS custom properties rather than literals.
 *
 * `--brass` is the app's accent and the only one guaranteed to read on every
 * theme, so the first circle takes it. The other two mix the accent toward the
 * ink and the paper, which keeps all three on-theme by construction — a literal
 * hue would look right on one theme and wrong on the seven others (design.md →
 * the token system).
 */
const CIRCLE_FILLS = [
  "color-mix(in srgb, var(--brass) 38%, transparent)",
  "color-mix(in srgb, var(--brass) 24%, var(--ink) 10%)",
  "color-mix(in srgb, var(--brass) 16%, var(--paper-raised) 30%)",
];

/**
 * Generic over the place type so a caller holding the wider
 * `SavedLocationWithUsage` gets that same row back from `onSelect`, rather than
 * the base type it would have to re-find by id.
 */
export interface LocationVennProps<P extends SavedLocation = SavedLocation> {
  /** The regions to draw, already computed. */
  layout: VennLayout<P>;
  /**
   * Raised with the place whose name was clicked. The component raises intent
   * and nothing more — opening an editor is the caller's business.
   */
  onSelect?: (place: P) => void;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/** A place's name, or its coordinates when it has none — same fallback as the row. */
function displayName(place: SavedLocation): string {
  const trimmed = place.name.trim();
  if (trimmed !== "") return trimmed;
  return `${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)}`;
}

/** One clickable place name. A `<button>` when it does something, text when not. */
function PlaceName<P extends SavedLocation>({
  place,
  onSelect,
  className = "",
}: {
  place: P;
  onSelect?: (place: P) => void;
  className?: string;
}) {
  const label = displayName(place);
  if (!onSelect) {
    return <span className={`block truncate text-ink ${className}`}>{label}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => onSelect(place)}
      title={label}
      className={`block w-full truncate rounded px-1 text-left text-ink hover:bg-brass-soft hover:text-brass-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${className}`}
    >
      {label}
    </button>
  );
}

/**
 * The names for one region, capped, with the overflow raising a request to see
 * the rest. Shared by the diagram and the compact group list so the cap and its
 * wording can't drift apart.
 */
function RegionNames<P extends SavedLocation>({
  region,
  onSelect,
  onOverflow,
  limit = NAMES_PER_REGION,
  nameClassName = "text-xs",
}: {
  region: VennRegion<P>;
  onSelect?: (place: P) => void;
  onOverflow: (region: VennRegion<P>) => void;
  limit?: number;
  nameClassName?: string;
}) {
  const shown = region.places.slice(0, limit);
  const hidden = region.places.length - shown.length;
  return (
    <>
      {shown.map((place) => (
        <PlaceName<P>
          key={place.id}
          place={place}
          onSelect={onSelect}
          className={nameClassName}
        />
      ))}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => onOverflow(region)}
          className={`block w-full rounded px-1 text-left font-medium text-brass hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass ${nameClassName}`}
        >
          +{hidden} more
        </button>
      )}
    </>
  );
}

/** The trailing "carries none of these" group. Never a circle — it is the outside. */
function UnmatchedGroup<P extends SavedLocation>({
  places,
  kind,
  onSelect,
}: {
  places: P[];
  kind: VennLayout["kind"];
  onSelect?: (place: P) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  if (places.length === 0) return null;

  const label = kind === "tag" ? "No matching tag" : "No matching category";
  return (
    <div className="rounded-md border border-dashed border-line p-3">
      <button
        type="button"
        onClick={() => setIsOpen((previous) => !previous)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-2 text-left text-sm text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
      >
        <span>
          {label} ({places.length})
        </span>
        <span aria-hidden="true">{isOpen ? "−" : "+"}</span>
      </button>
      {isOpen && (
        <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs max-lg:grid-cols-1">
          {places.map((place) => (
            <li key={place.id}>
              <PlaceName<P> place={place} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function LocationVenn<P extends SavedLocation>({
  layout,
  onSelect,
  className = "",
}: LocationVennProps<P>) {
  const isCompact = useIsCompact();
  // The region whose full list is open. Null when the modal is closed.
  const [expanded, setExpanded] = useState<VennRegion<P> | null>(null);

  const setCount = layout.names.length;
  if (setCount < 2) {
    return (
      <p className={`rounded-md border border-dashed border-line p-6 text-center text-sm text-muted ${className}`}>
        Pick at least two {layout.kind === "tag" ? "tags" : "categories"} to see where they
        overlap.
      </p>
    );
  }

  const centres = LAYOUTS[setCount as 2 | 3];
  const anchors = REGION_ANCHORS[String(setCount)];

  // Every possible region, empty ones included: an empty lens still needs to
  // read as empty rather than as absent.
  const combinations =
    setCount === 2
      ? [[0], [1], [0, 1]]
      : [[0], [1], [2], [0, 1], [0, 2], [1, 2], [0, 1, 2]];

  const overflowModal = expanded && (
    <Modal
      title={expanded.label}
      description={`${expanded.places.length} ${
        expanded.places.length === 1 ? "place" : "places"
      }`}
      onClose={() => setExpanded(null)}
      size="md"
    >
      <ul className="flex flex-col gap-1 text-sm">
        {expanded.places.map((place) => (
          <li key={place.id}>
            <PlaceName<P>
              place={place}
              onSelect={
                onSelect &&
                ((picked) => {
                  setExpanded(null);
                  onSelect(picked);
                })
              }
              className="py-1"
            />
          </li>
        ))}
      </ul>
    </Modal>
  );

  // --- Compact: labelled groups, no circles ---------------------------------
  //
  // A genuine component fork, not a restyle. The regions are identical; only
  // their arrangement differs, because overlapping discs have no readable form
  // at this width.
  if (isCompact) {
    return (
      <div className={`flex flex-col gap-3 ${className}`}>
        {layout.regions.length === 0 && (
          <p className="rounded-md border border-dashed border-line p-4 text-center text-sm text-muted">
            No place carries any of these {layout.kind === "tag" ? "tags" : "categories"}.
          </p>
        )}
        {layout.regions.map((region) => (
          <div
            key={region.setIndices.join(",")}
            className="rounded-md border border-line bg-paper-raised p-3"
            style={{
              // The region's own circle colour, as a left edge, so a group ties
              // back to the circle it would have been drawn in.
              borderLeftWidth: "3px",
              borderLeftColor: CIRCLE_FILLS[region.setIndices[0]],
            }}
          >
            <p className="mb-2 text-sm font-medium text-ink">
              {region.label}{" "}
              <span className="font-normal text-muted">({region.places.length})</span>
            </p>
            <div className="flex flex-col gap-0.5 text-sm">
              <RegionNames<P>
                region={region}
                onSelect={onSelect}
                onOverflow={setExpanded}
                limit={NAMES_PER_REGION}
                nameClassName="text-sm"
              />
            </div>
          </div>
        ))}
        <UnmatchedGroup<P>
          places={layout.unmatched}
          kind={layout.kind}
          onSelect={onSelect}
        />
        {overflowModal}
      </div>
    );
  }

  // --- Desktop: the diagram -------------------------------------------------
  //
  // The circles are an SVG underlay at `inset-0`; the names are ordinary HTML
  // positioned over them. Names in SVG `<text>` would not wrap, truncate or take
  // a focus ring, and each would need manual metrics — so the SVG draws only
  // what HTML cannot, which is the overlapping discs themselves.
  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div className="relative mx-auto aspect-square w-full max-w-[44rem]">
        <svg
          viewBox="0 0 100 100"
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          {centres.map((centre, index) => (
            <circle
              key={index}
              cx={centre.x}
              cy={centre.y}
              r={CIRCLE_RADIUS}
              fill={CIRCLE_FILLS[index]}
              stroke="var(--line)"
              strokeWidth={0.4}
              // Multiply so an overlap reads as darker than either circle, which
              // is what makes the lenses legible without drawing their outlines.
              style={{ mixBlendMode: "multiply" }}
            />
          ))}
        </svg>

        {/* The set names, outside their circles so they never collide with the
            place names inside. */}
        {centres.map((centre, index) => (
          <span
            key={index}
            className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-paper/80 px-1.5 py-0.5 text-sm font-medium text-ink"
            style={{
              left: `${centre.x}%`,
              // Push the label clear of the disc: above for a circle in the top
              // half, below for one in the bottom half.
              top: `${centre.y < 50 ? centre.y - CIRCLE_RADIUS - 5 : centre.y + CIRCLE_RADIUS + 5}%`,
            }}
          >
            {layout.names[index]}
          </span>
        ))}

        {combinations.map((indices) => {
          const key = indices.join(",");
          const region = findVennRegion(layout, indices);
          const anchor = anchors[key];
          if (!anchor) return null;

          return (
            <div
              key={key}
              className="absolute w-[22%] -translate-x-1/2 -translate-y-1/2 text-center"
              style={{ left: `${anchor.x}%`, top: `${anchor.y}%` }}
            >
              {region ? (
                <div className="flex flex-col gap-0.5 leading-tight">
                  <RegionNames<P>
                    region={region}
                    onSelect={onSelect}
                    onOverflow={setExpanded}
                  />
                </div>
              ) : (
                // An empty lens still says so — a blank gap reads as "I have not
                // loaded" rather than "nothing is in here".
                <span className="text-xs text-muted/70">—</span>
              )}
            </div>
          );
        })}
      </div>

      <UnmatchedGroup<P> places={layout.unmatched} kind={layout.kind} onSelect={onSelect} />
      {overflowModal}
    </div>
  );
}
