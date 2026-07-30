// A place resolved from a geocoding service: coordinates plus a human-readable
// name/address. The map picker turns these into journal entry locations.
export interface GeoPlace {
  latitude: number;
  longitude: number;
  displayName: string;
}
