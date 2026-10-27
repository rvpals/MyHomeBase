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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FullscreenStage, canGoFullscreen } from "@/components/fullscreen-stage";
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
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Read after mount, never during render: `document.fullscreenEnabled` does
  // not exist on the server, and iOS Safari on iPhone has no element
  // fullscreen at all. A control that cannot work is worse than no control.
  const [canFullscreen, setCanFullscreen] = useState(false);
  useEffect(() => setCanFullscreen(canGoFullscreen()), []);

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

  // Entering or leaving fullscreen changes the canvas size without firing a
  // window resize, so the view has to be refitted explicitly — otherwise the
  // graph keeps the old zoom and sits in a corner of the stage. One frame
  // later, because the browser has not laid the new size out yet when the
  // state flips.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      fit();
      draw();
    });
    return () => cancelAnimationFrame(id);
  }, [isFullscreen, fit, draw]);

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

  /**
   * Live pointers, for pinch.
   *
   * A touch screen has no wheel, so without this the only zoom on a phone or
   * tablet would be the buttons. Two fingers is what people already try.
   */
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<number | undefined>(undefined);

  /** Distance between the two live pointers, or undefined when there aren't two. */
  const pinchDistance = (): number | undefined => {
    const points = [...pointersRef.current.values()];
    if (points.length !== 2) return undefined;
    const dx = points[0].x - points[1].x;
    const dy = points[0].y - points[1].y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    // A second finger turns whatever was happening into a pinch: drop the drag
    // so the node being held does not fly across the canvas with the gesture.
    if (pointersRef.current.size === 2) {
      const drag = dragRef.current;
      if (drag?.kind === "node") graph.nodes[drag.index].isPinned = false;
      dragRef.current = undefined;
      pinchRef.current = pinchDistance();
      return;
    }

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
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    // Two fingers: scale by how much the gap changed, about the midpoint
    // between them — the same anchoring rule the wheel uses.
    if (pointersRef.current.size === 2) {
      const next = pinchDistance();
      const previous = pinchRef.current;
      if (next !== undefined && previous !== undefined && previous > 0) {
        const canvas = canvasRef.current;
        const points = [...pointersRef.current.values()];
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          zoomAbout(
            next / previous,
            (points[0].x + points[1].x) / 2 - rect.left,
            (points[0].y + points[1].y) / 2 - rect.top,
          );
        }
        pinchRef.current = next;
      }
      return;
    }

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
    pointersRef.current.delete(event.pointerId);
    // Lifting one finger of a pinch must not resume a drag with the other:
    // the gesture ends, and the remaining finger does nothing until it is
    // lifted and put down again.
    if (pointersRef.current.size < 2) pinchRef.current = undefined;

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

  /**
   * Scales about a point in canvas pixels, so whatever is under it stays put.
   *
   * The wheel passes the pointer; the buttons pass the canvas centre, which is
   * what makes a button press feel like zooming *the view* rather than
   * dragging the picture toward a corner.
   */
  const zoomAbout = useCallback(
    (factor: number, px: number, py: number) => {
      const view = viewRef.current;
      const next = Math.min(Math.max(view.zoom * factor, MIN_ZOOM), MAX_ZOOM);
      if (next === view.zoom) return;

      view.x = px - ((px - view.x) / view.zoom) * next;
      view.y = py - ((py - view.y) / view.zoom) * next;
      view.zoom = next;
      draw();
    },
    [draw],
  );

  /** Zoom from a button: about the middle of the canvas. */
  const zoomByButton = useCallback(
    (factor: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      zoomAbout(factor, canvas.clientWidth / 2, canvas.clientHeight / 2);
    },
    [zoomAbout],
  );

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    zoomAbout(
      event.deltaY < 0 ? 1.1 : 1 / 1.1,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
  };

  const canvasBlock = (
    // `h-full` in fullscreen so the canvas has a height to fill — a bare
    // `relative` div is content-sized, and `h-full` on the canvas inside it
    // would resolve against nothing.
    <div className={isFullscreen ? "relative h-full w-full" : "relative"}>
      <canvas
        ref={canvasRef}
        className={`w-full cursor-grab touch-none border-line bg-paper active:cursor-grabbing ${
          isFullscreen ? "block h-full border-0" : "rounded-lg border"
        }`}
        style={isFullscreen ? undefined : { height }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => setHovered(undefined)}
        onWheel={handleWheel}
      />
      {/* Over the canvas rather than beside it, so the picture keeps the full
          width — and so the same controls work on the fullscreen stage, which
          has nothing else on it. */}
      <div className="absolute right-2 top-2 flex flex-col gap-1">
        <GraphControl label="Zoom in" onClick={() => zoomByButton(1.25)}>
          +
        </GraphControl>
        <GraphControl label="Zoom out" onClick={() => zoomByButton(1 / 1.25)}>
          −
        </GraphControl>
        <GraphControl
          label="Fit to view"
          onClick={() => {
            fit();
            draw();
          }}
        >
          ⤢
        </GraphControl>
        {canFullscreen && !isFullscreen && (
          <GraphControl label="Full screen" onClick={() => setIsFullscreen(true)}>
            ⛶
          </GraphControl>
        )}
      </div>
    </div>
  );

  // One canvas, in one place or the other — never both. Two elements would
  // each claim `canvasRef` on mount and the second would win, leaving the
  // visible one unpainted.
  return (
    <div className={className}>
      {isFullscreen ? (
        <FullscreenStage onExit={() => setIsFullscreen(false)} label="Relationship graph">
          <div className="h-full w-full">{canvasBlock}</div>
        </FullscreenStage>
      ) : (
        canvasBlock
      )}
      <p className="mt-2 text-xs text-ink/50">
        Drag a dot to move it, drag the background to pan, pinch or scroll to zoom. Dots
        sitting together share {kind === "tag" ? "tags" : "categories"}.
      </p>
      <GraphList graph={graph} onSelect={onSelect} />
    </div>
  );
}

/** One of the square controls layered over the canvas. */
function GraphControl({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      // Deliberately not `Button`: design.md reserves that hard offset shadow
      // for discrete page-level actions, and these are a cluster of small
      // repeatable controls sitting on the artwork — the same call the
      // calculator keypad makes.
      className="flex h-7 w-7 items-center justify-center rounded border border-line bg-paper/90 text-sm text-ink/70 hover:border-brass hover:text-ink"
    >
      {children}
    </button>
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
