import { describe, expect, it } from "vitest";
import { buildCooccurrence } from "./cooccurrence";
import type { TopicEntry } from "./types";
import type { JournalEntry } from "@/lib/journal/types";

function topicEntry(id: number, tags: string[], categories: string[] = []): TopicEntry {
  const entry: JournalEntry = {
    id,
    date: "2026-07-27",
    time: "",
    title: `Entry ${id}`,
    content: "",
    placeName: "",
    isPinned: false,
    isLocked: false,
    isEncrypted: false,
    titleEncrypted: "",
    contentEncrypted: "",
    passwordHint: "",
    categories,
    tags,
    locations: [],
    source: "",
    externalId: "",
    externalContent: "",
    createdAt: "2026-07-27T00:00:00Z",
    updatedAt: "2026-07-27T00:00:00Z",
  };
  return { entry, reasons: [], score: 1, isMasked: false };
}

describe("buildCooccurrence", () => {
  it("counts the names that travel with a topic", () => {
    const rows = buildCooccurrence([
      topicEntry(1, ["HSA", "Taxes"]),
      topicEntry(2, ["HSA", "Taxes"]),
      topicEntry(3, ["HSA", "Fidelity"]),
    ]);

    expect(rows.map((r) => [r.name, r.entryCount])).toEqual([
      ["HSA", 3],
      ["Taxes", 2],
    ]);
  });

  it("reports share as a fraction of the topic's entries", () => {
    const rows = buildCooccurrence([
      topicEntry(1, ["Taxes"]),
      topicEntry(2, ["Taxes"]),
      topicEntry(3, []),
      topicEntry(4, []),
    ]);
    expect(rows[0]).toMatchObject({ name: "Taxes", entryCount: 2, share: 0.5 });
  });

  // A name on exactly one entry is a coincidence, not a pattern.
  it("drops names below the minimum count", () => {
    const rows = buildCooccurrence([topicEntry(1, ["Once"]), topicEntry(2, ["Twice"]), topicEntry(3, ["Twice"])]);
    expect(rows.map((r) => r.name)).toEqual(["Twice"]);
  });

  it("honours a caller-supplied minimum", () => {
    const rows = buildCooccurrence([topicEntry(1, ["Once"])], { minCount: 1 });
    expect(rows.map((r) => r.name)).toEqual(["Once"]);
  });

  // "HSA co-occurs with HSA" is noise that would always rank first.
  it("excludes the names that matched the term itself", () => {
    const rows = buildCooccurrence(
      [topicEntry(1, ["HSA", "Taxes"]), topicEntry(2, ["HSA", "Taxes"])],
      { exclude: ["HSA"] },
    );
    expect(rows.map((r) => r.name)).toEqual(["Taxes"]);
  });

  it("excludes case- and punctuation-insensitively", () => {
    const rows = buildCooccurrence(
      [topicEntry(1, ["H.S.A."]), topicEntry(2, ["H.S.A."])],
      { exclude: ["hsa"] },
    );
    expect(rows).toEqual([]);
  });

  it("counts differently-cased spellings as one name", () => {
    const rows = buildCooccurrence([topicEntry(1, ["taxes"]), topicEntry(2, ["Taxes"])]);
    expect(rows).toHaveLength(1);
    expect(rows[0].entryCount).toBe(2);
  });

  // They are different things in this journal; collapsing would overstate both.
  it("keeps a tag and a category of the same name separate", () => {
    const rows = buildCooccurrence([
      topicEntry(1, ["Money"], ["Money"]),
      topicEntry(2, ["Money"], ["Money"]),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.kind).sort()).toEqual(["category", "tag"]);
  });

  it("does not let one entry count a repeated name twice", () => {
    const rows = buildCooccurrence([topicEntry(1, ["Taxes", "Taxes"])], { minCount: 1 });
    expect(rows[0].entryCount).toBe(1);
  });

  it("ignores blank names", () => {
    const rows = buildCooccurrence([topicEntry(1, ["", "  "]), topicEntry(2, ["", "  "])], {
      minCount: 1,
    });
    expect(rows).toEqual([]);
  });

  it("breaks count ties alphabetically so the list is stable", () => {
    const rows = buildCooccurrence([
      topicEntry(1, ["Zebra", "Apple"]),
      topicEntry(2, ["Zebra", "Apple"]),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Apple", "Zebra"]);
  });

  it("returns nothing for no entries", () => {
    expect(buildCooccurrence([])).toEqual([]);
  });
});
