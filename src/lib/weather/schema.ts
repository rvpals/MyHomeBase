import { z } from "zod";

export const temperatureUnitSchema = z.enum(["celsius", "fahrenheit"]);

export const currentWeatherSchema = z.object({
  temperature: z.number(),
  unit: z.string(),
  description: z.string(),
  code: z.number().int(),
});

export const getCurrentWeatherSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  unit: temperatureUnitSchema.default("fahrenheit"),
});

export type GetCurrentWeatherInput = z.input<typeof getCurrentWeatherSchema>;
