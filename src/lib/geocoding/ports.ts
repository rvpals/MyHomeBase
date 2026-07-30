import type { GeoPlace } from "./types";

// The interface a geocoding use-case depends on. The real Nominatim client is
// wired at wiring.ts; tests wire a fake. Kept provider-agnostic so the service
// can be swapped without touching callers.
export interface GeocodingClient {
  /** Forward geocode: free-text query -> candidate places (best match first). */
  search(query: string, limit: number): Promise<GeoPlace[]>;
  /** Reverse geocode: coordinates -> the place at that point, if any. */
  reverse(latitude: number, longitude: number): Promise<GeoPlace | undefined>;
}
