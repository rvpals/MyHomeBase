import { z } from "zod";
import { IMAGE_UPLOAD_MIME_TYPES, imageUploadSchema } from "@/lib/shared/image-upload";

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
  iconMimeType: z.string().optional(),
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

// --- Saved entry filters -----------------------------------------------------

export const journalFilterFieldSchema = z.enum([
  "date",
  "time",
  "title",
  "content",
  "placeName",
  "category",
  "tag",
  "isPinned",
  "isLocked",
]);

export const journalFilterOperatorSchema = z.enum([
  "contains",
  "notContains",
  "equals",
  "before",
  "after",
  "between",
  "hasAny",
  "hasNone",
  "is",
  "isEmpty",
  "isNotEmpty",
]);

export const journalFilterJoinSchema = z.enum(["AND", "OR"]);

export const journalFilterConditionSchema = z.object({
  field: journalFilterFieldSchema,
  operator: journalFilterOperatorSchema,
  value: z.string().optional(),
  valueTo: z.string().optional(),
  values: z.array(z.string()).optional(),
});

export const journalFilterGroupSchema = z.object({
  join: journalFilterJoinSchema.default("AND"),
  conditions: z.array(journalFilterConditionSchema).default([]),
});

export const journalFilterSchema = z.object({
  join: journalFilterJoinSchema.default("AND"),
  groups: z.array(journalFilterGroupSchema).default([]),
});

export type JournalFilterInput = z.input<typeof journalFilterSchema>;

/** Saving a filter is an upsert by name — see migration 0043. */
export const saveJournalFilterSchema = z.object({
  name: z.string().min(1, "Give the filter a name."),
  filter: journalFilterSchema,
});

export type SaveJournalFilterInput = z.input<typeof saveJournalFilterSchema>;

/** What the repository persists, after defaults are applied. */
export type JournalFilterWriteData = z.output<typeof saveJournalFilterSchema>;

/**
 * Reads a stored `filter_json` string back into a filter, tolerating anything a
 * previous version of the app (or a hand-edited row) might have left there.
 *
 * The widening-envelope pattern `parseStoredMapping` in lib/csv-import uses:
 * accept older/looser shapes, always write the newest. A filter whose JSON is
 * unreadable comes back as an empty filter rather than throwing — the Entries
 * screen then lists everything and says the filter couldn't be read, which beats
 * a 500 on a screen the user can otherwise still use.
 *
 * Unknown fields and operators are dropped here rather than passed through, so
 * `buildFilterSql` only ever sees values from the allowlist.
 */
export function parseStoredJournalFilter(json: string): z.output<typeof journalFilterSchema> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { join: "AND", groups: [] };
  }

  // Tolerate a bare array of conditions — the shape a first cut might have
  // written before groups existed.
  if (Array.isArray(raw)) {
    const conditions = raw.filter(
      (item) => journalFilterConditionSchema.safeParse(item).success,
    ) as z.output<typeof journalFilterConditionSchema>[];
    return { join: "AND", groups: conditions.length > 0 ? [{ join: "AND", conditions }] : [] };
  }

  const parsed = journalFilterSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  // Partially-valid tree: keep the conditions that survive, drop the rest, so one
  // bad row doesn't discard a filter the user spent time on.
  if (raw && typeof raw === "object" && Array.isArray((raw as { groups?: unknown }).groups)) {
    const groups = ((raw as { groups: unknown[] }).groups)
      .map((group) => {
        if (!group || typeof group !== "object") return undefined;
        const candidate = group as { join?: unknown; conditions?: unknown };
        const conditions = Array.isArray(candidate.conditions)
          ? (candidate.conditions.filter(
              (item) => journalFilterConditionSchema.safeParse(item).success,
            ) as z.output<typeof journalFilterConditionSchema>[])
          : [];
        if (conditions.length === 0) return undefined;
        return { join: candidate.join === "OR" ? ("OR" as const) : ("AND" as const), conditions };
      })
      .filter((group): group is { join: "AND" | "OR"; conditions: z.output<typeof journalFilterConditionSchema>[] } =>
        group !== undefined,
      );
    const join = (raw as { join?: unknown }).join === "OR" ? ("OR" as const) : ("AND" as const);
    return { join, groups };
  }

  return { join: "AND", groups: [] };
}

/** Cap for a category/tag icon — same as an expense category icon; both render tiny. */
export const MAX_JOURNAL_ICON_BYTES = 128 * 1024;

// The upload shape and its type allowlist live in @/lib/shared/image-upload, which
// every module storing image bytes shares.
export const JOURNAL_IMAGE_MIME_TYPES = IMAGE_UPLOAD_MIME_TYPES;
export const journalImageUploadSchema = imageUploadSchema;
