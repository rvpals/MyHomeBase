// A force-directed graph over anything carrying tags and categories.
//
// Lifted out of `@/lib/sys-locations/location-graph` when the Journal's Topics
// section needed the same picture over entries instead of places. Nothing about
// the simulation was location-specific: the builder only ever read `id`,
// `name`, `categories` and `tags`, while `latitude`/`longitude` — the two fields
// that made the old generic constraint refuse a journal entry — were never
// touched. So the constraint narrowed to `GraphSubject` and the physics moved
// here unchanged.
//
// Two halves, both pure:
//
//   1. `buildTaxonomyGraph` turns subjects into nodes and edges — who connects
//      to whom, and how strongly.
//   2. `stepSimulation` advances the physics one frame.
//
// Neither knows about canvas, React or the DOM. The component owns the pixels
// and the animation loop; this file owns *where things are*, which is what makes
// the layout testable without rendering anything.
//
// Hand-rolled rather than d3-force: the simulation below is three forces and a
// Verlet integrator, it is readable in one sitting, and it keeps the dependency
// list where it is. The trade is that the tuning constants are ours to get
// right — see `DEFAULT_FORCES`.

/**
 * The least a thing must be to appear in one of these graphs.
 *
 * Saved locations and journal entries both satisfy it, which is the point.
 * `name` is whatever the node is labelled by — a place's name, an entry's
 * title.
 */
export interface GraphSubject {
  id: number;
  name: string;
  categories: string[];
  tags: string[];
}

/** Which of the two name lists an edge is drawn from. */
export type TaxonomyKind = "tag" | "category";

/**
 * One subject in the graph.
 *
 * Position and velocity are mutable and updated in place by `stepSimulation`:
 * a frame allocating a new node object per particle would churn the heap sixty
 * times a second for no benefit, since nothing outside the simulation holds a
 * reference across frames.
 */
export interface GraphNode<S extends GraphSubject = GraphSubject> {
  /** The thing this node stands for. */
  subject: S;
  x: number;
  y: number;
  /** Velocity, in units per step. Zero at rest. */
  vx: number;
  vy: number;
  /**
   * How many edges touch this node. Drives its drawn radius — a subject sharing
   * tags with many others is a hub and should read as one.
   */
  degree: number;
  /**
   * Pinned nodes ignore every force and stay where they are put. Set while a
   * node is being dragged, so the cursor wins over the physics.
   */
  isPinned: boolean;
}

/** A link between two subjects that have something in common. */
export interface GraphEdge {
  /** Index into the nodes array. Always less than `target`. */
  source: number;
  /** Index into the nodes array. */
  target: number;
  /** The taxonomy names both subjects carry, in the source's order. */
  shared: string[];
  /**
   * How strongly this edge pulls, 0–1. More shared names means a shorter, more
   * insistent spring, so the tightest clusters are the subjects with most in
   * common rather than merely the subjects with most connections.
   */
  strength: number;
}

export interface TaxonomyGraph<S extends GraphSubject = GraphSubject> {
  nodes: GraphNode<S>[];
  edges: GraphEdge[];
  /** The largest `shared.length` on any edge, for scaling line widths. */
  maxShared: number;
}

/**
 * Tuning for the simulation. One object so a caller can nudge a single force
 * without restating the rest, and so the defaults have one obvious home.
 *
 * The values are the result of balancing three things against each other:
 * repulsion has to beat attraction at short range or nodes collapse onto one
 * point, attraction has to beat centering at medium range or clusters never
 * form, and damping has to be low enough to settle but high enough not to
 * oscillate. Changing one in isolation usually means re-checking the others.
 */
export interface ForceSettings {
  /** How hard every node pushes every other node apart. */
  repulsion: number;
  /** How hard a shared tag pulls two subjects together. */
  attraction: number;
  /** The length a spring is happy at, in simulation units. */
  springLength: number;
  /** Pull toward the origin, keeping the graph from drifting off screen. */
  centering: number;
  /** Velocity retained each step. Below 1 or it never comes to rest. */
  damping: number;
  /**
   * Nodes closer than this are treated as this far apart.
   *
   * Without it, two coincident nodes produce a division by a near-zero distance
   * and fling each other to infinity — the classic way a hand-rolled force
   * layout explodes on its first frame.
   */
  minDistance: number;
  /**
   * The furthest a node may travel in one step.
   *
   * `minDistance` alone does not bound the system, and at a few dozen nodes
   * that never showed: it caps the force from *one pair*, while a node's
   * velocity is the sum over every other node. The Topics map made it visible
   * — 145 subjects seeded into a 160-unit disc puts most pairs inside
   * `minDistance`, each contributing the maximum impulse, and the total per
   * step exceeded what damping removes. Energy then multiplied about fifteen
   * times per step until it overflowed to Infinity and every coordinate became
   * NaN, so the canvas drew nothing at all.
   *
   * Clamping velocity makes the integrator stable at any node count instead of
   * only at the sizes it happened to be tried at. It is a speed limit, not a
   * force change: a settled layout reaches the same arrangement, just without
   * the overshoot on the first few frames when nodes start crowded.
   */
  maxVelocity: number;
}

export const DEFAULT_FORCES: ForceSettings = {
  repulsion: 6000,
  attraction: 0.08,
  springLength: 90,
  centering: 0.015,
  damping: 0.82,
  minDistance: 12,
  // Comfortably above the step a settled layout ever takes, so it never shapes
  // a normal frame — it only catches the runaway.
  maxVelocity: 40,
};

/** The taxonomy values a subject carries, for whichever list we're reading. */
function valuesOf(subject: GraphSubject, kind: TaxonomyKind): string[] {
  return kind === "tag" ? subject.tags : subject.categories;
}

/**
 * Names are compared case-insensitively, matching the repository's `COLLATE
 * NOCASE` — "hiking" and "Hiking" are one tag, so they must make one edge.
 */
function sharedNames(a: GraphSubject, b: GraphSubject, kind: TaxonomyKind): string[] {
  const other = new Set(valuesOf(b, kind).map((name) => name.toLowerCase()));
  return valuesOf(a, kind).filter((name) => other.has(name.toLowerCase()));
}

/**
 * Seeds a node's starting position on a circle rather than at random.
 *
 * A deterministic start matters more than it looks: `Math.random()` would give
 * a different layout on every render and make the simulation untestable. The
 * golden angle spreads successive nodes evenly instead of clumping them, which
 * is what stops the first few frames from being a violent explosion out of one
 * spot.
 */
function seedPosition(index: number, total: number): { x: number; y: number } {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const angle = index * goldenAngle;
  // Spread over a disc, not a ring: sqrt keeps the density even toward the edge.
  const radius = 160 * Math.sqrt((index + 0.5) / Math.max(total, 1));
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

/**
 * Builds the graph: every subject a node, an edge wherever two subjects share
 * at least one name.
 *
 * O(n²) in the number of subjects, because every pair must be considered. Fine
 * at the scale these graphs reach — a few hundred nodes is tens of thousands of
 * cheap set lookups, done once per rebuild and not per frame. The Topics screen
 * filters to one subject before building, which is what keeps it there.
 */
export function buildTaxonomyGraph<S extends GraphSubject>(
  subjects: readonly S[],
  kind: TaxonomyKind,
): TaxonomyGraph<S> {
  const nodes: GraphNode<S>[] = subjects.map((subject, index) => ({
    subject,
    ...seedPosition(index, subjects.length),
    vx: 0,
    vy: 0,
    degree: 0,
    isPinned: false,
  }));

  const edges: GraphEdge[] = [];
  let maxShared = 0;

  for (let i = 0; i < subjects.length; i += 1) {
    for (let j = i + 1; j < subjects.length; j += 1) {
      const shared = sharedNames(subjects[i], subjects[j], kind);
      if (shared.length === 0) continue;

      maxShared = Math.max(maxShared, shared.length);
      edges.push({ source: i, target: j, shared, strength: shared.length });
      nodes[i].degree += 1;
      nodes[j].degree += 1;
    }
  }

  // Normalise strength to 0–1 now that the maximum is known, so the renderer
  // and the physics both read one scale rather than each dividing again.
  for (const edge of edges) {
    edge.strength = maxShared === 0 ? 0 : edge.strength / maxShared;
  }

  return { nodes, edges, maxShared };
}

/**
 * Advances the simulation one frame, mutating node positions in place.
 *
 * Returns the total kinetic energy left in the system. A caller can stop
 * animating once it falls below a threshold — the layout has settled and
 * further frames would burn battery redrawing the same picture.
 */
export function stepSimulation<S extends GraphSubject>(
  graph: TaxonomyGraph<S>,
  forces: ForceSettings = DEFAULT_FORCES,
): number {
  const { nodes, edges } = graph;

  // --- Repulsion: every node pushes every other away -----------------------
  //
  // The O(n²) pass. A quadtree would make this O(n log n), which is what
  // d3-force does and why it scales to thousands; at the few hundred nodes
  // these graphs reach, the direct sum is faster than building the tree.
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distance = Math.sqrt(dx * dx + dy * dy);

      // Coincident nodes have no direction to separate along, so invent one.
      // Deterministic (derived from the indices) to keep the layout stable.
      if (distance < 0.001) {
        dx = Math.cos(i * 1.7 + j);
        dy = Math.sin(i * 1.7 + j);
        distance = 0.001;
      }

      const effective = Math.max(distance, forces.minDistance);
      const push = forces.repulsion / (effective * effective);
      const ux = dx / distance;
      const uy = dy / distance;

      a.vx -= ux * push;
      a.vy -= uy * push;
      b.vx += ux * push;
      b.vy += uy * push;
    }
  }

  // --- Attraction: a spring along every edge -------------------------------
  for (const edge of edges) {
    const a = nodes[edge.source];
    const b = nodes[edge.target];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.max(Math.sqrt(dx * dx + dy * dy), forces.minDistance);

    // More in common means a shorter rest length, so the strongest pairs end up
    // closest together rather than merely connected.
    const rest = forces.springLength * (1 - 0.4 * edge.strength);
    const pull = (distance - rest) * forces.attraction * (0.4 + edge.strength);
    const ux = dx / distance;
    const uy = dy / distance;

    a.vx += ux * pull;
    a.vy += uy * pull;
    b.vx -= ux * pull;
    b.vy -= uy * pull;
  }

  // --- Centering, damping, integration -------------------------------------
  let energy = 0;
  for (const node of nodes) {
    if (node.isPinned) {
      // A dragged node holds its place and keeps no momentum, so it does not
      // fly off when released.
      node.vx = 0;
      node.vy = 0;
      continue;
    }

    node.vx -= node.x * forces.centering;
    node.vy -= node.y * forces.centering;

    node.vx *= forces.damping;
    node.vy *= forces.damping;

    // The speed limit. Applied to the vector rather than to each axis, so a
    // clamped node keeps its direction instead of being dragged toward a
    // diagonal. See `maxVelocity` for what goes wrong without it.
    const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
    if (speed > forces.maxVelocity) {
      const scale = forces.maxVelocity / speed;
      node.vx *= scale;
      node.vy *= scale;
    }

    node.x += node.vx;
    node.y += node.vy;

    energy += node.vx * node.vx + node.vy * node.vy;
  }

  return energy;
}

/**
 * Runs the simulation to rest, or until `maxSteps`.
 *
 * For a static first paint and for tests, which need a settled layout without an
 * animation loop. `maxSteps` is a guard: a pathological graph can oscillate
 * without ever crossing the energy threshold, and a test that hangs is worse
 * than one that asserts on an imperfect layout.
 */
export function settleGraph<S extends GraphSubject>(
  graph: TaxonomyGraph<S>,
  forces: ForceSettings = DEFAULT_FORCES,
  maxSteps = 300,
  restEnergy = 0.01,
): number {
  for (let step = 0; step < maxSteps; step += 1) {
    if (stepSimulation(graph, forces) < restEnergy) return step + 1;
  }
  return maxSteps;
}

/**
 * The node under a point, or undefined. Searched back to front so the node
 * drawn on top is the one picked, matching what the reader sees.
 */
export function findNodeAt<S extends GraphSubject>(
  graph: TaxonomyGraph<S>,
  x: number,
  y: number,
  radius: number,
): GraphNode<S> | undefined {
  for (let i = graph.nodes.length - 1; i >= 0; i -= 1) {
    const node = graph.nodes[i];
    const dx = node.x - x;
    const dy = node.y - y;
    if (dx * dx + dy * dy <= radius * radius) return node;
  }
  return undefined;
}

/**
 * Every node index directly connected to `index`, plus the node itself.
 *
 * For the hover highlight: the neighbourhood stays lit and everything else dims.
 */
export function neighbourIndices<S extends GraphSubject>(
  graph: TaxonomyGraph<S>,
  index: number,
): Set<number> {
  const found = new Set<number>([index]);
  for (const edge of graph.edges) {
    if (edge.source === index) found.add(edge.target);
    else if (edge.target === index) found.add(edge.source);
  }
  return found;
}

/**
 * The bounding box of the laid-out nodes, padded.
 *
 * The component uses it to fit the graph to the canvas on first paint, so a
 * settled layout is framed rather than arbitrarily cropped.
 */
export function graphBounds<S extends GraphSubject>(
  graph: TaxonomyGraph<S>,
  padding = 40,
): { minX: number; minY: number; maxX: number; maxY: number } {
  if (graph.nodes.length === 0) {
    return { minX: -padding, minY: -padding, maxX: padding, maxY: padding };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of graph.nodes) {
    if (node.x < minX) minX = node.x;
    if (node.y < minY) minY = node.y;
    if (node.x > maxX) maxX = node.x;
    if (node.y > maxY) maxY = node.y;
  }

  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
}
