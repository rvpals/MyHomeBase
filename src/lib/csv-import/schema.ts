import { z } from "zod";

export const importTypeSchema = z.enum(["Position", "Transaction", "Performance", "Journal"]);

// Keys are CSV column indices, serialized as strings by JS object semantics.
export const columnMappingSchema = z.record(z.string(), z.string());

export const fieldOptionsSchema = z.object({
  delimiter: z.string().optional(),
  dateFormat: z.string().optional(),
});

// Per-column options, keyed by the same column index as columnMappingSchema.
export const fieldOptionsMapSchema = z.record(z.string(), fieldOptionsSchema);

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
});

export type CreateNamedMappingInput = z.input<typeof createNamedMappingSchema>;

export const updateNamedMappingSchema = z.object({
  name: z.string().min(1),
  columnMapping: columnMappingSchema,
  fieldOptions: fieldOptionsMapSchema.default({}),
});

export type UpdateNamedMappingInput = z.input<typeof updateNamedMappingSchema>;
