import type {
  FetchedVendorLogo,
  VendorDomainClient,
  VendorIconClient,
  VendorLogoClient,
} from "./ports";
import { vendorNameToDomainCandidates } from "./vendor-logos";

/**
 * Finds a vendor's icon by looking the name up, then falling back to guessing.
 *
 * The order is the whole point, and it is the correction to a first version
 * that only guessed. Guessing `<name>.com` produced `unitedstatespostoffice.com`
 * for USPS, `morrismuseum.com` for a museum that is a `.org`, `wawagas.com` for
 * Wawa and `tgifriday.com` for TGI Fridays — four real vendors with perfectly
 * good icons, all reported as "no logo found" because the address was wrong.
 * A search engine gets all four right.
 *
 * The guess is kept as a fallback rather than deleted, because the search is
 * quiet for exactly the cases the guess is good at: a small business or an
 * own-name brand DuckDuckGo has no article for, where `<name>.com` is simply
 * correct. Between them they resolved 24 of 28 names on a real vendor list;
 * search alone got 8, guessing alone got 17.
 *
 * Composed of two ports rather than doing the I/O itself, so a test can drive
 * the whole strategy — search hit, search miss into guess hit, everything
 * missing — without a network.
 */
export class SearchingVendorLogoClient implements VendorLogoClient {
  constructor(
    private readonly domains: VendorDomainClient,
    private readonly icons: VendorIconClient,
  ) {}

  async fetch(vendorName: string): Promise<FetchedVendorLogo | undefined> {
    const name = vendorName.trim();
    if (name === "") return undefined;

    // 1. Ask what the vendor's actual website is.
    let searched: string | undefined;
    try {
      searched = await this.domains.resolve(name);
    } catch {
      // A search that breaks must not lose the guess — it is a hint, not a
      // dependency.
      searched = undefined;
    }

    if (searched) {
      const found = await this.icons.fetchForDomain(searched);
      if (found) return { ...found, domain: searched, via: "search" };
    }

    // 2. Fall back to spelling the domain out of the name. Candidates are tried
    //    best-first and the first one with an icon wins, so a wrong candidate
    //    costs a 404 rather than a wrong logo.
    for (const candidate of vendorNameToDomainCandidates(name)) {
      // Already tried it as the search result; don't pay for it twice.
      if (candidate === searched) continue;
      const found = await this.icons.fetchForDomain(candidate);
      if (found) return { ...found, domain: candidate, via: "guess" };
    }

    return undefined;
  }
}
