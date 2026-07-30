import type { GeocodingClient } from "./ports";
import { reverseGeocodeSchema, searchPlacesSchema } from "./schema";
import type { ReverseGeocodeInput, SearchPlacesInput } from "./schema";
import type { GeoPlace } from "./types";

/** Forward geocode a free-text query into candidate places. */
export async function searchPlaces(
  client: GeocodingClient,
  input: SearchPlacesInput,
): Promise<GeoPlace[]> {
  const { query, limit } = searchPlacesSchema.parse(input);
  return client.search(query, limit);
}

/** Reverse geocode a coordinate into the place at that point (if any). */
export async function reverseGeocode(
  client: GeocodingClient,
  input: ReverseGeocodeInput,
): Promise<GeoPlace | undefined> {
  const { latitude, longitude } = reverseGeocodeSchema.parse(input);
  return client.reverse(latitude, longitude);
}
