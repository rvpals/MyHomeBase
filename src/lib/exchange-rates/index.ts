// The front door. Everything outside this folder imports from here.

export type {
  Currency,
  CurrencyBoard,
  CurrencyFailure,
  CurrencyRate,
  RateScale,
} from "./types";
export {
  CURRENCIES,
  CURRENCY_CODES,
  findCurrency,
  type CurrencyCode,
} from "./catalogue";
export {
  currencyBoardSchema,
  parseCurrencyCodes,
  type CurrencyBoardInput,
  type CurrencyBoardRequest,
} from "./schema";
export {
  changePercent,
  loadCurrencyBoard,
  rateFractionDigits,
  rateScale,
} from "./exchange-rates";
