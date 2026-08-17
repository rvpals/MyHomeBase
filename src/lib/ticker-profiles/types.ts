/**
 * A cache entry for one ticker's reference data.
 *
 * A blank `sector` is a recorded outcome — "the provider reported none" — not a
 * miss, so it stops the same symbol being re-requested on every render. Most
 * ETFs live here permanently: a fund genuinely has no single sector.
 */
export interface TickerProfileRecord {
  ticker: string;
  /** The provider's sector. Blank means it reported none. */
  sector: string;
  /** Stored because it arrives in the same payload; nothing reads it yet. */
  industry: string;
  /** A user-set sector, which wins over `sector`. Blank means unset. */
  manualSector: string;
  source: string;
  fetchedAt: string;
}

/** What a provider lookup produced. Blank fields mean "reported none". */
export interface FetchedProfile {
  sector: string;
  industry: string;
}

/**
 * The label a position with no usable sector is charted under.
 *
 * "ETFs & funds" rather than "Unclassified" because for a fund that is the
 * truthful description — the sector is absent by nature, not by omission — and
 * because an unexplained "Unclassified" bar is exactly the slice a reader wants
 * accounted for.
 */
export const NO_SECTOR_LABEL = "ETFs & funds";
