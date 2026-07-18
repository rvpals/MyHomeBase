import { z } from "zod";

export const propertySchema = z.object({
  id: z.number().int().positive(),
  address: z.string().min(1),
  purchasePriceCents: z.number().int().nonnegative(),
  purchaseDate: z.string().min(1),
  currentValueCents: z.number().int().nonnegative(),
  mortgageBalanceCents: z.number().int().nonnegative(),
  notes: z.string().min(1).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const notesPreprocess = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

export const createPropertySchema = z.object({
  address: z.string().min(1),
  purchasePriceCents: z.number().int().nonnegative(),
  purchaseDate: z.string().min(1),
  currentValueCents: z.number().int().nonnegative(),
  mortgageBalanceCents: z.number().int().nonnegative().default(0),
  notes: notesPreprocess,
});

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;

export const updatePropertySchema = createPropertySchema;

export type UpdatePropertyInput = z.infer<typeof updatePropertySchema>;
