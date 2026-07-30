import type { CurrentWeather, TemperatureUnit } from "./types";

// The interface a weather use-case depends on. The real Open-Meteo client is
// wired at wiring.ts; tests wire a fake. Provider-agnostic.
export interface WeatherClient {
  getCurrent(latitude: number, longitude: number, unit: TemperatureUnit): Promise<CurrentWeather>;
}
