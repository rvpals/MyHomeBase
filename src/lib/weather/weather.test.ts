import { describe, expect, it } from "vitest";
import { getCurrentWeather } from "./weather";
import { describeWeatherCode, weatherShape } from "./wmo";
import type { WeatherClient } from "./ports";
import type { CurrentWeather, TemperatureUnit } from "./types";

function fakeClient(weather: CurrentWeather): WeatherClient & { lastCall?: [number, number, TemperatureUnit] } {
  const client: WeatherClient & { lastCall?: [number, number, TemperatureUnit] } = {
    async getCurrent(latitude, longitude, unit) {
      client.lastCall = [latitude, longitude, unit];
      return weather;
    },
    // Part of the port but irrelevant to `getCurrentWeather`, which must not reach
    // for a week of data to stamp one reading on a journal entry.
    async getForecast() {
      throw new Error("getCurrentWeather must not call getForecast.");
    },
  };
  return client;
}

describe("describeWeatherCode", () => {
  it("maps known WMO codes to a description", () => {
    expect(describeWeatherCode(2)).toBe("Partly cloudy");
    expect(describeWeatherCode(95)).toBe("Thunderstorm");
  });

  it("falls back for an unknown code", () => {
    expect(describeWeatherCode(1234)).toBe("Weather code 1234");
  });
});

describe("weatherShape", () => {
  it("maps each WMO band to its shape", () => {
    expect(weatherShape(0)).toBe("clear");
    expect(weatherShape(2)).toBe("partly");
    expect(weatherShape(3)).toBe("cloud");
    expect(weatherShape(48)).toBe("fog");
    expect(weatherShape(53)).toBe("drizzle");
    expect(weatherShape(63)).toBe("rain");
    expect(weatherShape(73)).toBe("snow");
    expect(weatherShape(81)).toBe("rain");
    expect(weatherShape(86)).toBe("snow");
    expect(weatherShape(95)).toBe("storm");
  });

  it("groups freezing precipitation with its liquid siblings", () => {
    expect(weatherShape(57)).toBe("drizzle");
    expect(weatherShape(67)).toBe("rain");
  });

  it("falls back to a neutral shape for an unknown code", () => {
    // A provider adding a code should leave the strip intact, not punch a hole in it.
    expect(weatherShape(1234)).toBe("cloud");
    expect(weatherShape(4)).toBe("cloud");
  });
});

describe("getCurrentWeather", () => {
  const sample: CurrentWeather = { temperature: 72, unit: "°F", description: "Clear sky", code: 0 };

  it("validates input, applies the default unit, and returns the client's result", async () => {
    const client = fakeClient(sample);
    const result = await getCurrentWeather(client, { latitude: 40.34, longitude: -74.46 });
    expect(result).toEqual(sample);
    expect(client.lastCall).toEqual([40.34, -74.46, "fahrenheit"]); // default unit
  });

  it("passes through a chosen unit", async () => {
    const client = fakeClient(sample);
    await getCurrentWeather(client, { latitude: 1, longitude: 2, unit: "celsius" });
    expect(client.lastCall).toEqual([1, 2, "celsius"]);
  });

  it("rejects out-of-range coordinates", async () => {
    await expect(getCurrentWeather(fakeClient(sample), { latitude: 999, longitude: 0 })).rejects.toThrow();
  });
});
