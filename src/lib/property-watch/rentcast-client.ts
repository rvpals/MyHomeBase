import type { PropertyLookupClient } from "./ports";
import type { PropertyDetails } from "./types";

const RENTCAST_API_BASE_URL = "https://api.rentcast.io/v1";

interface RentCastYearRecord {
  year: number;
  value?: number;
  land?: number;
  improvements?: number;
  total?: number;
}

interface RentCastHistoryEntry {
  event: string;
  date: string;
  price?: number;
}

// Shape of one entry in the RentCast /v1/properties response. Only the fields
// this app reads are declared — the rest passes through untouched via `raw`.
export interface RentCastPropertyRecord {
  formattedAddress?: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  yearBuilt?: number;
  lotSize?: number;
  county?: string;
  subdivision?: string;
  zoning?: string;
  taxAssessments?: Record<string, RentCastYearRecord>;
  propertyTaxes?: Record<string, RentCastYearRecord>;
  lastSaleDate?: string;
  lastSalePrice?: number;
  history?: Record<string, RentCastHistoryEntry>;
  owner?: { names?: string[]; type?: string };
  ownerOccupied?: boolean;
  hoa?: { fee?: number };
}

function dollarsToCentsIfPresent(dollars: number | undefined): number | undefined {
  return dollars === undefined ? undefined : Math.round(dollars * 100);
}

function latestByYear(record: Record<string, RentCastYearRecord> | undefined): RentCastYearRecord | undefined {
  const entries = Object.values(record ?? {});
  if (entries.length === 0) return undefined;
  return entries.reduce((latest, entry) => (entry.year > latest.year ? entry : latest));
}

/** Normalizes a raw RentCast property record into this app's PropertyDetails shape. Pure — no I/O. */
export function normalizeRentCastProperty(
  address: string,
  record: RentCastPropertyRecord,
): PropertyDetails {
  const latestTaxAssessment = latestByYear(record.taxAssessments);
  const latestAnnualTax = latestByYear(record.propertyTaxes);

  const saleHistory = Object.values(record.history ?? {})
    .map((entry) => ({
      event: entry.event,
      date: entry.date,
      priceCents: dollarsToCentsIfPresent(entry.price),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  return {
    address: record.formattedAddress ?? address,
    propertyType: record.propertyType,
    bedrooms: record.bedrooms,
    bathrooms: record.bathrooms,
    squareFootage: record.squareFootage,
    yearBuilt: record.yearBuilt,
    lotSize: record.lotSize,
    county: record.county,
    subdivision: record.subdivision,
    zoning: record.zoning,
    latestTaxAssessment:
      latestTaxAssessment?.value === undefined
        ? undefined
        : {
            year: latestTaxAssessment.year,
            valueCents: Math.round(latestTaxAssessment.value * 100),
            landCents: dollarsToCentsIfPresent(latestTaxAssessment.land),
            improvementsCents: dollarsToCentsIfPresent(latestTaxAssessment.improvements),
          },
    latestAnnualTax:
      latestAnnualTax?.total === undefined
        ? undefined
        : { year: latestAnnualTax.year, amountCents: Math.round(latestAnnualTax.total * 100) },
    lastSaleDate: record.lastSaleDate,
    lastSalePriceCents: dollarsToCentsIfPresent(record.lastSalePrice),
    saleHistory,
    ownerNames: record.owner?.names ?? [],
    ownerType: record.owner?.type,
    ownerOccupied: record.ownerOccupied,
    hoaFeeCents: dollarsToCentsIfPresent(record.hoa?.fee),
    raw: record,
  };
}

export interface RentCastClientConfig {
  apiKey: string;
}

// The real lookup client. Talks to the RentCast Property Records API
// (https://developers.rentcast.io) over HTTPS with an X-Api-Key header.
export class RentCastLookupClient implements PropertyLookupClient {
  constructor(private config: RentCastClientConfig) {}

  async lookup(address: string): Promise<PropertyDetails> {
    const url = `${RENTCAST_API_BASE_URL}/properties?address=${encodeURIComponent(address)}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json", "X-Api-Key": this.config.apiKey },
    });

    if (!response.ok) {
      throw new Error(`RentCast lookup failed (${response.status}): ${await response.text()}`);
    }

    const records = (await response.json()) as RentCastPropertyRecord[];
    const record = records[0];
    if (!record) throw new Error(`No property found for address "${address}".`);

    return normalizeRentCastProperty(address, record);
  }
}
