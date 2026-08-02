import { z } from "zod";
import { TRANSACTION_STATUSES } from "./types";

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
  amountCents: z.number().int(),
  note: z.string(),
  status: transactionStatusSchema,
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
  // Negative is legitimate — refunds and payments are credits.
  amountCents: z.number().int(),
  note: z.string().trim().default(""),
  status: transactionStatusSchema.default("new"),
});

export type SaveTransactionInput = z.input<typeof saveTransactionSchema>;
export type TransactionWriteData = z.output<typeof saveTransactionSchema>;

export const saveCategoryRuleSchema = z.object({
  pattern: z.string().trim().min(1, "A pattern is required."),
  categoryName: z.string().trim().min(1, "Pick the category to assign."),
  // "" means "don't touch the status" — distinct from any real status value.
  applyStatus: z.union([transactionStatusSchema, z.literal("")]).default(""),
  priority: z.number().int().default(0),
  isEnabled: z.boolean().default(true),
});

export type SaveCategoryRuleInput = z.input<typeof saveCategoryRuleSchema>;
export type CategoryRuleWriteData = z.output<typeof saveCategoryRuleSchema>;

export const categoryRuleSchema = z.object({
  id: z.number().int().positive(),
  pattern: z.string().min(1),
  categoryName: z.string().min(1),
  applyStatus: z.union([transactionStatusSchema, z.literal("")]),
  priority: z.number().int(),
  isEnabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
