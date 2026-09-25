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
  /**
   * Ask for the second pass — the 52-week range, the moving averages, the
   * all-time high and the intraday series.
   *
   * Off by default, and deliberately a request rather than a promise: it
   * triples the provider calls, and the leg that carries most of these figures
   * needs an authenticated crumb that can be refused. The board comes back
   * either way; the figures are attached where they arrived.
   */
  includeDetail: z.boolean().optional().default(false),
});

/**
 * The *input* shape — what a caller may pass. `z.input` rather than `z.infer`
 * deliberately: `includeDetail` has a default, so the parsed output type has it
 * required while the thing you hand in may omit it. Inferring the output here
 * would make `loadIndexBoard(client)` and every `{ symbols: [...] }` literal a
 * type error for a field the schema exists to fill in.
 */
export type IndexBoardInput = z.input<typeof indexBoardSchema>;

/** The validated shape, with every default filled in. What `parse` hands back. */
export type IndexBoardRequest = z.output<typeof indexBoardSchema>;

/**
 * The same shape from a source that has raw strings — argv, a query string.
 *
 * The CLI can't hand `loadIndexBoard` a typed symbol union out of `--symbols`
 * without casting, and a cast is exactly the check we want the schema to do. So
 * the adapter parses through this first and passes on the validated result: an
 * uncatalogued symbol is rejected with the catalogue's own message rather than
 * reaching the use-case as a lie about its type.
 */
export function parseIndexSymbols(
  raw: string[] | undefined,
  includeDetail = false,
): IndexBoardRequest {
  return indexBoardSchema.parse({
    ...(raw === undefined ? {} : { symbols: raw }),
    includeDetail,
  });
}
