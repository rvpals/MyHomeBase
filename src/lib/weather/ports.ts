import type { CurrentWeather, TemperatureUnit, WeatherForecast } from "./types";

// The interface a weather use-case depends on. The real Open-Meteo client is
// wired at wiring.ts; tests wire a fake. Provider-agnostic.
export interface WeatherClient {
  getCurrent(latitude: number, longitude: number, unit: TemperatureUnit): Promise<CurrentWeather>;

  /**
   * Current conditions plus the next `days` days at a coordinate.
   *
   * Separate from `getCurrent` rather than an optional argument on it, because the
   * Journal only ever wants the single reading it stamps on an entry and should not
   * pay for a week of data — and because a provider without a forecast endpoint can
   * still implement the method above.
   */
  getForecast(
    latitude: number,
    longitude: number,
    unit: TemperatureUnit,
    days: number,
  ): Promise<WeatherForecast>;
}
