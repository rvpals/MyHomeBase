import { describe, expect, it } from "vitest";
import type { Module } from "../modules/types";
import { groupTablesByModule } from "./module-tables";

/** A registry row, with only the fields the grouping reads spelled out. */
function moduleRow(slug: string, shortName: string, sequence: number): Module {
  return {
    id: sequence,
    slug,
    shortName,
    longName: shortName,
    sequence,
    isVisible: true,
    icon: "chart",
    hasCarouselImage: false,
  };
}

const MODULES: Module[] = [
  moduleRow("investments", "Investments", 2),
  moduleRow("journal", "Journal", 3),
  moduleRow("games", "Games", 8),
];

function groupNames(groups: { label: string }[]): string[] {
  return groups.map((group) => group.label);
}

function tablesOf(groups: { key: string; tables: { name: string }[] }[], key: string): string[] {
  return groups.find((group) => group.key === key)?.tables.map((table) => table.name) ?? [];
}

describe("groupTablesByModule", () => {
  it("groups a table under the module its prefix maps to", () => {
    const groups = groupTablesByModule(
      ["inv_tax_lots", "inv_stock_positions", "jrn_entries"],
      MODULES,
    );

    expect(tablesOf(groups, "investments")).toEqual(["inv_stock_positions", "inv_tax_lots"]);
    expect(tablesOf(groups, "journal")).toEqual(["jrn_entries"]);
  });

  it("orders groups by the module sequence, with Non-Modules last", () => {
    const groups = groupTablesByModule(["jrn_entries", "sys_users"], MODULES);

    expect(groupNames(groups)).toEqual(["Investments", "Journal", "Games", "Non-Modules"]);
  });

  it("keeps a module that owns no tables, rather than dropping it", () => {
    const groups = groupTablesByModule(["jrn_entries"], MODULES);
    const games = groups.find((group) => group.key === "games");

    expect(games).toBeDefined();
    expect(games?.tables).toEqual([]);
  });

  it("puts the platform, icon and unprefixed tables in Non-Modules", () => {
    const groups = groupTablesByModule(
      ["sys_users", "ico_slot_overrides", "migrations", "jrn_entries"],
      MODULES,
    );

    expect(tablesOf(groups, "non-modules")).toEqual([
      "ico_slot_overrides",
      "migrations",
      "sys_users",
    ]);
  });

  it("takes the heading from the registry, so a renamed module follows", () => {
    const renamed = [moduleRow("journal", "Daily Log", 3)];
    const groups = groupTablesByModule(["jrn_entries"], renamed);

    expect(groupNames(groups)).toEqual(["Daily Log", "Non-Modules"]);
    expect(tablesOf(groups, "journal")).toEqual(["jrn_entries"]);
  });

  it("treats a runtime csv_ dataset as a CSV Analysis table", () => {
    const withCsv = [...MODULES, moduleRow("csv-analysis", "CSV Analysis", 4)];
    const groups = groupTablesByModule(["csv_analytics_entries", "csv_sales_2024"], withCsv);

    expect(tablesOf(groups, "csv-analysis")).toEqual([
      "csv_analytics_entries",
      "csv_sales_2024",
    ]);
  });

  it("carries the reference description when the table is documented", () => {
    const groups = groupTablesByModule(["jrn_entries", "csv_sales_2024"], MODULES);
    const entries = groups.find((group) => group.key === "journal")?.tables[0];

    expect(entries?.description).toContain("One journal entry");
  });

  it("leaves an undocumented table's description undefined", () => {
    const groups = groupTablesByModule(["zzz_hand_made"], MODULES);

    expect(groups.find((group) => group.key === "non-modules")?.tables[0]).toEqual({
      name: "zzz_hand_made",
      description: undefined,
    });
  });

  it("sends a table whose module isn't registered to Non-Modules", () => {
    // The Expense module's tables exist but nobody registered the module — the
    // tables must still be reachable somewhere.
    const groups = groupTablesByModule(["exp_transactions"], MODULES);

    expect(tablesOf(groups, "non-modules")).toEqual(["exp_transactions"]);
  });

  it("reports the prefix a module's tables carry", () => {
    const groups = groupTablesByModule([], MODULES);

    expect(groups.find((group) => group.key === "investments")?.prefix).toBe("inv_");
    expect(groups.find((group) => group.key === "non-modules")?.prefix).toBe("");
  });
});
