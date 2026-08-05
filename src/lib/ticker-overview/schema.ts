import { z } from "zod";
import { TICKER_HISTORY_RANGES } from "./types";

/**
 * A ticker as it crosses a boundary. Trimmed and upper-cased here so every
 * caller — the web action, the CLI, a test — looks the symbol up the same way,
 * and a stray "aapl " can't miss a position stored as "AAPL".
 */
export const tickerOverviewSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1, "A ticker is required.")
    .max(20, "That is too long to be a ticker.")
    .transform((value) => value.toUpperCase()),
});

export type TickerOverviewInput = z.infer<typeof tickerOverviewSchema>;

export const tickerHistoryRangeSchema = z.enum(TICKER_HISTORY_RANGES);

export const tickerPriceSeriesSchema = tickerOverviewSchema.extend({
  range: tickerHistoryRangeSchema.default("1y"),
});

export type TickerPriceSeriesInput = z.infer<typeof tickerPriceSeriesSchema>;

export const tickerNewsFeedSchema = tickerOverviewSchema.extend({
  /** Capped because the panel is a reading list, not an archive. */
  limit: z.number().int().min(1).max(25).default(10),
});

export type TickerNewsFeedInput = z.infer<typeof tickerNewsFeedSchema>;
