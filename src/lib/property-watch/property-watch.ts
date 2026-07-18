import type { PropertyLookupClient, WatchedPropertyRepository } from "./ports";
import { addressLookupSchema } from "./schema";
import type { PropertyDetails, PropertySnapshot, WatchedProperty } from "./types";

const RENTCAST_SOURCE = "rentcast";

export async function lookupProperty(
  client: PropertyLookupClient,
  address: string,
): Promise<PropertyDetails> {
  const validated = addressLookupSchema.parse({ address });
  return client.lookup(validated.address);
}

export function listWatchlist(repo: WatchedPropertyRepository): WatchedProperty[] {
  return repo.listWatchedProperties();
}

export function getWatchlistHistory(
  repo: WatchedPropertyRepository,
  watchedPropertyId: number,
): PropertySnapshot[] {
  return repo.listSnapshotsForWatchedProperty(watchedPropertyId);
}

// Saves the address (if not already watched) and records the given lookup
// result as its first snapshot. Reuses the existing watch entry on repeat calls.
export function addToWatchlist(
  repo: WatchedPropertyRepository,
  address: string,
  details: PropertyDetails,
): { watchedProperty: WatchedProperty; snapshot: PropertySnapshot } {
  const validated = addressLookupSchema.parse({ address });
  const watchedProperty =
    repo.getWatchedPropertyByAddress(validated.address) ?? repo.addWatchedProperty(validated.address);
  const snapshot = repo.addSnapshot(watchedProperty.id, RENTCAST_SOURCE, details);
  return { watchedProperty, snapshot };
}

export async function refreshWatchedProperty(
  repo: WatchedPropertyRepository,
  client: PropertyLookupClient,
  watchedPropertyId: number,
): Promise<PropertySnapshot> {
  const watchedProperty = repo.getWatchedPropertyById(watchedPropertyId);
  if (!watchedProperty) throw new Error(`No watched property with id ${watchedPropertyId}.`);

  const details = await client.lookup(watchedProperty.address);
  return repo.addSnapshot(watchedProperty.id, RENTCAST_SOURCE, details);
}

export function removeFromWatchlist(repo: WatchedPropertyRepository, watchedPropertyId: number): void {
  repo.removeWatchedProperty(watchedPropertyId);
}
