import { z } from "zod";
import { RULE_ACTION_FIELDS, TRANSACTION_STATUSES } from "./types";

// zod is the single source of truth for every shape crossing a boundary (server
// actions, CLI, CSV import).

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be formatted as YYYY-MM-DD");

export const transactionStatusSchema = z.enum(TRANSACTION_STATUSES);

export const creditCardAccountSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string(),
  creditLineCents: z.number().int(),
  imageMimeType: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * What an uploaded image in this module may be — card art and category icons
 * alike. SVG is excluded on purpose: it can carry script and would be served from
 * the app's own origin.
 */
export const EXPENSE_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

/** Cap for card art — enough for readable card artwork, not for a photo. */
export const MAX_CARD_IMAGE_BYTES = 512 * 1024;
/** Cap for a category icon: a quarter of the card cap, since it renders tiny. */
export const MAX_CATEGORY_ICON_BYTES = 128 * 1024;

/**
 * One image on its way in from a browser. Shared by card art and category icons —
 * the shape and the type allowlist are identical; only the size cap differs, and
 * that is enforced by the use-case that stores it.
 */
export const expenseImageUploadSchema = z.object({
  mimeType: z.enum(EXPENSE_IMAGE_MIME_TYPES, {
    message: "Use a PNG, JPEG, WebP or GIF image.",
  }),
  /** Base64 of the file, as read in the browser. */
  base64Data: z.string().min(1, "The image is empty."),
});

export type ExpenseImageUploadInput = z.infer<typeof expenseImageUploadSchema>;

export const saveAccountSchema = z.object({
  name: z.string().trim().min(1, "Account name is required."),
  description: z.string().trim().default(""),
  creditLineCents: z.number().int().nonnegative().default(0),
});

export type SaveAccountInput = z.input<typeof saveAccountSchema>;
export type AccountWriteData = z.output<typeof saveAccountSchema>;

export const expenseCategorySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  iconMimeType: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const saveCategorySchema = z.object({
  name: z.string().trim().min(1, "Category name is required."),
  description: z.string().trim().default(""),
});

export type SaveCategoryInput = z.input<typeof saveCategorySchema>;
export type CategoryWriteData = z.output<typeof saveCategorySchema>;

export const expenseTransactionSchema = z.object({
  id: z.number().int().positive(),
  transactionDate: z.string().min(1),
  postingDate: z.string(),
  transactionAccountId: z.number().int().positive(),
  transactionDescription: z.string(),
  categoryName: z.string(),
  vendor: z.string(),
  amountCents: z.number().int(),
  note: z.string(),
  status: transactionStatusSchema,
  processed: z.boolean(),
  createdByUserId: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const saveTransactionSchema = z.object({
  transactionDate: isoDate,
  // Optional on the way in: not every statement carries a posting date.
  postingDate: z.union([isoDate, z.literal("")]).default(""),
  transactionAccountId: z.number().int().positive("Pick the card this belongs to."),
  transactionDescription: z.string().trim().default(""),
  categoryName: z.string().trim().default(""),
  vendor: z.string().trim().default(""),
  // Negative is legitimate — refunds and payments are credits.
  amountCents: z.number().int(),
  note: z.string().trim().default(""),
  status: transactionStatusSchema.default("new"),
  processed: z.boolean().default(false),
});

export type SaveTransactionInput = z.input<typeof saveTransactionSchema>;
export type TransactionWriteData = z.output<typeof saveTransactionSchema>;

/**
 * The fields a bulk edit may set, and the only ones. Transaction date and amount
 * are absent on purpose: they identify a transaction against the statement it
 * came from, so applying one value across a selection could only ever corrupt
 * the ledger. Leaving them out of the schema means no caller — web, CLI or
 * test — can reach them, rather than relying on the UI to hide them.
 *
 * Every field is optional; an omitted field is left untouched. A field that *is*
 * present is written verbatim, so passing an empty string clears it.
 */
export const bulkTransactionEditSchema = z
  .object({
    transactionAccountId: z.number().int().positive("Pick the card this belongs to.").optional(),
    transactionDescription: z.string().trim().optional(),
    categoryName: z.string().trim().optional(),
    vendor: z.string().trim().optional(),
    note: z.string().trim().optional(),
    status: transactionStatusSchema.optional(),
    processed: z.boolean().optional(),
  })
  .refine((changes) => Object.values(changes).some((value) => value !== undefined), {
    message: "Enable at least one field to change.",
  });

export type BulkTransactionEditInput = z.input<typeof bulkTransactionEditSchema>;
export type BulkTransactionEditData = z.output<typeof bulkTransactionEditSchema>;

/** The ids a bulk delete or bulk edit applies to. */
export const transactionIdsSchema = z
  .array(z.number().int().positive())
  .min(1, "Select at least one transaction.");

export const ruleActionFieldSchema = z.enum(RULE_ACTION_FIELDS);

export const ruleActionSchema = z.object({
  id: z.number().int().positive(),
  ruleId: z.number().int().positive(),
  fieldName: ruleActionFieldSchema,
  fieldValue: z.string(),
  sortOrder: z.number().int().nonnegative(),
});

// One assignment as the editor supplies it. A `status` action is checked against
// the real status list here, so a typo is refused at save time instead of
// writing a value nothing else understands.
export const saveRuleActionSchema = z
  .object({
    fieldName: ruleActionFieldSchema,
    fieldValue: z.string().trim().default(""),
  })
  .refine(
    (action) =>
      action.fieldName !== "status" ||
      (TRANSACTION_STATUSES as readonly string[]).includes(action.fieldValue),
    { message: `A status action must be one of: ${TRANSACTION_STATUSES.join(", ")}.` },
  )
  .refine((action) => action.fieldName === "note" || action.fieldValue !== "", {
    message: "Give the value this rule should set (only a note may be blank).",
  });

export const savePostImportRuleSchema = z.object({
  pattern: z.string().trim().min(1, "A pattern is required."),
  priority: z.number().int().default(0),
  isEnabled: z.boolean().default(true),
  actions: z
    .array(saveRuleActionSchema)
    .min(1, "Add at least one field for this rule to set."),
});

export type SavePostImportRuleInput = z.input<typeof savePostImportRuleSchema>;
export type PostImportRuleWriteData = z.output<typeof savePostImportRuleSchema>;

export const postImportRuleSchema = z.object({
  id: z.number().int().positive(),
  pattern: z.string().min(1),
  priority: z.number().int(),
  isEnabled: z.boolean(),
  actions: z.array(ruleActionSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
