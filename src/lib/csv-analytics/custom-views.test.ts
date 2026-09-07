import { beforeEach, describe, expect, it } from "vitest";
import { createEntry } from "./csv-analytics";
import {
  createCustomView,
  deleteCustomView,
  getCustomViewById,
  listAllCustomViews,
  listCustomViews,
  listEnabledCustomViews,
  readCustomViewPage,
  setCustomViewEnabled,
  updateCustomView,
} from "./custom-views";
import { fakeCsvAnalyticsRepo } from "./fake-repository";
import type { CsvAnalyticsRepository } from "./ports";
import type { CreateCsvCustomViewInput } from "./schema";

const SALES_CSV = [
  "City,Amount,Qty",
  "Rome,150,3",
  "Oslo,90,1",
  "Lima,220,7",
  "Rome,40,2",
  ",70,4",
].join("\n");

let repo: CsvAnalyticsRepository;
let entryId: number;

beforeEach(() => {
  repo = fakeCsvAnalyticsRepo();
  const entry = createEntry(repo, {
    name: "Sales",
    description: undefined,
    tableBaseName: "sales",
    columns: [
      { name: "city", sourceHeader: "City", type: "text" },
      { name: "amount", sourceHeader: "Amount", type: "integer" },
      { name: "qty", sourceHeader: "Qty", type: "integer" },
    ],
    primaryKeyFields: [],
    fileText: SALES_CSV,
  });
  entryId = entry.id;
});

function viewInput(overrides: Partial<CreateCsvCustomViewInput> = {}): CreateCsvCustomViewInput {
  return {
    entryId,
    name: "Big sales",
    description: undefined,
    selectedColumns: [],
    criteria: [],
    orderBy: [],
    recordsPerPage: 100,
    isEnabled: true,
    ...overrides,
  };
}

describe("createCustomView", () => {
  it("saves a view against its entry and reads it back", () => {
    const created = createCustomView(
      repo,
      viewInput({
        description: "Everything over 100",
        selectedColumns: ["city", "amount"],
        criteria: [{ column: "amount", operator: "greaterThan", values: ["100"] }],
        orderBy: [{ column: "amount", direction: "desc" }],
        recordsPerPage: 25,
      }),
    );

    expect(created.id).toBeGreaterThan(0);
    expect(created.entryId).toBe(entryId);
    expect(created.name).toBe("Big sales");
    expect(created.description).toBe("Everything over 100");
    expect(created.selectedColumns).toEqual(["city", "amount"]);
    expect(created.recordsPerPage).toBe(25);
    expect(created.isEnabled).toBe(true);
    expect(getCustomViewById(repo, created.id)).toEqual(created);
  });

  it("defaults to enabled, all columns, no criteria and 100 a page", () => {
    // The schema's defaults are the contract for a view built without touching the
    // optional parts of the builder — the common case.
    const created = createCustomView(repo, {
      entryId,
      name: "Everything",
    } as CreateCsvCustomViewInput);
    expect(created.isEnabled).toBe(true);
    expect(created.selectedColumns).toEqual([]);
    expect(created.criteria).toEqual([]);
    expect(created.orderBy).toEqual([]);
    expect(created.recordsPerPage).toBe(100);
  });

  it("rejects an unknown entry", () => {
    expect(() => createCustomView(repo, viewInput({ entryId: 999 }))).toThrow(
      /entry 999 not found/i,
    );
  });

  it("rejects a criterion on a column the entry doesn't have", () => {
    expect(() =>
      createCustomView(
        repo,
        viewInput({ criteria: [{ column: "region", operator: "equals", values: ["EU"] }] }),
      ),
    ).toThrow(/no column named "region"/i);
  });

  it("rejects a selected column the entry doesn't have", () => {
    expect(() => createCustomView(repo, viewInput({ selectedColumns: ["region"] }))).toThrow(
      /no column named "region"/i,
    );
  });

  it("rejects an order-by on a column the entry doesn't have", () => {
    expect(() =>
      createCustomView(repo, viewInput({ orderBy: [{ column: "region", direction: "asc" }] })),
    ).toThrow(/no column named "region"/i);
  });

  it("rejects a criterion missing the value its operator needs", () => {
    expect(() =>
      createCustomView(
        repo,
        viewInput({ criteria: [{ column: "amount", operator: "greaterThan", values: [] }] }),
      ),
    ).toThrow(/needs a value/i);
  });

  it("rejects a between with only one bound", () => {
    expect(() =>
      createCustomView(
        repo,
        viewInput({ criteria: [{ column: "amount", operator: "between", values: ["10"] }] }),
      ),
    ).toThrow(/needs a value/i);
  });

  it("accepts a no-value operator with no values", () => {
    const created = createCustomView(
      repo,
      viewInput({ criteria: [{ column: "city", operator: "isEmpty", values: [] }] }),
    );
    expect(created.criteria).toHaveLength(1);
  });

  it("rejects the same column twice in the order by", () => {
    // SQLite accepts it and the second mention does nothing, which reads as a bug.
    expect(() =>
      createCustomView(
        repo,
        viewInput({
          orderBy: [
            { column: "amount", direction: "asc" },
            { column: "amount", direction: "desc" },
          ],
        }),
      ),
    ).toThrow(/appears twice/i);
  });

  it("rejects a duplicate name within the same entry", () => {
    createCustomView(repo, viewInput({ name: "Big sales" }));
    expect(() => createCustomView(repo, viewInput({ name: "Big sales" }))).toThrow(
      /already exists for this dataset/i,
    );
  });

  it("allows the same name on a different entry", () => {
    createCustomView(repo, viewInput({ name: "Big sales" }));
    const other = createEntry(repo, {
      name: "Other",
      description: undefined,
      tableBaseName: "other",
      columns: [{ name: "city", sourceHeader: "City", type: "text" }],
      primaryKeyFields: [],
      fileText: "City\nRome",
    });
    expect(
      createCustomView(repo, viewInput({ entryId: other.id, name: "Big sales" })).name,
    ).toBe("Big sales");
  });

  it("rejects a page size outside the allowed range", () => {
    expect(() => createCustomView(repo, viewInput({ recordsPerPage: 0 }))).toThrow();
    expect(() => createCustomView(repo, viewInput({ recordsPerPage: 5000 }))).toThrow();
  });

  it("rejects a blank name", () => {
    expect(() => createCustomView(repo, viewInput({ name: "" }))).toThrow();
  });
});

describe("updateCustomView", () => {
  it("replaces the whole definition", () => {
    const created = createCustomView(
      repo,
      viewInput({ criteria: [{ column: "amount", operator: "greaterThan", values: ["100"] }] }),
    );
    const updated = updateCustomView(repo, created.id, {
      name: "Renamed",
      description: undefined,
      selectedColumns: ["city"],
      criteria: [],
      orderBy: [{ column: "city", direction: "asc" }],
      recordsPerPage: 10,
      isEnabled: false,
    });

    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe("Renamed");
    expect(updated.criteria).toEqual([]);
    expect(updated.selectedColumns).toEqual(["city"]);
    expect(updated.recordsPerPage).toBe(10);
    expect(updated.isEnabled).toBe(false);
    // The entry a view belongs to is not part of an update.
    expect(updated.entryId).toBe(entryId);
  });

  it("lets a view keep its own name", () => {
    const created = createCustomView(repo, viewInput({ name: "Big sales" }));
    expect(
      updateCustomView(repo, created.id, {
        name: "Big sales",
        description: undefined,
        selectedColumns: [],
        criteria: [],
        orderBy: [],
        recordsPerPage: 100,
        isEnabled: true,
      }).name,
    ).toBe("Big sales");
  });

  it("rejects renaming onto another view's name", () => {
    createCustomView(repo, viewInput({ name: "Taken" }));
    const second = createCustomView(repo, viewInput({ name: "Free" }));
    expect(() =>
      updateCustomView(repo, second.id, {
        name: "Taken",
        description: undefined,
        selectedColumns: [],
        criteria: [],
        orderBy: [],
        recordsPerPage: 100,
        isEnabled: true,
      }),
    ).toThrow(/already exists/i);
  });

  it("rejects an unknown view", () => {
    expect(() =>
      updateCustomView(repo, 999, {
        name: "Nope",
        description: undefined,
        selectedColumns: [],
        criteria: [],
        orderBy: [],
        recordsPerPage: 100,
        isEnabled: true,
      }),
    ).toThrow(/Custom view 999 not found/i);
  });

  it("validates the new definition against the entry", () => {
    const created = createCustomView(repo, viewInput());
    expect(() =>
      updateCustomView(repo, created.id, {
        name: "Big sales",
        description: undefined,
        selectedColumns: ["region"],
        criteria: [],
        orderBy: [],
        recordsPerPage: 100,
        isEnabled: true,
      }),
    ).toThrow(/no column named "region"/i);
  });
});

describe("setCustomViewEnabled", () => {
  it("flips the flag and leaves the definition alone", () => {
    const created = createCustomView(
      repo,
      viewInput({ criteria: [{ column: "amount", operator: "greaterThan", values: ["100"] }] }),
    );
    const disabled = setCustomViewEnabled(repo, created.id, false);
    expect(disabled.isEnabled).toBe(false);
    expect(disabled.criteria).toEqual(created.criteria);
    expect(setCustomViewEnabled(repo, created.id, true).isEnabled).toBe(true);
  });

  it("rejects an unknown view", () => {
    expect(() => setCustomViewEnabled(repo, 999, false)).toThrow(/Custom view 999 not found/i);
  });
});

describe("listing", () => {
  it("lists an entry's views, disabled ones included", () => {
    const first = createCustomView(repo, viewInput({ name: "A" }));
    createCustomView(repo, viewInput({ name: "B", isEnabled: false }));
    setCustomViewEnabled(repo, first.id, true);
    expect(listCustomViews(repo, entryId).map((view) => view.name)).toEqual(["A", "B"]);
  });

  it("offers only enabled views to an entry's dropdown", () => {
    createCustomView(repo, viewInput({ name: "A" }));
    createCustomView(repo, viewInput({ name: "B", isEnabled: false }));
    expect(listEnabledCustomViews(repo, entryId).map((view) => view.name)).toEqual(["A"]);
  });

  it("does not leak another entry's views", () => {
    createCustomView(repo, viewInput({ name: "Mine" }));
    const other = createEntry(repo, {
      name: "Other",
      description: undefined,
      tableBaseName: "other",
      columns: [{ name: "city", sourceHeader: "City", type: "text" }],
      primaryKeyFields: [],
      fileText: "City\nRome",
    });
    createCustomView(repo, viewInput({ entryId: other.id, name: "Theirs" }));

    expect(listCustomViews(repo, entryId).map((view) => view.name)).toEqual(["Mine"]);
    expect(listAllCustomViews(repo).map((view) => view.name)).toEqual(["Mine", "Theirs"]);
  });
});

describe("deleteCustomView", () => {
  it("removes the view", () => {
    const created = createCustomView(repo, viewInput());
    deleteCustomView(repo, created.id);
    expect(getCustomViewById(repo, created.id)).toBeUndefined();
    expect(listCustomViews(repo, entryId)).toEqual([]);
  });

  it("is a no-op for an id that isn't there", () => {
    expect(() => deleteCustomView(repo, 999)).not.toThrow();
  });

  it("frees the name for reuse", () => {
    const created = createCustomView(repo, viewInput({ name: "Big sales" }));
    deleteCustomView(repo, created.id);
    expect(createCustomView(repo, viewInput({ name: "Big sales" })).name).toBe("Big sales");
  });
});

describe("readCustomViewPage", () => {
  it("filters, orders and projects in one read", () => {
    const view = createCustomView(
      repo,
      viewInput({
        selectedColumns: ["city", "amount"],
        criteria: [{ column: "amount", operator: "greaterThan", values: ["50"] }],
        orderBy: [{ column: "amount", direction: "desc" }],
      }),
    );

    const page = readCustomViewPage(repo, { viewId: view.id, page: 1 });
    expect(page.columns.map((column) => column.name)).toEqual(["city", "amount"]);
    expect(page.rows).toEqual([
      ["Lima", 220],
      ["Rome", 150],
      ["Oslo", 90],
      [null, 70],
    ]);
    expect(page.totalRows).toBe(4);
  });

  it("reports a page count over the filtered total, not the table", () => {
    const view = createCustomView(
      repo,
      viewInput({
        criteria: [{ column: "amount", operator: "greaterThan", values: ["50"] }],
        recordsPerPage: 2,
      }),
    );
    const page = readCustomViewPage(repo, { viewId: view.id, page: 1 });
    expect(page.totalRows).toBe(4);
    expect(page.pageCount).toBe(2);
    expect(page.rows).toHaveLength(2);
    expect(page.recordsPerPage).toBe(2);
  });

  it("returns the requested page", () => {
    const view = createCustomView(
      repo,
      viewInput({ orderBy: [{ column: "amount", direction: "asc" }], recordsPerPage: 2 }),
    );
    const second = readCustomViewPage(repo, { viewId: view.id, page: 2 });
    expect(second.page).toBe(2);
    expect(second.rows.map((row) => row[1])).toEqual([90, 150]);
  });

  it("defaults to page 1", () => {
    const view = createCustomView(repo, viewInput({ recordsPerPage: 2 }));
    expect(readCustomViewPage(repo, { viewId: view.id }).page).toBe(1);
  });

  it("calls an empty result one page, not zero", () => {
    // The pager still needs a page to be on.
    const view = createCustomView(
      repo,
      viewInput({ criteria: [{ column: "amount", operator: "greaterThan", values: ["9999"] }] }),
    );
    const page = readCustomViewPage(repo, { viewId: view.id, page: 1 });
    expect(page.rows).toEqual([]);
    expect(page.totalRows).toBe(0);
    expect(page.pageCount).toBe(1);
  });

  it("matches an empty cell with isEmpty", () => {
    const view = createCustomView(
      repo,
      viewInput({ criteria: [{ column: "city", operator: "isEmpty", values: [] }] }),
    );
    expect(readCustomViewPage(repo, { viewId: view.id, page: 1 }).totalRows).toBe(1);
  });

  it("refuses a disabled view", () => {
    // Disabling takes a view out of circulation, so a card still holding a stale
    // selection must not keep working — the caller falls back to the raw table.
    const view = createCustomView(repo, viewInput());
    setCustomViewEnabled(repo, view.id, false);
    expect(() => readCustomViewPage(repo, { viewId: view.id, page: 1 })).toThrow(/is disabled/i);
  });

  it("rejects an unknown view", () => {
    expect(() => readCustomViewPage(repo, { viewId: 999, page: 1 })).toThrow(
      /Custom view 999 not found/i,
    );
  });

  it("rejects a page below 1", () => {
    const view = createCustomView(repo, viewInput());
    expect(() => readCustomViewPage(repo, { viewId: view.id, page: 0 })).toThrow();
  });
});

describe("deleting an entry", () => {
  it("takes its custom views with it", () => {
    const view = createCustomView(repo, viewInput());
    repo.deleteEntry(entryId);
    expect(getCustomViewById(repo, view.id)).toBeUndefined();
    expect(listAllCustomViews(repo)).toEqual([]);
  });
});
