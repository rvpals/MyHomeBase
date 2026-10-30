import { describe, expect, it } from "vitest";
import { excludeCategoriesFromStats, excludeCategoryTotals } from "./statistics";
import { expenseSettingsToEntries, resolveExpenseSettings } from "./settings";
import { excludedCategoriesSchema } from "./schema";
import type { CategoryTotal, ExpenseTransaction } from "./types";

function tx(id: number, categoryName: string): ExpenseTransaction {
  return { id, categoryName, amountCents: 100 } as ExpenseTransaction;
}

describe("excludeCategoriesFromStats", () => {
  const rows = [tx(1, "Food"), tx(2, "Payment"), tx(3, "")];

  it("drops rows in an excluded category", () => {
    expect(excludeCategoriesFromStats(rows, ["Payment"]).map((t) => t.id)).toEqual([1, 3]);
  });

  it("returns everything for an empty list or an unknown name", () => {
    expect(excludeCategoriesFromStats(rows, [])).toBe(rows);
    expect(excludeCategoriesFromStats(rows, ["Nope"])).toHaveLength(3);
  });

  it("never treats a blank entry as 'uncategorised'", () => {
    expect(excludeCategoriesFromStats(rows, [""])).toBe(rows);
  });
});

describe("excludeCategoryTotals", () => {
  it("drops excluded categories", () => {
    const totals: CategoryTotal[] = [
      { categoryName: "Food", totalCents: 5, transactionCount: 1 },
      { categoryName: "Payment", totalCents: -9, transactionCount: 2 },
    ];
    expect(excludeCategoryTotals(totals, ["Payment"])).toEqual([totals[0]]);
  });
});

describe("statsExcludedCategories setting", () => {
  it("round-trips through entries, including names with commas", () => {
    const settings = resolveExpenseSettings([]);
    settings.statsExcludedCategories = ["Payment", "Food, Dining"];
    const rows = expenseSettingsToEntries(settings).map((entry, index) => ({
      id: index + 1,
      moduleId: 5,
      key: entry.key,
      value: entry.value,
    }));
    expect(resolveExpenseSettings(rows).statsExcludedCategories).toEqual([
      "Payment",
      "Food, Dining",
    ]);
  });

  it("defaults to none, and ignores malformed values", () => {
    expect(resolveExpenseSettings([]).statsExcludedCategories).toEqual([]);
    const bad = [{ id: 1, moduleId: 5, key: "stats_excluded_categories", value: "not json" }];
    expect(resolveExpenseSettings(bad).statsExcludedCategories).toEqual([]);
  });

  it("omits the entry when the list is empty", () => {
    const keys = expenseSettingsToEntries(resolveExpenseSettings([])).map((e) => e.key);
    expect(keys).not.toContain("stats_excluded_categories");
  });
});

describe("excludedCategoriesSchema", () => {
  it("trims and de-duplicates", () => {
    expect(excludedCategoriesSchema.parse([" Payment ", "Payment", "Food"])).toEqual([
      "Payment",
      "Food",
    ]);
  });

  it("rejects non-arrays", () => {
    expect(excludedCategoriesSchema.safeParse("Payment").success).toBe(false);
  });
});
