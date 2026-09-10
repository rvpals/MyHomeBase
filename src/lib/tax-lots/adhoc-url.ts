// Carrying a set of transactions in a URL.
//
// The ad-hoc analyzer stores nothing, so the URL *is* the state: it is what makes an
// analysis bookmarkable, refresh-proof, and linkable from the ticker viewer. That
// forces two constraints this file exists to satisfy:
//
//   - It must be compact. A `?lots=` carrying twenty transactions as pretty JSON
//     would blow past what a browser and a server will accept on a query string.
//     So each lot is a delimited tuple, not an object with repeated key names.
//   - It must never throw at the caller. A stale bookmark, a truncated copy-paste
//     or a hand-edited param is ordinary, and the screen's answer to all three is
//     "fall back to the stored view" — so decoding returns `undefined` rather than
//     raising, and the section treats that exactly like an absent param.
//
// Positional and pipe-delimited rather than JSON-in-base64: the result is readable
// in the address bar, which matters when the thing you are debugging is "why did
// this link analyze the wrong lots?".

import { adhocLotSchema, type AdhocLotInput } from "./schema";

/** Between the fields of one lot. */
const FIELD_SEPARATOR = "~";
/** Between lots. Not a comma: a note may well contain one. */
const LOT_SEPARATOR = "|";

/**
 * The field order inside one encoded lot. Append-only — a link someone bookmarked
 * last month decodes by position, so inserting a field in the middle would silently
 * shift every value after it into the wrong slot.
 */
const FIELD_COUNT = 6;

/** Strips the delimiters from free text so a note can't split its own record. */
function sanitize(value: string): string {
  return value.replaceAll(FIELD_SEPARATOR, " ").replaceAll(LOT_SEPARATOR, " ").trim();
}

/**
 * Encodes transactions for a `?lots=` param.
 *
 * Not URL-escaped here — that is `URLSearchParams`' job, and doing it in both places
 * would double-encode. Shares and price are written with `String`, so a whole share
 * count stays "10" rather than becoming "10.0000".
 */
export function encodeAdhocLots(lots: AdhocLotInput[]): string {
  return lots
    .map((lot) =>
      [
        lot.buyDate,
        String(lot.shares),
        String(lot.pricePerShare),
        lot.isSplitAdjusted ? "1" : "0",
        sanitize(lot.brokerageFirm),
        sanitize(lot.note),
      ].join(FIELD_SEPARATOR),
    )
    .join(LOT_SEPARATOR);
}

/**
 * Decodes a `?lots=` param, or `undefined` when it isn't a usable set.
 *
 * Every lot must parse. A partial decode is worse than no decode: dropping one
 * malformed transaction out of twelve would show a confident aggregate over eleven,
 * and nothing on the screen would say a purchase went missing. So one bad record
 * rejects the whole param and the screen falls back to the stored lots.
 */
export function decodeAdhocLots(encoded: string | undefined): AdhocLotInput[] | undefined {
  if (!encoded) return undefined;

  const lots: AdhocLotInput[] = [];
  for (const record of encoded.split(LOT_SEPARATOR)) {
    if (!record) continue;
    const fields = record.split(FIELD_SEPARATOR);
    if (fields.length !== FIELD_COUNT) return undefined;

    const [buyDate, shares, pricePerShare, isSplitAdjusted, brokerageFirm, note] = fields;
    // The schema does the validating, not this function — the same schema the form
    // and the CLI use, so a URL cannot smuggle in a shape they would have rejected.
    const parsed = adhocLotSchema.safeParse({
      buyDate,
      shares,
      pricePerShare,
      // "0" is truthy as a string, so the flag is compared rather than coerced —
      // `z.coerce.boolean()` on "0" would yield `true` and silently skip the split
      // table on every decoded lot.
      isSplitAdjusted: isSplitAdjusted === "1",
      brokerageFirm,
      note,
    });
    if (!parsed.success) return undefined;
    lots.push(parsed.data);
  }

  return lots.length > 0 ? lots : undefined;
}

/* ---------------------------------------------------------------------------------
   The multi-ticker payload, for "Add by tickers".
--------------------------------------------------------------------------------- */

/** Between one ticker's block and the next. */
const TICKER_SEPARATOR = ";";
/** Between a ticker symbol and its encoded lots. */
const SYMBOL_SEPARATOR = "=";

/**
 * Encodes several tickers, each with its own lots, for a `?tickers=` param.
 *
 * A separate param from `?lots=` rather than a superset of it. The single-ticker
 * link is the one the ticker viewer emits and the one a user is most likely to have
 * bookmarked, so it keeps its own shorter format and cannot be broken by a change
 * here — the screen accepts either and prefers this one when both are present.
 */
export function encodeTickerLots(
  entries: { ticker: string; lots: AdhocLotInput[] }[],
): string {
  return entries
    .filter((entry) => entry.lots.length > 0)
    .map((entry) => `${entry.ticker}${SYMBOL_SEPARATOR}${encodeAdhocLots(entry.lots)}`)
    .join(TICKER_SEPARATOR);
}

/**
 * Decodes a `?tickers=` param, or `undefined` when it isn't a usable set.
 *
 * Same all-or-nothing rule as the single-ticker decoder, for the same reason: a
 * partial decode would show a confident grand total with a whole ticker silently
 * missing from it, and nothing on the screen would say so.
 */
export function decodeTickerLots(
  encoded: string | undefined,
): { ticker: string; lots: AdhocLotInput[] }[] | undefined {
  if (!encoded) return undefined;

  const entries: { ticker: string; lots: AdhocLotInput[] }[] = [];
  for (const block of encoded.split(TICKER_SEPARATOR)) {
    if (!block) continue;
    // Split on the FIRST separator only, so the lots half is handed over intact.
    const at = block.indexOf(SYMBOL_SEPARATOR);
    if (at <= 0) return undefined;

    const ticker = block.slice(0, at).trim().toUpperCase();
    const lots = decodeAdhocLots(block.slice(at + 1));
    if (!ticker || !lots) return undefined;
    entries.push({ ticker, lots });
  }

  return entries.length > 0 ? entries : undefined;
}
