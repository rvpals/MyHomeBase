import { describe, expect, it } from "vitest";
import { SearchingVendorLogoClient } from "./searching-vendor-logo-client";
import type { VendorDomainClient, VendorIconClient } from "./ports";

/** A search that answers from a table. */
function fakeSearch(
  answers: Record<string, string>,
  options: { throws?: boolean } = {},
): VendorDomainClient & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async resolve(name: string) {
      asked.push(name);
      if (options.throws) throw new Error("search is down");
      return answers[name];
    },
  };
}

/** An icon service that has icons for exactly the listed domains. */
function fakeIcons(withIcons: string[]): VendorIconClient & { tried: string[] } {
  const tried: string[] = [];
  return {
    tried,
    async fetchForDomain(domain: string) {
      tried.push(domain);
      if (!withIcons.includes(domain)) return undefined;
      return {
        data: Buffer.from([1, 2, 3]),
        mimeType: "image/png",
        source: `https://icons.test/${domain}`,
      };
    },
  };
}

describe("SearchingVendorLogoClient", () => {
  it("uses the domain the search found", async () => {
    // The case guessing could never solve: usps.com is not derivable from the
    // words "United States Post Office".
    const search = fakeSearch({ "United States Post Office": "usps.com" });
    const icons = fakeIcons(["usps.com"]);

    const result = await new SearchingVendorLogoClient(search, icons).fetch(
      "United States Post Office",
    );

    expect(result?.domain).toBe("usps.com");
    expect(result?.via).toBe("search");
  });

  it("finds a .org the search knew about", async () => {
    const search = fakeSearch({ "Morris Museum": "morrismuseum.org" });
    const icons = fakeIcons(["morrismuseum.org"]);

    const result = await new SearchingVendorLogoClient(search, icons).fetch("Morris Museum");

    expect(result?.domain).toBe("morrismuseum.org");
  });

  it("falls back to guessing when the search has no answer", async () => {
    // DuckDuckGo is quiet for a plain own-name brand; the guess is right.
    const search = fakeSearch({});
    const icons = fakeIcons(["butcherbox.com"]);

    const result = await new SearchingVendorLogoClient(search, icons).fetch("ButcherBox");

    expect(result?.domain).toBe("butcherbox.com");
    expect(result?.via).toBe("guess");
  });

  it("falls back to guessing when the search's domain has no icon", async () => {
    const search = fakeSearch({ Wawa: "wawa-corporate.test" });
    const icons = fakeIcons(["wawa.com"]);

    const result = await new SearchingVendorLogoClient(search, icons).fetch("Wawa");

    expect(result?.domain).toBe("wawa.com");
    expect(result?.via).toBe("guess");
  });

  it("tries the pluralised guess when the singular has no icon", async () => {
    const search = fakeSearch({});
    const icons = fakeIcons(["tgifridays.com"]);

    const result = await new SearchingVendorLogoClient(search, icons).fetch("TGI Friday");

    expect(result?.domain).toBe("tgifridays.com");
  });

  it("still guesses when the search itself breaks", async () => {
    // A search outage must not take the whole feature down with it.
    const search = fakeSearch({}, { throws: true });
    const icons = fakeIcons(["costco.com"]);

    const result = await new SearchingVendorLogoClient(search, icons).fetch("Costco Warehouse");

    expect(result?.domain).toBe("costco.com");
  });

  it("returns undefined when neither half finds anything", async () => {
    const search = fakeSearch({});
    const icons = fakeIcons([]);

    const result = await new SearchingVendorLogoClient(search, icons).fetch("Ferraris Pizza");

    expect(result).toBeUndefined();
  });

  it("does not re-try the searched domain as a guess", async () => {
    const search = fakeSearch({ Costco: "costco.com" });
    const icons = fakeIcons([]);

    await new SearchingVendorLogoClient(search, icons).fetch("Costco");

    expect(icons.tried.filter((domain) => domain === "costco.com")).toHaveLength(1);
  });

  it("asks for nothing on a blank name", async () => {
    const search = fakeSearch({});
    const icons = fakeIcons([]);

    const result = await new SearchingVendorLogoClient(search, icons).fetch("   ");

    expect(result).toBeUndefined();
    expect(search.asked).toEqual([]);
    expect(icons.tried).toEqual([]);
  });
});
