import { describe, expect, it } from "vitest";
import { MASKED_ENTRY_LABEL, topicGraphSubjects } from "./graph";
import type { TopicEntry } from "./types";
import type { JournalEntry } from "@/lib/journal/types";
import { buildTaxonomyGraph, settleGraph } from "@/lib/shared/taxonomy-graph";

function topicEntry(overrides: Partial<JournalEntry> & { id: number }, isMasked = false): TopicEntry {
  const entry: JournalEntry = {
    date: "2026-07-27",
    time: "",
    title: "",
    content: "",
    placeName: "",
    isPinned: false,
    isLocked: false,
    isEncrypted: false,
    titleEncrypted: "",
    contentEncrypted: "",
    passwordHint: "",
    categories: [],
    tags: [],
    locations: [],
    source: "",
    externalId: "",
    externalContent: "",
    createdAt: "2026-07-27T00:00:00Z",
    updatedAt: "2026-07-27T00:00:00Z",
    ...overrides,
  };
  return { entry, reasons: [], score: 1, isMasked };
}

describe("topicGraphSubjects", () => {
  it("renames title to name and carries the taxonomy across", () => {
    const [subject] = topicGraphSubjects([
      topicEntry({ id: 7, title: "Filed the claim", tags: ["HSA"], categories: ["Money"] }),
    ]);

    expect(subject).toMatchObject({
      id: 7,
      name: "Filed the claim",
      tags: ["HSA"],
      categories: ["Money"],
      isMasked: false,
    });
  });

  it("labels an encrypted entry with the stand-in rather than its empty title", () => {
    const [subject] = topicGraphSubjects([
      topicEntry({ id: 1, title: "", tags: ["HSA"], isEncrypted: true }, true),
    ]);

    expect(subject.name).toBe(MASKED_ENTRY_LABEL);
    expect(subject.isMasked).toBe(true);
  });

  // A nameless dot in a force graph is unidentifiable.
  it("falls back to the date for an untitled entry", () => {
    const [subject] = topicGraphSubjects([topicEntry({ id: 1, title: "   ", date: "2026-03-04" })]);
    expect(subject.name).toBe("2026-03-04");
  });

  it("keeps a link back to the matched entry", () => {
    const matched = topicEntry({ id: 3, title: "Notes" });
    const [subject] = topicGraphSubjects([matched]);
    expect(subject.topicEntry).toBe(matched);
  });

  it("returns nothing for no entries", () => {
    expect(topicGraphSubjects([])).toEqual([]);
  });
});

// The point of the shared-graph refactor: journal entries must satisfy the
// constraint that previously demanded latitude/longitude.
describe("journal entries in the shared taxonomy graph", () => {
  it("builds edges between entries sharing a tag", () => {
    const subjects = topicGraphSubjects([
      topicEntry({ id: 1, title: "One", tags: ["HSA", "Taxes"] }),
      topicEntry({ id: 2, title: "Two", tags: ["HSA"] }),
      topicEntry({ id: 3, title: "Three", tags: ["Garden"] }),
    ]);

    const graph = buildTaxonomyGraph(subjects, "tag");

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ source: 0, target: 1, shared: ["HSA"] });
    expect(graph.nodes[2].degree).toBe(0);
  });

  it("settles to a finite layout", () => {
    const subjects = topicGraphSubjects([
      topicEntry({ id: 1, title: "One", tags: ["HSA"] }),
      topicEntry({ id: 2, title: "Two", tags: ["HSA"] }),
      topicEntry({ id: 3, title: "Three", tags: ["HSA"] }),
    ]);

    const graph = buildTaxonomyGraph(subjects, "tag");
    settleGraph(graph);

    for (const node of graph.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });
});
