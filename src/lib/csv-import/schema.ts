import { z } from "zod";

export const importTypeSchema = z.enum([
  "Position",
  "Transaction",
  "Performance",
  "Journal",
  "Expense",
  "Roster",
]);

// Keys are CSV column indices, serialized as strings by JS object semantics.
export const columnMappingSchema = z.record(z.string(), z.string());

export const fieldOptionsSchema = z.object({
  delimiter: z.string().optional(),
  dateFormat: z.string().optional(),
  constantValue: z.string().optional(),
});

// Per-column options, keyed by the same column index as columnMappingSchema.
export const fieldOptionsMapSchema = z.record(z.string(), fieldOptionsSchema);

export const accountNameMatchSchema = z.object({
  accountId: z.number().int().positive(),
  accountName: z.string().trim().min(1),
});

/** Keyed by the CSV's own account label, trimmed. */
export const accountNameMappingSchema = z.record(z.string(), accountNameMatchSchema);

export const saveCurrentMappingSchema = z.object({
  importType: importTypeSchema,
  columnMapping: columnMappingSchema,
});

export type SaveCurrentMappingInput = z.infer<typeof saveCurrentMappingSchema>;

export const createNamedMappingSchema = z.object({
  name: z.string().min(1),
  importType: importTypeSchema,
  columnMapping: columnMappingSchema,
  // Optional so existing callers (the stock importer) need no change; absent
  // means "no per-column options". z.input keeps it optional for callers while
  // parse() fills the {} default before it reaches the repository.
  fieldOptions: fieldOptionsMapSchema.default({}),
  // Same reasoning as fieldOptions: optional for callers that have no account
  // labels to remember (every import type but Performance), defaulted before it
  // reaches the repository.
  accountNameMapping: accountNameMappingSchema.default({}),
});

export type CreateNamedMappingInput = z.input<typeof createNamedMappingSchema>;

export const updateNamedMappingSchema = z.object({
  name: z.string().min(1),
  columnMapping: columnMappingSchema,
  fieldOptions: fieldOptionsMapSchema.default({}),
  accountNameMapping: accountNameMappingSchema.default({}),
});

export type UpdateNamedMappingInput = z.input<typeof updateNamedMappingSchema>;
