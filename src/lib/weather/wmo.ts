// WMO weather interpretation codes (as used by Open-Meteo) mapped to short
// human-readable descriptions. Open-Meteo returns only the numeric code, so the
// description is our concern.
const WMO_DESCRIPTIONS: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

/** Human-readable label for a WMO weather code, falling back to the raw code. */
export function describeWeatherCode(code: number): string {
  return WMO_DESCRIPTIONS[code] ?? `Weather code ${code}`;
}

/**
 * The handful of shapes a forecast needs to draw. Far coarser than the code list
 * above on purpose: a reader glancing at a week strip is asking "rain or not", and
 * thirty distinct glyphs would be thirty things to tell apart at 20px. The precise
 * description is still available as text.
 */
export type WeatherShape = "clear" | "partly" | "cloud" | "fog" | "drizzle" | "rain" | "snow" | "storm";

/**
 * A WMO code reduced to the shape that represents it.
 *
 * Ranges rather than a second thirty-entry table, because the WMO numbering is
 * already grouped: 5x is drizzle, 6x rain, 7x snow, 8x showers, 9x thunderstorms.
 * Freezing drizzle (56/57) and freezing rain (66/67) deliberately fall in with their
 * wet siblings rather than with snow — they fall as liquid, and "bring a coat" is
 * carried by the temperature beside the glyph.
 */
export function weatherShape(code: number): WeatherShape {
  if (code === 0) return "clear";
  if (code === 1 || code === 2) return "partly";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code >= 61 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "rain";
  if (code >= 85 && code <= 86) return "snow";
  // Bounded, not `>= 95`: an open-ended test would swallow every unknown high code
  // — 1234 would come back "storm" — and quietly claim a thunderstorm the provider
  // never reported. The WMO thunderstorm band ends at 99.
  if (code >= 95 && code <= 99) return "storm";
  // An unknown code gets the most neutral shape rather than no glyph at all, so a
  // provider adding a code doesn't leave a hole in the strip.
  return "cloud";
}
