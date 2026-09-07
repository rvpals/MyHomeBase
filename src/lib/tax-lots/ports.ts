import type { CreateTaxLotInput, UpdateTaxLotInput } from "./schema";
import type { TaxLot } from "./types";

/**
 * Storage for historical purchase lots.
 *
 * Deliberately CRUD-only: every calculation in this module is a pure function over
 * the rows this returns, so there is no aggregate query here to keep the maths in
 * one place rather than half in SQL and half in TypeScript.
 */
export interface TaxLotRepository {
  /** Every lot, or only one ticker's when `ticker` is given. Oldest buy date first. */
  listLots(ticker?: string): TaxLot[];
  getLotById(id: number): TaxLot | undefined;
  /** Every ticker holding at least one lot, sorted. */
  listTickers(): string[];
  createLot(input: CreateTaxLotInput): TaxLot;
  updateLot(id: number, input: UpdateTaxLotInput): TaxLot;
  deleteLot(id: number): void;
}
