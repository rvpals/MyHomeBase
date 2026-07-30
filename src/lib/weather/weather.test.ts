import { describe, expect, it } from "vitest";
import { getCurrentWeather } from "./weather";
import { describeWeatherCode } from "./wmo";
import type { WeatherClient } from "./ports";
import type { CurrentWeather, TemperatureUnit } from "./types";

function fakeClient(weather: CurrentWeather): WeatherClient & { lastCall?: [number, number, TemperatureUnit] } {
  const client: WeatherClient & { lastCall?: [number, number, TemperatureUnit] } = {
    async getCurrent(latitude, longitude, unit) {
      client.lastCall = [latitude, longitude, unit];
      return weather;
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
