import { beforeEach, describe, expect, it } from "vitest";
import { clearForecastCache, getForecast } from "./forecast";
import type { WeatherClient } from "./ports";
import type { CurrentWeather, TemperatureUnit, WeatherForecast } from "./types";

const CURRENT: CurrentWeather = {
  temperature: 72,
  unit: "°F",
  description: "Clear sky",
  code: 0,
};

const FORECAST: WeatherForecast = {
  current: CURRENT,
  unit: "°F",
  days: [
    { date: "2026-09-13", high: 78, low: 61, code: 0, description: "Clear sky" },
    { date: "2026-09-14", high: 74, low: 59, code: 61, description: "Slight rain" },
  ],
};

/** Counts calls so the cache tests can prove a fetch did or didn't happen. */
function fakeClient(forecast: WeatherForecast = FORECAST) {
  const calls: [number, number, TemperatureUnit, number][] = [];
  const client: WeatherClient = {
    async getCurrent() {
      return forecast.current;
    },
    async getForecast(latitude, longitude, unit, days) {
      calls.push([latitude, longitude, unit, days]);
      return forecast;
    },
  };
  return { client, calls };
}

/** A client whose forecast call always fails. */
function failingClient(): WeatherClient {
  return {
    async getCurrent() {
      throw new Error("nope");
    },
    async getForecast() {
      throw new Error("Open-Meteo request failed (HTTP 503) for 1,2.");
    },
  };
}

describe("getForecast", () => {
  // The cache is module-scope, so each test starts from empty or they leak into
  // each other through it.
  beforeEach(() => clearForecastCache());

  it("validates input, applies the defaults, and returns the client's result", async () => {
    const { client, calls } = fakeClient();
    const result = await getForecast(client, { latitude: 40.34, longitude: -74.46 });

    expect(result).toEqual(FORECAST);
    expect(calls).toEqual([[40.34, -74.46, "fahrenheit", 7]]);
  });

  it("passes through a chosen unit and day count", async () => {
    const { client, calls } = fakeClient();
    await getForecast(client, { latitude: 1, longitude: 2, unit: "celsius", days: 3 });

    expect(calls).toEqual([[1, 2, "celsius", 3]]);
  });

  it("serves a second call from the cache rather than refetching", async () => {
    const { client, calls } = fakeClient();
    await getForecast(client, { latitude: 1, longitude: 2 }, 1_000);
    const second = await getForecast(client, { latitude: 1, longitude: 2 }, 2_000);

    expect(second).toEqual(FORECAST);
    expect(calls).toHaveLength(1);
  });

  it("refetches once the entry is older than the TTL", async () => {
    const { client, calls } = fakeClient();
    await getForecast(client, { latitude: 1, longitude: 2 }, 0);
    // 30 minutes and a second later.
    await getForecast(client, { latitude: 1, longitude: 2 }, 30 * 60 * 1000 + 1_000);

    expect(calls).toHaveLength(2);
  });

  it("refetches when explicitly asked, even with a live entry", async () => {
    const { client, calls } = fakeClient();
    await getForecast(client, { latitude: 1, longitude: 2 }, 1_000);
    await getForecast(client, { latitude: 1, longitude: 2, refresh: true }, 1_100);

    expect(calls).toHaveLength(2);
  });

  it("caches per location, unit and day count", async () => {
    const { client, calls } = fakeClient();
    await getForecast(client, { latitude: 1, longitude: 2 }, 0);
    await getForecast(client, { latitude: 9, longitude: 9 }, 0);
    await getForecast(client, { latitude: 1, longitude: 2, unit: "celsius" }, 0);
    await getForecast(client, { latitude: 1, longitude: 2, days: 3 }, 0);

    expect(calls).toHaveLength(4);
  });

  it("treats coordinates within ~1km as the same place", async () => {
    const { client, calls } = fakeClient();
    await getForecast(client, { latitude: 40.341, longitude: -74.461 }, 0);
    await getForecast(client, { latitude: 40.344, longitude: -74.462 }, 0);

    expect(calls).toHaveLength(1);
  });

  it("rejects an out-of-range coordinate", async () => {
    const { client } = fakeClient();
    await expect(getForecast(client, { latitude: 91, longitude: 0 })).rejects.toThrow();
    await expect(getForecast(client, { latitude: 0, longitude: 181 })).rejects.toThrow();
  });

  it("rejects a day count beyond the provider's ceiling", async () => {
    const { client } = fakeClient();
    await expect(getForecast(client, { latitude: 1, longitude: 2, days: 17 })).rejects.toThrow();
    await expect(getForecast(client, { latitude: 1, longitude: 2, days: 0 })).rejects.toThrow();
  });

  it("propagates a fetch failure and caches nothing", async () => {
    const failing = failingClient();
    await expect(getForecast(failing, { latitude: 1, longitude: 2 })).rejects.toThrow(/503/);

    // A cached error would blank the card for half an hour after one blip, so the
    // next call must reach a (now working) client.
    const { client, calls } = fakeClient();
    await expect(getForecast(client, { latitude: 1, longitude: 2 })).resolves.toEqual(FORECAST);
    expect(calls).toHaveLength(1);
  });
});
