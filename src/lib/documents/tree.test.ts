import { describe, expect, it } from "vitest";
import {
  UNCATEGORIZED_ID,
  UNCATEGORIZED_LABEL,
  attachTagIcons,
  buildDocumentTree,
  isInTreeSelection,
  treeSelectionFilter,
} from "./tree";
import type { DocumentSummary, DocumentTaxonomyItem } from "./types";

const STAMP = "2026-10-30T00:00:00Z";

function category(name: string, overrides: Partial<DocumentTaxonomyItem> = {}): DocumentTaxonomyItem {
  return {
    name,
    description: "",
    hasIcon: false,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

function document(
  id: number,
  categories: string[],
  tags: string[] = [],
): DocumentSummary {
  return {
    id,
    title: `Document ${id}`,
    description: "",
    categories,
    tags,
    attachmentCount: 0,
    totalBytes: 0,
    createdBy: null,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

describe("buildDocumentTree", () => {
  it("counts the documents filed under each category", () => {
    const tree = buildDocumentTree(
      [category("Insurance"), category("Tax")],
      [
        document(1, ["Insurance"]),
        document(2, ["Insurance"]),
        document(3, ["Tax"]),
      ],
    );

    expect(tree.map((node) => [node.label, node.count])).toEqual([
      ["Insurance", 2],
      ["Tax", 1],
    ]);
  });

  it("keeps a category with no documents, so it does not vanish from the tree", () => {
    const tree = buildDocumentTree([category("Warranty")], []);

    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ label: "Warranty", count: 0, tags: [] });
  });

  it("counts a document under every category it is filed under", () => {
    const tree = buildDocumentTree(
      [category("Insurance"), category("Tax")],
      [document(1, ["Insurance", "Tax"])],
    );

    expect(tree.find((node) => node.label === "Insurance")?.count).toBe(1);
    expect(tree.find((node) => node.label === "Tax")?.count).toBe(1);
  });

  it("lists only the tags actually worn by that category's documents", () => {
    const tree = buildDocumentTree(
      [category("Insurance"), category("Tax")],
      [
        document(1, ["Insurance"], ["car", "2026"]),
        document(2, ["Tax"], ["house"]),
      ],
    );

    const insurance = tree.find((node) => node.label === "Insurance");
    expect(insurance?.tags.map((tag) => tag.name).sort()).toEqual(["2026", "car"]);
    // "house" is on a Tax document, so offering it under Insurance would be a filter
    // guaranteed to return nothing.
    expect(insurance?.tags.map((tag) => tag.name)).not.toContain("house");
  });

  it("orders tags by use, then by name", () => {
    const tree = buildDocumentTree(
      [category("Tax")],
      [
        document(1, ["Tax"], ["receipts", "zebra"]),
        document(2, ["Tax"], ["receipts", "alpha"]),
        document(3, ["Tax"], ["receipts"]),
      ],
    );

    expect(tree[0].tags.map((tag) => [tag.name, tag.count])).toEqual([
      ["receipts", 3],
      ["alpha", 1],
      ["zebra", 1],
    ]);
  });

  it("matches a category case-insensitively, as the database collation does", () => {
    const tree = buildDocumentTree(
      [category("Insurance")],
      [document(1, ["insurance"]), document(2, ["INSURANCE"])],
    );

    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ label: "Insurance", count: 2 });
  });

  it("folds tags differing only in case into one row", () => {
    const tree = buildDocumentTree(
      [category("Tax")],
      [document(1, ["Tax"], ["Car"]), document(2, ["Tax"], ["car"])],
    );

    expect(tree[0].tags).toHaveLength(1);
    expect(tree[0].tags[0].count).toBe(2);
  });

  it("buckets documents with no category under Uncategorized, last", () => {
    const tree = buildDocumentTree(
      [category("Insurance")],
      [document(1, ["Insurance"]), document(2, []), document(3, [])],
    );

    expect(tree.at(-1)).toMatchObject({
      id: UNCATEGORIZED_ID,
      label: UNCATEGORIZED_LABEL,
      name: "",
      count: 2,
    });
  });

  it("omits the Uncategorized bucket when every document is filed", () => {
    const tree = buildDocumentTree([category("Insurance")], [document(1, ["Insurance"])]);

    expect(tree.some((node) => node.id === UNCATEGORIZED_ID)).toBe(false);
  });

  it("still shows a category that is on a document but missing from the taxonomy list", () => {
    const tree = buildDocumentTree([], [document(1, ["Orphan"])]);

    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ label: "Orphan", count: 1, hasIcon: false });
  });

  it("returns nothing for an empty library", () => {
    expect(buildDocumentTree([], [])).toEqual([]);
  });
});

describe("attachTagIcons", () => {
  it("fills in the icon fields from the tag taxonomy", () => {
    const tree = buildDocumentTree(
      [category("Tax")],
      [document(1, ["Tax"], ["receipts"])],
    );

    const withIcons = attachTagIcons(tree, [
      category("receipts", { hasIcon: true, updatedAt: "2026-10-31T00:00:00Z" }),
    ]);

    expect(withIcons[0].tags[0]).toMatchObject({
      name: "receipts",
      hasIcon: true,
      updatedAt: "2026-10-31T00:00:00Z",
    });
  });

  it("leaves a tag with no taxonomy row untouched rather than dropping it", () => {
    const tree = buildDocumentTree([category("Tax")], [document(1, ["Tax"], ["adhoc"])]);

    const withIcons = attachTagIcons(tree, []);

    expect(withIcons[0].tags).toHaveLength(1);
    expect(withIcons[0].tags[0]).toMatchObject({ name: "adhoc", hasIcon: false });
  });
});

describe("treeSelectionFilter", () => {
  it("filters on the selected category and tag", () => {
    expect(treeSelectionFilter("Insurance", "car")).toEqual({
      categories: ["Insurance"],
      tags: ["car"],
    });
  });

  it("filters on no category for Uncategorized, which the schema cannot express", () => {
    expect(treeSelectionFilter(UNCATEGORIZED_ID, undefined)).toEqual({
      categories: [],
      tags: [],
    });
  });

  it("treats nothing selected as no filter at all", () => {
    expect(treeSelectionFilter(undefined, undefined)).toEqual({ categories: [], tags: [] });
    expect(treeSelectionFilter("", "")).toEqual({ categories: [], tags: [] });
  });
});

describe("isInTreeSelection", () => {
  it("keeps only uncategorised documents under the Uncategorized node", () => {
    expect(isInTreeSelection(document(1, []), UNCATEGORIZED_ID)).toBe(true);
    expect(isInTreeSelection(document(2, ["Tax"]), UNCATEGORIZED_ID)).toBe(false);
  });

  it("leaves every other selection to the query that already narrowed it", () => {
    expect(isInTreeSelection(document(1, ["Tax"]), "Tax")).toBe(true);
    expect(isInTreeSelection(document(2, ["Tax"]), undefined)).toBe(true);
  });
});
