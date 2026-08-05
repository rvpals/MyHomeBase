import { z } from "zod";

export const investmentAccountSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string(),
  initialValueCents: z.number().int().nonnegative(),
  lastValueCents: z.number().int().nonnegative().optional(),
  lastUpdatedAt: z.string().optional(),
  iconMimeType: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createInvestmentAccountSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  initialValueCents: z.number().int().nonnegative().default(0),
});

export type CreateInvestmentAccountInput = z.infer<typeof createInvestmentAccountSchema>;

export const updateInvestmentAccountSchema = createInvestmentAccountSchema;

export type UpdateInvestmentAccountInput = z.infer<typeof updateInvestmentAccountSchema>;

/**
 * Cap for an account icon. Matches the expense category icon: both render at
 * ~20-24px, so anything larger is bytes nobody sees.
 */
export const MAX_ACCOUNT_ICON_BYTES = 128 * 1024;

export const performanceRecordSchema = z.object({
  id: z.number().int().positive(),
  accountId: z.number().int().positive(),
  totalValueCents: z.number().int().nonnegative(),
  recordDate: z.string().min(1),
  note: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createPerformanceRecordSchema = z.object({
  accountId: z.number().int().positive(),
  totalValueCents: z.number().int().nonnegative(),
  recordDate: z.string().min(1),
  note: z.string().default(""),
});

export type CreatePerformanceRecordInput = z.infer<typeof createPerformanceRecordSchema>;

export const updatePerformanceRecordSchema = z.object({
  totalValueCents: z.number().int().nonnegative(),
  recordDate: z.string().min(1),
  note: z.string().default(""),
});

export type UpdatePerformanceRecordInput = z.infer<typeof updatePerformanceRecordSchema>;
