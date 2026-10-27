import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORCES,
  buildLocationGraph,
  findNodeAt,
  graphBounds,
  neighbourIndices,
  settleGraph,
  stepSimulation,
} from "./location-graph";
import type { SavedLocation } from "./types";

let nextId = 1;

function place(name: string, tags: string[] = [], categories: string[] = []): SavedLocation {
  return {
    id: nextId++,
    name,
    latitude: 0,
    longitude: 0,
    description: "",
    address: "",
    categories,
    tags,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Straight-line distance between two nodes, for layout assertions. */
function gap(graph: ReturnType<typeof buildLocationGraph>, a: number, b: number): number {
  const dx = graph.nodes[a].x - graph.nodes[b].x;
  const dy = graph.nodes[a].y - graph.nodes[b].y;
  return Math.sqrt(dx * dx + dy * dy);
}

describe("buildLocationGraph", () => {
  it("makes one node per place", () => {
    const graph = buildLocationGraph([place("A"), place("B"), place("C")], "tag");
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes.map((node) => node.place.name)).toEqual(["A", "B", "C"]);
  });

  it("joins two places that share a tag", () => {
    const graph = buildLocationGraph(
      [place("Blue Ridge", ["Hiking"]), place("Mt Tam", ["Hiking"])],
      "tag",
    );
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ source: 0, target: 1, shared: ["Hiking"] });
  });

  it("leaves places with nothing in common unconnected", () => {
    const graph = buildLocationGraph(
      [place("Blue Ridge", ["Hiking"]), place("Office", ["Work"])],
      "tag",
    );
    expect(graph.edges).toEqual([]);
    expect(graph.nodes.every((node) => node.degree === 0)).toBe(true);
  });

  it("records every shared name on the edge", () => {
    const graph = buildLocationGraph(
      [place("Blue Ridge", ["Hiking", "Scenic"]), place("Mt Tam", ["Hiking", "Scenic"])],
      "tag",
    );
    expect(graph.edges[0].shared).toEqual(["Hiking", "Scenic"]);
    expect(graph.maxShared).toBe(2);
  });

  it("matches tag names case-insensitively, as the repository does", () => {
    const graph = buildLocationGraph(
      [place("Blue Ridge", ["Hiking"]), place("Mt Tam", ["hiking"])],
      "tag",
    );
    expect(graph.edges).toHaveLength(1);
  });

  it("counts an edge against both of its nodes", () => {
    const graph = buildLocationGraph(
      [
        place("Hub", ["Hiking", "Dogs"]),
        place("A", ["Hiking"]),
        place("B", ["Dogs"]),
      ],
      "tag",
    );
    expect(graph.nodes[0].degree).toBe(2);
    expect(graph.nodes[1].degree).toBe(1);
    expect(graph.nodes[2].degree).toBe(1);
  });

  it("normalises strength so the most-shared edge is 1", () => {
    const graph = buildLocationGraph(
      [
        place("A", ["One", "Two"]),
        place("B", ["One", "Two"]),
        place("C", ["One"]),
      ],
      "tag",
    );
    const strongest = graph.edges.find((edge) => edge.shared.length === 2);
    const weakest = graph.edges.find((edge) => edge.shared.length === 1);
    expect(strongest?.strength).toBe(1);
    expect(weakest?.strength).toBe(0.5);
  });

  it("reads categories when asked for categories", () => {
    const graph = buildLocationGraph(
      [place("A", ["Hiking"], ["Trailhead"]), place("B", ["Urban"], ["Trailhead"])],
      "category",
    );
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].shared).toEqual(["Trailhead"]);
  });

  it("seeds positions deterministically, so a layout is reproducible", () => {
    const places = [place("A", ["X"]), place("B", ["X"]), place("C", ["X"])];
    const first = buildLocationGraph(places, "tag");
    const second = buildLocationGraph(places, "tag");
    expect(first.nodes.map((node) => node.x)).toEqual(second.nodes.map((node) => node.x));
  });

  it("does not seed two nodes at the same point", () => {
    const graph = buildLocationGraph([place("A"), place("B"), place("C")], "tag");
    expect(gap(graph, 0, 1)).toBeGreaterThan(0);
    expect(gap(graph, 1, 2)).toBeGreaterThan(0);
  });

  it("handles an empty library", () => {
    const graph = buildLocationGraph([], "tag");
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.maxShared).toBe(0);
  });
});

describe("stepSimulation", () => {
  it("holds unconnected nodes apart rather than letting them collapse together", () => {
    const graph = buildLocationGraph([place("A"), place("B")], "tag");
    for (let i = 0; i < 400; i += 1) stepSimulation(graph);

    // The property that matters is that two nodes sharing nothing stay legibly
    // separated — not that the distance only ever grows, which is what the old
    // assertion required. Repulsion falls off as 1/d² while centering pulls at a
    // constant 0.015 × distance, so a pair seeded ~205px apart correctly settles
    // INWARD to a stable ~93px (near the 90px springLength) instead of flying
    // apart. Asserting growth made the test a statement about where the seed
    // happened to put them rather than about the physics.
    const settled = gap(graph, 0, 1);
    expect(settled).toBeGreaterThan(DEFAULT_FORCES.minDistance);
    expect(settled).toBeGreaterThan(DEFAULT_FORCES.springLength * 0.5);

    // And it is an equilibrium, not a moment on the way to a collapse.
    for (let i = 0; i < 400; i += 1) stepSimulation(graph);
    expect(gap(graph, 0, 1)).toBeCloseTo(settled, 1);
  });

  it("pulls connected nodes together from far apart", () => {
    const graph = buildLocationGraph(
      [place("A", ["Hiking"]), place("B", ["Hiking"])],
      "tag",
    );
    // Start them well beyond the spring's rest length.
    graph.nodes[0].x = -400;
    graph.nodes[1].x = 400;
    graph.nodes[0].y = 0;
    graph.nodes[1].y = 0;
    const before = gap(graph, 0, 1);
    for (let i = 0; i < 60; i += 1) stepSimulation(graph);
    expect(gap(graph, 0, 1)).toBeLessThan(before);
  });

  it("never produces a non-finite position, even from coincident nodes", () => {
    const graph = buildLocationGraph([place("A"), place("B"), place("C")], "tag");
    // The degenerate case: everything stacked on one point.
    for (const node of graph.nodes) {
      node.x = 0;
      node.y = 0;
    }
    for (let i = 0; i < 50; i += 1) stepSimulation(graph);
    for (const node of graph.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });

  it("separates coincident nodes rather than leaving them stacked", () => {
    const graph = buildLocationGraph([place("A"), place("B")], "tag");
    for (const node of graph.nodes) {
      node.x = 0;
      node.y = 0;
    }
    for (let i = 0; i < 50; i += 1) stepSimulation(graph);
    expect(gap(graph, 0, 1)).toBeGreaterThan(1);
  });

  it("holds a pinned node exactly in place", () => {
    const graph = buildLocationGraph(
      [place("A", ["Hiking"]), place("B", ["Hiking"])],
      "tag",
    );
    graph.nodes[0].isPinned = true;
    graph.nodes[0].x = 100;
    graph.nodes[0].y = 50;
    for (let i = 0; i < 30; i += 1) stepSimulation(graph);
    expect(graph.nodes[0].x).toBe(100);
    expect(graph.nodes[0].y).toBe(50);
  });

  it("loses energy over time rather than oscillating forever", () => {
    const graph = buildLocationGraph(
      [place("A", ["X"]), place("B", ["X"]), place("C", ["X"])],
      "tag",
    );
    const early = stepSimulation(graph);
    for (let i = 0; i < 100; i += 1) stepSimulation(graph);
    expect(stepSimulation(graph)).toBeLessThan(early);
  });

  it("pulls a strongly-shared pair closer than a weakly-shared one", () => {
    const graph = buildLocationGraph(
      [
        place("A", ["One", "Two", "Three"]),
        place("B", ["One", "Two", "Three"]),
        place("C", ["One"]),
        place("D", ["One"]),
      ],
      "tag",
    );
    settleGraph(graph);
    // A-B share three names; C-D share one. The stronger pair should end closer.
    expect(gap(graph, 0, 1)).toBeLessThan(gap(graph, 2, 3));
  });
});

describe("settleGraph", () => {
  it("comes to rest and reports how many steps it took", () => {
    const graph = buildLocationGraph([place("A", ["X"]), place("B", ["X"])], "tag");
    const steps = settleGraph(graph);
    expect(steps).toBeGreaterThan(0);
    expect(steps).toBeLessThanOrEqual(300);
  });

  it("gives up at maxSteps rather than looping forever", () => {
    const graph = buildLocationGraph([place("A", ["X"]), place("B", ["X"])], "tag");
    // An unreachable rest threshold forces the guard to be what stops it.
    expect(settleGraph(graph, DEFAULT_FORCES, 25, -1)).toBe(25);
  });

  it("settles an empty graph without throwing", () => {
    expect(() => settleGraph(buildLocationGraph([], "tag"))).not.toThrow();
  });
});

describe("findNodeAt", () => {
  it("finds a node within the radius", () => {
    const graph = buildLocationGraph([place("A")], "tag");
    graph.nodes[0].x = 10;
    graph.nodes[0].y = 10;
    expect(findNodeAt(graph, 12, 12, 8)?.place.name).toBe("A");
  });

  it("returns undefined beyond the radius", () => {
    const graph = buildLocationGraph([place("A")], "tag");
    graph.nodes[0].x = 10;
    graph.nodes[0].y = 10;
    expect(findNodeAt(graph, 100, 100, 8)).toBeUndefined();
  });

  it("picks the last-drawn node when two overlap", () => {
    const graph = buildLocationGraph([place("Under"), place("Over")], "tag");
    for (const node of graph.nodes) {
      node.x = 0;
      node.y = 0;
    }
    expect(findNodeAt(graph, 0, 0, 10)?.place.name).toBe("Over");
  });
});

describe("neighbourIndices", () => {
  it("includes the node itself and everything it touches", () => {
    const graph = buildLocationGraph(
      [
        place("Hub", ["Hiking", "Dogs"]),
        place("A", ["Hiking"]),
        place("B", ["Dogs"]),
        place("Far", ["Work"]),
      ],
      "tag",
    );
    expect(neighbourIndices(graph, 0)).toEqual(new Set([0, 1, 2]));
  });

  it("returns just the node when it has no edges", () => {
    const graph = buildLocationGraph([place("Lonely", ["Solo"]), place("Other", ["X"])], "tag");
    expect(neighbourIndices(graph, 0)).toEqual(new Set([0]));
  });
});

describe("graphBounds", () => {
  it("covers every node with padding", () => {
    const graph = buildLocationGraph([place("A"), place("B")], "tag");
    graph.nodes[0].x = -50;
    graph.nodes[0].y = -20;
    graph.nodes[1].x = 70;
    graph.nodes[1].y = 30;
    expect(graphBounds(graph, 10)).toEqual({
      minX: -60,
      minY: -30,
      maxX: 80,
      maxY: 40,
    });
  });

  it("returns a usable box for an empty graph", () => {
    const bounds = graphBounds(buildLocationGraph([], "tag"), 25);
    expect(bounds.maxX).toBeGreaterThan(bounds.minX);
    expect(bounds.maxY).toBeGreaterThan(bounds.minY);
  });
});
