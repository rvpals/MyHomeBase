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
 * What a card image may be. SVG is excluded on purpose — it can carry script and
 * would be served from the app's own origin. The cap keeps these to the small
 * "tell the cards apart" images they're meant to be.
 */
export const CARD_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const MAX_CARD_IMAGE_BYTES = 512 * 1024;

export const cardImageSchema = z.object({
  mimeType: z.enum(CARD_IMAGE_MIME_TYPES, {
    message: "Use a PNG, JPEG, WebP or GIF image.",
  }),
  /** Base64 of the file, as read in the browser. */
  base64Data: z.string().min(1, "The image is empty."),
});

export type CardImageInput = z.infer<typeof cardImageSchema>;

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
