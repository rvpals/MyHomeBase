import type { FetchedProfile, TickerProfileRecord } from "./types";

export interface TickerProfileRepository {
  get(ticker: string): TickerProfileRecord | undefined;
  /** Every cached profile — the sector roll-up needs them all at once. */
  list(): TickerProfileRecord[];
  /**
   * Stores a lookup's result, replacing any existing row for the ticker.
   * A blank `sector` records "the provider reported none", which is what stops
   * a fund being re-requested forever. `manual_sector` is never touched here —
   * a refresh must not discard a user's override.
   */
  save(ticker: string, profile: FetchedProfile, source: string): void;
}

export interface TickerProfileClient {
  /**
   * Looks up one ticker's sector and industry.
   *
   * Returns blank fields when the provider answered but reported none — that is
   * an answer worth caching. Implementations **must throw** when the request
   * itself failed, so a network outage is never recorded as a permanent absence.
   */
  fetch(ticker: string): Promise<FetchedProfile>;
  /** Names the provider, recorded alongside a stored profile. */
  readonly source: string;
}
