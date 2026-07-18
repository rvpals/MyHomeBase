import { z } from "zod";

export const stockWatchListSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createWatchListSchema = z.object({
  name: z.string().min(1),
});

export type CreateWatchListInput = z.infer<typeof createWatchListSchema>;

export const renameWatchListSchema = createWatchListSchema;

export type RenameWatchListInput = z.infer<typeof renameWatchListSchema>;

export const stockWatchListItemSchema = z.object({
  id: z.number().int().positive(),
  watchListId: z.number().int().positive(),
  ticker: z.string().min(1),
  shares: z.number().nonnegative(),
  priceWhenAddedCents: z.number().int().nonnegative(),
  addedDate: z.string().min(1),
  reminderAt: z.string().optional(),
  reminderMessage: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// priceWhenAddedCents is not accepted here — the use-case fetches a live quote
// and supplies it, same rule as stock_positions.value_cents.
export const addWatchListItemSchema = z.object({
  watchListId: z.number().int().positive(),
  ticker: z.string().min(1),
  shares: z.number().nonnegative().default(0),
  addedDate: z.string().min(1),
});

export type AddWatchListItemInput = z.infer<typeof addWatchListItemSchema>;

export const updateWatchListItemReminderSchema = z.object({
  reminderAt: z.string().optional(),
  reminderMessage: z.string().default(""),
});

export type UpdateWatchListItemReminderInput = z.infer<typeof updateWatchListItemReminderSchema>;
