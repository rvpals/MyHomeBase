import { z } from "zod";

// zod is the single source of truth for every shape crossing a boundary into
// this module — the web actions and the CLI both parse with these, so the two
// adapters cannot drift.

/**
 * Coordinates are bounded here, unlike `entryLocationSchema` in `lib/journal`.
 *
 * That one is deliberately loose because the CSV importer feeds it whatever a
 * legacy export held (its own doc comment cites "12234.44, -2334.333"), and
 * rejecting a junk coordinate there would fail a whole import over one row.
 * Nothing imports into the library — every row is typed or clicked by a person
 * — so a latitude of 500 is a bug to catch, not history to preserve.
 */
const latitudeSchema = z
  .number()
  .min(-90, "latitude must be between -90 and 90")
  .max(90, "latitude must be between -90 and 90");

const longitudeSchema = z
  .number()
  .min(-180, "longitude must be between -180 and 180")
  .max(180, "longitude must be between -180 and 180");

/** A taxonomy name as stored: trimmed, non-empty, and length-capped. */
const taxonomyNameSchema = z
  .string()
  .trim()
  .min(1, "A name is required.")
  .max(60, "A name may be at most 60 characters.");

export const savedLocationSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  description: z.string(),
  address: z.string(),
  categories: z.array(z.string()),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const locationTaxonomySchema = z.object({
  name: z.string(),
  description: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * What a caller supplies to save a place. `id` is assigned by the repository.
 *
 * Category and tag arrays take raw strings: the use-case trims, drops blanks
 * and de-dupes, so a caller may hand over the split of a comma-separated field
 * without pre-cleaning it. Same contract as the entry writer in `lib/journal`.
 */
export const saveLocationInputSchema = z.object({
  name: z.string().trim().max(120, "A name may be at most 120 characters.").default(""),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  description: z.string().trim().max(2000).default(""),
  address: z.string().trim().max(500).default(""),
  categories: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});

export type SaveLocationInput = z.input<typeof saveLocationInputSchema>;
/** The same shape after parsing — every default filled in. */
export type LocationWriteData = z.output<typeof saveLocationInputSchema>;

export const updateLocationInputSchema = saveLocationInputSchema.extend({
  id: z.number().int().positive(),
});

export type UpdateLocationInput = z.input<typeof updateLocationInputSchema>;

export const upsertLocationTaxonomyInputSchema = z.object({
  name: taxonomyNameSchema,
  description: z.string().trim().max(500).default(""),
});

export type UpsertLocationTaxonomyInput = z.input<typeof upsertLocationTaxonomyInputSchema>;
export type LocationTaxonomyWriteData = z.output<typeof upsertLocationTaxonomyInputSchema>;

/**
 * How the manager, the picker and the map all narrow the library.
 *
 * One schema for three screens because they ask the same question — text, plus
 * optional category and tag filters. The picker passes only `query`, the map
 * passes only the filters, the manager passes all three.
 */
export const locationSearchInputSchema = z.object({
  /** Matched against name, description and address. Blank means "everything". */
  query: z.string().trim().default(""),
  /** A location must carry *all* of these to match. */
  categories: z.array(z.string()).default([]),
  /** A location must carry *all* of these to match. */
  tags: z.array(z.string()).default([]),
  /** Caps the result set. The picker wants a short list; the map wants them all. */
  limit: z.number().int().positive().max(1000).optional(),
});

export type LocationSearchInput = z.input<typeof locationSearchInputSchema>;
export type LocationSearchCriteria = z.output<typeof locationSearchInputSchema>;

/** Deleting a place, or a taxonomy row, by its key. */
export const locationIdSchema = z.number().int().positive();
export const locationTaxonomyNameSchema = taxonomyNameSchema;

/**
 * Promoting an entry's hand-dropped location into the library.
 *
 * Takes coordinates and a suggested name rather than an entry-location id: the
 * caller has the row already, and this keeps the use-case from needing to read
 * `lib/journal` — which would make the two modules mutually dependent.
 */
export const promoteLocationInputSchema = saveLocationInputSchema.extend({
  /**
   * The `jrn_entry_locations` row that prompted this, so it can be pointed at
   * the new library row once it exists. Omit to just create the place.
   */
  entryLocationId: z.number().int().positive().optional(),
});

export type PromoteLocationInput = z.input<typeof promoteLocationInputSchema>;

/**
 * Merging duplicate places: one survivor, and the copies folded into it.
 *
 * The survivor is named separately rather than being `removeIds[0]` so the
 * direction of the merge is impossible to get backwards at a call site — this
 * operation deletes rows, and "which one lives" is the only thing about it that
 * matters.
 */
export const mergeLocationsInputSchema = z
  .object({
    keepId: locationIdSchema,
    removeIds: z.array(locationIdSchema).min(1, "Pick at least one place to merge away."),
  })
  .refine((input) => !input.removeIds.includes(input.keepId), {
    message: "The place you keep cannot also be one of the places merged away.",
    path: ["removeIds"],
  });

export type MergeLocationsInput = z.input<typeof mergeLocationsInputSchema>;
