export interface TaxAssessment {
  year: number;
  valueCents: number;
  landCents?: number;
  improvementsCents?: number;
}

export interface AnnualTax {
  year: number;
  amountCents: number;
}

export interface SaleEvent {
  event: string;
  date: string;
  priceCents?: number;
}

// The normalized result of looking up one address. Ephemeral — not persisted
// as-is; addToWatchlist turns one of these into a PropertySnapshot row.
export interface PropertyDetails {
  address: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  yearBuilt?: number;
  lotSize?: number;
  county?: string;
  subdivision?: string;
  zoning?: string;
  latestTaxAssessment?: TaxAssessment;
  latestAnnualTax?: AnnualTax;
  lastSaleDate?: string;
  lastSalePriceCents?: number;
  saleHistory: SaleEvent[];
  ownerNames: string[];
  ownerType?: string;
  ownerOccupied?: boolean;
  hoaFeeCents?: number;
  /** The full provider response, kept for fields this app doesn't model explicitly. */
  raw: unknown;
}

export interface WatchedProperty {
  id: number;
  address: string;
  createdAt: string;
}

// One point-in-time snapshot for a watched property. Append-only — a refresh
// always inserts a new row, never edits an existing one.
export interface PropertySnapshot {
  id: number;
  watchedPropertyId: number;
  source: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  yearBuilt?: number;
  lotSize?: number;
  taxAssessmentYear?: number;
  taxAssessedValueCents?: number;
  annualTaxYear?: number;
  annualTaxCents?: number;
  lastSaleDate?: string;
  lastSalePriceCents?: number;
  raw: unknown;
  fetchedAt: string;
}
