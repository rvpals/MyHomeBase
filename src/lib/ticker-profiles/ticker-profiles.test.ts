import { describe, expect, it } from "vitest";
import type { TickerProfileClient, TickerProfileRepository } from "./ports";
import {
  getOrFetchTickerProfile,
  isStale,
  isValidTicker,
  loadSectorMap,
  needsFetch,
  normalizeTicker,
  refreshTickerProfiles,
  resolveSector,
} from "./ticker-profiles";
import { NO_SECTOR_LABEL, type FetchedProfile, type TickerProfileRecord } from "./types";

const NOW = Date.parse("2026-08-16T00:00:00.000Z");
const FRESH = "2026-08-10T00:00:00.000Z";
const OLD = "2026-01-01T00:00:00.000Z";

function record(overrides: Partial<TickerProfileRecord> = {}): TickerProfileRecord {
  return {
    ticker: "AAPL",
    sector: "Technology",
    industry: "Consumer Electronics",
    manualSector: "",
    source: "yahoo:assetProfile",
    fetchedAt: FRESH,
    ...overrides,
  };
}

function fakeRepo(seed: TickerProfileRecord[] = []) {
  const rows = new Map(seed.map((row) => [row.ticker, row]));
  const saved: string[] = [];

  const repo: TickerProfileRepository = {
    get: (ticker) => rows.get(ticker),
    list: () => [...rows.values()],
    save(ticker, profile, source) {
      saved.push(ticker);
      rows.set(ticker, {
        ticker,
        sector: profile.sector,
        industry: profile.industry,
        // Mirrors the SQL: an override survives a refresh.
        manualSector: rows.get(ticker)?.manualSector ?? "",
        source,
        fetchedAt: "2026-08-16T00:00:00.000Z",
      });
    },
  };
  return { repo, rows, saved };
}

function fakeClient(result: FetchedProfile | Error): TickerProfileClient & { fetchCount: number } {
  const client = {
    fetchCount: 0,
    source: "test",
    async fetch(): Promise<FetchedProfile> {
      client.fetchCount += 1;
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return client;
}

const TECH: FetchedProfile = { sector: "Technology", industry: "Software" };
const NOTHING: FetchedProfile = { sector: "", industry: "" };

describe("normalizeTicker / isValidTicker", () => {
  it("upper-cases and trims", () => {
    expect(normalizeTicker("  aapl ")).toBe("AAPL");
  });

  it("accepts real symbol shapes", () => {
    for (const ticker of ["AAPL", "BRK.B", "SPY", "RDS-A"]) {
      expect(isValidTicker(ticker)).toBe(true);
    }
  });

  it("rejects anything that could escape into a URL", () => {
    for (const bad of ["../etc/passwd", "AA PL", "AAPL?x=1", "a".repeat(16), ""]) {
      expect(isValidTicker(bad)).toBe(false);
    }
  });
});

describe("isStale", () => {
  it("treats a recent lookup as current and an old one as worth retrying", () => {
    expect(isStale(FRESH, NOW)).toBe(false);
    expect(isStale(OLD, NOW)).toBe(true);
  });

  it("retries an unparseable timestamp rather than trusting it", () => {
    expect(isStale("not a date", NOW)).toBe(true);
  });

  it("reads SQLite's zone-less timestamp as UTC", () => {
    expect(isStale("2026-08-10 00:00:00", NOW)).toBe(false);
  });
});

describe("resolveSector", () => {
  it("prefers a hand-set sector over the provider's", () => {
    expect(resolveSector(record({ manualSector: "Real Estate" }))).toBe("Real Estate");
  });

  it("falls back to the provider's sector", () => {
    expect(resolveSector(record())).toBe("Technology");
  });

  it("labels a fund rather than calling it unclassified", () => {
    expect(resolveSector(record({ sector: "" }))).toBe(NO_SECTOR_LABEL);
    expect(resolveSector(undefined)).toBe(NO_SECTOR_LABEL);
  });

  it("treats a whitespace-only sector as none", () => {
    expect(resolveSector(record({ sector: "   " }))).toBe(NO_SECTOR_LABEL);
  });
});

describe("needsFetch", () => {
  it("fetches when nothing is cached", () => {
    expect(needsFetch(undefined, NOW)).toBe(true);
  });

  it("leaves a fresh answer alone — including a cached 'no sector'", () => {
    expect(needsFetch(record(), NOW)).toBe(false);
    expect(needsFetch(record({ sector: "" }), NOW)).toBe(false);
  });

  it("retries a stale row", () => {
    expect(needsFetch(record({ fetchedAt: OLD }), NOW)).toBe(true);
  });

  it("never re-fetches over a hand-set sector, however old", () => {
    expect(needsFetch(record({ manualSector: "Energy", fetchedAt: OLD }), NOW)).toBe(false);
  });
});

describe("loadSectorMap", () => {
  it("keys every cached profile by ticker", () => {
    const { repo } = fakeRepo([record(), record({ ticker: "SPY", sector: "" })]);
    const map = loadSectorMap(repo);
    expect(resolveSector(map.get("AAPL"))).toBe("Technology");
    expect(resolveSector(map.get("SPY"))).toBe(NO_SECTOR_LABEL);
  });
});

describe("getOrFetchTickerProfile", () => {
  it("serves a fresh cache entry without asking the provider", async () => {
    const { repo } = fakeRepo([record()]);
    const client = fakeClient(TECH);

    expect((await getOrFetchTickerProfile(repo, client, "AAPL", NOW))?.sector).toBe("Technology");
    expect(client.fetchCount).toBe(0);
  });

  it("fetches and stores when nothing is cached", async () => {
    const { repo, saved } = fakeRepo();
    const client = fakeClient(TECH);

    expect((await getOrFetchTickerProfile(repo, client, "msft", NOW))?.sector).toBe("Technology");
    expect(saved).toEqual(["MSFT"]);
  });

  it("caches a reported 'no sector', so a fund isn't re-requested", async () => {
    const { repo, rows, saved } = fakeRepo();
    const client = fakeClient(NOTHING);

    await getOrFetchTickerProfile(repo, client, "SPY", NOW);
    expect(saved).toEqual(["SPY"]);
    expect(rows.get("SPY")?.sector).toBe("");
    expect(needsFetch(rows.get("SPY"), NOW)).toBe(false);
  });

  it("does not cache a failed request as an absent sector", async () => {
    const { repo, rows, saved } = fakeRepo();
    const client = fakeClient(new Error("HTTP 401"));

    expect(await getOrFetchTickerProfile(repo, client, "AAPL", NOW)).toBeUndefined();
    expect(saved).toEqual([]);
    expect(rows.has("AAPL")).toBe(false);
  });

  it("keeps the stale value when a refresh attempt fails", async () => {
    const { repo } = fakeRepo([record({ fetchedAt: OLD })]);
    const client = fakeClient(new Error("network down"));

    expect((await getOrFetchTickerProfile(repo, client, "AAPL", NOW))?.sector).toBe("Technology");
  });

  it("rejects a malformed ticker without touching the provider", async () => {
    const { repo } = fakeRepo();
    const client = fakeClient(TECH);

    expect(await getOrFetchTickerProfile(repo, client, "../etc/passwd", NOW)).toBeUndefined();
    expect(client.fetchCount).toBe(0);
  });
});

describe("refreshTickerProfiles", () => {
  it("fetches each unknown ticker exactly once, de-duplicating repeats", async () => {
    const { repo } = fakeRepo();
    const client = fakeClient(TECH);

    const result = await refreshTickerProfiles(repo, client, ["AAPL", "aapl", "MSFT"], NOW);
    expect(result.fetched).toEqual(["AAPL", "MSFT"]);
    expect(client.fetchCount).toBe(2);
  });

  it("skips tickers that already have a fresh answer", async () => {
    const { repo } = fakeRepo([record()]);
    const client = fakeClient(TECH);

    const result = await refreshTickerProfiles(repo, client, ["AAPL", "MSFT"], NOW);
    expect(result.skipped).toEqual(["AAPL"]);
    expect(result.fetched).toEqual(["MSFT"]);
  });

  it("carries on past a failure rather than abandoning the walk", async () => {
    const { repo } = fakeRepo();
    let call = 0;
    const client: TickerProfileClient = {
      source: "test",
      async fetch() {
        call += 1;
        if (call === 1) throw new Error("HTTP 401");
        return TECH;
      },
    };

    const result = await refreshTickerProfiles(repo, client, ["BAD", "MSFT"], NOW);
    expect(result.failed).toEqual(["BAD"]);
    expect(result.fetched).toEqual(["MSFT"]);
  });

  it("drops malformed tickers instead of sending them upstream", async () => {
    const { repo } = fakeRepo();
    const client = fakeClient(TECH);

    const result = await refreshTickerProfiles(repo, client, ["AA PL", "AAPL"], NOW);
    expect(result.fetched).toEqual(["AAPL"]);
    expect(client.fetchCount).toBe(1);
  });

  it("preserves a hand-set sector across a refresh", async () => {
    const { repo, rows } = fakeRepo([
      record({ manualSector: "Real Estate", sector: "", fetchedAt: OLD }),
    ]);
    const client = fakeClient(TECH);

    await refreshTickerProfiles(repo, client, ["AAPL"], NOW);
    expect(rows.get("AAPL")?.manualSector).toBe("Real Estate");
    expect(resolveSector(rows.get("AAPL"))).toBe("Real Estate");
  });
});
