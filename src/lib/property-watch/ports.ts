import type { PropertyDetails, PropertySnapshot, WatchedProperty } from "./types";

export interface PropertyLookupClient {
  lookup(address: string): Promise<PropertyDetails>;
}

export interface WatchedPropertyRepository {
  listWatchedProperties(): WatchedProperty[];
  getWatchedPropertyById(id: number): WatchedProperty | undefined;
  getWatchedPropertyByAddress(address: string): WatchedProperty | undefined;
  addWatchedProperty(address: string): WatchedProperty;
  removeWatchedProperty(id: number): void;
  addSnapshot(watchedPropertyId: number, source: string, details: PropertyDetails): PropertySnapshot;
  listSnapshotsForWatchedProperty(watchedPropertyId: number): PropertySnapshot[];
}
