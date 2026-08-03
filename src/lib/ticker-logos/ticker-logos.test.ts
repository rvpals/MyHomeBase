import { describe, expect, it } from "vitest";
import type { FetchedLogo, TickerLogoClient, TickerLogoRepository } from "./ports";
import {
  MAX_LOGO_BYTES,
  getOrFetchTickerLogo,
  isAcceptableLogo,
  isValidTicker,
  normalizeTicker,
} from "./ticker-logos";
import type { TickerLogoRecord } from "./types";

const PNG = { data: Buffer.from("fake png bytes"), mimeType: "image/png" };

function fakeRepo(seed: TickerLogoRecord[] = []) {
  const rows = new Map(seed.map((record) => [record.ticker, record]));
  const calls = { save: [] as string[], saveMissing: [] as string[] };

  const repo: TickerLogoRepository = {
    get: (ticker) => rows.get(ticker),
    save(ticker, image, source) {
      calls.save.push(ticker);
      rows.set(ticker, { ticker, image, source, fetchedAt: "2026-08-03T00:00:00.000Z" });
    },
    saveMissing(ticker, source) {
      calls.saveMissing.push(ticker);
      rows.set(ticker, { ticker, source, fetchedAt: "2026-08-03T00:00:00.000Z" });
    },
  };
  return { repo, rows, calls };
}

function fakeClient(
  result: FetchedLogo | undefined | (() => never),
): TickerLogoClient & { fetchCount: number } {
  const client = {
    fetchCount: 0,
    sourceFor: (ticker: string) => `https://example.test/${ticker}.png`,
    async fetch() {
      client.fetchCount += 1;
      if (typeof result === "function") result();
      return result as FetchedLogo | undefined;
    },
  };
  return client;
}

describe("normalizeTicker / isValidTicker", () => {
  it("upper-cases and trims", () => {
    expect(normalizeTicker("  aapl ")).toBe("AAPL");
  });

  it("accepts real symbol shapes", () => {
    for (const ticker of ["AAPL", "BRK.B", "SPY", "RDS-A", "TSM"]) {
      expect(isValidTicker(ticker)).toBe(true);
    }
  });

  it("rejects anything that could escape into a URL or path", () => {
    for (const bad of ["../etc/passwd", "AA PL", "AAPL?x=1", "AAPL/../", "a".repeat(16), ""]) {
      expect(isValidTicker(bad)).toBe(false);
    }
  });
});

describe("isAcceptableLogo", () => {
  it("accepts the allowed image types", () => {
    expect(isAcceptableLogo(PNG)).toBe(true);
  });

  it("rejects a disallowed type, including SVG", () => {
    expect(isAcceptableLogo({ data: PNG.data, mimeType: "image/svg+xml" })).toBe(false);
    expect(isAcceptableLogo({ data: PNG.data, mimeType: "text/html" })).toBe(false);
  });

  it("rejects empty or oversized data", () => {
    expect(isAcceptableLogo({ data: Buffer.alloc(0), mimeType: "image/png" })).toBe(false);
    expect(
      isAcceptableLogo({ data: Buffer.alloc(MAX_LOGO_BYTES + 1), mimeType: "image/png" }),
    ).toBe(false);
  });
});

describe("getOrFetchTickerLogo", () => {
  const NOW = Date.parse("2026-08-03T12:00:00.000Z");

  it("downloads and caches on first use", async () => {
    const { repo, calls } = fakeRepo();
    const client = fakeClient({ image: PNG, source: "https://example.test/AAPL.png" });

    const logo = await getOrFetchTickerLogo(repo, client, "aapl", NOW);

    expect(logo?.mimeType).toBe("image/png");
    expect(calls.save).toEqual(["AAPL"]); // stored under the normalised ticker
    expect(client.fetchCount).toBe(1);
  });

  it("serves a cached image without touching the network", async () => {
    const { repo } = fakeRepo([
      { ticker: "AAPL", image: PNG, source: "s", fetchedAt: "2026-08-01T00:00:00.000Z" },
    ]);
    const client = fakeClient(undefined);

    const logo = await getOrFetchTickerLogo(repo, client, "AAPL", NOW);

    expect(logo).toBeDefined();
    expect(client.fetchCount).toBe(0);
  });

  it("records a miss so the same ticker isn't requested again", async () => {
    const { repo, calls } = fakeRepo();
    const client = fakeClient(undefined);

    expect(await getOrFetchTickerLogo(repo, client, "NOLOGO", NOW)).toBeUndefined();
    expect(calls.saveMissing).toEqual(["NOLOGO"]);

    // Second call is served from the negative cache.
    expect(await getOrFetchTickerLogo(repo, client, "NOLOGO", NOW)).toBeUndefined();
    expect(client.fetchCount).toBe(1);
  });

  it("retries a negative entry once it's old enough", async () => {
    const { repo } = fakeRepo([
      { ticker: "LATER", source: "s", fetchedAt: "2026-01-01T00:00:00.000Z" }, // >30 days old
    ]);
    const client = fakeClient({ image: PNG, source: "s" });

    const logo = await getOrFetchTickerLogo(repo, client, "LATER", NOW);

    expect(logo).toBeDefined();
    expect(client.fetchCount).toBe(1);
  });

  it("does not cache a network failure as a permanent absence", async () => {
    const { repo, calls } = fakeRepo();
    const client = fakeClient(() => {
      throw new Error("socket hang up");
    });

    expect(await getOrFetchTickerLogo(repo, client, "AAPL", NOW)).toBeUndefined();
    // Nothing recorded, so the next render tries again rather than assuming there's no logo.
    expect(calls.saveMissing).toEqual([]);
    expect(calls.save).toEqual([]);
  });

  it("treats an unacceptable download as no logo", async () => {
    const { repo, calls } = fakeRepo();
    const client = fakeClient({
      image: { data: Buffer.from("<html>error</html>"), mimeType: "text/html" },
      source: "s",
    });

    expect(await getOrFetchTickerLogo(repo, client, "WEIRD", NOW)).toBeUndefined();
    expect(calls.saveMissing).toEqual(["WEIRD"]);
  });

  it("ignores a stored image whose type is no longer allowed", async () => {
    const { repo } = fakeRepo([
      {
        ticker: "OLD",
        image: { data: Buffer.from("svg"), mimeType: "image/svg+xml" },
        source: "s",
        fetchedAt: "2026-08-01T00:00:00.000Z",
      },
    ]);
    const client = fakeClient({ image: PNG, source: "s" });

    const logo = await getOrFetchTickerLogo(repo, client, "OLD", NOW);

    expect(logo?.mimeType).toBe("image/png"); // re-fetched rather than served
  });

  it("refuses an invalid ticker without any request", async () => {
    const { repo } = fakeRepo();
    const client = fakeClient({ image: PNG, source: "s" });

    expect(await getOrFetchTickerLogo(repo, client, "../secret", NOW)).toBeUndefined();
    expect(client.fetchCount).toBe(0);
  });
});
