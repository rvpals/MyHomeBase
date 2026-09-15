export type TemperatureUnit = "celsius" | "fahrenheit";

// Current conditions at a point, as fetched from the weather service. `unit` is
// the display unit string the service reports (e.g. "°F"); `code` is the WMO
// weather code, and `description` its human-readable label.
export interface CurrentWeather {
  temperature: number;
  unit: string;
  description: string;
  code: number;
}

/**
 * One day of the forecast. The date is a local-calendar "YYYY-MM-DD" as the service
 * reports it for the requested coordinate — the day it is *there*, which is the whole
 * point of a forecast and is not necessarily the server's day.
 */
export interface DailyForecast {
  /** Local-calendar day at the forecast location, "YYYY-MM-DD". */
  date: string;
  high: number;
  low: number;
  /** The WMO weather code, and its human-readable label. */
  code: number;
  description: string;
}

/**
 * Current conditions plus the coming days at one place.
 *
 * `unit` sits on the envelope rather than on every day: one request is one unit, and
 * repeating it per day invites a view that reads it from `days[0]` and renders nothing
 * when the list is empty.
 */
export interface WeatherForecast {
  current: CurrentWeather;
  days: DailyForecast[];
  /** The display unit for `high`/`low`, e.g. "°F". */
  unit: string;
}
