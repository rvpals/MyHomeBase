import { z } from "zod";

// zod is the single source of truth for the shapes crossing every boundary
// (web actions, CLI, importer). Entity schemas validate what the repository
// reads back; input schemas validate what callers send in.

export const weatherSchema = z.object({
  temp: z.number(),
  unit: z.string(),
  description: z.string(),
  code: z.number().int(),
});

export const entryLocationSchema = z.object({
  id: z.number().int().positive(),
  entryId: z.number().int().positive(),
  latitude: z.number(),
  longitude: z.number(),
  locationName: z.string(),
  sortOrder: z.number().int().nonnegative(),
});

export const journalEntrySchema = z.object({
  id: z.number().int().positive(),
  date: z.string().min(1),
  time: z.string(),
  title: z.string(),
  content: z.string(),
  placeName: z.string(),
  weather: weatherSchema.optional(),
  isPinned: z.boolean(),
  isLocked: z.boolean(),
  categories: z.array(z.string()),
  tags: z.array(z.string()),
  locations: z.array(entryLocationSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// A location as supplied by a caller: id/entryId/sortOrder are assigned by the
// repository (sortOrder from array position). locationName is optional.
export const entryLocationInputSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  locationName: z.string().default(""),
});

export type EntryLocationInput = z.input<typeof entryLocationInputSchema>;

// entry_date is the anchor field, so its format is enforced (it drives sorting
// and the date index). Category/tag arrays accept raw strings here — the
// use-case trims, drops blanks, and de-dupes them, so an importer can hand over
// the split result of "tag1, tag2, " without a pre-clean.
const entryDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be formatted as YYYY-MM-DD");

export const createEntrySchema = z.object({
  date: entryDateSchema,
  time: z.string().default(""),
  title: z.string().default(""),
  content: z.string().default(""),
  placeName: z.string().default(""),
  weather: weatherSchema.optional(),
  isPinned: z.boolean().default(false),
  isLocked: z.boolean().default(false),
  categories: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  locations: z.array(entryLocationInputSchema).default([]),
});

// Input type (what callers pass): fields with a default are optional. This is
// what a web action, CLI command, or importer constructs.
export type CreateEntryInput = z.input<typeof createEntrySchema>;

// Update replaces the whole aggregate — same shape as create.
export const updateEntrySchema = createEntrySchema;

export type UpdateEntryInput = z.input<typeof updateEntrySchema>;

// Output type (post-parse): every default has been applied, so every field is
// present. This is the fully-resolved shape the repository persists.
export type EntryWriteData = z.output<typeof createEntrySchema>;

export const journalCategorySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const journalTagSchema = journalCategorySchema;

export const upsertCategorySchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
});

export type UpsertCategoryInput = z.infer<typeof upsertCategorySchema>;

export const upsertTagSchema = upsertCategorySchema;

export type UpsertTagInput = z.infer<typeof upsertTagSchema>;
