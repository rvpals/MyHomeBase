import type { IndexLogoImage, IndexLogoRecord } from "./types";

export interface IndexLogoRepository {
  get(symbol: string): IndexLogoRecord | undefined;
  /** Stores a found logo, replacing any existing row for the symbol. */
  save(symbol: string, image: IndexLogoImage, source: string): void;
  /** Records that a lookup found nothing, so it isn't repeated on every render. */
  saveMissing(symbol: string, source: string): void;
}

/**
 * Downloads the icon for a domain.
 *
 * Structurally identical to `VendorIconClient`, and deliberately so —
 * `GoogleFaviconIconClient` already implements this shape and is wired in as
 * the real one, so no second HTTP client exists for the same job. Declared here
 * rather than imported from `vendor-logos` to keep the two features
 * independent: a change to how vendor icons are found should not be able to
 * alter the index board.
 */
export interface IndexIconClient {
  /** Returns undefined when there is no icon for this domain — an ordinary miss. */
  fetchForDomain(
    domain: string,
  ): Promise<{ data: Buffer; mimeType: string; source: string } | undefined>;
}
