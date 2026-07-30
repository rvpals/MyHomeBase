import type { GeocodingClient } from "./ports";
import type { GeoPlace } from "./types";

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";

// Nominatim's usage policy requires a descriptive User-Agent identifying the
// application — the reason geocoding runs server-side (a browser fetch can't set
// this header) rather than directly from the map component.
const USER_AGENT = "MyHomeBase/1.0 (self-hosted personal journal app)";

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  error?: string;
}

function toGeoPlace(result: NominatimResult): GeoPlace {
  return {
    latitude: Number.parseFloat(result.lat),
    longitude: Number.parseFloat(result.lon),
    displayName: result.display_name,
  };
}

function isValid(place: GeoPlace): boolean {
  return Number.isFinite(place.latitude) && Number.isFinite(place.longitude);
}

// Real client over the public Nominatim (OpenStreetMap) service.
export class NominatimGeocodingClient implements GeocodingClient {
  async search(query: string, limit: number): Promise<GeoPlace[]> {
    const url = `${NOMINATIM_BASE}/search?format=jsonv2&addressdetails=0&limit=${limit}&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
    });
    if (!response.ok) {
      throw new Error(`Nominatim search failed (HTTP ${response.status}) for query "${query}".`);
    }
    const results = (await response.json()) as NominatimResult[];
    return results.map(toGeoPlace).filter(isValid);
  }

  async reverse(latitude: number, longitude: number): Promise<GeoPlace | undefined> {
    const url = `${NOMINATIM_BASE}/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`;
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
    });
    if (!response.ok) {
      throw new Error(
        `Nominatim reverse geocode failed (HTTP ${response.status}) for ${latitude},${longitude}.`,
      );
    }
    const result = (await response.json()) as NominatimResult;
    // Nominatim returns { error } when a point has no address (e.g. open ocean).
    if (result.error || !result.lat || !result.lon) return undefined;
    const place = toGeoPlace(result);
    return isValid(place) ? place : undefined;
  }
}
