import { describe, expect, it } from "vitest";
import {
  parseExpandedModules,
  resolveInitialExpanded,
  serializeExpandedModules,
  toggleExpandedModule,
} from "./collapse";

describe("parseExpandedModules", () => {
  it("reads a comma-separated slug list", () => {
    expect([...parseExpandedModules("journal,expense")]).toEqual(["journal", "expense"]);
  });

  it("treats a missing or empty value as nothing expanded", () => {
    expect(parseExpandedModules(undefined).size).toBe(0);
    expect(parseExpandedModules("").size).toBe(0);
  });

  it("survives a hand-edited row rather than throwing", () => {
    // Navigation has to render whatever is stored — a bad preference row should
    // collapse the tree, not break every page behind the login.
    const parsed = parseExpandedModules(",, journal , ,,expense,,");
    expect([...parsed]).toEqual(["journal", "expense"]);
  });

  it("drops duplicates", () => {
    expect(parseExpandedModules("journal,journal,journal").size).toBe(1);
  });

  it("keeps a slug that is not a current module", () => {
    // An admin toggling a module off and back on shouldn't silently forget the
    // reader's choice, so unknown slugs are preserved rather than validated away.
    expect(parseExpandedModules("retired-module").has("retired-module")).toBe(true);
  });
});

describe("serializeExpandedModules", () => {
  it("writes a sorted, de-duplicated list", () => {
    expect(serializeExpandedModules(["expense", "journal", "expense"])).toBe("expense,journal");
  });

  it("is stable — the same set always produces the same string", () => {
    // An unsorted join would rewrite the row on every toggle round-trip.
    expect(serializeExpandedModules(["journal", "expense"])).toBe(
      serializeExpandedModules(["expense", "journal"]),
    );
  });

  it("writes an empty string for an empty set", () => {
    expect(serializeExpandedModules([])).toBe("");
  });

  it("round-trips through parse", () => {
    const original = new Set(["journal", "music-library", "expense"]);
    expect(parseExpandedModules(serializeExpandedModules(original))).toEqual(original);
  });
});

describe("toggleExpandedModule", () => {
  it("adds a collapsed module and removes an expanded one", () => {
    const expanded = new Set(["journal"]);
    expect(toggleExpandedModule(expanded, "expense").has("expense")).toBe(true);
    expect(toggleExpandedModule(expanded, "journal").has("journal")).toBe(false);
  });

  it("does not mutate the set it was given", () => {
    // It feeds React state, where an in-place mutation is a re-render that
    // doesn't happen.
    const expanded = new Set(["journal"]);
    toggleExpandedModule(expanded, "expense");
    expect([...expanded]).toEqual(["journal"]);
  });
});

describe("resolveInitialExpanded", () => {
  it("always expands the active module, whatever is stored", () => {
    // A tree whose current section is hidden has nothing highlighted and reads
    // as though navigation has lost track of where you are.
    const resolved = resolveInitialExpanded(new Set(), "journal");
    expect(resolved.has("journal")).toBe(true);
  });

  it("keeps other modules collapsed as stored", () => {
    const resolved = resolveInitialExpanded(new Set(["expense"]), "journal");
    expect([...resolved].sort()).toEqual(["expense", "journal"]);
  });

  it("leaves the stored set alone when there is no active module", () => {
    // Home and the account screen belong to no module.
    const resolved = resolveInitialExpanded(new Set(["expense"]), undefined);
    expect([...resolved]).toEqual(["expense"]);
  });

  it("does not mutate the stored set", () => {
    const stored = new Set(["expense"]);
    resolveInitialExpanded(stored, "journal");
    expect([...stored]).toEqual(["expense"]);
  });
});
