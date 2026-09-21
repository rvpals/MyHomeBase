"use client";

// "Add from the location database": searches the saved-location library by
// name, description or address and adds the chosen place to the entry.
//
// The chosen place is *copied* onto the entry — coordinates and name — with
// `savedLocationId` recorded as provenance. That is why editing a library row
// later never moves an entry that already used it (migration 0101).
//
// Route-local rather than registered: only the Journal has a location library.

import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import type { SavedLocationWithUsage } from "@/lib/journal-locations";
import type { JournalLocationInput } from "./journal-actions";
import { searchSavedLocationsAction } from "./journal-locations-actions";
import { FilterChip, formatCoords } from "./journal-locations-view";

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
      const result = await searchSavedLocationsAction({
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

  function toggleFilter(list: string[], value: string, set: (next: string[]) => void) {
    set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  function handlePick(place: SavedLocationWithUsage) {
    onPick({
      latitude: place.latitude,
      longitude: place.longitude,
      // The entry keeps the library's name at the time of writing. If the place
      // is renamed later, this entry still says what it was called that day.
      locationName: place.name,
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

      {categoryOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted">Categories</span>
          {categoryOptions.map((option) => (
            <FilterChip
              key={option}
              label={option}
              isActive={activeCategories.includes(option)}
              onToggle={() => toggleFilter(activeCategories, option, setActiveCategories)}
            />
          ))}
        </div>
      )}

      {tagOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted">Tags</span>
          {tagOptions.map((option) => (
            <FilterChip
              key={option}
              label={option}
              isActive={activeTags.includes(option)}
              onToggle={() => toggleFilter(activeTags, option, setActiveTags)}
            />
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {places.length === 0 ? (
        <p className="text-sm text-muted">
          {isLoading ? "Searching…" : "No saved places match. Add some under Locations → Location Manager."}
        </p>
      ) : (
        <ul className="flex max-h-72 flex-col overflow-y-auto rounded-md border border-line">
          {places.map((place) => (
            <li key={place.id} className="border-b border-line last:border-b-0">
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
