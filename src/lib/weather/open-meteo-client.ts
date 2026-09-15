import type { WeatherClient } from "./ports";
import type {
  CurrentWeather,
  DailyForecast,
  TemperatureUnit,
  WeatherForecast,
} from "./types";
import { describeWeatherCode } from "./wmo";

const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";

interface OpenMeteoResponse {
  current?: { temperature_2m?: number; weather_code?: number };
  current_units?: { temperature_2m?: string };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
  };
  daily_units?: { temperature_2m_max?: string };
}

/** The unit symbol to show when the service didn't label the field itself. */
function fallbackUnit(unit: TemperatureUnit): string {
  return unit === "fahrenheit" ? "°F" : "°C";
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

    const body = await this.request(url, latitude, longitude);
    return this.readCurrent(body, latitude, longitude, unit);
  }

  async getForecast(
    latitude: number,
    longitude: number,
    unit: TemperatureUnit,
    days: number,
  ): Promise<WeatherForecast> {
    // `timezone=auto` matters more than it looks: without it Open-Meteo buckets the
    // daily rows by UTC, so a location far from Greenwich gets highs and lows split
    // across the wrong local days — and the first row stops being "today" where the
    // reader is. With it, `daily.time[0]` is the local day at the coordinate.
    const url =
      `${OPEN_METEO_BASE}?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,weather_code` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
      `&forecast_days=${days}&timezone=auto&temperature_unit=${unit}`;

    const body = await this.request(url, latitude, longitude);

    return {
      current: this.readCurrent(body, latitude, longitude, unit),
      days: this.readDays(body),
      unit: body.daily_units?.temperature_2m_max ?? fallbackUnit(unit),
    };
  }

  private async request(
    url: string,
    latitude: number,
    longitude: number,
  ): Promise<OpenMeteoResponse> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Open-Meteo request failed (HTTP ${response.status}) for ${latitude},${longitude}.`,
      );
    }
    return (await response.json()) as OpenMeteoResponse;
  }

  private readCurrent(
    body: OpenMeteoResponse,
    latitude: number,
    longitude: number,
    unit: TemperatureUnit,
  ): CurrentWeather {
    const temperature = body.current?.temperature_2m;
    const code = body.current?.weather_code;
    if (temperature === undefined || code === undefined) {
      throw new Error(`Open-Meteo returned no current conditions for ${latitude},${longitude}.`);
    }

    return {
      temperature,
      unit: body.current_units?.temperature_2m ?? fallbackUnit(unit),
      description: describeWeatherCode(code),
      code,
    };
  }

  /**
   * The daily rows, zipped from the parallel arrays Open-Meteo returns.
   *
   * Driven by the shortest array rather than by `time.length`, and each row is checked
   * before it is kept. The response is four independent arrays that are *supposed* to
   * be the same length; trusting that would put `undefined` into a `number` field and
   * render "NaN°" on the home screen. A short or ragged response loses the tail days
   * instead, which the card can draw.
   */
  private readDays(body: OpenMeteoResponse): DailyForecast[] {
    const daily = body.daily;
    if (!daily?.time) return [];

    const { time, weather_code: codes, temperature_2m_max: highs, temperature_2m_min: lows } = daily;

    const days: DailyForecast[] = [];
    for (let index = 0; index < time.length; index += 1) {
      const date = time[index];
      const code = codes?.[index];
      const high = highs?.[index];
      const low = lows?.[index];
      if (date === undefined || code === undefined || high === undefined || low === undefined) {
        break;
      }

      days.push({ date, high, low, code, description: describeWeatherCode(code) });
    }

    return days;
  }
}
