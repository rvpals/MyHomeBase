import { z } from "zod";

export const addressLookupSchema = z.object({
  address: z.string().min(1),
});

export type AddressLookupInput = z.infer<typeof addressLookupSchema>;
