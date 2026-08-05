import { z } from "zod";

export const positionTypeSchema = z.enum(["Stock", "ETF", "Bond", "MutualFund", "Crypto", "Other"]);

/**
 * Every instrument type, for a picker. Derived from the schema rather than written
 * out again, so a new type can't appear in one place and not the other.
 */
export const POSITION_TYPES = positionTypeSchema.options;

export const transactionActionSchema = z.enum(["Buy", "Sell"]);

export const stockPositionSchema = z.object({
  accountId: z.number().int().nonnegative(),
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
  costCents: z.number().int().nonnegative(),
  unitCostCents: z.number().int().nonnegative(),
  // Signed: a losing position reports a negative gain. Not `.nonnegative()`.
  unrealizedGainLossCents: z.number().int(),
  unrealizedGainLossPct: z.number(),
  cusip: z.string(),
  isin: z.string(),
  assetClass: z.string(),
  assetStrategy: z.string(),
  estAnnualIncomeCents: z.number().int().nonnegative(),
  incomeEarnedCents: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// value_cents is server-computed (currentPriceCents * quantity), never accepted from a caller.
export const upsertPositionSchema = z.object({
  // 0 is "Unassigned" — a position tracked before any account was set up.
  accountId: z.number().int().nonnegative().default(0),
  ticker: z.string().min(1),
  name: z.string().default(""),
  type: positionTypeSchema.default("Stock"),
  currentPriceCents: z.number().int().nonnegative().default(0),
  quantity: z.number().nonnegative().default(0),
  dayGainLossCents: z.number().int().default(0),
  dayHighCents: z.number().int().nonnegative().default(0),
  dayLowCents: z.number().int().nonnegative().default(0),
  dividendRateCents: z.number().int().nonnegative().default(0),
  costCents: z.number().int().nonnegative().default(0),
  unitCostCents: z.number().int().nonnegative().default(0),
  unrealizedGainLossCents: z.number().int().default(0),
  unrealizedGainLossPct: z.number().default(0),
  cusip: z.string().default(""),
  isin: z.string().default(""),
  assetClass: z.string().default(""),
  assetStrategy: z.string().default(""),
  estAnnualIncomeCents: z.number().int().nonnegative().default(0),
  incomeEarnedCents: z.number().int().nonnegative().default(0),
});

export type UpsertPositionInput = z.infer<typeof upsertPositionSchema>;

/** Identifies one position for a read or a delete. */
export const positionKeySchema = z.object({
  accountId: z.number().int().nonnegative(),
  ticker: z.string().min(1),
});

export type PositionKeyInput = z.infer<typeof positionKeySchema>;

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
