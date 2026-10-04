import { z } from "zod";
import { CURRENCY_CODES } from "./catalogue";

/**
 * The boundary shape for a board load.
 *
 * A closed enum rather than a free string, exactly as `indexBoardSchema` does:
 * these codes are *this card's* catalogue, not ISO 4217 entire, and one that
 * isn't in the catalogue has no label, flag or symbol to render it with.
 * Omitting `codes` means the whole board, which is what every caller does.
 */
export const currencyBoardSchema = z.object({
  codes: z
    .array(z.enum(CURRENCY_CODES))
    .min(1, "Pick at least one currency.")
    // The same currency twice is one row, not two identical ones.
    .transform((values) => Array.from(new Set(values)))
    .optional(),
});

/** What a caller may pass — `codes` optional. */
export type CurrencyBoardInput = z.input<typeof currencyBoardSchema>;

/** The validated shape. What `parse` hands back. */
export type CurrencyBoardRequest = z.output<typeof currencyBoardSchema>;

/**
 * The same shape from a source that has raw strings — argv, a query string.
 *
 * Parsing through the schema rather than casting is the point: an uncatalogued
 * code is rejected with the catalogue's own message instead of reaching the
 * use-case as a lie about its type. Codes are upper-cased first so `--codes eur`
 * works the way anyone would expect.
 */
export function parseCurrencyCodes(raw: string[] | undefined): CurrencyBoardRequest {
  return currencyBoardSchema.parse(
    raw === undefined ? {} : { codes: raw.map((code) => code.toUpperCase()) },
  );
}
