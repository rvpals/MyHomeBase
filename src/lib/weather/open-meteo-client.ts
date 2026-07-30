import type { WeatherClient } from "./ports";
import type { CurrentWeather, TemperatureUnit } from "./types";
import { describeWeatherCode } from "./wmo";

const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";

interface OpenMeteoResponse {
  current?: { temperature_2m?: number; weather_code?: number };
  current_units?: { temperature_2m?: string };
}

// Real client over Open-Meteo (free, no API key required).
export class OpenMeteoWeatherClient implements WeatherClient {
  async getCurrent(
    latitude: number,
    longitude: number,
    unit: TemperatureUnit,
  ): Promise<CurrentWeather> {
    const url =
      `${OPEN_METEO_BASE}?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,weather_code&temperature_unit=${unit}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Open-Meteo request failed (HTTP ${response.status}) for ${latitude},${longitude}.`,
      );
    }

    const body = (await response.json()) as OpenMeteoResponse;
    const temperature = body.current?.temperature_2m;
    const code = body.current?.weather_code;
    if (temperature === undefined || code === undefined) {
      throw new Error(`Open-Meteo returned no current conditions for ${latitude},${longitude}.`);
    }

    return {
      temperature,
      unit: body.current_units?.temperature_2m ?? (unit === "fahrenheit" ? "°F" : "°C"),
      description: describeWeatherCode(code),
      code,
    };
  }
}
