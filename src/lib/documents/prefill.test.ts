import { describe, expect, it } from "vitest";
import {
  applyPrefillTemplate,
  deletePrefillTemplate,
  describePrefillFields,
  emptyPrefillValues,
  formStateToPrefillValues,
  getPrefillTemplateByName,
  joinPrefillList,
  listEnabledPrefillTemplates,
  listPrefillSuggestions,
  listPrefillTemplates,
  prefillValuesToFormState,
  savePrefillTemplate,
  setPrefillTemplateEnabled,
  splitPrefillList,
} from "./prefill";
import { parseStoredDocumentPrefillFields } from "./schema";
import { FakeRepository } from "./test-fakes";
import type { DocumentPrefillTemplate } from "./types";

function setup() {
  const repo = new FakeRepository();
  const save = (
    name: string,
    fields: { field: string; value: string }[],
    extra: { id?: number; description?: string; isEnabled?: boolean } = {},
  ) =>
    savePrefillTemplate(repo, {
      name,
      fields: fields.map((entry) => ({ ...entry })),
      ...extra,
    } as Parameters<typeof savePrefillTemplate>[1]);
  return { repo, save };
}

/** A template built without touching the repository, for the pure apply tests. */
function template(fields: { field: string; value: string }[]): DocumentPrefillTemplate {
  return {
    id: 1,
    name: "Test",
    description: "",
    isEnabled: true,
    fields: fields.map((entry) => ({ ...entry, mode: "literal" })) as
      DocumentPrefillTemplate["fields"],
    createdAt: "2026-10-30T00:00:00Z",
    updatedAt: "2026-10-30T00:00:00Z",
  };
}

describe("splitPrefillList", () => {
  it("splits on commas and keeps names that contain spaces", () => {
    // The whole reason this does not split on whitespace the way the Journal's tags
    // do: "Car insurance" is one category, not two.
    expect(splitPrefillList("Car insurance, Tax")).toEqual(["Car insurance", "Tax"]);
  });

  it("drops blanks and collapses case-insensitive duplicates", () => {
    expect(splitPrefillList("Tax, , tax ,  ,TAX")).toEqual(["Tax"]);
  });

  it("returns nothing for a blank or comma-only value", () => {
    expect(splitPrefillList("")).toEqual([]);
    expect(splitPrefillList("  ,  , ")).toEqual([]);
  });

  it("round-trips through joinPrefillList", () => {
    expect(splitPrefillList(joinPrefillList(["Tax", "Car insurance"]))).toEqual([
      "Tax",
      "Car insurance",
    ]);
  });
});

describe("applyPrefillTemplate — fill-only-blanks", () => {
  it("fills every blank field the template names", () => {
    const filled = applyPrefillTemplate(
      template([
        { field: "title", value: "Utility bill — " },
        { field: "categories", value: "Utilities" },
        { field: "tags", value: "Electricity, Monthly" },
      ]),
      emptyPrefillValues(),
    );

    expect(filled.title).toBe("Utility bill — ");
    expect(filled.categories).toBe("Utilities");
    expect(filled.tags).toBe("Electricity, Monthly");
    // Untouched: the template said nothing about it.
    expect(filled.description).toBe("");
  });

  it("never overwrites a text field that has already been typed into", () => {
    const current = { ...emptyPrefillValues(), title: "Lease 2026" };

    const filled = applyPrefillTemplate(
      template([
        { field: "title", value: "Utility bill — " },
        { field: "description", value: "Filed monthly." },
      ]),
      current,
    );

    // The whole point of fill-only-blanks: applying can add, never destroy, which is
    // what lets the control run with no confirm and no undo.
    expect(filled.title).toBe("Lease 2026");
    expect(filled.description).toBe("Filed monthly.");
  });

  it("never merges into a list that already has a name chosen", () => {
    const current = { ...emptyPrefillValues(), categories: "Property" };

    const filled = applyPrefillTemplate(
      template([
        { field: "categories", value: "Utilities" },
        { field: "tags", value: "Monthly" },
      ]),
      current,
    );

    // Half-merging two vocabularies would produce chips neither side asked for, and
    // the filer could not tell which came from where.
    expect(filled.categories).toBe("Property");
    expect(filled.tags).toBe("Monthly");
  });

  it("fills nothing from a blank template value", () => {
    const filled = applyPrefillTemplate(
      template([
        { field: "title", value: "   " },
        { field: "tags", value: " , , " },
      ]),
      emptyPrefillValues(),
    );

    expect(filled.title).toBe("");
    expect(filled.tags).toBe("");
  });

  it("does not mutate the values it was handed", () => {
    const current = emptyPrefillValues();
    applyPrefillTemplate(template([{ field: "title", value: "Filed" }]), current);
    expect(current.title).toBe("");
  });
});

describe("prefillValuesToFormState", () => {
  it("splits the two list fields and leaves the two text fields alone", () => {
    const state = prefillValuesToFormState({
      title: "Lease",
      description: "Signed, with spaces , kept",
      categories: "Property, Legal",
      tags: "2026",
    });

    expect(state.title).toBe("Lease");
    // Description is NOT a list — its commas are prose and must survive.
    expect(state.description).toBe("Signed, with spaces , kept");
    expect(state.categories).toEqual(["Property", "Legal"]);
    expect(state.tags).toEqual(["2026"]);
  });

  it("round-trips back through formStateToPrefillValues", () => {
    const values = {
      title: "Lease",
      description: "Signed",
      categories: "Property, Legal",
      tags: "2026",
    };
    expect(formStateToPrefillValues(prefillValuesToFormState(values))).toEqual(values);
  });
});

describe("savePrefillTemplate", () => {
  it("creates a template and reads it back by name, case-insensitively", () => {
    const { repo, save } = setup();
    save("Utility Bill", [{ field: "categories", value: "Utilities" }]);

    const found = getPrefillTemplateByName(repo, "utility bill");
    expect(found?.name).toBe("Utility Bill");
    expect(found?.fields).toEqual([
      { field: "categories", mode: "literal", value: "Utilities" },
    ]);
    // New templates are offered by the form straight away.
    expect(found?.isEnabled).toBe(true);
  });

  it("updates in place when given an id, rather than making a second row", () => {
    const { repo, save } = setup();
    const created = save("Utility Bill", [{ field: "tags", value: "Monthly" }]);

    save("Utility Bill", [{ field: "tags", value: "Monthly, Electricity" }], {
      id: created.id,
    });

    expect(listPrefillTemplates(repo)).toHaveLength(1);
    expect(listPrefillTemplates(repo)[0].fields[0].value).toBe("Monthly, Electricity");
  });

  it("refuses a name another template already holds, in any case", () => {
    const { save } = setup();
    save("Utility Bill", []);

    // A sentence, not a SQLITE_CONSTRAINT — the reason the check lives in the
    // use-case rather than being left to the unique index.
    expect(() => save("utility bill", [])).toThrow(/already exists/i);
  });

  it("lets a template keep its own name when edited", () => {
    const { save } = setup();
    const created = save("Utility Bill", []);
    expect(() => save("Utility Bill", [], { id: created.id })).not.toThrow();
  });

  it("refuses a blank name", () => {
    const { save } = setup();
    expect(() => save("   ", [])).toThrow();
  });

  it("refuses the same field twice", () => {
    const { save } = setup();
    // Two values for one field has no meaning — the second would silently win on
    // apply, which is not something a filer could predict.
    expect(() =>
      save("Broken", [
        { field: "tags", value: "Monthly" },
        { field: "tags", value: "Yearly" },
      ]),
    ).toThrow(/set twice/i);
  });

  it("refuses a field the form does not have", () => {
    const { save } = setup();
    expect(() => save("Broken", [{ field: "attachments", value: "lease.pdf" }])).toThrow();
  });

  it("refuses editing a template that is gone", () => {
    const { save } = setup();
    expect(() => save("Ghost", [], { id: 999 })).toThrow(/no longer exists/i);
  });
});

describe("listEnabledPrefillTemplates", () => {
  it("leaves out disabled templates, which stay on the Templates screen", () => {
    const { repo, save } = setup();
    const seasonal = save("Tax 2025", [{ field: "categories", value: "Tax" }]);
    save("Utility Bill", [{ field: "categories", value: "Utilities" }]);

    setPrefillTemplateEnabled(repo, seasonal.id, false);

    expect(listEnabledPrefillTemplates(repo).map((t) => t.name)).toEqual(["Utility Bill"]);
    // Disabled is not deleted: the values that took time to assemble are still there.
    expect(listPrefillTemplates(repo)).toHaveLength(2);
  });
});

describe("setPrefillTemplateEnabled", () => {
  it("toggles the flag and returns the updated template", () => {
    const { repo, save } = setup();
    const created = save("Utility Bill", []);

    expect(setPrefillTemplateEnabled(repo, created.id, false).isEnabled).toBe(false);
    expect(setPrefillTemplateEnabled(repo, created.id, true).isEnabled).toBe(true);
  });

  it("refuses a template that is gone", () => {
    const { repo } = setup();
    expect(() => setPrefillTemplateEnabled(repo, 999, false)).toThrow(/no longer exists/i);
  });
});

describe("deletePrefillTemplate", () => {
  it("removes it", () => {
    const { repo, save } = setup();
    const created = save("Utility Bill", []);

    deletePrefillTemplate(repo, created.id);

    expect(listPrefillTemplates(repo)).toEqual([]);
  });

  it("refuses an id that is not a positive integer", () => {
    const { repo } = setup();
    expect(() => deletePrefillTemplate(repo, 0)).toThrow(/positive integer/i);
    expect(() => deletePrefillTemplate(repo, 1.5)).toThrow(/positive integer/i);
  });
});

describe("listPrefillSuggestions", () => {
  it("offers the managed category and tag lists", () => {
    const { repo } = setup();
    repo.upsertCategory("Utilities", "");
    repo.upsertTag("Monthly", "");

    expect(listPrefillSuggestions(repo, "categories")).toEqual(["Utilities"]);
    expect(listPrefillSuggestions(repo, "tags")).toEqual(["Monthly"]);
  });

  it("offers nothing for title and description", () => {
    const { repo } = setup();
    // Document titles are near enough unique every time, so a list of past ones
    // under the box would be noise rather than help.
    expect(listPrefillSuggestions(repo, "title")).toEqual([]);
    expect(listPrefillSuggestions(repo, "description")).toEqual([]);
  });
});

describe("parseStoredDocumentPrefillFields — forgiving reads", () => {
  it("reads a well-formed array", () => {
    const parsed = parseStoredDocumentPrefillFields(
      JSON.stringify([{ field: "title", mode: "literal", value: "Lease" }]),
    );
    expect(parsed).toEqual([{ field: "title", mode: "literal", value: "Lease" }]);
  });

  it("returns an empty list for unreadable JSON rather than throwing", () => {
    // A template whose JSON has rotted should come back empty and re-editable, not
    // 500 the Prefill Templates screen.
    expect(parseStoredDocumentPrefillFields("{not json")).toEqual([]);
    expect(parseStoredDocumentPrefillFields('{"field":"title"}')).toEqual([]);
  });

  it("drops a bad entry without discarding the rest", () => {
    const parsed = parseStoredDocumentPrefillFields(
      JSON.stringify([
        { field: "nonsense", mode: "literal", value: "x" },
        { field: "title", mode: "literal", value: "Lease" },
      ]),
    );
    expect(parsed).toEqual([{ field: "title", mode: "literal", value: "Lease" }]);
  });

  it("de-duplicates on read, so a pre-rule row cannot apply twice", () => {
    const parsed = parseStoredDocumentPrefillFields(
      JSON.stringify([
        { field: "tags", mode: "literal", value: "First" },
        { field: "tags", mode: "literal", value: "Second" },
      ]),
    );
    expect(parsed).toEqual([{ field: "tags", mode: "literal", value: "First" }]);
  });

  it("defaults a missing mode to literal", () => {
    expect(parseStoredDocumentPrefillFields(JSON.stringify([{ field: "title" }]))).toEqual([
      { field: "title", mode: "literal", value: "" },
    ]);
  });
});

describe("describePrefillFields", () => {
  it("summarises what a template fills", () => {
    expect(
      describePrefillFields([
        { field: "title", mode: "literal", value: "Lease" },
        { field: "tags", mode: "literal", value: "2026" },
      ]),
    ).toBe("Title: Lease · Tags: 2026");
  });

  it("says so when a template fills nothing", () => {
    expect(describePrefillFields([])).toBe("No fields yet.");
  });
});
