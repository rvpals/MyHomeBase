"use client";

// Journal → Saved Locations: every place in the application-wide library, each
// row carrying how many journal entries were written there, and each count a
// link into that place's entries.
//
// The library itself is Admin → Locations' to own — this screen creates,
// edits and deletes nothing. It reads the same places and answers one question
// the Location Manager cannot: which of my entries happened here.
//
// Presentational. The counting happens on the server (see
// `lib/journal/entry-locations`), and the drill-down is a route, so this
// component holds nothing but the search box and the filter chips.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/button";
import { LocationFilterChips } from "@/components/location-filter-chips";
import { SavedLocationRow } from "@/components/saved-location-row";
import { ViewModeSwitch, type ViewModeOption } from "@/components/view-mode-switch";
import type { SavedLocation } from "@/lib/sys-locations";

/** Same two shapes the Location Manager offers, for the same reason. */
type SavedLocationView = "list" | "card";

const VIEW_OPTIONS: readonly ViewModeOption<SavedLocationView>[] = [
  { key: "list", label: "List", hint: "One compact row per place" },
  { key: "card", label: "Card", hint: "A roomier card per place" },
];

export interface JournalSavedLocationsViewProps {
  /** Every saved place, in the library's own order. */
  places: SavedLocation[];
  /** Place id → how many entries link to it. Missing means zero. */
  entryCounts: Record<number, number>;
  /**
   * Whether *any* entry is linked yet.
   *
   * Drives the explanatory note: before the first link every row reads 0, which
   * is indistinguishable from a broken screen unless something says why.
   */
  hasLinkedEntries: boolean;
  categoryOptions: string[];
  tagOptions: string[];
  categoryIcons: Record<string, string>;
  tagIcons: Record<string, string>;
  /** Where a place's entries live, e.g. `/modules/journal/saved-locations`. */
  basePath: string;
  /**
   * Whether this reader may open the Location Manager.
   *
   * The library is Admin → Locations' to own and that whole route redirects a
   * non-admin to the home page, so the "Open" button would be a trap for most
   * readers. It still renders for them — disabled, with a title saying why —
   * because silently hiding it makes the screen look different for two people
   * describing it to each other.
   */
  canOpenManager: boolean;
}

/** Where the Location Manager opens straight onto one place. */
function managerEditHref(placeId: number) {
  return `/admin/locations/manager?edit=${placeId}`;
}

/**
 * "Open" — the hand-off from this read-only screen to the one that can edit.
 *
 * A link for an admin and a disabled `<button>` for everyone else, rather than
 * one element that changes behaviour: `Button` ignores `disabled` when `href`
 * is set (a link has no disabled state in HTML), so a disabled-looking link
 * would still navigate.
 */
function OpenInManagerButton({
  place,
  canOpenManager,
}: {
  place: SavedLocation;
  canOpenManager: boolean;
}) {
  const label = place.name || "unnamed place";

  if (!canOpenManager) {
    return (
      <Button
        variant="secondary"
        size="sm"
        disabled
        title="Only an administrator can edit the location library"
        ariaLabel={`Open "${label}" in the Location Manager (administrators only)`}
      >
        Open
      </Button>
    );
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      href={managerEditHref(place.id)}
      title="Edit this place in the Location Manager"
      ariaLabel={`Open "${label}" in the Location Manager`}
    >
      Open
    </Button>
  );
}

/**
 * The `#n` badge and its link.
 *
 * A count of zero is deliberately **not** a link: there is nothing to show, and
 * a link that leads to an empty page is a worse answer than a plain number.
 */
function EntryCountBadge({
  count,
  href,
}: {
  count: number;
  href: string;
}) {
  if (count === 0) {
    return (
      <span
        className="inline-flex min-w-9 items-center justify-center rounded-full border border-line px-2 py-0.5 text-xs text-muted"
        title="No entries written here yet"
      >
        0
      </span>
    );
  }

  return (
    <Link
      href={href}
      className="inline-flex min-w-9 items-center justify-center rounded-full border border-brass bg-brass-soft px-2 py-0.5 text-xs text-brass-dark hover:bg-brass hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
      title={`${count} ${count === 1 ? "entry" : "entries"} written here`}
    >
      {count}
    </Link>
  );
}

export function JournalSavedLocationsView({
  places,
  entryCounts,
  hasLinkedEntries,
  categoryOptions,
  tagOptions,
  categoryIcons,
  tagIcons,
  basePath,
  canOpenManager,
}: JournalSavedLocationsViewProps) {
  const [query, setQuery] = useState("");
  const [activeCategories, setActiveCategories] = useState<string[]>([]);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [view, setView] = useState<SavedLocationView>("list");

  /**
   * Filtered in the browser, not by a server action.
   *
   * The Location Manager searches server-side because it edits what it lists and
   * must re-read after a write. This screen only reads, and the whole library is
   * already here — a round trip per keystroke would buy nothing.
   */
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return places.filter((place) => {
      if (
        needle !== "" &&
        !place.name.toLowerCase().includes(needle) &&
        !place.address.toLowerCase().includes(needle) &&
        !place.description.toLowerCase().includes(needle)
      ) {
        return false;
      }
      // AND semantics, matching the Location Manager's chips: a place must carry
      // every selected name, not any of them.
      return (
        activeCategories.every((name) => place.categories.includes(name)) &&
        activeTags.every((name) => place.tags.includes(name))
      );
    });
  }, [places, query, activeCategories, activeTags]);

  if (places.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-line p-6 text-center text-sm text-muted">
        You have no saved places yet. Add them in Admin → Locations → Location Manager,
        then pick one when writing an entry.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Only until something links. After that the counts speak for themselves
          and a standing explanation would just be clutter. */}
      {!hasLinkedEntries && (
        <p className="rounded-md border border-dashed border-line p-3 text-sm text-muted">
          Counts start from when entry linking was switched on. Entries written before
          then are not linked to a saved place, so every count below reads 0 until you
          write a new entry and pick a place from your location database.
        </p>
      )}

      <div className="flex items-center justify-between gap-3 max-lg:flex-col max-lg:items-stretch">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search your saved places by name, description or address"
          aria-label="Search saved places"
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
        <ViewModeSwitch options={VIEW_OPTIONS} value={view} onChange={setView} label="View" />
      </div>

      <LocationFilterChips
        categoryOptions={categoryOptions}
        tagOptions={tagOptions}
        categoryIcons={categoryIcons}
        tagIcons={tagIcons}
        activeCategories={activeCategories}
        activeTags={activeTags}
        onCategoriesChange={setActiveCategories}
        onTagsChange={setActiveTags}
      />

      <p className="text-xs text-muted">
        {shown.length} of {places.length} place{places.length === 1 ? "" : "s"}
      </p>

      {shown.length === 0 ? (
        <p className="rounded-md border border-dashed border-line p-6 text-center text-sm text-muted">
          No saved place matches that search.
        </p>
      ) : (
        <ul className={view === "card" ? "card-grid gap-4" : "flex flex-col gap-1"}>
          {shown.map((place) => (
            <li key={place.id}>
              <SavedLocationRow
                place={place}
                shape={view}
                /* Both controls ride in `actions` — the slot this row already
                   has for "controls acting on this place", which is exactly
                   what a link to its entries and a link to its editor are. No
                   new prop on a shared component.

                   Open sits left of the count so the badge stays the rightmost
                   thing it has always been. */
                actions={
                  <div className="flex items-center gap-2">
                    <OpenInManagerButton place={place} canOpenManager={canOpenManager} />
                    <EntryCountBadge
                      count={entryCounts[place.id] ?? 0}
                      href={`${basePath}/${place.id}`}
                    />
                  </div>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
