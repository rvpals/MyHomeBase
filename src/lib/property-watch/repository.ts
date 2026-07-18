import type Database from "better-sqlite3";
import type { WatchedPropertyRepository } from "./ports";
import type { PropertyDetails, PropertySnapshot, WatchedProperty } from "./types";

interface WatchedPropertyRow {
  id: number;
  address: string;
  created_at: string;
}

interface PropertySnapshotRow {
  id: number;
  watched_property_id: number;
  source: string;
  property_type: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  square_footage: number | null;
  year_built: number | null;
  lot_size: number | null;
  tax_assessment_year: number | null;
  tax_assessed_value_cents: number | null;
  annual_tax_year: number | null;
  annual_tax_cents: number | null;
  last_sale_date: string | null;
  last_sale_price_cents: number | null;
  raw_data: string;
  fetched_at: string;
}

function toWatchedProperty(row: WatchedPropertyRow): WatchedProperty {
  return { id: row.id, address: row.address, createdAt: row.created_at };
}

function toSnapshot(row: PropertySnapshotRow): PropertySnapshot {
  return {
    id: row.id,
    watchedPropertyId: row.watched_property_id,
    source: row.source,
    propertyType: row.property_type ?? undefined,
    bedrooms: row.bedrooms ?? undefined,
    bathrooms: row.bathrooms ?? undefined,
    squareFootage: row.square_footage ?? undefined,
    yearBuilt: row.year_built ?? undefined,
    lotSize: row.lot_size ?? undefined,
    taxAssessmentYear: row.tax_assessment_year ?? undefined,
    taxAssessedValueCents: row.tax_assessed_value_cents ?? undefined,
    annualTaxYear: row.annual_tax_year ?? undefined,
    annualTaxCents: row.annual_tax_cents ?? undefined,
    lastSaleDate: row.last_sale_date ?? undefined,
    lastSalePriceCents: row.last_sale_price_cents ?? undefined,
    raw: JSON.parse(row.raw_data),
    fetchedAt: row.fetched_at,
  };
}

// The real repository. Swap the database without touching any use-case.
export class SqliteWatchedPropertyRepository implements WatchedPropertyRepository {
  constructor(private db: Database.Database) {}

  listWatchedProperties(): WatchedProperty[] {
    const rows = this.db
      .prepare("SELECT * FROM watched_properties ORDER BY created_at ASC")
      .all() as WatchedPropertyRow[];
    return rows.map(toWatchedProperty);
  }

  getWatchedPropertyById(id: number): WatchedProperty | undefined {
    const row = this.db.prepare("SELECT * FROM watched_properties WHERE id = ?").get(id) as
      | WatchedPropertyRow
      | undefined;
    return row ? toWatchedProperty(row) : undefined;
  }

  getWatchedPropertyByAddress(address: string): WatchedProperty | undefined {
    const row = this.db
      .prepare("SELECT * FROM watched_properties WHERE address = ?")
      .get(address) as WatchedPropertyRow | undefined;
    return row ? toWatchedProperty(row) : undefined;
  }

  addWatchedProperty(address: string): WatchedProperty {
    const result = this.db
      .prepare("INSERT INTO watched_properties (address) VALUES (?)")
      .run(address);
    const created = this.getWatchedPropertyById(Number(result.lastInsertRowid));
    if (!created) throw new Error("Failed to read back newly watched property.");
    return created;
  }

  removeWatchedProperty(id: number): void {
    const removeTransaction = this.db.transaction((watchedPropertyId: number) => {
      this.db.prepare("DELETE FROM property_snapshots WHERE watched_property_id = ?").run(watchedPropertyId);
      this.db.prepare("DELETE FROM watched_properties WHERE id = ?").run(watchedPropertyId);
    });
    removeTransaction(id);
  }

  addSnapshot(watchedPropertyId: number, source: string, details: PropertyDetails): PropertySnapshot {
    const result = this.db
      .prepare(
        `INSERT INTO property_snapshots (
           watched_property_id, source, property_type, bedrooms, bathrooms, square_footage,
           year_built, lot_size, tax_assessment_year, tax_assessed_value_cents,
           annual_tax_year, annual_tax_cents, last_sale_date, last_sale_price_cents, raw_data
         ) VALUES (
           @watchedPropertyId, @source, @propertyType, @bedrooms, @bathrooms, @squareFootage,
           @yearBuilt, @lotSize, @taxAssessmentYear, @taxAssessedValueCents,
           @annualTaxYear, @annualTaxCents, @lastSaleDate, @lastSalePriceCents, @rawData
         )`,
      )
      .run({
        watchedPropertyId,
        source,
        propertyType: details.propertyType ?? null,
        bedrooms: details.bedrooms ?? null,
        bathrooms: details.bathrooms ?? null,
        squareFootage: details.squareFootage ?? null,
        yearBuilt: details.yearBuilt ?? null,
        lotSize: details.lotSize ?? null,
        taxAssessmentYear: details.latestTaxAssessment?.year ?? null,
        taxAssessedValueCents: details.latestTaxAssessment?.valueCents ?? null,
        annualTaxYear: details.latestAnnualTax?.year ?? null,
        annualTaxCents: details.latestAnnualTax?.amountCents ?? null,
        lastSaleDate: details.lastSaleDate ?? null,
        lastSalePriceCents: details.lastSalePriceCents ?? null,
        rawData: JSON.stringify(details.raw),
      });

    const row = this.db
      .prepare("SELECT * FROM property_snapshots WHERE id = ?")
      .get(Number(result.lastInsertRowid)) as PropertySnapshotRow;
    return toSnapshot(row);
  }

  listSnapshotsForWatchedProperty(watchedPropertyId: number): PropertySnapshot[] {
    const rows = this.db
      .prepare("SELECT * FROM property_snapshots WHERE watched_property_id = ? ORDER BY fetched_at DESC")
      .all(watchedPropertyId) as PropertySnapshotRow[];
    return rows.map(toSnapshot);
  }
}
