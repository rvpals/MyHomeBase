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

export const dailyForecastSchema = z.object({
  date: z.string(),
  high: z.number(),
  low: z.number(),
  code: z.number().int(),
  description: z.string(),
});

export const weatherForecastSchema = z.object({
  current: currentWeatherSchema,
  days: z.array(dailyForecastSchema),
  unit: z.string(),
});

export const getForecastSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  unit: temperatureUnitSchema.default("fahrenheit"),
  // Capped at 16 because that is Open-Meteo's own ceiling; asking for more is a
  // bad request rather than a longer forecast.
  days: z.number().int().min(1).max(16).default(7),
  /** Skip a live cache entry and refetch. */
  refresh: z.boolean().default(false),
});

export type GetForecastInput = z.input<typeof getForecastSchema>;
