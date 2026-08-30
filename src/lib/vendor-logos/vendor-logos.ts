// Turning a vendor name into candidate domains, and deciding whether fetched
// bytes are worth storing. Pure — a name in, candidates out; bytes in, a verdict
// out — so every quirk of a card statement is unit-testable without a network.
//
// The impure halves are duckduckgo-domain-client.ts (looks a name up) and
// google-favicon-logo-client.ts (fetches the icon and orchestrates the two).

/** What a vendor icon may be. SVG is excluded deliberately: it is a script
 * carrier, and these bytes come from a third party. Matches the allowlist the
 * manual vendor-icon upload already enforces. */
export const VENDOR_LOGO_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
] as const;

/**
 * Cap on a fetched logo. The same 128 KB the manual upload allows, for the same
 * reason — it renders at 20px, and a vendor list is a page of them.
 */
export const MAX_VENDOR_LOGO_BYTES = 128 * 1024;

/**
 * Noise a card statement wraps around a merchant name. Stripped before the
 * domain guess, longest first so `S Q ` never half-matches inside `SQ *`.
 */
const STATEMENT_PREFIXES = ["sq *", "sp *", "tst*", "tst *", "pos ", "pp*", "paypal *"];

/** Company suffixes that are never part of a domain. */
const COMPANY_SUFFIXES = [
  "incorporated",
  "corporation",
  "company",
  "limited",
  "holdings",
  "group",
  "inc",
  "llc",
  "ltd",
  "corp",
  "co",
];

/**
 * Trailing words that describe *what a business is* rather than who it is.
 * "Costco Warehouse" and "Costco Gas Station" are both costco.com, and
 * "Wawa Gas" is wawa.com — the brand is the first word or two, and the rest is
 * the kind of shop. Dropped only from the end, and never when they are the
 * whole name, so a vendor genuinely called "Pharmacy" survives.
 */
const DESCRIPTIVE_SUFFIXES = [
  "gas station",
  "fried chicken",
  "warehouse",
  "pharmacy",
  "restaurant",
  "wireless",
  "station",
  "market",
  "store",
  "shop",
  "bank",
  "gas",
];

/** Hosts that answer a search but are never a vendor's own site. */
const NON_VENDOR_HOSTS = [
  "wikipedia.org",
  "wikidata.org",
  "britannica.com",
  "facebook.com",
  "yelp.com",
  "tripadvisor.com",
  "linkedin.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "amazon.com/stores",
];

/**
 * Whether a URL from a search result is plausibly a vendor's own website.
 *
 * A search for "Morris Museum" returns the Wikipedia article as its abstract,
 * which is the right *answer* and the wrong *domain* — hanging a Wikipedia
 * favicon off a vendor would be worse than no icon, since it looks like the
 * feature worked. Directory and social hosts are rejected for the same reason.
 */
export function isVendorOwnSite(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return false;
  }
  return !NON_VENDOR_HOSTS.some((bad) => host === bad || host.endsWith(`.${bad}`));
}

/** The bare hostname of a URL, or undefined when it isn't one. */
export function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Domains worth trying for a vendor, best guess first.
 *
 * This is the *fallback* half of finding a vendor's site — the search client
 * gets first refusal, because string manipulation cannot turn "United States
 * Post Office" into `usps.com` and no amount of rules will. What it is good at
 * is the plain case a search engine has no article for: a local business, or a
 * brand whose name is already its domain.
 *
 * Several candidates rather than one, because a single guess was the thing that
 * made the first version of this useless. `.org` catches museums and
 * non-profits; the trailing `s` catches "TGI Friday" against tgifridays.com.
 * The caller tries them in order and takes the first that has an icon, so a
 * wrong candidate costs one 404 rather than a wrong logo.
 *
 * Returns an empty array when nothing usable is left — an empty name, or a line
 * that was all punctuation and store numbers.
 */
export function vendorNameToDomainCandidates(rawName: string): string[] {
  let name = rawName.trim().toLowerCase();
  if (name === "") return [];

  // Statement noise first, since a prefix sits before the part we want.
  for (const prefix of STATEMENT_PREFIXES) {
    if (name.startsWith(prefix)) {
      name = name.slice(prefix.length);
      break;
    }
  }

  // A store number (`#221`) and anything after it is location, not identity.
  name = name.split("#")[0];

  // A name that is already a domain is the answer — "Amazon.com" must not
  // become "amazoncom.com". Only a known TLD counts, so "Marshall's" and
  // "IKEA Inc." are unaffected.
  const asDomain = name.trim().replace(/^www\./, "");
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|co\.uk|io|shop|store)$/.test(asDomain)) {
    return [asDomain];
  }

  // Keep letters, digits and separators; everything else is punctuation a
  // domain cannot carry. Apostrophes vanish rather than becoming a gap, so
  // "Trader Joe's" -> "traderjoes" and not "trader joe s".
  name = name.replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  if (name === "") return [];

  // Trailing company suffixes, repeatedly — "foo inc llc" happens.
  let words = name.split(/\s+/).filter(Boolean);
  while (words.length > 1 && COMPANY_SUFFIXES.includes(words[words.length - 1])) {
    words = words.slice(0, -1);
  }

  // Then the "what kind of shop" tail, longest phrase first so "gas station"
  // wins over "station". Repeated, because "Costco Gas Station Warehouse" is
  // the sort of thing a statement produces.
  for (let changed = true; changed && words.length > 1; ) {
    changed = false;
    for (const suffix of DESCRIPTIVE_SUFFIXES) {
      const parts = suffix.split(" ");
      if (parts.length >= words.length) continue;
      if (words.slice(-parts.length).join(" ") === suffix) {
        words = words.slice(0, -parts.length);
        changed = true;
        break;
      }
    }
  }
  if (words.length === 0) return [];

  const host = words.join("");
  // A digit or two left over is a store number, not a brand.
  if (host === "" || /^\d+$/.test(host)) return [];

  const candidates = [`${host}.com`, `${host}.org`];
  // "TGI Friday" is tgifridays.com. Only worth trying when it isn't already
  // plural, and only after the singular, which is the commoner spelling.
  if (!host.endsWith("s")) candidates.splice(1, 0, `${host}s.com`);

  return candidates;
}

/** Whether fetched bytes are worth storing as a vendor icon. */
export function isAcceptableVendorLogo(mimeType: string, byteLength: number): boolean {
  if (byteLength <= 0 || byteLength > MAX_VENDOR_LOGO_BYTES) return false;
  return (VENDOR_LOGO_MIME_TYPES as readonly string[]).includes(mimeType);
}
