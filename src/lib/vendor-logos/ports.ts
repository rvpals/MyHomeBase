/** The bytes of a logo and where they came from. */
export interface FetchedVendorLogo {
  data: Buffer;
  mimeType: string;
  /** The URL the bytes came from, for the run log. */
  source: string;
  /** The domain the icon was found under — shown so a wrong match is visible. */
  domain: string;
  /** Which half of the strategy found it. */
  via: "search" | "guess";
}

/**
 * Looks a vendor's name up and returns the domain of its own website.
 *
 * This is the half that makes the feature work at all. String manipulation
 * cannot turn "United States Post Office" into `usps.com`, "Morris Museum" into
 * a `.org`, or "TGI Friday" into `tgifridays.com` — a first version that only
 * guessed missed every one of those. A search engine already knows.
 */
export interface VendorDomainClient {
  /** The vendor's own domain, or undefined when the search has no answer. */
  resolve(vendorName: string): Promise<string | undefined>;
}

/**
 * Downloads a vendor's icon, given the domain to look under.
 *
 * Behind a port for the same reason `TickerLogoClient` is: the use case must be
 * testable without a network, and the provider is the part most likely to need
 * swapping. That is not hypothetical — Clearbit's free logo endpoint was the
 * first choice here and had already been retired (the hostname no longer
 * resolves) by the time it was wired up.
 */
export interface VendorIconClient {
  /** Returns undefined when there is no icon for this domain — an ordinary miss. */
  fetchForDomain(domain: string): Promise<{ data: Buffer; mimeType: string; source: string } | undefined>;
}

/**
 * Finds and downloads a vendor's icon: resolve a domain, then fetch its icon.
 *
 * One port over the two halves so the use case has a single thing to call and a
 * single thing to fake. Implementations must not throw for an ordinary "nothing
 * found"; a transport failure may throw and the caller treats it as one vendor
 * failing, not the run.
 */
export interface VendorLogoClient {
  fetch(vendorName: string): Promise<FetchedVendorLogo | undefined>;
}
