"use client";

// Anything tagged, as a force-directed graph: every subject is a dot, two dots
// are joined when they share a tag (or a category), and the arrangement falls
// out of a physics simulation rather than being authored. Drag a node, scroll
// to zoom, drag the background to pan, hover to light up a neighbourhood, click
// to raise a selection.
//
// A sibling of `location-graph-view.tsx`, not a replacement for it. That one
// draws saved places and knows about coordinates (its label falls back to a
// lat/long pair) and about the Location Manager's View switch. This one draws
// whatever satisfies `GraphSubject` and takes its label ready-made, which is
// what the Journal's Topics section needs. **The simulation underneath is the
// same module** — `@/lib/shared/taxonomy-graph` — so there is one force layout
// in this codebase, drawn by two components with different vocabularies.
//
// Canvas rather than SVG. At a few hundred nodes and the edges between them, SVG
// means thousands of DOM elements re-laid-out sixty times a second; a canvas
// redraw is one call. The trade is that nothing here is in the accessibility
// tree, which is why the keyboard path is a real list and not a focus ring on a
// dot — see `GraphList` at the bottom.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildTaxonomyGraph,
  findNodeAt,
  graphBounds,
  neighbourIndices,
  settleGraph,
  stepSimulation,
  type GraphSubject,
  type TaxonomyGraph,
  type TaxonomyKind,
} from "@/lib/shared/taxonomy-graph";

/** Node radius in graph units, before zoom. Grows a little with degree. */
const BASE_RADIUS = 6;
const MAX_RADIUS = 16;

/** Zoom limits. Past these the picture is either a smear or one dot. */
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;

/**
 * Below this much kinetic energy the layout has settled and the loop stops.
 *
 * Stopping matters: a force simulation that keeps running redraws an identical
 * picture sixty times a second forever, which on a laptop is a fan spinning up
 * for nothing.
 */
const REST_ENERGY = 0.05;

/** Frames to run before giving up on settling. */
const MAX_FRAMES = 600;

/** How far the pointer may move between down and up and still count as a click. */
const CLICK_SLOP = 4;

export interface TaxonomyGraphViewProps<S extends GraphSubject = GraphSubject> {
  /** The subjects to graph. */
  subjects: readonly S[];
  /** Which taxonomy joins them. */
  kind: TaxonomyKind;
  /**
   * Raised with the subject whose node was clicked. The component raises intent
   * and nothing more — what a click opens is the caller's business.
   */
  onSelect?: (subject: S) => void;
  /** Canvas height. Callers set this per screen; the view is already narrow-aware. */
  height?: string;
  /**
   * What a node's size should mean, as a positive weight.
   *
   * Omitted, nodes are sized by **degree** — how many links they have — which
   * is right when every node is one record and the interesting thing is how
   * connected it is.
   *
   * Pass this when the nodes themselves have different magnitudes: Journal's
   * Topics map draws tags, where a tag on 90 entries is a bigger subject than
   * one on 3 regardless of how many neighbours it happens to have. Weights are
   * scaled against the largest in the set, so the units are the caller's own.
   */
  weightOf?: (subject: S) => number;
  /**
   * Which of two accents a node draws in, for a graph holding two kinds of
   * thing. Omitted, every node uses the primary accent.
   *
   * Deliberately a two-way choice rather than a colour: the palette is read
   * from the theme at runtime (design.md forbids literal colours), so a caller
   * cannot be handed one to pick from.
   */
  accentOf?: (subject: S) => "primary" | "secondary";
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/**
 * A node's drawn radius from its degree: hubs read bigger, but not without
 * limit.
 *
 * Takes only what it reads rather than a whole node, so the generic stays out
 * of a pure calculation.
 */
function radiusOf(node: { degree: number }): number {
  return Math.min(BASE_RADIUS + node.degree * 0.8, MAX_RADIUS);
}

/**
 * A node's drawn radius from a caller-supplied weight, scaled against the
 * largest weight in the set.
 *
 * Square-rooted, because a dot's *area* is what the eye compares: scaling the
 * radius linearly would make a tag on 90 entries look thirty times heavier
 * than one on 3 rather than about five times, and one huge disc would swamp
 * the picture. A zero or negative weight still draws at the base size — an
 * invisible node is worse than a small one.
 */
function weightedRadius(weight: number, maxWeight: number): number {
  if (maxWeight <= 0 || weight <= 0) return BASE_RADIUS;
  return BASE_RADIUS + (MAX_RADIUS - BASE_RADIUS) * Math.sqrt(weight / maxWeight);
}

/**
 * The theme's colours, resolved to values canvas can use.
 *
 * Canvas takes no CSS classes, so the tokens have to be read off `:root` at
 * runtime — design.md's rule is that colours are theme tokens, and a literal
 * hex here would be wrong on most of the themes. Re-read whenever the theme
 * changes rather than once per mount: this app swaps themes live, and a cached
 * accent would leave the graph drawn in the previous theme's colours.
 *
 * Same approach as `location-graph-view.tsx`; the fallbacks only apply on the
 * server, where there is no computed style to read.
 */
function useThemeColors(): {
  brass: string;
  brassDark: string;
  ink: string;
  line: string;
  paper: string;
} {
  const read = useCallback(() => {
    if (typeof window === "undefined") {
      return {
        brass: "#b9975b",
        brassDark: "#8a6f3e",
        ink: "#e8e3d8",
        line: "#3a3a3a",
        paper: "#1a1a1a",
      };
    }
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback;
    return {
      brass: token("--brass", "#b9975b"),
      brassDark: token("--brass-dark", "#8a6f3e"),
      ink: token("--ink", "#e8e3d8"),
      line: token("--line", "#3a3a3a"),
      paper: token("--paper", "#1a1a1a"),
    };
  }, []);

  const [colors, setColors] = useState(read);

  useEffect(() => {
    const observer = new MutationObserver(() => setColors(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class", "style"],
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the computed
    // style is unknowable during render (no `window` on the server), so the
    // first real read has to happen after mount.
    setColors(read());
    return () => observer.disconnect();
  }, [read]);

  return colors;
}

export function TaxonomyGraphView<S extends GraphSubject>({
  subjects,
  kind,
  onSelect,
  height = "32rem",
  weightOf,
  accentOf,
  className = "",
}: TaxonomyGraphViewProps<S>) {
  const colors = useThemeColors();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hovered, setHovered] = useState<number | undefined>(undefined);

  // The largest weight in the set, so every radius is relative to it. Computed
  // once per subject list rather than per frame.
  const maxWeight = useMemo(() => {
    if (!weightOf) return 0;
    let max = 0;
    for (const subject of subjects) max = Math.max(max, weightOf(subject));
    return max;
  }, [subjects, weightOf]);

  /** One node's radius, by whichever rule this caller chose. */
  const nodeRadius = useCallback(
    (node: { degree: number; subject: S }) =>
      weightOf ? weightedRadius(weightOf(node.subject), maxWeight) : radiusOf(node),
    [weightOf, maxWeight],
  );

  // The graph is rebuilt only when the subjects or the joining taxonomy change.
  // Settled once here rather than animated from the seed positions: the first
  // paint is then the finished arrangement instead of an explosion that
  // resolves over a second, which reads as a glitch on a screen the reader
  // just navigated to.
  const graph = useMemo<TaxonomyGraph<S>>(() => {
    const built = buildTaxonomyGraph(subjects, kind);
    settleGraph(built);
    return built;
  }, [subjects, kind]);

  // Pan and zoom, in a ref rather than state: they change on every pointer move
  // and every wheel tick, and re-rendering React for each one would drop frames
  // while the canvas is redrawn imperatively anyway.
  const viewRef = useRef({ x: 0, y: 0, zoom: 1 });
  const frameRef = useRef(0);
  const runningRef = useRef(false);

  /** Fits the settled layout to the canvas, so nothing starts off screen. */
  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = graphBounds(graph);
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    if (width <= 0 || height <= 0) return;

    const zoom = Math.min(
      Math.max(Math.min(canvas.clientWidth / width, canvas.clientHeight / height), MIN_ZOOM),
      MAX_ZOOM,
    );
    viewRef.current = {
      zoom,
      x: canvas.clientWidth / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom,
      y: canvas.clientHeight / 2 - ((bounds.minY + bounds.maxY) / 2) * zoom,
    };
  }, [graph]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
      canvas.width = width * ratio;
      canvas.height = height * ratio;
    }

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const view = viewRef.current;
    context.translate(view.x, view.y);
    context.scale(view.zoom, view.zoom);

    const lit = hovered === undefined ? undefined : neighbourIndices(graph, hovered);

    // Edges first, so nodes sit on top of them.
    for (const edge of graph.edges) {
      const a = graph.nodes[edge.source];
      const b = graph.nodes[edge.target];
      const isLit = lit === undefined || (lit.has(edge.source) && lit.has(edge.target));

      context.globalAlpha = isLit ? 0.55 : 0.12;
      context.strokeStyle = colors.line;
      context.lineWidth = (0.5 + edge.strength * 1.8) / view.zoom;
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
    }

    for (let i = 0; i < graph.nodes.length; i += 1) {
      const node = graph.nodes[i];
      const radius = nodeRadius(node);
      const isLit = lit === undefined || lit.has(i);

      context.globalAlpha = isLit ? 1 : 0.25;
      context.beginPath();
      context.arc(node.x, node.y, radius, 0, Math.PI * 2);
      // Hover always wins, so the node under the cursor reads as picked
      // whichever accent it normally carries.
      context.fillStyle =
        i === hovered
          ? colors.brass
          : accentOf?.(node.subject) === "secondary"
            ? colors.ink
            : colors.brassDark;
      context.fill();
      context.lineWidth = 1 / view.zoom;
      context.strokeStyle = colors.paper;
      context.stroke();

      // Labels only when zoomed in enough to read them, and only for the lit
      // neighbourhood — every label at every zoom is an unreadable mat of text.
      if (view.zoom > 0.6 && isLit) {
        context.globalAlpha = isLit ? 0.9 : 0.2;
        context.fillStyle = colors.ink;
        context.font = `${11 / view.zoom}px system-ui, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "top";
        context.fillText(node.subject.name, node.x, node.y + radius + 3 / view.zoom);
      }
    }

    context.globalAlpha = 1;
    // `nodeRadius` and `accentOf` are read per node, so a change to either has
    // to redraw — without them here the canvas would keep painting the previous
    // sizing rule until something else forced a frame.
  }, [colors, graph, hovered, nodeRadius, accentOf]);

  // Redraw whenever the picture could have changed. The simulation is already
  // settled, so this is one frame, not a loop.
  useEffect(() => {
    fit();
    draw();
  }, [fit, draw]);

  useEffect(() => {
    const onResize = () => {
      fit();
      draw();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fit, draw]);

  /** Canvas pixels -> graph units. */
  const toGraph = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const view = viewRef.current;
    return {
      x: (clientX - rect.left - view.x) / view.zoom,
      y: (clientY - rect.top - view.y) / view.zoom,
    };
  }, []);

  /**
   * Runs the simulation again for a while.
   *
   * Dragging a node invalidates the settled layout, so the physics has to pick
   * back up — but only until it rests again, and never for longer than
   * `MAX_FRAMES`, so a graph that will not settle still stops burning frames.
   */
  const kick = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    let frames = 0;

    const tick = () => {
      const energy = stepSimulation(graph);
      draw();
      frames += 1;
      if (energy < REST_ENERGY || frames > MAX_FRAMES) {
        runningRef.current = false;
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [graph, draw]);

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  const dragRef = useRef<
    { kind: "node"; index: number; moved: number } | { kind: "pan"; moved: number } | undefined
  >(undefined);
  const lastRef = useRef({ x: 0, y: 0 });

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    lastRef.current = { x: event.clientX, y: event.clientY };
    const point = toGraph(event.clientX, event.clientY);
    const node = findNodeAt(graph, point.x, point.y, MAX_RADIUS);

    if (node) {
      const index = graph.nodes.indexOf(node);
      node.isPinned = true;
      dragRef.current = { kind: "node", index, moved: 0 };
    } else {
      dragRef.current = { kind: "pan", moved: 0 };
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const dx = event.clientX - lastRef.current.x;
    const dy = event.clientY - lastRef.current.y;

    if (!drag) {
      const point = toGraph(event.clientX, event.clientY);
      const node = findNodeAt(graph, point.x, point.y, MAX_RADIUS);
      const index = node ? graph.nodes.indexOf(node) : undefined;
      if (index !== hovered) setHovered(index);
      return;
    }

    lastRef.current = { x: event.clientX, y: event.clientY };
    drag.moved += Math.abs(dx) + Math.abs(dy);

    if (drag.kind === "node") {
      const node = graph.nodes[drag.index];
      node.x += dx / viewRef.current.zoom;
      node.y += dy / viewRef.current.zoom;
      kick();
    } else {
      viewRef.current.x += dx;
      viewRef.current.y += dy;
      draw();
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = undefined;
    if (!drag) return;

    if (drag.kind === "node") {
      const node = graph.nodes[drag.index];
      node.isPinned = false;
      // A press that barely moved is a click, not a drag.
      if (drag.moved <= CLICK_SLOP && onSelect) onSelect(node.subject);
      kick();
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    const view = viewRef.current;
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    const next = Math.min(Math.max(view.zoom * factor, MIN_ZOOM), MAX_ZOOM);

    // Zoom about the pointer rather than the origin, so the thing under the
    // cursor stays under the cursor.
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    view.x = px - ((px - view.x) / view.zoom) * next;
    view.y = py - ((py - view.y) / view.zoom) * next;
    view.zoom = next;
    draw();
  };

  return (
    <div className={className}>
      <canvas
        ref={canvasRef}
        className="w-full cursor-grab touch-none rounded-lg border border-line bg-paper active:cursor-grabbing"
        style={{ height }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => setHovered(undefined)}
        onWheel={handleWheel}
      />
      <p className="mt-2 text-xs text-ink/50">
        Drag a dot to move it, drag the background to pan, scroll to zoom. Dots sitting
        together share {kind === "tag" ? "tags" : "categories"}.
      </p>
      <GraphList graph={graph} onSelect={onSelect} />
    </div>
  );
}

/**
 * The same graph as a ranked list, hubs first.
 *
 * Not a fallback — it is the keyboard and screen-reader path. A canvas puts
 * nothing in the accessibility tree, so without this the whole view would be
 * unreachable without a mouse.
 */
function GraphList<S extends GraphSubject>({
  graph,
  onSelect,
}: {
  graph: TaxonomyGraph<S>;
  onSelect?: (subject: S) => void;
}) {
  const ranked = useMemo(
    () =>
      [...graph.nodes].sort(
        (a, b) => b.degree - a.degree || a.subject.name.localeCompare(b.subject.name),
      ),
    [graph],
  );

  if (ranked.length === 0) return null;

  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs text-ink/60 hover:text-ink">
        List the {ranked.length} entries in this graph
      </summary>
      <ul className="mt-2 space-y-1">
        {ranked.map((node) => (
          <li key={node.subject.id}>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-ink/5"
              onClick={() => onSelect?.(node.subject)}
            >
              <span className="truncate">{node.subject.name}</span>
              <span className="ml-auto shrink-0 text-xs text-ink/50">
                {node.degree} {node.degree === 1 ? "link" : "links"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
