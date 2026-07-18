import { describe, expect, it } from "vitest";
import { normalizeRentCastProperty, type RentCastPropertyRecord } from "./rentcast-client";

const sampleRecord: RentCastPropertyRecord = {
  formattedAddress: "1600 Pennsylvania Ave NW, Washington, DC 20500",
  propertyType: "Single Family",
  bedrooms: 4,
  bathrooms: 3.5,
  squareFootage: 2800,
  yearBuilt: 1955,
  lotSize: 6000,
  county: "District of Columbia",
  subdivision: "Downtown",
  zoning: "R-1",
  taxAssessments: {
    "2022": { year: 2022, value: 500000, land: 200000, improvements: 300000 },
    "2023": { year: 2023, value: 520000, land: 210000, improvements: 310000 },
  },
  propertyTaxes: {
    "2022": { year: 2022, total: 6000 },
    "2023": { year: 2023, total: 6200 },
  },
  lastSaleDate: "2015-06-01",
  lastSalePrice: 450000,
  history: {
    "2015-06-01": { event: "Sale", date: "2015-06-01", price: 450000 },
    "2005-03-15": { event: "Sale", date: "2005-03-15", price: 300000 },
  },
  owner: { names: ["Jane Doe"], type: "Individual" },
  ownerOccupied: true,
  hoa: { fee: 150 },
};

describe("normalizeRentCastProperty", () => {
  it("picks the latest year for tax assessment and annual tax, converted to cents", () => {
    const details = normalizeRentCastProperty("1600 Pennsylvania Ave NW", sampleRecord);
    expect(details.latestTaxAssessment).toEqual({
      year: 2023,
      valueCents: 52000000,
      landCents: 21000000,
      improvementsCents: 31000000,
    });
    expect(details.latestAnnualTax).toEqual({ year: 2023, amountCents: 620000 });
  });

  it("sorts sale history newest first and converts prices to cents", () => {
    const details = normalizeRentCastProperty("1600 Pennsylvania Ave NW", sampleRecord);
    expect(details.saleHistory).toEqual([
      { event: "Sale", date: "2015-06-01", priceCents: 45000000 },
      { event: "Sale", date: "2005-03-15", priceCents: 30000000 },
    ]);
  });

  it("maps owner, HOA, and last sale fields", () => {
    const details = normalizeRentCastProperty("1600 Pennsylvania Ave NW", sampleRecord);
    expect(details.ownerNames).toEqual(["Jane Doe"]);
    expect(details.ownerType).toBe("Individual");
    expect(details.ownerOccupied).toBe(true);
    expect(details.hoaFeeCents).toBe(15000);
    expect(details.lastSaleDate).toBe("2015-06-01");
    expect(details.lastSalePriceCents).toBe(45000000);
  });

  it("falls back to the input address when formattedAddress is missing", () => {
    const details = normalizeRentCastProperty("123 Fallback St", {});
    expect(details.address).toBe("123 Fallback St");
  });

  it("leaves tax assessment and annual tax undefined when no records exist", () => {
    const details = normalizeRentCastProperty("123 Fallback St", {});
    expect(details.latestTaxAssessment).toBeUndefined();
    expect(details.latestAnnualTax).toBeUndefined();
    expect(details.saleHistory).toEqual([]);
    expect(details.ownerNames).toEqual([]);
  });
});
