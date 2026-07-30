"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/button";
import type { GeoPlace } from "@/lib/geocoding";
import { reverseGeocodeAction, searchPlacesAction } from "./journal-actions";
import type { LatLng } from "./journal-location-map";

// One picked point: coordinates plus an (optional) human-readable name.
export interface PickedLocation {
  latitude: number;
  longitude: number;
  name: string;
}

// Leaflet touches `window`, so the map is loaded client-only.
const JournalLocationMap = dynamic(
  () => import("./journal-location-map").then((module) => module.JournalLocationMap),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-64 place-items-center rounded-md border border-line text-sm text-muted">
        Loading map…
      </div>
    ),
  },
);

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

function formatCoords(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

// A single-point location picker: search a place, or click the map, then name
// the point. Controlled — the parent owns the value. Reused by the multi-location
// picker (for its "draft" point) and the journal Preferences card.
export function JournalLocationField({
  value,
  onChange,
}: {
  value: PickedLocation | null;
  onChange: (next: PickedLocation | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoPlace[]>([]);
  const [center, setCenter] = useState<LatLng | null>(
    value ? { latitude: value.latitude, longitude: value.longitude } : null,
  );
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleSearch() {
    const trimmed = query.trim();
    if (trimmed === "") return;
    setIsSearching(true);
    setError(undefined);
    try {
      const result = await searchPlacesAction(trimmed);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const places = result.places ?? [];
      setResults(places);
      if (places.length === 0) setError("No places found.");
    } finally {
      setIsSearching(false);
    }
  }

  function selectResult(place: GeoPlace) {
    onChange({ latitude: place.latitude, longitude: place.longitude, name: place.displayName });
    setCenter({ latitude: place.latitude, longitude: place.longitude });
    setResults([]);
  }

  async function handleMapPick(latitude: number, longitude: number) {
    onChange({ latitude, longitude, name: "" }); // drop the pin immediately
    const result = await reverseGeocodeAction(latitude, longitude);
    const name = result.ok && result.place ? result.place.displayName : "";
    onChange({ latitude, longitude, name }); // then fill the suggested name
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleSearch();
            }
          }}
          placeholder="Search a place, or click the map"
          className={INPUT_CLASS}
        />
        <Button size="sm" variant="secondary" onClick={handleSearch} disabled={isSearching || query.trim() === ""}>
          {isSearching ? "…" : "Search"}
        </Button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {results.length > 0 && (
        <ul className="flex flex-col overflow-hidden rounded-md border border-line">
          {results.map((place, index) => (
            <li key={`${place.latitude},${place.longitude},${index}`}>
              <button
                type="button"
                onClick={() => selectResult(place)}
                className="block w-full px-3 py-1.5 text-left text-sm text-ink hover:bg-brass-soft"
              >
                {place.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}

      <JournalLocationMap marker={value} center={center} onPick={handleMapPick} />

      {value && (
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Name for {formatCoords(value.latitude, value.longitude)}</span>
          <div className="flex gap-2">
            <input
              type="text"
              value={value.name}
              onChange={(event) => onChange({ ...value, name: event.target.value })}
              placeholder="Optional name for this location"
              className={INPUT_CLASS}
            />
            <Button size="sm" variant="secondary" onClick={() => onChange(null)}>
              Clear
            </Button>
          </div>
        </label>
      )}
    </div>
  );
}
