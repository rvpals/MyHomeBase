import { z } from "zod";

export const positionTypeSchema = z.enum(["Stock", "ETF", "Bond", "MutualFund", "Crypto", "Other"]);

export const transactionActionSchema = z.enum(["Buy", "Sell"]);

export const stockPositionSchema = z.object({
  ticker: z.string().min(1),
  name: z.string(),
  type: positionTypeSchema,
  currentPriceCents: z.number().int().nonnegative(),
  quantity: z.number().nonnegative(),
  dayGainLossCents: z.number().int(),
  valueCents: z.number().int().nonnegative(),
  dayHighCents: z.number().int().nonnegative(),
  dayLowCents: z.number().int().nonnegative(),
  dividendRateCents: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// value_cents is server-computed (currentPriceCents * quantity), never accepted from a caller.
export const upsertPositionSchema = z.object({
  ticker: z.string().min(1),
  name: z.string().default(""),
  type: positionTypeSchema.default("Stock"),
  currentPriceCents: z.number().int().nonnegative().default(0),
  quantity: z.number().nonnegative().default(0),
  dayGainLossCents: z.number().int().default(0),
  dayHighCents: z.number().int().nonnegative().default(0),
  dayLowCents: z.number().int().nonnegative().default(0),
  dividendRateCents: z.number().int().nonnegative().default(0),
});

export type UpsertPositionInput = z.infer<typeof upsertPositionSchema>;

export const stockTransactionSchema = z.object({
  id: z.number().int().positive(),
  transactionAt: z.string().min(1),
  action: transactionActionSchema,
  ticker: z.string().min(1),
  numberOfShares: z.number().nonnegative(),
  pricePerShareCents: z.number().int().nonnegative(),
  totalAmountCents: z.number().int().nonnegative(),
  note: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// totalAmountCents is server-computed (numberOfShares * pricePerShareCents,
// same rule as stock_positions.value_cents), never accepted from a caller.
export const createTransactionSchema = z.object({
  transactionAt: z.string().min(1),
  action: transactionActionSchema.default("Buy"),
  ticker: z.string().min(1),
  numberOfShares: z.number().positive(),
  pricePerShareCents: z.number().int().nonnegative(),
  note: z.string().default(""),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

export const updateTransactionSchema = createTransactionSchema;

export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;
