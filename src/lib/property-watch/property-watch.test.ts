import { describe, expect, it } from "vitest";
import {
  addToWatchlist,
  getWatchlistHistory,
  listWatchlist,
  lookupProperty,
  refreshWatchedProperty,
  removeFromWatchlist,
} from "./property-watch";
import type { PropertyLookupClient, WatchedPropertyRepository } from "./ports";
import type { PropertyDetails, PropertySnapshot, WatchedProperty } from "./types";

function sampleDetails(address: string): PropertyDetails {
  return {
    address,
    propertyType: "Single Family",
    bedrooms: 3,
    bathrooms: 2,
    squareFootage: 1800,
    saleHistory: [],
    ownerNames: [],
    raw: { address },
  };
}

// Hand-written fake — no mocking framework, reusable across tests.
function fakeRepo(seed: { watched: WatchedProperty[]; snapshots: PropertySnapshot[] }): WatchedPropertyRepository {
  let watched = [...seed.watched];
  let snapshots = [...seed.snapshots];
  let nextWatchedId = watched.reduce((max, entry) => Math.max(max, entry.id), 0) + 1;
  let nextSnapshotId = snapshots.reduce((max, entry) => Math.max(max, entry.id), 0) + 1;

  return {
    listWatchedProperties() {
      return [...watched];
    },
    getWatchedPropertyById(id) {
      return watched.find((entry) => entry.id === id);
    },
    getWatchedPropertyByAddress(address) {
      return watched.find((entry) => entry.address === address);
    },
    addWatchedProperty(address) {
      const created: WatchedProperty = { id: nextWatchedId++, address, createdAt: "2026-01-01T00:00:00.000Z" };
      watched.push(created);
      return created;
    },
    removeWatchedProperty(id) {
      watched = watched.filter((entry) => entry.id !== id);
      snapshots = snapshots.filter((entry) => entry.watchedPropertyId !== id);
    },
    addSnapshot(watchedPropertyId, source, details) {
      const created: PropertySnapshot = {
        id: nextSnapshotId++,
        watchedPropertyId,
        source,
        propertyType: details.propertyType,
        bedrooms: details.bedrooms,
        bathrooms: details.bathrooms,
        squareFootage: details.squareFootage,
        raw: details.raw,
        fetchedAt: "2026-01-01T00:00:00.000Z",
      };
      snapshots.push(created);
      return created;
    },
    listSnapshotsForWatchedProperty(watchedPropertyId) {
      return snapshots
        .filter((entry) => entry.watchedPropertyId === watchedPropertyId)
        .sort((a, b) => b.id - a.id);
    },
  };
}

function fakeClient(response: PropertyDetails | Error): PropertyLookupClient {
  return {
    async lookup(address) {
      if (response instanceof Error) throw response;
      return { ...response, address };
    },
  };
}

describe("lookupProperty", () => {
  it("returns the client's normalized property details", async () => {
    const client = fakeClient(sampleDetails("123 Main St"));
    const result = await lookupProperty(client, "123 Main St");
    expect(result.address).toBe("123 Main St");
  });

  it("rejects an empty address", async () => {
    const client = fakeClient(sampleDetails(""));
    await expect(lookupProperty(client, "")).rejects.toThrow();
  });
});

describe("addToWatchlist", () => {
  it("creates a new watched property and its first snapshot", () => {
    const repo = fakeRepo({ watched: [], snapshots: [] });
    const { watchedProperty, snapshot } = addToWatchlist(repo, "123 Main St", sampleDetails("123 Main St"));
    expect(watchedProperty.address).toBe("123 Main St");
    expect(snapshot.watchedPropertyId).toBe(watchedProperty.id);
    expect(listWatchlist(repo)).toHaveLength(1);
  });

  it("reuses the existing watch entry for an address already being watched", () => {
    const repo = fakeRepo({ watched: [], snapshots: [] });
    const first = addToWatchlist(repo, "123 Main St", sampleDetails("123 Main St"));
    const second = addToWatchlist(repo, "123 Main St", sampleDetails("123 Main St"));
    expect(second.watchedProperty.id).toBe(first.watchedProperty.id);
    expect(listWatchlist(repo)).toHaveLength(1);
    expect(getWatchlistHistory(repo, first.watchedProperty.id)).toHaveLength(2);
  });
});

describe("refreshWatchedProperty", () => {
  it("fetches fresh details and appends a new snapshot", async () => {
    const repo = fakeRepo({ watched: [], snapshots: [] });
    const { watchedProperty } = addToWatchlist(repo, "123 Main St", sampleDetails("123 Main St"));
    const client = fakeClient({ ...sampleDetails("123 Main St"), squareFootage: 1900 });

    const snapshot = await refreshWatchedProperty(repo, client, watchedProperty.id);

    expect(snapshot.squareFootage).toBe(1900);
    expect(getWatchlistHistory(repo, watchedProperty.id)).toHaveLength(2);
  });

  it("throws when the watched property does not exist", async () => {
    const repo = fakeRepo({ watched: [], snapshots: [] });
    const client = fakeClient(sampleDetails("123 Main St"));
    await expect(refreshWatchedProperty(repo, client, 999)).rejects.toThrow();
  });
});

describe("removeFromWatchlist", () => {
  it("removes the watched property and its snapshot history", () => {
    const repo = fakeRepo({ watched: [], snapshots: [] });
    const { watchedProperty } = addToWatchlist(repo, "123 Main St", sampleDetails("123 Main St"));

    removeFromWatchlist(repo, watchedProperty.id);

    expect(listWatchlist(repo)).toHaveLength(0);
    expect(getWatchlistHistory(repo, watchedProperty.id)).toHaveLength(0);
  });
});
