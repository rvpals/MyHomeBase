import type { VendorDomainClient } from "./ports";
import { hostnameOf, isVendorOwnSite } from "./vendor-logos";

// Resolves a vendor name to its own website using DuckDuckGo's Instant Answer
// API — free, keyless, no account, and explicitly public.
//
// This exists because guessing does not work. `<name>.com` cannot produce
// usps.com from "United States Post Office", cannot know Morris Museum is a
// .org, and cannot pluralise "TGI Friday" into tgifridays.com. Those were real
// misses on a real vendor list. A search engine answers all three.
//
// It is not a general web search: the Instant Answer API returns the structured
// answer DuckDuckGo already has for a query, so it is quiet for a small local
// business it has never heard of. That is the right shape here — a confident
// answer or nothing, rather than a best-effort link that would attach the wrong
// logo to a vendor.

const API_ORIGIN = "https://api.duckduckgo.com";

/** Requests are abandoned rather than left holding a bulk run open. */
const TIMEOUT_MS = 8_000;

/** The fields of the Instant Answer payload this uses. */
interface InstantAnswer {
  /** The canonical site for the subject, when there is one. */
  AbstractURL?: string;
  /** Related links; the first is usually the official site. */
  Results?: { FirstURL?: string }[];
}

export class DuckDuckGoVendorDomainClient implements VendorDomainClient {
  async resolve(vendorName: string): Promise<string | undefined> {
    const query = vendorName.trim();
    if (query === "") return undefined;

    // `skip_disambig` so an ambiguous name yields nothing rather than a
    // disambiguation page, and `no_html` because none of it is rendered.
    const url =
      `${API_ORIGIN}/?q=${encodeURIComponent(query)}` +
      `&format=json&no_html=1&skip_disambig=1&t=myhomebase`;

    const response = await globalThis.fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return undefined;

    const answer = (await response.json()) as InstantAnswer;

    // Results[0] first: it is the official site when present, whereas the
    // abstract is often the Wikipedia article about the company.
    const candidates = [answer.Results?.[0]?.FirstURL, answer.AbstractURL].filter(
      (value): value is string => typeof value === "string" && value !== "",
    );

    for (const candidate of candidates) {
      // A Wikipedia or Yelp favicon against a vendor is worse than none — it
      // looks like the feature worked.
      if (!isVendorOwnSite(candidate)) continue;
      const host = hostnameOf(candidate);
      if (host) return host;
    }
    return undefined;
  }
}
