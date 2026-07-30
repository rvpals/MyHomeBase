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
