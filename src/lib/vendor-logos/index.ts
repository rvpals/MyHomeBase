export type {
  FetchedVendorLogo,
  VendorLogoClient,
  VendorDomainClient,
  VendorIconClient,
} from "./ports";
export { SearchingVendorLogoClient } from "./searching-vendor-logo-client";
export { DuckDuckGoVendorDomainClient } from "./duckduckgo-domain-client";
export { GoogleFaviconIconClient } from "./google-favicon-icon-client";
export {
  vendorNameToDomainCandidates,
  isAcceptableVendorLogo,
  isVendorOwnSite,
  hostnameOf,
  VENDOR_LOGO_MIME_TYPES,
  MAX_VENDOR_LOGO_BYTES,
} from "./vendor-logos";
