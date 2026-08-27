import { z } from "zod";
import { MARKET_INDEX_SYMBOLS } from "./catalogue";

/**
 * The boundary shape for a board load.
 *
 * A closed enum rather than a free string, for the same reason
 * `runSimulationSchema` closes its ranges: these symbols are *this card's*
 * catalogue, not Yahoo's whole universe, and one that isn't in the catalogue has
 * no label or unit to render it with. Omitting `symbols` means the whole board,
 * which is what both callers do by default.
 */
export const indexBoardSchema = z.object({
  symbols: z
    .array(z.enum(MARKET_INDEX_SYMBOLS))
    .min(1, "Pick at least one index.")
    // The same symbol twice is one row, not two identical ones.
    .transform((values) => Array.from(new Set(values)))
    .optional(),
});

export type IndexBoardInput = z.infer<typeof indexBoardSchema>;

/**
 * The same shape from a source that has raw strings — argv, a query string.
 *
 * The CLI can't hand `loadIndexBoard` a typed symbol union out of `--symbols`
 * without casting, and a cast is exactly the check we want the schema to do. So
 * the adapter parses through this first and passes on the validated result: an
 * uncatalogued symbol is rejected with the catalogue's own message rather than
 * reaching the use-case as a lie about its type.
 */
export function parseIndexSymbols(raw: string[] | undefined): IndexBoardInput {
  return indexBoardSchema.parse(raw === undefined ? {} : { symbols: raw });
}
