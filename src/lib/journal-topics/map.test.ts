import { describe, expect, it } from "vitest";
import { buildTopicMap, topicMapNodeKey } from "./map";
import { topicMapSubjects } from "./graph";
import {
  DEFAULT_FORCES,
  buildTaxonomyGraph,
  graphBounds,
  settleGraph,
  stepSimulation,
} from "@/lib/shared/taxonomy-graph";
import type { JournalEntry } from "@/lib/journal/types";

function entry(overrides: Partial<JournalEntry> & { id: number }): JournalEntry {
  return {
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
}

/** Two names on two entries each — the smallest map that clears both defaults. */
const PAIRED = [
  entry({ id: 1, tags: ["HSA", "Taxes"] }),
  entry({ id: 2, tags: ["HSA", "Taxes"] }),
];

describe("buildTopicMap", () => {
  it("counts how many entries carry each name", () => {
    const map = buildTopicMap(PAIRED);
    expect(map.nodes).toEqual([
      { name: "HSA", kind: "tag", entryCount: 2 },
      { name: "Taxes", kind: "tag", entryCount: 2 },
    ]);
  });

  it("joins two names that share entries", () => {
    const map = buildTopicMap(PAIRED);
    expect(map.edges).toHaveLength(1);
    expect(map.edges[0]).toMatchObject({ sharedEntries: 2, strength: 1 });
  });

  it("carries tags and categories in one map, each keeping its kind", () => {
    const map = buildTopicMap([
      entry({ id: 1, tags: ["HSA"], categories: ["Money"] }),
      entry({ id: 2, tags: ["HSA"], categories: ["Money"] }),
    ]);
    expect(map.nodes.map((n) => n.kind).sort()).toEqual(["category", "tag"]);
    expect(map.edges).toHaveLength(1);
  });

  it("keeps a tag and a category of the same name apart", () => {
    const map = buildTopicMap([
      entry({ id: 1, tags: ["Money"], categories: ["Money"] }),
      entry({ id: 2, tags: ["Money"], categories: ["Money"] }),
    ]);
    expect(map.nodes).toHaveLength(2);
  });

  it("treats differently-cased spellings as one node", () => {
    const map = buildTopicMap([
      entry({ id: 1, tags: ["hsa", "Taxes"] }),
      entry({ id: 2, tags: ["HSA", "Taxes"] }),
    ]);
    expect(map.nodes.filter((n) => n.name.toLowerCase() === "hsa")).toHaveLength(1);
  });

  it("does not let one entry count a repeated name twice", () => {
    const map = buildTopicMap(
      [entry({ id: 1, tags: ["HSA", "HSA"] })],
      { minEntryCount: 1 },
    );
    expect(map.nodes[0].entryCount).toBe(1);
  });

  // Encrypted entries carry plaintext taxonomy; only their text is sealed.
  it("includes encrypted entries, whose tags are plaintext", () => {
    const map = buildTopicMap([
      entry({ id: 1, tags: ["HSA", "Taxes"], isEncrypted: true }),
      entry({ id: 2, tags: ["HSA", "Taxes"], isEncrypted: true }),
    ]);
    expect(map.nodes).toHaveLength(2);
    expect(map.edges).toHaveLength(1);
  });

  it("ignores blank names", () => {
    const map = buildTopicMap(
      [entry({ id: 1, tags: ["", "   ", "HSA"] })],
      { minEntryCount: 1 },
    );
    expect(map.nodes.map((n) => n.name)).toEqual(["HSA"]);
  });

  describe("thresholds", () => {
    it("drops names below the minimum entry count, and reports how many", () => {
      const map = buildTopicMap([
        entry({ id: 1, tags: ["HSA", "Taxes", "Once"] }),
        entry({ id: 2, tags: ["HSA", "Taxes"] }),
      ]);
      expect(map.nodes.map((n) => n.name)).toEqual(["HSA", "Taxes"]);
      expect(map.hiddenNodeCount).toBe(1);
    });

    it("keeps rare names when the threshold is lowered", () => {
      const map = buildTopicMap([entry({ id: 1, tags: ["Once"] })], { minEntryCount: 1 });
      expect(map.nodes.map((n) => n.name)).toEqual(["Once"]);
      expect(map.hiddenNodeCount).toBe(0);
    });

    // One shared entry is a coincidence, and spurious edges are what pull
    // unrelated subjects into the same cluster.
    it("draws no edge for a single shared entry", () => {
      const map = buildTopicMap(
        [
          entry({ id: 1, tags: ["HSA", "Garden"] }),
          entry({ id: 2, tags: ["HSA"] }),
          entry({ id: 3, tags: ["Garden"] }),
        ],
        { minEntryCount: 1 },
      );
      expect(map.edges).toEqual([]);
    });

    it("draws that edge when the threshold is lowered", () => {
      const map = buildTopicMap(
        [entry({ id: 1, tags: ["HSA", "Garden"] })],
        { minEntryCount: 1, minSharedEntries: 1 },
      );
      expect(map.edges).toHaveLength(1);
    });

    // An edge pointing at a node that was filtered out would reference nothing.
    it("drops an edge whose node was filtered away", () => {
      const map = buildTopicMap(
        [
          entry({ id: 1, tags: ["HSA", "Rare"] }),
          entry({ id: 2, tags: ["HSA", "Rare"] }),
          entry({ id: 3, tags: ["HSA"] }),
        ],
        { minEntryCount: 3, minSharedEntries: 2 },
      );
      expect(map.nodes.map((n) => n.name)).toEqual(["HSA"]);
      expect(map.edges).toEqual([]);
    });
  });

  it("orders nodes by entry count, then alphabetically, so the layout is stable", () => {
    const map = buildTopicMap([
      entry({ id: 1, tags: ["Zebra", "Apple", "Big"] }),
      entry({ id: 2, tags: ["Zebra", "Apple", "Big"] }),
      entry({ id: 3, tags: ["Big"] }),
    ]);
    expect(map.nodes.map((n) => n.name)).toEqual(["Big", "Apple", "Zebra"]);
  });

  it("returns an empty map for no entries", () => {
    expect(buildTopicMap([])).toEqual({ nodes: [], edges: [], hiddenNodeCount: 0 });
  });

  it("returns nodes but no edges when nothing co-occurs", () => {
    const map = buildTopicMap([entry({ id: 1, tags: ["Alone"] })], { minEntryCount: 1 });
    expect(map.nodes).toHaveLength(1);
    expect(map.edges).toEqual([]);
  });
});

describe("topicMapSubjects", () => {
  it("labels each node and carries its kind and count", () => {
    const subjects = topicMapSubjects(buildTopicMap(PAIRED));
    expect(subjects.map((s) => [s.name, s.kind, s.entryCount])).toEqual([
      ["HSA", "tag", 2],
      ["Taxes", "tag", 2],
    ]);
  });

  it("gives every node a distinct id, which GraphSubject requires", () => {
    const subjects = topicMapSubjects(buildTopicMap(PAIRED));
    expect(new Set(subjects.map((s) => s.id)).size).toBe(subjects.length);
  });

  // The whole point of the adapter: the shared builder joins on shared names,
  // so the map's edges have to survive the round trip unchanged.
  it("reproduces exactly the map's edges through the shared graph builder", () => {
    const map = buildTopicMap([
      entry({ id: 1, tags: ["HSA", "Taxes"] }),
      entry({ id: 2, tags: ["HSA", "Taxes"] }),
      entry({ id: 3, tags: ["Taxes", "Garden"] }),
      entry({ id: 4, tags: ["Taxes", "Garden"] }),
    ]);
    const graph = buildTaxonomyGraph(topicMapSubjects(map), "tag");

    expect(graph.edges).toHaveLength(map.edges.length);

    const drawn = graph.edges
      .map((edge) =>
        [graph.nodes[edge.source].subject.name, graph.nodes[edge.target].subject.name]
          .sort()
          .join("—"),
      )
      .sort();
    // Taxes links both others; HSA and Garden never share an entry.
    expect(drawn).toEqual(["Garden—Taxes", "HSA—Taxes"]);
  });

  it("joins two nodes exactly once, not once per shared entry", () => {
    const map = buildTopicMap([
      entry({ id: 1, tags: ["HSA", "Taxes"] }),
      entry({ id: 2, tags: ["HSA", "Taxes"] }),
      entry({ id: 3, tags: ["HSA", "Taxes"] }),
    ]);
    const graph = buildTaxonomyGraph(topicMapSubjects(map), "tag");
    expect(graph.edges).toHaveLength(1);
  });

  it("leaves an unconnected node with no links", () => {
    const map = buildTopicMap(
      [
        entry({ id: 1, tags: ["HSA", "Taxes"] }),
        entry({ id: 2, tags: ["HSA", "Taxes"] }),
        entry({ id: 3, tags: ["Alone"] }),
        entry({ id: 4, tags: ["Alone"] }),
      ],
    );
    const graph = buildTaxonomyGraph(topicMapSubjects(map), "tag");
    const alone = graph.nodes.find((node) => node.subject.name === "Alone");
    expect(alone?.degree).toBe(0);
  });

  it("returns nothing for an empty map", () => {
    expect(topicMapSubjects({ nodes: [], edges: [], hiddenNodeCount: 0 })).toEqual([]);
  });
});

describe("topicMapNodeKey", () => {
  it("keys by kind and normalized name", () => {
    expect(topicMapNodeKey({ name: "H.S.A.", kind: "tag", entryCount: 1 })).toBe("tag:hsa");
    expect(topicMapNodeKey({ name: "HSA", kind: "category", entryCount: 1 })).toBe(
      "category:hsa",
    );
  });
});

// The bug that made the Topics map render as blank space: the force layout had
// no speed limit, so at this node count the accumulated repulsion outran
// damping, energy multiplied about fifteen times per step until it overflowed,
// and every coordinate became NaN. `minDistance` did not catch it — it caps the
// force from one pair, while a node's velocity is the sum over all the others.
describe("the map's layout at realistic scale", () => {
  /** A map roughly the size a well-used journal produces. */
  function crowdedMap(nodeCount: number): JournalEntry[] {
    const names = Array.from({ length: nodeCount }, (_, i) => `Tag${i}`);
    const entries: JournalEntry[] = [];
    let id = 1;
    // Every name on several entries, and heavily overlapping, so the graph is
    // dense rather than a ring — density is what made the forces run away.
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < Math.min(i + 6, names.length); j += 1) {
        entries.push(entry({ id: id++, tags: [names[i], names[j]] }));
        entries.push(entry({ id: id++, tags: [names[i], names[j]] }));
      }
    }
    return entries;
  }

  it("settles 150 subjects to finite positions", () => {
    const graph = buildTaxonomyGraph(
      topicMapSubjects(buildTopicMap(crowdedMap(150))),
      "tag",
    );
    expect(graph.nodes.length).toBeGreaterThan(100);

    settleGraph(graph);

    for (const node of graph.nodes) {
      expect(Number.isFinite(node.x), `node ${node.subject.name} x`).toBe(true);
      expect(Number.isFinite(node.y), `node ${node.subject.name} y`).toBe(true);
    }
  });

  it("keeps the laid-out graph inside a drawable bounding box", () => {
    const graph = buildTaxonomyGraph(
      topicMapSubjects(buildTopicMap(crowdedMap(150))),
      "tag",
    );
    settleGraph(graph);
    const bounds = graphBounds(graph);

    // A box this size fits a canvas at a sane zoom. The failure mode was not a
    // large box but a NaN one, so any finite, positive extent proves the fix —
    // the generous ceiling guards against a different regression, a layout that
    // technically settles but flings nodes thousands of units apart.
    expect(Number.isFinite(bounds.minX)).toBe(true);
    expect(bounds.maxX - bounds.minX).toBeGreaterThan(0);
    expect(bounds.maxX - bounds.minX).toBeLessThan(10_000);
    expect(bounds.maxY - bounds.minY).toBeLessThan(10_000);
  });

  it("never lets a node exceed the speed limit in a single step", () => {
    const graph = buildTaxonomyGraph(
      topicMapSubjects(buildTopicMap(crowdedMap(150))),
      "tag",
    );

    // The first few steps are where it ran away.
    for (let step = 0; step < 10; step += 1) {
      stepSimulation(graph);
      for (const node of graph.nodes) {
        const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
        expect(speed).toBeLessThanOrEqual(DEFAULT_FORCES.maxVelocity + 0.0001);
      }
    }
  });
});
