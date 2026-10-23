// The Location Manager's graph view: saved places as a force-directed node
// graph, joined wherever they share a tag (or a category).
//
// **The simulation no longer lives here.** It moved to
// `@/lib/shared/taxonomy-graph` when the Journal's Topics section needed the
// same picture over entries, and nothing in it was ever location-specific — the
// builder only read `id`, `name`, `categories` and `tags`. This file is now the
// location-shaped face of that shared module.
//
// One thing it does more than re-export: a node here exposes the place as
// `place`, not as the shared module's `subject`. That name is load-bearing —
// `location-graph-view.tsx` reads `node.place` throughout — and renaming it
// across the component to save this adapter would be churn in working code for
// no gain. `buildLocationGraph` therefore wraps the shared builder and re-wraps
// its nodes, while everything that merely *reads* a graph (the physics, the
// hit-testing, the bounds) is re-exported untouched and operates on either
// shape, because none of it looks at the payload field at all.

import type { LocationTaxonomyKind, SavedLocation } from "./types";
import {
  buildTaxonomyGraph,
  findNodeAt as findSubjectNodeAt,
  type GraphNode as SharedGraphNode,
  type TaxonomyGraph,
} from "@/lib/shared/taxonomy-graph";

export {
  DEFAULT_FORCES,
  graphBounds,
  neighbourIndices,
  settleGraph,
  stepSimulation,
  type ForceSettings,
  type GraphEdge,
} from "@/lib/shared/taxonomy-graph";

/**
 * One place in the graph.
 *
 * Structurally the shared `GraphNode` with the payload also published as
 * `place`. Both fields point at the same object — this is a rename, not a copy.
 */
export interface GraphNode<P extends SavedLocation = SavedLocation>
  extends SharedGraphNode<P> {
  /** The place this node stands for. The shared module calls it `subject`. */
  place: P;
}

export interface LocationGraph<P extends SavedLocation = SavedLocation> {
  nodes: GraphNode<P>[];
  edges: TaxonomyGraph<P>["edges"];
  /** The largest `shared.length` on any edge, for scaling line widths. */
  maxShared: number;
}

/**
 * Builds the graph: every place a node, an edge wherever two places share at
 * least one name.
 *
 * Delegates to `buildTaxonomyGraph` and republishes each node's payload under
 * `place`. The nodes are mutated in place by the shared `stepSimulation`, so
 * the aliasing has to survive: assigning `place` onto the very same node object
 * (rather than spreading into a new one) is what keeps the two views of the
 * payload in sync as the physics runs.
 */
export function buildLocationGraph<P extends SavedLocation>(
  places: readonly P[],
  kind: LocationTaxonomyKind,
): LocationGraph<P> {
  const graph = buildTaxonomyGraph(places, kind);
  const nodes = graph.nodes.map((node) =>
    Object.assign(node as SharedGraphNode<P> & { place: P }, { place: node.subject }),
  );
  return { nodes, edges: graph.edges, maxShared: graph.maxShared };
}

/**
 * The node under a point, or undefined.
 *
 * Wrapped rather than re-exported straight through, because the shared
 * `findNodeAt` is typed to return the shared node — which has `subject` but not
 * `place`, so a caller doing `node.place` would not typecheck. The value is
 * already the right object (see `buildLocationGraph`: the nodes are aliased,
 * not copied); only the declared type needs narrowing back.
 */
export function findNodeAt<P extends SavedLocation>(
  graph: LocationGraph<P>,
  x: number,
  y: number,
  radius: number,
): GraphNode<P> | undefined {
  return findSubjectNodeAt(graph, x, y, radius) as GraphNode<P> | undefined;
}
