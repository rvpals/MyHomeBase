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
    // Columns in `columns` that have no header in the file at all — the user types one
    // literal value here, applied to every imported row, keyed by that column's `name`.
    newColumnValues: z.record(z.string(), z.string()).optional(),
  })
  .refine((input) => primaryKeyFieldsMatchColumns(input.primaryKeyFields, input.columns), {
    message: "Every primary key field must match a defined column.",
    path: ["primaryKeyFields"],
  })
  .refine(
    (input) => {
      const values = input.newColumnValues ?? {};
      return Object.keys(values).every((name) => values[name]?.trim());
    },
    { message: "Every new column needs a value to apply to each row.", path: ["newColumnValues"] },
  );

export type CreateCsvAnalyticEntryInput = z.infer<typeof createCsvAnalyticEntrySchema>;

// Editing always updates name/description; `ingest` is only present when the user drops
// a new file. "overwrite" needs columns/primaryKeyFields for the whole redefined schema.
// For append/truncate, `columns` is only the NEW columns being added (the entry's existing
// schema is otherwise reused untouched), and `newColumnValues` provides the value to apply
// to each new column for every row, keyed by that column's `name`.
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
        newColumnValues: z.record(z.string(), z.string()).optional(),
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
  )
  .refine(
    (input) => {
      if (!input.ingest || input.ingest.mode === "overwrite") return true;
      const newColumns = input.ingest.columns ?? [];
      const values = input.ingest.newColumnValues ?? {};
      return newColumns.every((column) => values[column.name]?.trim());
    },
    { message: "Every new column needs a value to apply to each row.", path: ["ingest", "newColumnValues"] },
  );

export type UpdateCsvAnalyticEntryInput = z.infer<typeof updateCsvAnalyticEntrySchema>;

// A saved chart preset. `optionsJson` is stored opaquely by lib, but is validated here
// as well-formed JSON so a malformed blob never reaches the database.
export const saveChartPresetSchema = z.object({
  entryId: z.number().int().positive(),
  name: z.string().min(1),
  optionsJson: z.string().refine(
    (value) => {
      try {
        JSON.parse(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: "Chart options must be valid JSON." },
  ),
});

export type SaveChartPresetInput = z.infer<typeof saveChartPresetSchema>;
