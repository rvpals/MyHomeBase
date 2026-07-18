import type Database from "better-sqlite3";
import type { PropertyRepository } from "./ports";
import { propertySchema } from "./schema";
import type { CreatePropertyInput, UpdatePropertyInput } from "./schema";
import type { Property } from "./types";

interface PropertyRow {
  id: number;
  address: string;
  purchase_price_cents: number;
  purchase_date: string;
  current_value_cents: number;
  mortgage_balance_cents: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function toDomain(row: PropertyRow): Property {
  return propertySchema.parse({
    id: row.id,
    address: row.address,
    purchasePriceCents: row.purchase_price_cents,
    purchaseDate: row.purchase_date,
    currentValueCents: row.current_value_cents,
    mortgageBalanceCents: row.mortgage_balance_cents,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

// The real repository. Swap the database without touching any use-case.
export class SqlitePropertyRepository implements PropertyRepository {
  constructor(private db: Database.Database) {}

  listProperties(): Property[] {
    const rows = this.db
      .prepare("SELECT * FROM properties ORDER BY created_at ASC")
      .all() as PropertyRow[];
    return rows.map(toDomain);
  }

  getPropertyById(id: number): Property | undefined {
    const row = this.db.prepare("SELECT * FROM properties WHERE id = ?").get(id) as
      | PropertyRow
      | undefined;
    return row ? toDomain(row) : undefined;
  }

  createProperty(input: CreatePropertyInput): Property {
    const result = this.db
      .prepare(
        `INSERT INTO properties (address, purchase_price_cents, purchase_date, current_value_cents, mortgage_balance_cents, notes)
         VALUES (@address, @purchasePriceCents, @purchaseDate, @currentValueCents, @mortgageBalanceCents, @notes)`,
      )
      .run({
        address: input.address,
        purchasePriceCents: input.purchasePriceCents,
        purchaseDate: input.purchaseDate,
        currentValueCents: input.currentValueCents,
        mortgageBalanceCents: input.mortgageBalanceCents,
        notes: input.notes ?? null,
      });

    const created = this.getPropertyById(Number(result.lastInsertRowid));
    if (!created) throw new Error("Failed to read back newly created property.");
    return created;
  }

  updateProperty(id: number, input: UpdatePropertyInput): Property {
    this.db
      .prepare(
        `UPDATE properties
         SET address = @address,
             purchase_price_cents = @purchasePriceCents,
             purchase_date = @purchaseDate,
             current_value_cents = @currentValueCents,
             mortgage_balance_cents = @mortgageBalanceCents,
             notes = @notes
         WHERE id = @id`,
      )
      .run({
        id,
        address: input.address,
        purchasePriceCents: input.purchasePriceCents,
        purchaseDate: input.purchaseDate,
        currentValueCents: input.currentValueCents,
        mortgageBalanceCents: input.mortgageBalanceCents,
        notes: input.notes ?? null,
      });

    const updated = this.getPropertyById(id);
    if (!updated) throw new Error(`Failed to read back updated property ${id}.`);
    return updated;
  }

  deleteProperty(id: number): void {
    this.db.prepare("DELETE FROM properties WHERE id = ?").run(id);
  }
}
