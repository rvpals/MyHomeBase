import { z } from "zod";

export const tickerSchema = z.string().min(1);

// range/interval follow Yahoo's chart API vocabulary (e.g. "1y"/"1d") — validated
// as non-empty strings rather than a closed enum, since the set of accepted values
// is the upstream provider's, not this app's.
export const historyRequestSchema = z.object({
  ticker: z.string().min(1),
  range: z.string().min(1),
  interval: z.string().min(1),
});

export type HistoryRequest = z.infer<typeof historyRequestSchema>;
