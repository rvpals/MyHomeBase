"use client";

// "Add from the location database": searches the application-wide
// sys_locations library by name, description or address — narrowed by category
// and tag chips — and adds the chosen place to the entry.
//
// The chosen place is *copied* onto the entry: coordinates, name and street
// address. An entry stays a standalone record of where you were, so editing the
// saved place later never moves it and deleting it never blanks the entry.
//
// Migration 0151 added one field that is not a copy: `savedLocationId`, a
// pointer back at the library row. It is what Journal -> Locations counts, and
// it changes nothing about what an entry displays -- every field on screen is
// still the entry's own. (0141 had dropped a column of that name, but only
// because its target table was being deleted; sys_locations is a real target.)
//
// Route-local rather than registered: only the entry form renders this.

import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import type { SavedLocationWithUsage } from "@/lib/sys-locations";
import type { JournalLocationInput } from "./journal-actions";
import { locationTaxonomyIconsAction, searchSysLocationsAction } from "./journal-actions";
import { formatCoords } from "@/app/(protected)/admin/locations/filter-chip";
import { LocationFilterChips } from "@/components/location-filter-chips";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

// Enough to scan, few enough that the list doesn't take over the form. Someone
// with more matches than this narrows with a word or a chip.
const PICKER_LIMIT = 25;

export function JournalLocationLibraryPicker({
  categoryOptions,
  tagOptions,
  onPick,
}: {
  categoryOptions: string[];
  tagOptions: string[];
  /** Called with the picked place already shaped as an entry location. */
  onPick: (location: JournalLocationInput) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeCategories, setActiveCategories] = useState<string[]>([]);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [places, setPlaces] = useState<SavedLocationWithUsage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  // Name -> uploaded icon URL, fetched once on mount. Empty until it arrives,
  // which just means a tile draws its monogram for that first moment.
  const [categoryIcons, setCategoryIcons] = useState<Record<string, string>>({});
  const [tagIcons, setTagIcons] = useState<Record<string, string>>({});

  // Its own effect, not folded into the search below: the icons depend on
  // nothing the user types, so re-reading them on every keystroke would be a
  // database round trip per character for an answer that never changes.
  //
  // A failure here is deliberately silent -- the tiles fall back to monograms,
  // a cosmetic loss, and an error line about icons above a working list of
  // places would be noise in the middle of writing an entry.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await locationTaxonomyIconsAction();
      if (cancelled || !result.ok) return;
      setCategoryIcons(result.categoryIcons ?? {});
      setTagIcons(result.tagIcons ?? {});
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Loads on mount and on every change, debounced. Unlike the manager's list
  // this has no server-rendered starting set — the entry form doesn't read the
  // library, so the first load happens here.
  //
  // `setIsLoading(true)` sits inside the timeout rather than in the effect body:
  // a synchronous setState there cascades a render, and flagging "searching"
  // before the debounce has even elapsed would flicker on every keystroke.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      setIsLoading(true);
      const result = await searchSysLocationsAction({
        query,
        categories: activeCategories,
        tags: activeTags,
        limit: PICKER_LIMIT,
      });
      if (cancelled) return;
      if (result.ok) {
        setPlaces(result.locations ?? []);
        setError(undefined);
      } else {
        setError(result.error);
      }
      setIsLoading(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, activeCategories, activeTags]);

  function handlePick(place: SavedLocationWithUsage) {
    onPick({
      latitude: place.latitude,
      longitude: place.longitude,
      // The entry keeps the library's name at the time of writing. If the place
      // is renamed later, this entry still says what it was called that day.
      locationName: place.name,
      // Copied now, like the name above: the entry keeps the address the place
      // had on the day. Blank in the library means no address, not "".
      streetAddress: place.address.trim() || undefined,
      // The one field that is *not* a copy (migration 0151): a pointer home, so
      // Journal -> Locations can count the entries written at this place. The
      // copied fields above remain what the entry actually displays.
      savedLocationId: place.id,
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search your saved places by name, description or address"
        className={INPUT_CLASS}
      />

      {/* The same uploaded icons the admin screens show. They were left out
          here at first, on the theory that a grid of glyphs would compete with
          the entry form's own controls -- in practice the monograms made every
          tile in a list look alike, and the icon is the fastest way to find the
          one you want. The rows below stay hand-rolled -- each is a *pick*
          button, a different job from the admin screens' read-and-edit rows,
          and bending `SavedLocationRow` to cover it would grow it props it has
          no other use for. */}
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

      {error && <p className="text-xs text-red-400">{error}</p>}

      {places.length === 0 ? (
        <p className="text-sm text-muted">
          {isLoading ? "Searching…" : "No saved places match. Add some under Administration → Locations → Location Manager."}
        </p>
      ) : (
        /* Two columns on a desktop, one on a phone: at PICKER_LIMIT of 25 a
           single column asks for a lot of scrolling in a box this short, and
           these rows are narrow enough to pair. `max-lg:grid-cols-1` keeps the
           phone exactly as it was -- the rows already truncate addresses at
           full width, so halving them there would help nothing. */
        <ul className="grid max-h-72 grid-cols-2 gap-x-px overflow-y-auto rounded-md border border-line max-lg:grid-cols-1">
          {places.map((place) => (
            // The divider is per-cell rather than per-row: in a two-column grid
            // a `last:` rule would only clear the final cell, leaving the one
            // beside it with a dangling border, so every cell carries a top
            // border instead and the first row of cells suppresses it.
            <li
              key={place.id}
              className="min-w-0 border-t border-line [&:nth-child(-n+2)]:border-t-0 [&:nth-child(even)]:border-l max-lg:[&:nth-child(2)]:border-t max-lg:[&:nth-child(even)]:border-l-0"
            >
              <button
                type="button"
                onClick={() => handlePick(place)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-brass-soft"
              >
                <span className="font-medium text-ink">
                  {place.name || <span className="text-muted">(unnamed)</span>}
                </span>
                {place.description && (
                  <span className="ml-2 text-xs text-muted">{place.description}</span>
                )}
                {place.address && (
                  <span className="block truncate text-xs text-muted">{place.address}</span>
                )}
                <span className="block font-mono text-xs text-muted">
                  {formatCoords(place.latitude, place.longitude)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted">
        Adding a place copies its coordinates onto this entry. Editing the saved place later
        won&apos;t move this entry.
      </p>
      <div className="sr-only" aria-live="polite">
        {isLoading ? "Searching saved places" : `${places.length} saved places listed`}
      </div>
      {/* Only once something is actually narrowing the list — an always-present
          "Clear" next to an untouched search box is a control with nothing to do. */}
      {(query !== "" || activeCategories.length > 0 || activeTags.length > 0) && (
        <div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setQuery("");
              setActiveCategories([]);
              setActiveTags([]);
            }}
          >
            Clear search
          </Button>
        </div>
      )}
    </div>
  );
}
