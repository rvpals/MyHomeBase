import { describe, expect, it } from "vitest";
import {
  CACHE_BUST_PARAM,
  cacheBustedUrl,
  getAppVersion,
  isUpdateAvailable,
  urlWithoutCacheBuster,
} from "./app-version";
import type { BuildIdRepository } from "./ports";

function repoReturning(value: string | null): BuildIdRepository {
  return { readBuildId: () => value };
}

describe("getAppVersion", () => {
  it("reports the build id the repository holds", () => {
    expect(getAppVersion(repoReturning("aBcD1234"))).toEqual({ buildId: "aBcD1234" });
  });

  it("trims the trailing newline the BUILD_ID file carries", () => {
    expect(getAppVersion(repoReturning("aBcD1234\n"))).toEqual({ buildId: "aBcD1234" });
  });

  it("reports null when there is no build id, as in next dev", () => {
    expect(getAppVersion(repoReturning(null))).toEqual({ buildId: null });
  });

  it("collapses an empty or whitespace-only id to null, so callers have one unknown", () => {
    expect(getAppVersion(repoReturning(""))).toEqual({ buildId: null });
    expect(getAppVersion(repoReturning("  \n"))).toEqual({ buildId: null });
  });
});

describe("isUpdateAvailable", () => {
  it("is true when the server is serving a different build than the client booted with", () => {
    expect(isUpdateAvailable("old-build", "new-build")).toBe(true);
  });

  it("is false when they match", () => {
    expect(isUpdateAvailable("same-build", "same-build")).toBe(false);
  });

  it("is false when the client's own build is unknown, so dev never nags", () => {
    expect(isUpdateAvailable(null, "new-build")).toBe(false);
  });

  it("is false when the server's build is unknown, so a failed check is not an update", () => {
    expect(isUpdateAvailable("old-build", null)).toBe(false);
  });

  it("is false when both are unknown", () => {
    expect(isUpdateAvailable(null, null)).toBe(false);
  });
});

describe("cacheBustedUrl", () => {
  it("adds a stamp the HTTP cache has never seen", () => {
    expect(cacheBustedUrl("https://home.example/modules/stocks", 1712)).toBe(
      `https://home.example/modules/stocks?${CACHE_BUST_PARAM}=1712`,
    );
  });

  it("keeps the page's existing query parameters, so filters survive the reload", () => {
    const result = new URL(cacheBustedUrl("https://home.example/x?ticker=MSFT&range=1y", 99));
    expect(result.searchParams.get("ticker")).toBe("MSFT");
    expect(result.searchParams.get("range")).toBe("1y");
    expect(result.searchParams.get(CACHE_BUST_PARAM)).toBe("99");
  });

  it("replaces a previous stamp rather than appending, so repeat reloads don't grow the URL", () => {
    const once = cacheBustedUrl("https://home.example/x", 1);
    const twice = cacheBustedUrl(once, 2);
    expect(twice).toBe(`https://home.example/x?${CACHE_BUST_PARAM}=2`);
  });
});

describe("urlWithoutCacheBuster", () => {
  it("strips the stamp so it never reaches a bookmark", () => {
    expect(urlWithoutCacheBuster(`https://home.example/modules/stocks?${CACHE_BUST_PARAM}=1712`)).toBe(
      "https://home.example/modules/stocks",
    );
  });

  it("leaves the page's own parameters in place", () => {
    expect(urlWithoutCacheBuster(`https://home.example/x?ticker=MSFT&${CACHE_BUST_PARAM}=5`)).toBe(
      "https://home.example/x?ticker=MSFT",
    );
  });

  it("returns null when there was no stamp, so the caller skips a pointless history write", () => {
    expect(urlWithoutCacheBuster("https://home.example/modules/stocks")).toBeNull();
  });
});
