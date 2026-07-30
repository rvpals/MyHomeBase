import type { WeatherClient } from "./ports";
import { getCurrentWeatherSchema } from "./schema";
import type { GetCurrentWeatherInput } from "./schema";
import type { CurrentWeather } from "./types";

/** Fetches current conditions at a coordinate in the requested temperature unit. */
export async function getCurrentWeather(
  client: WeatherClient,
  input: GetCurrentWeatherInput,
): Promise<CurrentWeather> {
  const { latitude, longitude, unit } = getCurrentWeatherSchema.parse(input);
  return client.getCurrent(latitude, longitude, unit);
}
