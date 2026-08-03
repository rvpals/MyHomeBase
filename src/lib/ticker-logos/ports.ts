import type { TickerLogoImage, TickerLogoRecord } from "./types";

export interface TickerLogoRepository {
  get(ticker: string): TickerLogoRecord | undefined;
  /** Stores a found logo, replacing any existing row for the ticker. */
  save(ticker: string, image: TickerLogoImage, source: string): void;
  /** Records that a lookup found nothing, so it isn't repeated on every render. */
  saveMissing(ticker: string, source: string): void;
}

/** What a fetch attempt produced. */
export interface FetchedLogo {
  image: TickerLogoImage;
  /** The URL it came from, stored alongside the bytes. */
  source: string;
}

export interface TickerLogoClient {
  /**
   * Downloads a logo, or returns undefined when the service has none for this
   * ticker. Implementations must not throw for an ordinary "not found".
   */
  fetch(ticker: string): Promise<FetchedLogo | undefined>;
  /** The URL that would be tried — recorded when a lookup finds nothing. */
  sourceFor(ticker: string): string;
}
