"use client";

import { useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/button";
import type { GeoPlace } from "@/lib/geocoding";
import { reverseGeocodeAction, searchPlacesAction } from "./actions";
import type { LatLng } from "@/components/location-map";

// One picked point: coordinates plus an (optional) human-readable name, and
// the street address the lookup returned for it when there was one.
export interface PickedLocation {
  latitude: number;
  longitude: number;
  name: string;
  /**
   * The full street address for this point, or undefined when no lookup has
   * answered for it yet. Callers that only need a point ignore it.
   */
  streetAddress?: string;
}

// Leaflet touches `window`, so the map is loaded client-only.
const LocationMap = dynamic(
  () => import("@/components/location-map").then((module) => module.LocationMap),
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
export function LocationPickerField({
  value,
  onChange,
  showAddress = false,
  showName = true,
  mapHeightClassName,
  searchAction,
}: {
  value: PickedLocation | null;
  onChange: (next: PickedLocation | null) => void;
  /**
   * Rendered immediately right of the Search button — for a `Comments` mark
   * explaining how to use the search and the map. A slot rather than the copy
   * itself, because the three callers here want different wording (or none),
   * and this component should not know which screen it is on.
   */
  searchAction?: ReactNode;
  /**
   * Height for the map box, passed straight through to `LocationMap`. Omitted
   * means that component's own default (`h-64`), so the callers that were here
   * before this prop are untouched. The location manager passes a taller one:
   * its map is the screen's working surface, not a thumbnail beside a form.
   */
  mapHeightClassName?: string;
  /**
   * Shows the editable street-address box under the map. Off by default so the
   * two existing callers — the location manager, which has its own Address
   * field, and the Preferences card, which wants a point only — are unchanged.
   */
  showAddress?: boolean;
  /**
   * Shows the "Name for <coords>" box under the map.
   *
   * On by default, because the two pickers that compose this one *do* use the
   * name. The location editor passes false: it has its own Name field at the
   * top and ignores this one, so showing both meant a box that silently threw
   * away whatever was typed into it.
   */
  showName?: boolean;
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
    onChange({
      latitude: place.latitude,
      longitude: place.longitude,
      name: place.displayName,
      streetAddress: place.displayName,
    });
    setCenter({ latitude: place.latitude, longitude: place.longitude });
    setResults([]);
  }

  async function handleMapPick(latitude: number, longitude: number) {
    onChange({ latitude, longitude, name: "" }); // drop the pin immediately
    const result = await reverseGeocodeAction(latitude, longitude);
    const name = result.ok && result.place ? result.place.displayName : "";
    // The address rides along with the suggested name: both come from the same
    // lookup, and asking again later would be a second request for one answer.
    onChange({ latitude, longitude, name, streetAddress: name }); // then fill it in
  }

  return (
    <div className="flex flex-col gap-3">
      {/* `items-center` so a bare glyph in `searchAction` sits on the button's
          midline rather than stretching to the row's height. */}
      <div className="flex items-center gap-2">
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
          placeholder="Search a street address or place, or click the map"
          className={INPUT_CLASS}
        />
        <Button size="sm" variant="secondary" onClick={handleSearch} disabled={isSearching || query.trim() === ""}>
          {isSearching ? "…" : "Search"}
        </Button>
        {searchAction}
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

      <LocationMap
        marker={value}
        center={center}
        onPick={handleMapPick}
        {...(mapHeightClassName ? { heightClassName: mapHeightClassName } : {})}
      />

      {value && showName && (
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

      {/* With the name box hidden the Clear button would go with it, stranding
          the pin: the map only ever *sets* a point. So the coordinates stand in
          for the heading, and carry Clear themselves. */}
      {value && !showName && (
        <div className="flex items-center gap-2 text-sm">
          <span className="flex-1 font-mono text-xs text-muted">
            {formatCoords(value.latitude, value.longitude)}
          </span>
          <Button size="sm" variant="secondary" onClick={() => onChange(null)}>
            Clear
          </Button>
        </div>
      )}

      {value && showAddress && (
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Street address</span>
          <input
            type="text"
            value={value.streetAddress ?? ""}
            onChange={(event) => onChange({ ...value, streetAddress: event.target.value })}
            placeholder="full street address"
            className={INPUT_CLASS}
          />
        </label>
      )}
    </div>
  );
}
