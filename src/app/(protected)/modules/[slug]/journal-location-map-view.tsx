"use client";

// The Location Map: every saved place on one map, narrowed by category and tag,
// with the numbered list beside it so a pin can be read back to a name.
//
// Library places only, not entry locations. An entry's pins already show on the
// entry itself; this screen answers "where are the places I know about", which
// is a different question from "where have I been".
//
// Route-local rather than registered: nothing outside My Journal renders this.

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { SavedLocationWithUsage } from "@/lib/journal-locations";
import { searchSavedLocationsAction } from "./journal-locations-actions";
import { FilterChip, formatCoords } from "./journal-locations-view";

const JournalLocationMap = dynamic(
  () => import("./journal-location-map").then((module) => module.JournalLocationMap),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-[32rem] place-items-center rounded-md border border-line text-sm text-muted">
        Loading map…
      </div>
    ),
  },
);

export function JournalLocationMapView({
  locations,
  categoryOptions,
  tagOptions,
}: {
  locations: SavedLocationWithUsage[];
  categoryOptions: string[];
  tagOptions: string[];
}) {
  const [activeCategories, setActiveCategories] = useState<string[]>([]);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [results, setResults] = useState<SavedLocationWithUsage[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const isFiltered = activeCategories.length > 0 || activeTags.length > 0;

  // As in the manager: the unfiltered case doesn't clear `results`, because
  // `shown` below ignores it whenever nothing is narrowing. Clearing it would be
  // a synchronous setState inside an effect.
  useEffect(() => {
    if (!isFiltered) return;
    let cancelled = false;
    (async () => {
      const result = await searchSavedLocationsAction({
        categories: activeCategories,
        tags: activeTags,
      });
      if (cancelled) return;
      if (result.ok) {
        setResults(result.locations ?? []);
        setError(undefined);
      } else {
        setError(result.error);
      }
    })();
    return () => {
      cancelled = true;
    };
    // No debounce, unlike the manager's search box: a chip is one deliberate
    // click, not a stream of keystrokes.
  }, [activeCategories, activeTags, isFiltered]);

  // Memoised so the pin list below keeps a stable identity across renders that
  // changed neither the filters nor the rows.
  const shown = useMemo(
    () => (isFiltered ? (results ?? []) : locations),
    [isFiltered, results, locations],
  );

  const markers = useMemo(
    () =>
      shown.map((place, index) => ({
        latitude: place.latitude,
        longitude: place.longitude,
        number: index + 1,
      })),
    [shown],
  );

  function toggleFilter(list: string[], value: string, set: (next: string[]) => void) {
    set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-red-400">{error}</p>}

      {(categoryOptions.length > 0 || tagOptions.length > 0) && (
        <div className="flex flex-col gap-2">
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
        </div>
      )}

      {shown.length === 0 ? (
        <p className="text-sm text-muted">
          {isFiltered
            ? "No places match those filters."
            : "No saved places yet — add some under Locations → Location Manager."}
        </p>
      ) : (
        // Map and legend side by side on a desktop, stacked on a phone. The map
        // leads in both, and shortens on the small screen via `max-lg:` so the
        // desktop height is provably untouched.
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
          <JournalLocationMap
            marker={null}
            markers={markers}
            center={null}
            heightClassName="h-[32rem] max-lg:h-64"
          />

          <ol className="flex max-h-[32rem] flex-col gap-1 overflow-y-auto max-lg:max-h-72">
            {shown.map((place, index) => (
              <li
                key={place.id}
                className="rounded-md border border-line bg-paper px-3 py-1.5 text-sm"
              >
                <span className="font-mono text-xs text-muted">#{index + 1}</span>{" "}
                <span className="font-medium text-ink">
                  {place.name || <span className="text-muted">(unnamed)</span>}
                </span>
                {place.description && (
                  <span className="block text-xs text-muted">{place.description}</span>
                )}
                {place.address && (
                  <span className="block truncate text-xs text-muted">{place.address}</span>
                )}
                <span className="block font-mono text-xs text-muted">
                  {formatCoords(place.latitude, place.longitude)}
                </span>
                {(place.categories.length > 0 || place.tags.length > 0) && (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {[...place.categories, ...place.tags].map((label) => (
                      <span
                        key={label}
                        className="rounded-full border border-line px-2 py-0.5 text-xs text-muted"
                      >
                        {label}
                      </span>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
