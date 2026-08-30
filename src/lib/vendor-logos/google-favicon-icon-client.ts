import type { VendorIconClient } from "./ports";
import { isAcceptableVendorLogo } from "./vendor-logos";

// Downloads the icon for a domain from Google's favicon service — free, no key,
// no account.
//
// Why this and not Clearbit, which was the first choice: logo.clearbit.com no
// longer resolves at all (no A record — HubSpot retired the free logo API after
// the acquisition). Google's endpoint answers a clean 404 for a domain it has
// nothing for, which is what makes a wrong domain a reportable miss rather than
// a wrong icon.
//
// The trade is quality: a favicon is smaller and plainer than a real logo asset.
// At the 20px these render at, that is close to invisible.

const BASE_URL = "https://www.google.com/s2/favicons";

/** Requests are abandoned rather than left holding a bulk run open. */
const TIMEOUT_MS = 6_000;

/** The largest this endpoint serves, and room to spare for a high-DPI screen. */
const REQUESTED_SIZE = 128;

export class GoogleFaviconIconClient implements VendorIconClient {
  async fetchForDomain(domain: string) {
    if (domain.trim() === "") return undefined;

    const source = `${BASE_URL}?domain=${encodeURIComponent(domain)}&sz=${REQUESTED_SIZE}`;
    const response = await globalThis.fetch(source, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "image/png,image/jpeg,image/webp,image/*" },
    });

    // A 404 still carries a body — Google answers with a generic globe rather
    // than nothing. Returning that would put a meaningless grey globe against
    // every vendor whose domain was wrong, so the status decides, not the bytes.
    if (!response.ok) return undefined;

    const mimeType = (response.headers.get("content-type") ?? "").split(";")[0].trim();
    const data = Buffer.from(await response.arrayBuffer());
    if (!isAcceptableVendorLogo(mimeType, data.length)) return undefined;

    return { data, mimeType, source };
  }
}
