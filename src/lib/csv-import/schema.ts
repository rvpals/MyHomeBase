import { z } from "zod";

export const importTypeSchema = z.enum(["Position", "Transaction", "Performance"]);

// Keys are CSV column indices, serialized as strings by JS object semantics.
export const columnMappingSchema = z.record(z.string(), z.string());

export const saveCurrentMappingSchema = z.object({
  importType: importTypeSchema,
  columnMapping: columnMappingSchema,
});

export type SaveCurrentMappingInput = z.infer<typeof saveCurrentMappingSchema>;

export const createNamedMappingSchema = z.object({
  name: z.string().min(1),
  importType: importTypeSchema,
  columnMapping: columnMappingSchema,
});

export type CreateNamedMappingInput = z.infer<typeof createNamedMappingSchema>;
