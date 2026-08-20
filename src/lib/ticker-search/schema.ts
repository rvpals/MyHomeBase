import { z } from "zod";

/**
 * What the search box may send. Deliberately permissive — this is a *filter*
 * over symbols we already hold, not a symbol being stored, so anything the
 * reader types is a legitimate query even when nothing matches it.
 *
 * The cap is there so a paste of a whole document can't become a query; 32 is
 * comfortably longer than any real symbol.
 */
export const tickerQuerySchema = z.string().max(32);
