import { z } from "zod";

export const csvColumnTypeSchema = z.enum(["text", "integer", "real", "date", "datetime", "boolean"]);

export const csvColumnDefinitionSchema = z.object({
  name: z.string().min(1),
  sourceHeader: z.string().min(1),
  type: csvColumnTypeSchema,
});

export const ingestModeSchema = z.enum(["append", "truncate", "overwrite"]);

const descriptionPreprocess = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

function primaryKeyFieldsMatchColumns(
  primaryKeyFields: string[],
  columns: { name: string }[],
): boolean {
  return primaryKeyFields.every((field) => columns.some((column) => column.name === field));
}

export const createCsvAnalyticEntrySchema = z
  .object({
    name: z.string().min(1),
    description: descriptionPreprocess,
    tableBaseName: z.string().min(1),
    columns: z.array(csvColumnDefinitionSchema).min(1),
    primaryKeyFields: z.array(z.string()).default([]),
    fileText: z.string().min(1),
  })
  .refine((input) => primaryKeyFieldsMatchColumns(input.primaryKeyFields, input.columns), {
    message: "Every primary key field must match a defined column.",
    path: ["primaryKeyFields"],
  });

export type CreateCsvAnalyticEntryInput = z.infer<typeof createCsvAnalyticEntrySchema>;

// Editing always updates name/description; `ingest` is only present when the user drops
// a new file, and only "overwrite" needs columns/primaryKeyFields (append/truncate reuse
// the entry's existing schema untouched).
export const updateCsvAnalyticEntrySchema = z
  .object({
    name: z.string().min(1),
    description: descriptionPreprocess,
    ingest: z
      .object({
        mode: ingestModeSchema,
        fileText: z.string().min(1),
        tableBaseName: z.string().min(1).optional(),
        columns: z.array(csvColumnDefinitionSchema).optional(),
        primaryKeyFields: z.array(z.string()).optional(),
      })
      .optional(),
  })
  .refine(
    (input) => input.ingest?.mode !== "overwrite" || (input.ingest.columns?.length ?? 0) > 0,
    { message: "Overwrite requires at least one column definition.", path: ["ingest", "columns"] },
  )
  .refine(
    (input) =>
      input.ingest?.mode !== "overwrite" ||
      primaryKeyFieldsMatchColumns(input.ingest.primaryKeyFields ?? [], input.ingest.columns ?? []),
    { message: "Every primary key field must match a defined column.", path: ["ingest", "primaryKeyFields"] },
  );

export type UpdateCsvAnalyticEntryInput = z.infer<typeof updateCsvAnalyticEntrySchema>;
