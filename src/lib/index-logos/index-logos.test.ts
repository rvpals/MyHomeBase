import { describe, expect, it } from "vitest";
import { getOrFetchIndexLogo, isAcceptableIndexLogo, MAX_INDEX_LOGO_BYTES } from "./index-logos";
import type { IndexIconClient, IndexLogoRepository } from "./ports";
import type { IndexLogoImage, IndexLogoRecord } from "./types";

const PNG: IndexLogoImage = { data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), mimeType: "image/png" };

/** Hand-written fake — no mocking framework, no network. Records its writes. */
function fakeRepo(seed?: IndexLogoRecord) {
  const rows = new Map<string, IndexLogoRecord>();
  if (seed) rows.set(seed.symbol, seed);

  const repo: IndexLogoRepository & { saved: string[]; missing: string[] } = {
    saved: [],
    missing: [],
    get: (symbol) => rows.get(symbol),
    save(symbol, image, source) {
      this.saved.push(symbol);
      rows.set(symbol, { symbol, image, source, fetchedAt: new Date().toISOString() });
    },
    saveMissing(symbol, source) {
      this.missing.push(symbol);
      rows.set(symbol, { symbol, source, fetchedAt: new Date().toISOString() });
    },
  };
  return repo;
}

/** `asked` records the domains actually requested, which is what the cache tests assert on. */
function fakeClient(
  result: { data: Buffer; mimeType: string; source: string } | undefined | "throw",
) {
  const asked: string[] = [];
  const client: IndexIconClient = {
    async fetchForDomain(domain) {
      asked.push(domain);
      if (result === "throw") throw new Error("ECONNRESET");
      return result;
    },
  };
  return { client, asked };
}

const FOUND = { data: PNG.data, mimeType: "image/png", source: "https://example.test/icon.png" };

describe("isAcceptableIndexLogo", () => {
  it("accepts a small png", () => {
    expect(isAcceptableIndexLogo(PNG)).toBe(true);
  });

  it("accepts an ico, which is what many favicons are", () => {
    expect(isAcceptableIndexLogo({ data: PNG.data, mimeType: "image/x-icon" })).toBe(true);
  });

  it("rejects svg — a script carrier from a third party", () => {
    expect(isAcceptableIndexLogo({ data: PNG.data, mimeType: "image/svg+xml" })).toBe(false);
  });

  it("rejects an empty image and one over the cap", () => {
    expect(isAcceptableIndexLogo({ data: Buffer.alloc(0), mimeType: "image/png" })).toBe(false);
    expect(
      isAcceptableIndexLogo({ data: Buffer.alloc(MAX_INDEX_LOGO_BYTES + 1), mimeType: "image/png" }),
    ).toBe(false);
  });
});

describe("getOrFetchIndexLogo", () => {
  it("downloads and caches on a first lookup", async () => {
    const repo = fakeRepo();
    const { client, asked } = fakeClient(FOUND);

    const image = await getOrFetchIndexLogo(repo, client, "^GSPC", "spglobal.com");

    expect(image?.mimeType).toBe("image/png");
    expect(asked).toEqual(["spglobal.com"]);
    expect(repo.saved).toEqual(["^GSPC"]);
  });

  it("serves a cached image without asking the service", async () => {
    const repo = fakeRepo({
      symbol: "^GSPC",
      image: PNG,
      source: "https://example.test/icon.png",
      fetchedAt: new Date().toISOString(),
    });
    const { client, asked } = fakeClient(FOUND);

    const image = await getOrFetchIndexLogo(repo, client, "^GSPC", "spglobal.com");

    expect(image).toEqual(PNG);
    expect(asked).toEqual([]);
  });

  it("records a miss so the same symbol isn't re-requested", async () => {
    const repo = fakeRepo();
    const { client } = fakeClient(undefined);

    const image = await getOrFetchIndexLogo(repo, client, "^RUT", "ftserussell.com");

    expect(image).toBeUndefined();
    expect(repo.missing).toEqual(["^RUT"]);
  });

  it("honours a recent miss without a second request", async () => {
    const repo = fakeRepo({
      symbol: "^RUT",
      source: "ftserussell.com",
      fetchedAt: new Date().toISOString(),
    });
    const { client, asked } = fakeClient(FOUND);

    expect(await getOrFetchIndexLogo(repo, client, "^RUT", "ftserussell.com")).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it("retries a miss older than the negative-cache window", async () => {
    const repo = fakeRepo({
      symbol: "^RUT",
      source: "lseg.com",
      fetchedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const { client, asked } = fakeClient(FOUND);

    const image = await getOrFetchIndexLogo(repo, client, "^RUT", "lseg.com");

    expect(image?.mimeType).toBe("image/png");
    expect(asked).toEqual(["lseg.com"]);
  });

  it("does not cache a transport failure as a permanent absence", async () => {
    const repo = fakeRepo();
    const { client } = fakeClient("throw");

    const image = await getOrFetchIndexLogo(repo, client, "^GSPC", "spglobal.com");

    expect(image).toBeUndefined();
    expect(repo.missing).toEqual([]);
    expect(repo.saved).toEqual([]);
  });

  it("stores unusable bytes as a miss rather than serving them", async () => {
    const repo = fakeRepo();
    const { client } = fakeClient({ ...FOUND, mimeType: "text/html" });

    expect(await getOrFetchIndexLogo(repo, client, "^GSPC", "spglobal.com")).toBeUndefined();
    expect(repo.missing).toEqual(["^GSPC"]);
  });

  it("never calls the service for an index with no domain", async () => {
    const repo = fakeRepo();
    const { client, asked } = fakeClient(FOUND);

    expect(await getOrFetchIndexLogo(repo, client, "^GSPC", "")).toBeUndefined();
    expect(asked).toEqual([]);
    expect(repo.missing).toEqual([]);
  });
});
