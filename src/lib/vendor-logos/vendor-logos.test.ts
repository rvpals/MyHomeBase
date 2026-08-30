import { describe, expect, it } from "vitest";
import {
  MAX_VENDOR_LOGO_BYTES,
  hostnameOf,
  isAcceptableVendorLogo,
  isVendorOwnSite,
  vendorNameToDomainCandidates,
} from "./vendor-logos";

/** The first candidate — what a single-guess implementation would have used. */
const first = (name: string) => vendorNameToDomainCandidates(name)[0];

describe("vendorNameToDomainCandidates", () => {
  it("turns a plain brand name into a domain", () => {
    expect(first("Costco")).toBe("costco.com");
  });

  it("lower-cases and joins a multi-word name", () => {
    expect(first("Home Depot")).toBe("homedepot.com");
  });

  it("drops an apostrophe rather than splitting the word on it", () => {
    expect(first("Trader Joe's")).toBe("traderjoes.com");
  });

  it("strips a square prefix and a store number", () => {
    expect(first("SQ *TGI FRIDAYS #221")).toBe("tgifridays.com");
  });

  it("strips a trailing company suffix", () => {
    expect(first("Acme Inc")).toBe("acme.com");
    expect(first("Acme Holdings LLC")).toBe("acme.com");
  });

  it("keeps a name that is already a domain, and only that", () => {
    // "Amazon.com" must not become "amazoncom.com".
    expect(vendorNameToDomainCandidates("Amazon.com")).toEqual(["amazon.com"]);
    expect(vendorNameToDomainCandidates("www.lidl.com")).toEqual(["lidl.com"]);
  });

  it("drops a trailing word that says what kind of shop it is", () => {
    // All of these are the brand's own domain; the tail is the format.
    expect(first("Costco Warehouse")).toBe("costco.com");
    expect(first("Costco Gas Station")).toBe("costco.com");
    expect(first("CVS Pharmacy")).toBe("cvs.com");
    expect(first("CapitalOne bank")).toBe("capitalone.com");
  });

  it("drops a bare 'gas', which is how a fuel stop reaches the statement", () => {
    // Reported as a miss on a real vendor list: "Wawa Gas" is wawa.com.
    expect(first("Wawa Gas")).toBe("wawa.com");
  });

  it("offers a pluralised candidate, since a brand is often plural", () => {
    // Reported as a miss: "TGI Friday" is tgifridays.com.
    expect(vendorNameToDomainCandidates("TGI Friday")).toContain("tgifridays.com");
  });

  it("offers a .org candidate, since not every vendor is a .com", () => {
    // Reported as a miss: Morris Museum is morrismuseum.org.
    expect(vendorNameToDomainCandidates("Morris Museum")).toContain("morrismuseum.org");
  });

  it("does not offer a pluralised candidate for a name already plural", () => {
    expect(vendorNameToDomainCandidates("Marshalls")).not.toContain("marshallss.com");
  });

  it("keeps a descriptive word when it is the whole name", () => {
    expect(first("Pharmacy")).toBe("pharmacy.com");
  });

  it("keeps digits that are part of a brand", () => {
    expect(first("7 Eleven")).toBe("7eleven.com");
  });

  it("returns nothing for a name with nothing usable left", () => {
    expect(vendorNameToDomainCandidates("")).toEqual([]);
    expect(vendorNameToDomainCandidates("   ")).toEqual([]);
    expect(vendorNameToDomainCandidates("***")).toEqual([]);
    expect(vendorNameToDomainCandidates("#4432")).toEqual([]);
    expect(vendorNameToDomainCandidates("POS 12345")).toEqual([]);
  });
});

describe("isVendorOwnSite", () => {
  it("accepts a company's own website", () => {
    expect(isVendorOwnSite("https://usps.com/")).toBe(true);
    expect(isVendorOwnSite("https://www.morrismuseum.org")).toBe(true);
  });

  it("rejects the encyclopedia article about the company", () => {
    // A Wikipedia favicon against a vendor is worse than none — it looks like
    // the feature worked.
    expect(isVendorOwnSite("https://en.wikipedia.org/wiki/United_States_Postal_Service")).toBe(
      false,
    );
  });

  it("rejects directory and social hosts", () => {
    expect(isVendorOwnSite("https://www.yelp.com/biz/some-pizza")).toBe(false);
    expect(isVendorOwnSite("https://www.facebook.com/somestore")).toBe(false);
  });

  it("rejects a string that isn't a URL", () => {
    expect(isVendorOwnSite("not a url")).toBe(false);
  });
});

describe("hostnameOf", () => {
  it("strips the scheme, www and path", () => {
    expect(hostnameOf("https://www.cvs.com/store/123")).toBe("cvs.com");
  });

  it("returns undefined for a non-URL", () => {
    expect(hostnameOf("cvs")).toBeUndefined();
  });
});

describe("isAcceptableVendorLogo", () => {
  it("accepts the image types a vendor icon may be", () => {
    expect(isAcceptableVendorLogo("image/png", 4_000)).toBe(true);
    expect(isAcceptableVendorLogo("image/jpeg", 4_000)).toBe(true);
    expect(isAcceptableVendorLogo("image/x-icon", 4_000)).toBe(true);
  });

  it("rejects SVG, which is a script carrier and these bytes are third-party", () => {
    expect(isAcceptableVendorLogo("image/svg+xml", 4_000)).toBe(false);
  });

  it("rejects a non-image, which is what an error page comes back as", () => {
    expect(isAcceptableVendorLogo("text/html", 4_000)).toBe(false);
  });

  it("rejects an empty body and one over the cap", () => {
    expect(isAcceptableVendorLogo("image/png", 0)).toBe(false);
    expect(isAcceptableVendorLogo("image/png", MAX_VENDOR_LOGO_BYTES + 1)).toBe(false);
  });
});
