import { z } from "zod";

/** ISO YYYY-MM-DD. The same shape every other date column in this schema uses. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD.");

export const tbillPurchaseSchema = z.object({
  id: z.number().int().positive(),
  symbol: z.string(),
  description: z.string(),
  datePurchased: isoDate,
  datePayout: isoDate,
  sharesPurchased: z.number().nonnegative(),
  purchasePrice: z.number().nonnegative(),
  amountSpentCents: z.number().int(),
  payoutAmountCents: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * What it takes to record a purchase.
 *
 * `purchasePrice` is capped at 100 rather than left open: it is quoted per $100 of
 * face value, so anything above par is not a discount instrument and the yield
 * formula would return a negative number that looks like a real reading. Refusing
 * it here means the web form and the CLI refuse it identically.
 *
 * `datePayout` is required, not optional — a bill's maturity is fixed at purchase.
 * See the migration log.
 */
export const createTBillPurchaseSchema = z
  .object({
    symbol: z.string().min(1, "A symbol is required."),
    description: z.string().default(""),
    datePurchased: isoDate,
    datePayout: isoDate,
    sharesPurchased: z.number().nonnegative().default(0),
    purchasePrice: z
      .number()
      .positive("A purchase price is required.")
      .max(100, "A T-Bill price is quoted per $100 of face value, so it cannot exceed 100."),
    amountSpentCents: z.number().int().nonnegative().default(0),
    payoutAmountCents: z.number().int().nonnegative().default(0),
  })
  .refine((input) => input.datePayout >= input.datePurchased, {
    // ISO dates compare correctly as strings, which is half the reason the column
    // is stored in that format.
    message: "The payout date cannot be before the purchase date.",
    path: ["datePayout"],
  });

export type CreateTBillPurchaseInput = z.infer<typeof createTBillPurchaseSchema>;

export const updateTBillPurchaseSchema = createTBillPurchaseSchema;

export type UpdateTBillPurchaseInput = z.infer<typeof updateTBillPurchaseSchema>;
