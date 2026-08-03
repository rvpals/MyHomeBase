import type { FetchedLogo, TickerLogoClient } from "./ports";
import { MAX_LOGO_BYTES, isValidTicker, normalizeTicker } from "./ticker-logos";

// Downloads ticker artwork from Financial Modeling Prep's public image endpoint,
// which takes a plain ticker and needs no API key. Deliberately tolerant: a
// missing logo is an ordinary outcome (undefined), not an error.

const BASE_URL = "https://financialmodelingprep.com/image-stock";

/** Requests are abandoned rather than left to hold a page render open. */
const TIMEOUT_MS = 6_000;

export class FmpTickerLogoClient implements TickerLogoClient {
  sourceFor(ticker: string): string {
    return `${BASE_URL}/${encodeURIComponent(normalizeTicker(ticker))}.png`;
  }

  async fetch(rawTicker: string): Promise<FetchedLogo | undefined> {
    const ticker = normalizeTicker(rawTicker);
    // Belt and braces — the use-case checks too, but this string goes into an
    // outbound URL, so it isn't trusted here either.
    if (!isValidTicker(ticker)) return undefined;

    const source = this.sourceFor(ticker);
    const response = await globalThis.fetch(source, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "image/png,image/jpeg,image/webp,image/*" },
    });

    // 404 for an unknown symbol is expected, not exceptional.
    if (!response.ok) return undefined;

    const mimeType = (response.headers.get("content-type") ?? "").split(";")[0].trim();
    // The endpoint answers 200 with an HTML error page for some symbols, so the
    // content type decides rather than the status code.
    if (!mimeType.startsWith("image/")) return undefined;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_LOGO_BYTES) return undefined;

    return { image: { data: buffer, mimeType }, source };
  }
}
