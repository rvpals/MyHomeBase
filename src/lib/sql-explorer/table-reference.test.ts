import { describe, expect, it } from "vitest";
import { buildTableReference, describeTable } from "./table-reference";

describe("describeTable", () => {
  it("returns the description of a documented table", () => {
    expect(describeTable("stk_stock_positions")).toContain("Current holdings");
  });

  it("returns undefined for a table the reference doesn't cover", () => {
    expect(describeTable("csv_sales_2024")).toBeUndefined();
  });
});

describe("buildTableReference", () => {
  it("groups documented tables under their module", () => {
    const groups = buildTableReference(["stk_stock_positions", "jrn_entries"]);

    expect(groups.map((group) => group.module)).toEqual(["Stocks & ETFs", "Journal"]);
    expect(groups[0].tables).toHaveLength(1);
    expect(groups[0].tables[0][0]).toBe("stk_stock_positions");
  });

  it("omits a group whose tables are all absent from the database", () => {
    const groups = buildTableReference(["jrn_entries"]);

    expect(groups.map((group) => group.module)).toEqual(["Journal"]);
  });

  it("collects an undocumented table into a trailing Unclassified group", () => {
    const groups = buildTableReference(["jrn_entries", "zzz_something_new"]);

    const last = groups[groups.length - 1];
    expect(last.module).toBe("Unclassified");
    expect(last.tables).toEqual([["zzz_something_new", "No description recorded."]]);
  });

  it("explains an undocumented csv_ table as an imported dataset", () => {
    const groups = buildTableReference(["csv_sales_2024"]);

    expect(groups[0].module).toBe("Unclassified");
    expect(groups[0].tables[0][1]).toContain("imported CSV dataset");
  });

  it("returns nothing for an empty database", () => {
    expect(buildTableReference([])).toEqual([]);
  });

  it("describes every table it groups", () => {
    const groups = buildTableReference(["sys_users", "gam_scores", "ico_slot_overrides"]);

    for (const group of groups) {
      for (const [name, description] of group.tables) {
        expect(description, `${name} has no description`).not.toBe("");
      }
    }
  });
});
