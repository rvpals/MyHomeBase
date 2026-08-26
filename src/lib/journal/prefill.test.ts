import { describe, expect, it } from "vitest";
import {
  applyPrefillTemplate,
  deletePrefillTemplate,
  emptyPrefillValues,
  getPrefillTemplate,
  getPrefillTemplateByName,
  listEnabledPrefillTemplates,
  listPrefillSuggestions,
  listPrefillTemplates,
  prefillFieldAllowsNow,
  prefillFieldLabel,
  resolvePrefillValue,
  savePrefillTemplate,
  setPrefillTemplateEnabled,
} from "./prefill";
import { parseStoredPrefillFields, savePrefillTemplateSchema } from "./schema";
import type { JournalRepository } from "./ports";
import type { PrefillTemplateWriteData } from "./schema";
import type {
  JournalCategory,
  JournalPrefillField,
  JournalPrefillFieldValue,
  JournalPrefillTemplate,
  JournalTag,
} from "./types";

// Hand-written in-memory fake, covering only the slice of the port prefill uses:
// the template table, the two managed taxonomy lists the suggestion path reads,
// and the distinct-values query. Everything else throws, so a use-case that
// quietly reaches for an entry query fails loudly instead of passing on a stub.
function fakeRepo(options?: { categories?: string[]; tags?: string[]; distinct?: string[] }) {
  let templates: JournalPrefillTemplate[] = [];
  let nextId = 1;
  const now = "2026-01-01T00:00:00.000Z";

  const repo = {
    listPrefillTemplates() {
      return [...templates].sort((a, b) => a.name.localeCompare(b.name));
    },
    getPrefillTemplateById(id: number) {
      return templates.find((template) => template.id === id);
    },
    getPrefillTemplateByName(name: string) {
      // NOCASE, matching idx_jrn_prefill_templates_name.
      return templates.find(
        (template) => template.name.toLowerCase() === name.trim().toLowerCase(),
      );
    },
    savePrefillTemplate(input: PrefillTemplateWriteData) {
      if (input.id !== undefined) {
        const index = templates.findIndex((template) => template.id === input.id);
        if (index === -1) throw new Error(`Prefill template ${input.id} no longer exists.`);
        const updated: JournalPrefillTemplate = {
          ...templates[index],
          name: input.name,
          description: input.description,
          isEnabled: input.isEnabled,
          fields: input.fields,
          updatedAt: now,
        };
        templates[index] = updated;
        return updated;
      }
      const created: JournalPrefillTemplate = {
        id: nextId++,
        name: input.name,
        description: input.description,
        isEnabled: input.isEnabled,
        fields: input.fields,
        createdAt: now,
        updatedAt: now,
      };
      templates.push(created);
      return created;
    },
    deletePrefillTemplate(id: number) {
      templates = templates.filter((template) => template.id !== id);
    },
    setPrefillTemplateEnabled(id: number, isEnabled: boolean) {
      const index = templates.findIndex((template) => template.id === id);
      if (index === -1) throw new Error(`Prefill template ${id} no longer exists.`);
      templates[index] = { ...templates[index], isEnabled, updatedAt: now };
      return templates[index];
    },
    listCategories(): JournalCategory[] {
      return (options?.categories ?? []).map((name) => ({
        name,
        description: "",
        createdAt: now,
        updatedAt: now,
      }));
    },
    listTags(): JournalTag[] {
      return (options?.tags ?? []).map((name) => ({
        name,
        description: "",
        createdAt: now,
        updatedAt: now,
      }));
    },
    listDistinctFieldValues(_field: JournalPrefillField, limit: number) {
      return (options?.distinct ?? []).slice(0, limit);
    },
  };

  // The port is wider than this fake. Anything unimplemented throws rather than
  // returning a plausible empty value, so an accidental dependency shows up as a
  // failing test instead of a silent pass.
  return new Proxy(repo, {
    get(target, property, receiver) {
      if (property in target) return Reflect.get(target, property, receiver);
      return () => {
        throw new Error(`fakeRepo: ${String(property)} is not implemented for prefill tests`);
      };
    },
  }) as unknown as JournalRepository;
}

function field(
  fieldName: JournalPrefillField,
  value: string,
  mode: "literal" | "now" = "literal",
): JournalPrefillFieldValue {
  return { field: fieldName, mode, value };
}

function template(fields: JournalPrefillFieldValue[]): JournalPrefillTemplate {
  return {
    id: 1,
    name: "Gym",
    description: "",
    isEnabled: true,
    fields,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

// A fixed local-time instant, so the date/time assertions don't depend on when
// the suite runs. Month is 0-indexed: this is 2026-03-09 07:05 local.
const NOW = new Date(2026, 2, 9, 7, 5, 0);

describe("the field registry", () => {
  it("labels every field", () => {
    expect(prefillFieldLabel("placeName")).toBe("Place name");
    expect(prefillFieldLabel("categories")).toBe("Categories");
  });

  it("allows the current-value mode on date and time only", () => {
    expect(prefillFieldAllowsNow("date")).toBe(true);
    expect(prefillFieldAllowsNow("time")).toBe(true);
    expect(prefillFieldAllowsNow("title")).toBe(false);
    expect(prefillFieldAllowsNow("categories")).toBe(false);
  });
});

describe("resolvePrefillValue", () => {
  it("returns a literal value unchanged", () => {
    expect(resolvePrefillValue(field("title", "Morning run"), NOW)).toBe("Morning run");
  });

  it("resolves a `now` date from the supplied clock, zero-padded", () => {
    expect(resolvePrefillValue(field("date", "", "now"), NOW)).toBe("2026-03-09");
  });

  it("resolves a `now` time as HH:MM", () => {
    expect(resolvePrefillValue(field("time", "", "now"), NOW)).toBe("07:05");
  });

  it("uses the caller's clock rather than the real one", () => {
    // The whole point of taking `now` as an argument: the browser's day, not the
    // server's. A different instant must produce a different answer.
    const later = new Date(2027, 11, 31, 23, 59, 0);
    expect(resolvePrefillValue(field("date", "", "now"), later)).toBe("2027-12-31");
    expect(resolvePrefillValue(field("time", "", "now"), later)).toBe("23:59");
  });
});

describe("applyPrefillTemplate", () => {
  it("fills every empty field the template names", () => {
    const result = applyPrefillTemplate(
      template([
        field("title", "Gym session"),
        field("categories", "HEALTH"),
        field("tags", "gym cardio"),
      ]),
      emptyPrefillValues(),
      NOW,
    );
    expect(result.title).toBe("Gym session");
    expect(result.categories).toBe("HEALTH");
    expect(result.tags).toBe("gym cardio");
  });

  it("never overwrites a field the writer has already typed into", () => {
    const current = { ...emptyPrefillValues(), title: "Something I already wrote" };
    const result = applyPrefillTemplate(template([field("title", "Gym session")]), current, NOW);
    expect(result.title).toBe("Something I already wrote");
  });

  it("treats a whitespace-only field as empty", () => {
    const current = { ...emptyPrefillValues(), placeName: "   " };
    const result = applyPrefillTemplate(
      template([field("placeName", "The gym")]),
      current,
      NOW,
    );
    expect(result.placeName).toBe("The gym");
  });

  it("skips a template value that is itself blank", () => {
    const result = applyPrefillTemplate(template([field("title", "")]), emptyPrefillValues(), NOW);
    expect(result.title).toBe("");
  });

  it("resolves dynamic fields as it fills them", () => {
    const result = applyPrefillTemplate(
      template([field("date", "", "now"), field("time", "", "now")]),
      emptyPrefillValues(),
      NOW,
    );
    expect(result.date).toBe("2026-03-09");
    expect(result.time).toBe("07:05");
  });

  it("leaves fields the template does not name alone", () => {
    const current = { ...emptyPrefillValues(), content: "Draft" };
    const result = applyPrefillTemplate(template([field("title", "Gym")]), current, NOW);
    expect(result.content).toBe("Draft");
  });

  it("does not mutate the form it was given", () => {
    const current = emptyPrefillValues();
    applyPrefillTemplate(template([field("title", "Gym")]), current, NOW);
    expect(current.title).toBe("");
  });
});

describe("savePrefillTemplate", () => {
  it("creates a template and reads it back", () => {
    const repo = fakeRepo();
    const saved = savePrefillTemplate(repo, {
      name: "Gym",
      description: "Weekday workout",
      fields: [{ field: "categories", value: "HEALTH" }],
    });
    expect(saved.id).toBe(1);
    expect(saved.isEnabled).toBe(true);
    expect(saved.fields).toEqual([{ field: "categories", mode: "literal", value: "HEALTH" }]);
    expect(listPrefillTemplates(repo)).toHaveLength(1);
    expect(getPrefillTemplate(repo, saved.id)?.name).toBe("Gym");
  });

  it("updates in place when given an id, without creating a second row", () => {
    const repo = fakeRepo();
    const created = savePrefillTemplate(repo, { name: "Gym", fields: [] });
    const updated = savePrefillTemplate(repo, {
      id: created.id,
      name: "Gym",
      description: "Now with tags",
      fields: [{ field: "tags", value: "gym" }],
    });
    expect(updated.id).toBe(created.id);
    expect(updated.description).toBe("Now with tags");
    expect(listPrefillTemplates(repo)).toHaveLength(1);
  });

  it("rejects a duplicate name, case-insensitively", () => {
    const repo = fakeRepo();
    savePrefillTemplate(repo, { name: "Gym", fields: [] });
    expect(() => savePrefillTemplate(repo, { name: "gym", fields: [] })).toThrow(
      /already exists/,
    );
  });

  it("lets a template keep its own name when edited", () => {
    // The clash check must exclude the row being edited, or saving a template
    // without renaming it would report a conflict with itself.
    const repo = fakeRepo();
    const created = savePrefillTemplate(repo, { name: "Gym", fields: [] });
    expect(() =>
      savePrefillTemplate(repo, { id: created.id, name: "Gym", description: "x", fields: [] }),
    ).not.toThrow();
  });

  it("rejects a blank name", () => {
    const repo = fakeRepo();
    expect(() => savePrefillTemplate(repo, { name: "   ", fields: [] })).toThrow();
  });

  it("rejects the same field twice", () => {
    const repo = fakeRepo();
    expect(() =>
      savePrefillTemplate(repo, {
        name: "Gym",
        fields: [
          { field: "title", value: "One" },
          { field: "title", value: "Two" },
        ],
      }),
    ).toThrow();
  });

  it("rejects `now` on a field that has no current value", () => {
    const repo = fakeRepo();
    expect(() =>
      savePrefillTemplate(repo, {
        name: "Gym",
        fields: [{ field: "title", mode: "now", value: "" }],
      }),
    ).toThrow();
  });

  it("rejects an edit of a template that no longer exists", () => {
    const repo = fakeRepo();
    expect(() => savePrefillTemplate(repo, { id: 99, name: "Ghost", fields: [] })).toThrow(
      /no longer exists/,
    );
  });

  it("clears the literal value when the mode is `now`", () => {
    // A dynamic field carrying a stale literal would be ambiguous to anything
    // reading the stored JSON later.
    const repo = fakeRepo();
    const saved = savePrefillTemplate(repo, {
      name: "Today",
      fields: [{ field: "date", mode: "now", value: "2020-01-01" }],
    });
    expect(saved.fields[0]).toEqual({ field: "date", mode: "now", value: "" });
  });
});

describe("enable / disable / delete", () => {
  it("keeps a disabled template listed but out of the entry form's list", () => {
    const repo = fakeRepo();
    const created = savePrefillTemplate(repo, { name: "Holiday", fields: [] });
    setPrefillTemplateEnabled(repo, created.id, false);

    expect(listPrefillTemplates(repo)).toHaveLength(1);
    expect(listEnabledPrefillTemplates(repo)).toHaveLength(0);
  });

  it("re-enables a template", () => {
    const repo = fakeRepo();
    const created = savePrefillTemplate(repo, { name: "Holiday", fields: [] });
    setPrefillTemplateEnabled(repo, created.id, false);
    expect(setPrefillTemplateEnabled(repo, created.id, true).isEnabled).toBe(true);
    expect(listEnabledPrefillTemplates(repo)).toHaveLength(1);
  });

  it("rejects enabling a template that no longer exists", () => {
    const repo = fakeRepo();
    expect(() => setPrefillTemplateEnabled(repo, 42, false)).toThrow(/no longer exists/);
  });

  it("deletes a template", () => {
    const repo = fakeRepo();
    const created = savePrefillTemplate(repo, { name: "Gym", fields: [] });
    deletePrefillTemplate(repo, created.id);
    expect(listPrefillTemplates(repo)).toHaveLength(0);
  });

  it("rejects a non-positive id", () => {
    const repo = fakeRepo();
    expect(() => deletePrefillTemplate(repo, 0)).toThrow(/positive integer/);
  });

  it("finds a template by name, case-insensitively", () => {
    const repo = fakeRepo();
    savePrefillTemplate(repo, { name: "Gym", fields: [] });
    expect(getPrefillTemplateByName(repo, "  gym ")?.name).toBe("Gym");
    expect(getPrefillTemplateByName(repo, "nothing")).toBeUndefined();
  });
});

describe("listPrefillSuggestions", () => {
  it("suggests the managed category list, not what entries happen to contain", () => {
    const repo = fakeRepo({ categories: ["FAMILY", "HEALTH"], distinct: ["typo'd value"] });
    expect(listPrefillSuggestions(repo, "categories")).toEqual(["FAMILY", "HEALTH"]);
  });

  it("suggests the managed tag list", () => {
    const repo = fakeRepo({ tags: ["gym", "cardio"] });
    expect(listPrefillSuggestions(repo, "tags")).toEqual(["gym", "cardio"]);
  });

  it("suggests used values for a free-text field, honouring the limit", () => {
    const repo = fakeRepo({ distinct: ["The gym", "Home", "Office"] });
    expect(listPrefillSuggestions(repo, "placeName", 2)).toEqual(["The gym", "Home"]);
  });
});

describe("parseStoredPrefillFields", () => {
  it("reads a well-formed row", () => {
    const json = JSON.stringify([{ field: "title", mode: "literal", value: "Gym" }]);
    expect(parseStoredPrefillFields(json)).toEqual([
      { field: "title", mode: "literal", value: "Gym" },
    ]);
  });

  it("returns nothing for unreadable JSON rather than throwing", () => {
    expect(parseStoredPrefillFields("{ not json")).toEqual([]);
    expect(parseStoredPrefillFields('{"field":"title"}')).toEqual([]);
  });

  it("drops an unknown field but keeps the rest", () => {
    const json = JSON.stringify([
      { field: "weather", mode: "literal", value: "sunny" },
      { field: "title", mode: "literal", value: "Gym" },
    ]);
    expect(parseStoredPrefillFields(json)).toEqual([
      { field: "title", mode: "literal", value: "Gym" },
    ]);
  });

  it("drops an illegal `now` mode but keeps the rest", () => {
    const json = JSON.stringify([
      { field: "title", mode: "now", value: "" },
      { field: "date", mode: "now", value: "" },
    ]);
    expect(parseStoredPrefillFields(json)).toEqual([{ field: "date", mode: "now", value: "" }]);
  });

  it("keeps only the first of a duplicated field", () => {
    // A row written before the uniqueness rule existed would otherwise apply
    // twice, with last-wins behaviour no reader could predict.
    const json = JSON.stringify([
      { field: "title", mode: "literal", value: "First" },
      { field: "title", mode: "literal", value: "Second" },
    ]);
    expect(parseStoredPrefillFields(json)).toEqual([
      { field: "title", mode: "literal", value: "First" },
    ]);
  });

  it("applies defaults to a row missing mode and value", () => {
    expect(parseStoredPrefillFields(JSON.stringify([{ field: "tags" }]))).toEqual([
      { field: "tags", mode: "literal", value: "" },
    ]);
  });
});

describe("savePrefillTemplateSchema", () => {
  it("trims the name", () => {
    const parsed = savePrefillTemplateSchema.parse({ name: "  Gym  ", fields: [] });
    expect(parsed.name).toBe("Gym");
  });

  it("defaults description, isEnabled and fields", () => {
    const parsed = savePrefillTemplateSchema.parse({ name: "Gym" });
    expect(parsed).toMatchObject({ description: "", isEnabled: true, fields: [] });
  });
});
