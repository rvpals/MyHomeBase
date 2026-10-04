import type { Currency } from "./types";

/**
 * The board, in display order.
 *
 * Eleven currencies, fixed in code rather than configurable — the same choice the
 * Indexes catalogue makes, and for the same reason: a household dashboard wants a
 * considered list, not an empty one with a picker. Adding a currency is a one-line
 * edit here plus a flag in `currency-flags.tsx`.
 *
 * Every symbol is `USD{CODE}=X`, so every rate reads "1 USD = X" without inversion.
 * Yahoo reaches all of them through the same chart endpoint a normal ticker uses,
 * which is why none of these needed anything beyond `getRate`.
 *
 * `flag` names the SVG the row draws, not a file or a domain — nothing here reaches
 * the network for artwork. EUR flies the European Union's flag rather than any one
 * member state's, which is why the field is `flag` and not `country`.
 */
export const CURRENCIES: readonly Currency[] = [
  { code: "CNY", label: "Chinese Yuan", flag: "cn", symbol: "USDCNY=X" },
  { code: "EUR", label: "Euro", flag: "eu", symbol: "USDEUR=X" },
  { code: "GBP", label: "British Pound", flag: "gb", symbol: "USDGBP=X" },
  { code: "JPY", label: "Japanese Yen", flag: "jp", symbol: "USDJPY=X" },
  { code: "CAD", label: "Canadian Dollar", flag: "ca", symbol: "USDCAD=X" },
  { code: "AUD", label: "Australian Dollar", flag: "au", symbol: "USDAUD=X" },
  { code: "CHF", label: "Swiss Franc", flag: "ch", symbol: "USDCHF=X" },
  { code: "KRW", label: "South Korean Won", flag: "kr", symbol: "USDKRW=X" },
  { code: "HKD", label: "Hong Kong Dollar", flag: "hk", symbol: "USDHKD=X" },
  { code: "INR", label: "Indian Rupee", flag: "in", symbol: "USDINR=X" },
  { code: "TWD", label: "Taiwan Dollar", flag: "tw", symbol: "USDTWD=X" },
] as const;

/**
 * Every currency code on the board, as literal types.
 *
 * Spelled out rather than mapped from `CURRENCIES`, for the same reason
 * `MARKET_INDEX_SYMBOLS` is: `z.enum` needs a literal tuple, and a `.map()` over
 * the catalogue widens to `string[]` and loses exactly the type the schema
 * exists to enforce. The test keeps the two lists in step.
 */
export const CURRENCY_CODES = [
  "CNY",
  "EUR",
  "GBP",
  "JPY",
  "CAD",
  "AUD",
  "CHF",
  "KRW",
  "HKD",
  "INR",
  "TWD",
] as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[number];

/** The catalogue entry for a code, or `undefined` when it isn't on the board. */
export function findCurrency(code: string): Currency | undefined {
  return CURRENCIES.find((currency) => currency.code === code.toUpperCase());
}
