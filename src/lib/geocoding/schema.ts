import { z } from "zod";

export const geoPlaceSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  displayName: z.string(),
});

export const searchPlacesSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(10).default(5),
});

export type SearchPlacesInput = z.input<typeof searchPlacesSchema>;

export const reverseGeocodeSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export type ReverseGeocodeInput = z.input<typeof reverseGeocodeSchema>;
