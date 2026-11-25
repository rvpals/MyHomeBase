import type { CreateTBillPurchaseInput, UpdateTBillPurchaseInput } from "./schema";
import type { TBillPurchase } from "./types";

export interface TBillRepository {
  /** Newest purchase date first. */
  listPurchases(): TBillPurchase[];
  getPurchaseById(id: number): TBillPurchase | undefined;
  createPurchase(input: CreateTBillPurchaseInput): TBillPurchase;
  updatePurchase(id: number, input: UpdateTBillPurchaseInput): TBillPurchase;
  deletePurchase(id: number): void;
  /**
   * How many purchases are already stored for each `(symbol, purchase date)` key.
   *
   * Read **once, before** a CSV run rather than per row: rows the run itself
   * inserts must not inflate the baseline, or the second legitimate identical row
   * in one file looks like a duplicate of the first. The symbol is keyed
   * lower-cased, since a file writing `912797ls4` means the same bill as `912797LS4`.
   */
  countsBySymbolAndDate(): Map<string, number>;
}
