import { describe, expect, it } from "vitest";
import { bulkSetTaxonomy, describeBulkResult } from "./bulk";
import { createDocument } from "./documents";
import { FakeRepository } from "./test-fakes";

function setup() {
  const repo = new FakeRepository();
  const make = (title: string, categories: string[] = [], tags: string[] = []) =>
    createDocument(repo, { title, description: "", categories, tags }, 1);
  return { repo, make };
}

describe("bulkSetTaxonomy — add", () => {
  it("adds a category to every selected document", () => {
    const { repo, make } = setup();
    const a = make("Lease", ["Property"]);
    const b = make("Warranty", ["Appliance"]);

    const result = bulkSetTaxonomy(repo, {
      ids: [a.id, b.id],
      field: "categories",
      mode: "add",
      names: ["Tax 2026"],
    });

    expect(result.changedCount).toBe(2);
    expect(repo.getDocumentById(a.id)?.categories).toEqual(["Property", "Tax 2026"]);
    // Adding does not displace what was already filed — the whole reason "add" is a
    // separate mode from "replace".
    expect(repo.getDocumentById(b.id)?.categories).toEqual(["Appliance", "Tax 2026"]);
  });

  it("does not duplicate a name a document already holds", () => {
    const { repo, make } = setup();
    const a = make("Lease", ["Tax 2026"]);

    bulkSetTaxonomy(repo, {
      ids: [a.id],
      field: "categories",
      mode: "add",
      names: ["Tax 2026"],
    });

    expect(repo.getDocumentById(a.id)?.categories).toEqual(["Tax 2026"]);
  });

  it("treats an existing name case-insensitively", () => {
    const { repo, make } = setup();
    const a = make("Lease", ["Tax 2026"]);

    bulkSetTaxonomy(repo, {
      ids: [a.id],
      field: "categories",
      mode: "add",
      names: ["tax 2026"],
    });

    expect(repo.getDocumentById(a.id)?.categories).toEqual(["Tax 2026"]);
  });

  it("works on tags as well as categories", () => {
    const { repo, make } = setup();
    const a = make("Lease", [], ["house"]);

    bulkSetTaxonomy(repo, { ids: [a.id], field: "tags", mode: "add", names: ["2026"] });

    expect(repo.getDocumentById(a.id)?.tags).toEqual(["house", "2026"]);
    expect(repo.getDocumentById(a.id)?.categories).toEqual([]);
  });
});

describe("bulkSetTaxonomy — remove", () => {
  it("removes a category from every selected document and leaves the rest", () => {
    const { repo, make } = setup();
    const a = make("Lease", ["Property", "Tax 2026"]);
    const b = make("Warranty", ["Tax 2026"]);

    const result = bulkSetTaxonomy(repo, {
      ids: [a.id, b.id],
      field: "categories",
      mode: "remove",
      names: ["Tax 2026"],
    });

    expect(result.changedCount).toBe(2);
    expect(repo.getDocumentById(a.id)?.categories).toEqual(["Property"]);
    expect(repo.getDocumentById(b.id)?.categories).toEqual([]);
  });

  it("is a no-op for a document that does not hold the name", () => {
    const { repo, make } = setup();
    const a = make("Lease", ["Property"]);

    bulkSetTaxonomy(repo, {
      ids: [a.id],
      field: "categories",
      mode: "remove",
      names: ["Nothing"],
    });

    expect(repo.getDocumentById(a.id)?.categories).toEqual(["Property"]);
  });
});

describe("bulkSetTaxonomy — replace", () => {
  it("replaces the whole list rather than merging into it", () => {
    const { repo, make } = setup();
    const a = make("Lease", ["Property", "Old"]);

    bulkSetTaxonomy(repo, {
      ids: [a.id],
      field: "categories",
      mode: "replace",
      names: ["Tax 2026"],
    });

    expect(repo.getDocumentById(a.id)?.categories).toEqual(["Tax 2026"]);
  });

  it("clears the field when given no names", () => {
    const { repo, make } = setup();
    const a = make("Lease", ["Property"]);

    // The one call here that destroys information, and a real operation: "these are
    // uncategorised now". The caller confirms it; the use-case still permits it,
    // because refusing would leave no way to clear a field in bulk at all.
    const result = bulkSetTaxonomy(repo, {
      ids: [a.id],
      field: "categories",
      mode: "replace",
      names: [],
    });

    expect(result.changedCount).toBe(1);
    expect(repo.getDocumentById(a.id)?.categories).toEqual([]);
  });
});

describe("bulkSetTaxonomy — edges", () => {
  it("short-circuits an add of nothing rather than touching every row", () => {
    const { repo, make } = setup();
    const a = make("Lease", ["Property"]);

    const result = bulkSetTaxonomy(repo, {
      ids: [a.id],
      field: "categories",
      mode: "add",
      names: [],
    });

    // Reported as skipped, not changed: an overstated count is a lie the toast repeats.
    expect(result.changedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(repo.getDocumentById(a.id)?.categories).toEqual(["Property"]);
  });

  it("skips an id that no longer exists and keeps the count honest", () => {
    const { repo, make } = setup();
    const a = make("Lease");

    const result = bulkSetTaxonomy(repo, {
      ids: [a.id, 9999],
      field: "categories",
      mode: "add",
      names: ["Tax"],
    });

    expect(result.changedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
  });

  it("de-dupes a double-submitted selection", () => {
    const { repo, make } = setup();
    const a = make("Lease");

    const result = bulkSetTaxonomy(repo, {
      ids: [a.id, a.id],
      field: "categories",
      mode: "add",
      names: ["Tax"],
    });

    // Otherwise the returned count disagrees with what the reader was shown.
    expect(result.changedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
  });

  it("refuses an empty selection", () => {
    const { repo } = setup();

    expect(() =>
      bulkSetTaxonomy(repo, {
        ids: [],
        field: "categories",
        mode: "add",
        names: ["Tax"],
      }),
    ).toThrow(/at least one/i);
  });

  it("refuses an unknown mode", () => {
    const { repo, make } = setup();
    const a = make("Lease");

    expect(() =>
      bulkSetTaxonomy(repo, {
        ids: [a.id],
        field: "categories",
        // Not a mode — the boundary schema is what stops it reaching the repository.
        mode: "obliterate" as never,
        names: ["Tax"],
      }),
    ).toThrow();
  });

  it("drops blank names rather than filing under an empty category", () => {
    const { repo, make } = setup();
    const a = make("Lease");

    bulkSetTaxonomy(repo, {
      ids: [a.id],
      field: "categories",
      mode: "add",
      names: ["  ", "Tax"],
    });

    expect(repo.getDocumentById(a.id)?.categories).toEqual(["Tax"]);
  });
});

describe("describeBulkResult", () => {
  it("singularises one document", () => {
    expect(describeBulkResult({ changedCount: 1, skippedCount: 0 })).toBe("1 document updated");
  });

  it("pluralises several", () => {
    expect(describeBulkResult({ changedCount: 3, skippedCount: 0 })).toBe("3 documents updated");
  });

  it("mentions skipped rows when there were any", () => {
    expect(describeBulkResult({ changedCount: 2, skippedCount: 1 })).toBe(
      "2 documents updated, 1 skipped",
    );
  });

  it("says nothing about skips when there were none", () => {
    expect(describeBulkResult({ changedCount: 2, skippedCount: 0 })).not.toMatch(/skipped/);
  });
});
