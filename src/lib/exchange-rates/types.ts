/**
 * The Foreign Currencies board: what one US dollar buys, per currency.
 *
 * Always USD-based, in that direction. Yahoo serves both `USDEUR=X` and
 * `EURUSD=X`, and market convention actually quotes the euro and sterling the
 * other way round — but the card reads "1 USD = X" on every row, so inverting
 * four of eleven to match a trading desk would make the card inconsistent with
 * itself for no gain to anyone reading it. See `CURRENCIES`.
 */

/** How a rate is printed — see `rateFractionDigits`. */
export type RateScale = "fine" | "coarse";

/** One currency on the board, as declared in the catalogue. */
export interface Currency {
  /** ISO 4217 code, e.g. "CNY". Also the row's identity. */
  code: string;
  /** What it's called, e.g. "Chinese Yuan". */
  label: string;
  /** The country or union whose flag the row draws. */
  flag: string;
  /** Yahoo's symbol for one USD in this currency, e.g. `USDCNY=X`. */
  symbol: string;
}

/** One fetched rate, ready to render. */
export interface CurrencyRate {
  code: string;
  label: string;
  flag: string;
  /** Units of this currency per one US dollar. */
  rate: number;
  /** The previous session's close, or `undefined` when the provider omitted it. */
  previousRate?: number;
  /**
   * The day move as a signed percentage, or `undefined` when there is no
   * previous close to compare against. Not defaulted to zero: "unchanged" and
   * "unknown" are different answers and the card draws them differently.
   */
  changePct?: number;
}

/** A symbol that could not be fetched, and why — reported, never thrown. */
export interface CurrencyFailure {
  code: string;
  message: string;
}

/**
 * The whole board.
 *
 * A partly-failed board is still a board: one dead symbol should not blank ten
 * good rows, so failures are collected here and the card shows what it got. The
 * same choice `loadIndexBoard` makes, for the same reason.
 */
export interface CurrencyBoard {
  rates: CurrencyRate[];
  failures: CurrencyFailure[];
  /** When the board was fetched, as an ISO instant. */
  fetchedAt: string;
}
