"use client";

// The weather-location picker on the Account screen. Route-local, not a registered
// component: it is one control bound to this screen's action, and `components.md`
// keeps page-specific UI out of the registry.
//
// Deliberately *not* the Journal's `journal-location-field.tsx`, despite the overlap.
// That one is bound to the journal module's own actions (gated on journal access) and
// loads Leaflet to let someone drop a pin on a map. Here the reader needs a place name
// and a pair of coordinates, nothing more — pulling a map library onto the Account
// screen to pick "London" would be the expensive way to do less.

import { useState } from "react";
import { Button } from "@/components/button";
import type { GeoPlace } from "@/lib/geocoding";
import type { WeatherLocation } from "@/lib/user-preferences";
import { searchPlacesForWeatherAction } from "./actions";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export function WeatherLocationField({
  value,
  onChange,
  disabled,
}: {
  value: WeatherLocation | null;
  onChange: (next: WeatherLocation | null) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoPlace[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [searched, setSearched] = useState(false);

  async function handleSearch() {
    const trimmed = query.trim();
    if (trimmed === "") return;

    setIsSearching(true);
    setError(undefined);
    try {
      const result = await searchPlacesForWeatherAction(trimmed);
      if (!result.ok) {
        setError(result.error ?? "Place search failed.");
        setResults([]);
        return;
      }
      setResults(result.places ?? []);
      setSearched(true);
    } finally {
      setIsSearching(false);
    }
  }

  function choose(place: GeoPlace) {
    onChange({
      latitude: place.latitude,
      longitude: place.longitude,
      name: place.displayName,
    });
    // The list has done its job; leaving it open invites a second click that looks
    // like it changed something when the field above already shows the answer.
    setResults([]);
    setQuery("");
    setSearched(false);
  }

  return (
    <div className="mt-6 border-t border-line pt-4">
      <h3 className="text-sm font-medium text-ink">Weather location</h3>
      <p className="mt-1 text-xs text-muted">
        Shown on the home screen&rsquo;s Clock card. Leave it unset to hide the forecast.
      </p>

      {value ? (
        <div className="mt-3 flex items-start justify-between gap-3 rounded-md border border-line bg-paper px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm text-ink" title={value.name}>
              {value.name}
            </p>
            <p className="font-mono text-xs text-muted">
              {value.latitude.toFixed(4)}, {value.longitude.toFixed(4)}
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onChange(null)}
            disabled={disabled}
            type="button"
          >
            Clear
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">No location set.</p>
      )}

      {/* A search button rather than search-as-you-type. Nominatim's usage policy
          asks for no heavy automated querying, and a keystroke-triggered lookup would
          fire a request per letter for a field someone edits once a year. */}
      <div className="mt-3 flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Enter searches instead of submitting the Preferences form around it —
            // otherwise typing a town and pressing Enter saves the form with the old
            // location still in place, which looks like the search silently failed.
            if (event.key === "Enter") {
              event.preventDefault();
              void handleSearch();
            }
          }}
          placeholder="Search for a town or city…"
          aria-label="Search for a weather location"
          disabled={disabled || isSearching}
          className={INPUT_CLASS}
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={handleSearch}
          disabled={disabled || isSearching || query.trim() === ""}
          type="button"
        >
          {isSearching ? "Searching…" : "Search"}
        </Button>
      </div>

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      {results.length > 0 && (
        <ul className="mt-2 divide-y divide-line overflow-hidden rounded-md border border-line">
          {results.map((place) => (
            <li key={`${place.latitude},${place.longitude}`}>
              <button
                type="button"
                onClick={() => choose(place)}
                className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
              >
                {place.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}

      {searched && results.length === 0 && !error && (
        <p className="mt-2 text-sm text-muted">No places matched that search.</p>
      )}
    </div>
  );
}
