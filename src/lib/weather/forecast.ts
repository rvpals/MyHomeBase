import type { WeatherClient } from "./ports";
import { getForecastSchema } from "./schema";
import type { GetForecastInput } from "./schema";
import type { WeatherForecast } from "./types";

/** How long a fetched forecast stays good. Open-Meteo refreshes about hourly. */
const CACHE_TTL_MS = 30 * 60 * 1000;

interface CacheEntry {
  forecast: WeatherForecast;
  fetchedAt: number;
}

/**
 * Simple in-process cache, keyed by the exact request.
 *
 * The home screen is dynamic (it reads the session cookie), so without this every
 * landing would hit Open-Meteo — including a reload loop, and including every user on
 * the install. A module-scope Map is the simple version deliberately: this is one
 * small object per location, the process is a single Next.js server, and an eviction
 * policy for a map that holds one entry per distinct user location would be building
 * for a problem this app does not have. If it ever needs to survive a restart or be
 * shared across processes, it belongs in a repository instead.
 */
const cache = new Map<string, CacheEntry>();

function cacheKey(latitude: number, longitude: number, unit: string, days: number): string {
  // Rounded to ~1km. Two users in the same town would otherwise each hold their own
  // entry for what is meteorologically the same forecast.
  return `${latitude.toFixed(2)},${longitude.toFixed(2)},${unit},${days}`;
}

/**
 * Current conditions plus the next few days at a coordinate.
 *
 * Cached for 30 minutes per location; `now` is injectable so a test can age the cache
 * without waiting. Pass `refresh: true` to bypass a live entry and refill it.
 *
 * Errors are **not** cached: a failed fetch throws to the caller and leaves any
 * previous entry alone, so a transient outage doesn't poison the next half hour.
 */
export async function getForecast(
  client: WeatherClient,
  input: GetForecastInput,
  now: number = Date.now(),
): Promise<WeatherForecast> {
  const { latitude, longitude, unit, days, refresh } = getForecastSchema.parse(input);

  const key = cacheKey(latitude, longitude, unit, days);
  const cached = cache.get(key);
  if (!refresh && cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached.forecast;

  const forecast = await client.getForecast(latitude, longitude, unit, days);
  cache.set(key, { forecast, fetchedAt: now });
  return forecast;
}

/** Empties the cache. For tests, and for a future "refresh now" control. */
export function clearForecastCache(): void {
  cache.clear();
}
