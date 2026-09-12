import { z } from "zod";
import { ACCOUNT_KINDS, ANALYSIS_FOCUSES, DEFAULT_EXPORTED_KINDS } from "./types";

export const exportFormatSchema = z.enum(["markdown", "json"]);

export const analysisFocusSchema = z.enum(ANALYSIS_FOCUSES);

export const accountKindSchema = z.enum(ACCOUNT_KINDS);

/**
 * What the reader chose, as it arrives from the modal or from argv.
 *
 * An empty `focus` is allowed on purpose — it means "review it generally"
 * rather than a mistake, and the prompt has a branch for exactly that. The
 * duplicate check exists because a checkbox group that somehow submits the same
 * value twice would otherwise emit the same instruction block twice.
 */
export const portfolioExportOptionsSchema = z.object({
  format: exportFormatSchema.default("markdown"),
  focus: z
    .array(analysisFocusSchema)
    .default([])
    .refine((values) => new Set(values).size === values.length, {
      message: "A focus area is selected more than once.",
    }),
  includeKinds: z
    .array(accountKindSchema)
    .nonempty("Select at least one account type to export.")
    .default([...DEFAULT_EXPORTED_KINDS]),
});

export type PortfolioExportOptions = z.infer<typeof portfolioExportOptionsSchema>;
