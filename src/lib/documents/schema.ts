// The zod schemas that validate everything crossing into this module — from a server
// action, from the upload route handler, or from the CLI. All three parse with the
// same schema, which is what makes a document filed from the terminal identical to one
// filed in the browser.

import { z } from "zod";

/** A document's title. Required: a library of "Untitled" rows helps nobody find anything. */
export const DOCUMENT_TITLE_MAX_LENGTH = 200;

/** The description under the title. Optional, and generous — it is where the context goes. */
export const DOCUMENT_DESCRIPTION_MAX_LENGTH = 5_000;

/**
 * The ceiling defaults, used when the admin setting is blank or unparseable.
 *
 * These are **defaults, not the limit** — the real values come from `sys_app_settings`
 * (Admin → Configuration), resolved by `resolveDocumentLimits` in `settings.ts`. They
 * live here because the schema factory below needs something to fall back on, and
 * because a validator that silently permits anything when a setting is missing is
 * worse than one that applies a sane bound.
 */
export const DEFAULT_DOCUMENT_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const DEFAULT_DOCUMENT_MAX_FILES = 20;

/**
 * The hard ceiling on the configurable per-file limit.
 *
 * An admin may raise the limit, but not past this: every upload is buffered in memory
 * on its way to the share, so an unbounded setting is an out-of-memory switch dressed
 * up as a preference. 500 MB is far above any paperwork this module is for.
 */
export const DOCUMENT_MAX_FILE_BYTES_CEILING = 500 * 1024 * 1024;

/** The same, for the per-document count. */
export const DOCUMENT_MAX_FILES_CEILING = 200;

/**
 * A name in the category or tag lists.
 *
 * Trimmed before the length check so "   " is empty rather than three characters, and
 * capped well under the column width so a name is always renderable as a chip. Same
 * shape and same reasoning as the Journal's and Clips'.
 */
const taxonomyNameSchema = z
  .string()
  .trim()
  .min(1, "Give it a name.")
  .max(60, "Keep the name under 60 characters.");

/**
 * A list of names *attached to a document* — its categories, or a filter's tags.
 *
 * Blanks are **dropped, not rejected**, which is the difference between this and
 * `taxonomyNameSchema` on its own, and it is the same distinction Clips draws:
 *
 * - Naming a category on the Categories & Tags screen is a deliberate act, so an empty
 *   name there is a mistake worth refusing — that is `documentTaxonomySchema`.
 * - A document's own list arrives from a chip picker, where an empty entry is a reader
 *   who opened a box and typed nothing. Refusing the whole save over it would be
 *   telling them off for something they did not do.
 */
export const taxonomyListSchema = z
  .array(z.string())
  .default([])
  .transform((names) => names.map((name) => name.trim()).filter((name) => name !== ""))
  .pipe(z.array(taxonomyNameSchema).max(50, "That is too many for one document."));

/** Creating or renaming a category/tag on the Categories & Tags screen. */
export const documentTaxonomySchema = z.object({
  name: taxonomyNameSchema,
  description: z.string().trim().max(500, "Keep the description under 500 characters.").default(""),
});

export type DocumentTaxonomyInput = z.infer<typeof documentTaxonomySchema>;

/** Filing a new document. Attachments are uploaded separately — see the route handler. */
export const createDocumentSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give the document a title.")
    .max(DOCUMENT_TITLE_MAX_LENGTH, "Keep the title under 200 characters."),
  description: z
    .string()
    .trim()
    .max(DOCUMENT_DESCRIPTION_MAX_LENGTH, "Keep the description under 5,000 characters.")
    .default(""),
  categories: taxonomyListSchema,
  tags: taxonomyListSchema,
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

/**
 * Editing a document's own fields.
 *
 * A full replace of the fields and the taxonomy, not a patch — the editor owns the
 * whole form, and a partial update would be a second way to write the same row.
 * Attachments are **not** here: adding and removing a file are their own operations,
 * because each one touches the share and can fail on its own.
 */
export const updateDocumentSchema = createDocumentSchema.extend({
  id: z.number().int().positive(),
});

export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

/**
 * Deleting a document, and the one decision that comes with it.
 *
 * `deleteFiles` defaults to **false**: the destructive reading is never the default
 * one. The record going while the files stay is recoverable by hand; the reverse is
 * not. The UI asks explicitly, and even on `true` the files are moved to `_deleted/`
 * rather than unlinked — see `file-store.ts`.
 */
export const deleteDocumentSchema = z.object({
  id: z.number().int().positive(),
  deleteFiles: z.boolean().default(false),
});

export type DeleteDocumentInput = z.infer<typeof deleteDocumentSchema>;

/** Removing one attachment, with the same deliberate choice about its file. */
export const removeAttachmentSchema = z.object({
  attachmentId: z.number().int().positive(),
  deleteFile: z.boolean().default(false),
});

export type RemoveAttachmentInput = z.infer<typeof removeAttachmentSchema>;

/** The list filter: any of the three may be absent, and an empty filter is everything. */
export const documentFilterSchema = z.object({
  /** Matched against title and description, case-insensitively. */
  search: z.string().trim().max(200).default(""),
  categories: taxonomyListSchema,
  tags: taxonomyListSchema,
  /**
   * Whether `search` also looks inside the filed files (migration 0165).
   *
   * Off by default, and deliberately a separate flag rather than always-on. Searching
   * contents widens the result set — a word mentioned once inside a 40-page scan is a
   * weaker hit than the same word in a title — so the reader opts in, and a reader
   * who never presses the toggle sees exactly the behaviour they had before.
   *
   * Only ever matches files that have already been read: this flag never triggers an
   * extraction, because a search box that could spend 3.7 seconds per unindexed file
   * would be unusable.
   */
  searchContents: z.boolean().default(false),
});

export type DocumentFilterInput = z.infer<typeof documentFilterSchema>;

/**
 * One uploaded file, validated against the limits in force **at the time of the
 * upload** rather than against a constant.
 *
 * A factory rather than a fixed schema because the ceiling is an admin setting: baking
 * 25 MB into a module-level `const` would mean raising the limit in Admin had no
 * effect on the thing that actually enforces it. The caller resolves the settings and
 * passes them in, so the boundary check and the configured value can never disagree.
 *
 * `fileName` is checked for emptiness only. It is **not** trusted as a path: every
 * stored name goes through `sanitizeNameSegment` and every resolved path through
 * `resolveInside`, because a name is attacker-controlled input and a validator that
 * tried to spot a bad one by pattern would eventually miss a case.
 */
export function attachmentUploadSchema(maxFileBytes: number) {
  return z.object({
    documentId: z.number().int().positive(),
    fileName: z.string().trim().min(1, "That file has no name."),
    mimeType: z.string().trim().min(1, "That file has no type."),
    byteSize: z
      .number()
      .int()
      .positive("That file is empty.")
      .max(maxFileBytes, `That file is larger than the ${formatBytes(maxFileBytes)} limit.`),
  });
}

export type AttachmentUploadInput = z.infer<ReturnType<typeof attachmentUploadSchema>>;

/**
 * Bytes as a person reads them.
 *
 * Here rather than in a view because it appears in a **validation message**, which is
 * produced in the library and shown verbatim by both the web app and the CLI. A
 * formatter in the view would leave the CLI printing "26214400".
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal, and no trailing ".0" — "25 MB", not "25.0 MB".
  const rounded = Math.round(value * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} ${units[unit]}`;
}

// --- Prefill templates -------------------------------------------------------
//
// A named set of field values a new document can be filed from. See migration 0169
// for why the fields are JSON rather than child rows, and why `mode` is stored at
// all when only one value is currently legal.

export const documentPrefillFieldSchema = z.enum([
  "title",
  "description",
  "categories",
  "tags",
]);

/**
 * The only legal mode today.
 *
 * Journal's equivalent also accepts `now`, because an entry has a date and a stored
 * literal date would pin every new entry to a fixed day. A document has no date or
 * time field, so there is nothing to resolve at apply-time and nothing to offer.
 *
 * Kept as an enum of one rather than dropped, so the stored JSON matches the
 * Journal's shape and a future dated field is a schema change rather than a rewrite
 * of every stored row. See migration 0169.
 */
export const documentPrefillModeSchema = z.enum(["literal"]);

/**
 * One field of a template.
 *
 * Values are NOT run through `taxonomyNameSchema` even for the categories and tags
 * fields, on purpose: a template holds the delimited *text* a filer typed, and the
 * names inside it are validated when the document is actually saved, by
 * `createDocumentSchema`. Validating here as well would mean a template could be
 * rejected for a name the Categories & Tags screen is about to create.
 */
export const documentPrefillFieldValueSchema = z.object({
  field: documentPrefillFieldSchema,
  mode: documentPrefillModeSchema.default("literal"),
  value: z.string().default(""),
});

export const saveDocumentPrefillTemplateSchema = z.object({
  /** Omitted when creating; present when editing an existing template. */
  id: z.number().int().positive().optional(),
  name: z
    .string()
    .trim()
    .min(1, "Give the template a name.")
    .max(100, "Keep the template name under 100 characters."),
  description: z
    .string()
    .trim()
    .max(500, "Keep the description under 500 characters.")
    .default(""),
  isEnabled: z.boolean().default(true),
  fields: z
    .array(documentPrefillFieldValueSchema)
    .default([])
    // One row per field. The editor's dropdown can be set to the same field twice,
    // and two values for one field has no meaning — the second would silently win on
    // apply. Caught here so the web form and the CLI report it the same way, rather
    // than in the view.
    .superRefine((fields, ctx) => {
      const seen = new Set<string>();
      for (const [index, entry] of fields.entries()) {
        if (seen.has(entry.field)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "field"],
            message: `"${entry.field}" is set twice — a template can only fill each field once.`,
          });
        }
        seen.add(entry.field);
      }
    }),
});

export type SaveDocumentPrefillTemplateInput = z.input<typeof saveDocumentPrefillTemplateSchema>;

/** What the repository persists, after defaults are applied. */
export type DocumentPrefillTemplateWriteData = z.output<
  typeof saveDocumentPrefillTemplateSchema
>;

/**
 * Reads a stored `fields_json` string back into a field list, tolerating whatever a
 * previous version of the app (or a hand-edited row) left there.
 *
 * Forgiving on purpose, the same contract `parseStoredPrefillFields` has in the
 * Journal: a template whose JSON has rotted should come back empty and re-editable,
 * not 500 the Prefill Templates screen. Unknown field keys are dropped individually,
 * so one bad entry doesn't discard the rest of a template someone spent time
 * assembling.
 */
export function parseStoredDocumentPrefillFields(
  json: string,
): z.output<typeof documentPrefillFieldValueSchema>[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const parsed: z.output<typeof documentPrefillFieldValueSchema>[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const result = documentPrefillFieldValueSchema.safeParse(item);
    if (!result.success) continue;
    // De-duplicate on read as well as on write: a row written before the uniqueness
    // rule existed would otherwise apply twice, and the last-wins behaviour that
    // produces is not something a reader could predict.
    if (seen.has(result.data.field)) continue;
    seen.add(result.data.field);
    parsed.push(result.data);
  }
  return parsed;
}
