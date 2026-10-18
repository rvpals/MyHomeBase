"use client";

// One saved place, drawn either as a dense row or as a roomier card.
//
// Three screens list the same library and had grown three copies of this
// markup: Admin → Locations → Location Manager (the editable list), Admin →
// Locations → Location Map (the numbered legend beside the map), and the
// journal entry form's "add from the location database" tab. The copies had
// already drifted — one truncated the address, one didn't; one showed chips,
// one dropped them — which is the usual way this ends.
//
// Pure presentation: it takes a place and renders it. It does not know how to
// edit, delete or pick one, which is why `actions` is a ReactNode and the row
// raises `onClick` rather than deciding anything.

import { type ReactNode } from "react";
import { formatCoords } from "@/app/(protected)/admin/locations/filter-chip";
import type { SavedLocation } from "@/lib/sys-locations";

/**
 * `list` is the dense scan — everything on as few lines as possible, address
 * truncated. `card` gives the place room: the address wraps instead of being
 * cut, and the name reads as a heading.
 *
 * A shape, not a breakpoint. The caller decides which to draw, because the
 * screens that use this disagree on purpose — the Map's legend is a narrow rail
 * beside the map, the Manager's list is the whole width.
 */
export type SavedLocationShape = "list" | "card";

/**
 * The fields this row draws. Deliberately `SavedLocation` and not
 * `SavedLocationWithUsage`: nothing here reads a usage count, and asking for
 * the wider type would stop a caller that only has the narrow one.
 */
export interface SavedLocationRowProps {
  place: SavedLocation;
  /** Which shape to draw. Defaults to the dense row. */
  shape?: SavedLocationShape;
  /**
   * The `#n` badge, tying this row to its numbered pin on a map. Omit on a
   * screen with no map — a number with nothing to point at is noise.
   */
  number?: number;
  /**
   * Controls acting on this place — the Manager passes edit and delete, the Map
   * passes nothing. A ReactNode rather than `onEdit`/`onDelete` props so this
   * component never grows a vocabulary of verbs it doesn't perform.
   */
  actions?: ReactNode;
  /**
   * Makes the whole row activatable, for a picker. With it the row renders as a
   * `<button>`; without it, as plain content.
   *
   * Not combinable with `actions`: a button inside a button is invalid HTML and
   * the nested click targets are ambiguous to a keyboard and a screen reader
   * alike. A caller wanting both should put the activation on a child.
   */
  onClick?: () => void;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/**
 * The `#n` badge — a circle, so the record number reads as a marker rather than
 * as part of the place's text.
 *
 * `bg-brass-soft` is design.md's low-emphasis chip token, the same one the
 * DataGrid's record count wears. Sized with a square box plus `justify-center`
 * rather than symmetric padding: a two-digit number must not stretch the circle
 * into a pill, so the box is fixed and the digits centre inside it.
 */
function NumberBadge({ number }: { number: number }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brass-soft font-mono text-xs font-semibold tabular-nums text-brass-dark">
      {number}
    </span>
  );
}

/**
 * The coordinate pair as a rounded-square badge — the counterpart to the round
 * `#n` above, deliberately a different shape so the two never read as the same
 * kind of mark.
 *
 * `inline-flex`, not `block`: the badge should be as wide as the coordinates,
 * not the width of the row.
 */
function CoordsBadge({ place }: { place: SavedLocation }) {
  return (
    <span className="mt-1 inline-flex w-fit items-center rounded-md bg-brass-soft px-2 py-0.5 font-mono text-xs tabular-nums text-brass-dark">
      {formatCoords(place.latitude, place.longitude)}
    </span>
  );
}

/** Categories and tags, in that order. Both are plain labels here. */
function Chips({ place }: { place: SavedLocation }) {
  if (place.categories.length === 0 && place.tags.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1">
      {[...place.categories, ...place.tags].map((label) => (
        <span
          key={label}
          className="rounded-full border border-line px-2 py-0.5 text-xs text-muted"
        >
          {label}
        </span>
      ))}
    </span>
  );
}

export function SavedLocationRow({
  place,
  shape = "list",
  number,
  actions,
  onClick,
  className = "",
}: SavedLocationRowProps) {
  const isCard = shape === "card";

  const name = (
    <span className={isCard ? "font-display text-base text-ink" : "font-medium text-ink"}>
      {place.name || <span className="text-muted">(unnamed)</span>}
    </span>
  );

  const details = (
    <>
      {/* Italic and a step down in size: the reader's own words about the
          place, set apart from the factual address below rather than competing
          with it. Smaller than the name in both shapes — the dense row's name
          is already `text-sm`, so `text-xs` is the step down there too. */}
      {place.description && (
        <span className={`italic text-muted ${isCard ? "block text-xs" : "ml-2 text-xs"}`}>
          {place.description}
        </span>
      )}
      {/* The card's reason to exist: a long address wraps here, where the dense
          row has to cut it off. Underlined to read as the postal address rather
          than as more muted prose; `decoration-line` keeps the rule quieter than
          the text, and the offset stops it striking through descenders. */}
      {place.address && (
        <span
          className={`block text-xs text-muted underline decoration-line underline-offset-2 ${
            isCard ? "" : "truncate"
          }`}
        >
          {place.address}
        </span>
      )}
      <CoordsBadge place={place} />
    </>
  );

  const body = onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
    >
      {name}
      {details}
    </button>
  ) : (
    <>
      {name}
      {details}
    </>
  );

  if (isCard) {
    return (
      <div
        className={`flex flex-col gap-1 rounded-xl border border-line bg-paper-raised p-3 text-sm ${className}`}
      >
        <div className="flex items-start gap-2">
          {number !== undefined && <NumberBadge number={number} />}
          <span className="min-w-0 flex-1">{body}</span>
          {actions && <span className="flex shrink-0 items-center gap-1">{actions}</span>}
        </div>
        <Chips place={place} />
      </div>
    );
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-md border border-line bg-paper px-3 py-1.5 text-sm ${className}`}
    >
      {number !== undefined && <NumberBadge number={number} />}
      {actions && <span className="flex shrink-0 items-center gap-1">{actions}</span>}
      <span className="min-w-0 flex-1">{body}</span>
      <Chips place={place} />
    </div>
  );
}
