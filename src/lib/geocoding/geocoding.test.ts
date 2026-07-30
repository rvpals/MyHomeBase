import { describe, expect, it } from "vitest";
import { reverseGeocode, searchPlaces } from "./geocoding";
import type { GeocodingClient } from "./ports";
import type { GeoPlace } from "./types";

function fakeClient(overrides: Partial<GeocodingClient> = {}): GeocodingClient {
  return {
    async search() {
      return [];
    },
    async reverse() {
      return undefined;
    },
    ...overrides,
  };
}

describe("searchPlaces", () => {
  it("validates input and forwards query + default limit to the client", async () => {
    let received: { query: string; limit: number } | undefined;
    const place: GeoPlace = { latitude: 40.34, longitude: -74.46, displayName: "Princeton, NJ" };
    const client = fakeClient({
      async search(query, limit) {
        received = { query, limit };
        return [place];
      },
    });

    const results = await searchPlaces(client, { query: "princeton" });

    expect(results).toEqual([place]);
    expect(received).toEqual({ query: "princeton", limit: 5 }); // default applied
  });

  it("rejects an empty query", async () => {
    await expect(searchPlaces(fakeClient(), { query: "" })).rejects.toThrow();
  });
});

describe("reverseGeocode", () => {
  it("validates coordinates and returns the resolved place", async () => {
    const place: GeoPlace = { latitude: 40, longitude: -74, displayName: "New Jersey" };
    const client = fakeClient({
      async reverse() {
        return place;
      },
    });
    expect(await reverseGeocode(client, { latitude: 40, longitude: -74 })).toEqual(place);
  });

  it("rejects an out-of-range latitude", async () => {
    await expect(reverseGeocode(fakeClient(), { latitude: 200, longitude: 0 })).rejects.toThrow();
  });
});
