"use client";

// Saved places as a force-directed graph, in the shape of a Logseq graph view:
// every place is a dot, two dots are joined when the places share a tag (or a
// category), and the arrangement falls out of a physics simulation rather than
// being authored. Drag a node, scroll to zoom, drag the background to pan,
// hover to light up a neighbourhood, click to open the editor.
//
// A fourth shape for the Location Manager's View switch, beside List, Card and
// Venn. The Venn is exact about two or three tags; this is approximate about
// all of them — clusters show you which places belong together without you
// having to name the tags first.
//
// Canvas rather than SVG. At a few hundred nodes and the edges between them, SVG
// means thousands of DOM elements re-laid-out sixty times a second; a canvas
// redraw is one call. The trade is that nothing here is in the accessibility
// tree, which is why the keyboard path is a real list and not a focus ring on a
// dot — see `GraphList` at the bottom.
//
// The simulation itself lives in `lib/sys-locations/location-graph`. This file
// owns pixels, pointers and the animation loop, and nothing else.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsCompact } from "@/components/viewport-context";
import {
  buildLocationGraph,
  findNodeAt,
  graphBounds,
  neighbourIndices,
  settleGraph,
  stepSimulation,
  type GraphNode,
  type LocationGraph,
  type LocationTaxonomyKind,
  type SavedLocation,
} from "@/lib/sys-locations";

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

/**
 * Frames to run before giving up on settling.
 *
 * A dense graph can jitter below the rest threshold without ever crossing it;
 * this stops the loop anyway, because a layout still twitching after ten seconds
 * is not going to improve.
 */
const MAX_FRAMES = 600;

/** How far the pointer may move between down and up and still count as a click. */
const CLICK_SLOP = 4;

export interface LocationGraphViewProps<P extends SavedLocation = SavedLocation> {
  /** The places to graph. */
  places: readonly P[];
  /** Which taxonomy joins them. */
  kind: LocationTaxonomyKind;
  /**
   * Raised with the place whose node was clicked. The component raises intent
   * and nothing more — opening an editor is the caller's business.
   */
  onSelect?: (place: P) => void;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

/** A place's name, or its coordinates when it has none — same fallback as the row. */
function displayName(place: SavedLocation): string {
  const trimmed = place.name.trim();
  if (trimmed !== "") return trimmed;
  return `${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)}`;
}

/**
 * A node's drawn radius: hubs read bigger, but not without limit.
 *
 * Takes only what it reads, rather than a `GraphNode<P>`: `degree` is the whole
 * input, so narrowing the parameter keeps the generic out of a pure calculation.
 */
function radiusOf(node: { degree: number }): number {
  return Math.min(BASE_RADIUS + node.degree * 0.8, MAX_RADIUS);
}

/**
 * The theme's colours, resolved to values canvas can use.
 *
 * Canvas takes no CSS classes, so the tokens have to be read off `:root` at
 * runtime. Re-read whenever the theme changes rather than once per mount: this
 * app swaps themes live, and a cached brass would leave the graph drawn in the
 * previous theme's accent until something else forced a remount.
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
      return { brass: "#b9975b", brassDark: "#8a6f3e", ink: "#e8e3d8", line: "#3a3a3a", paper: "#1a1a1a" };
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
    // The theme is swapped by setting attributes on <html>, so that is what we
    // watch. Cheaper and more reliable than polling the computed style.
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

export function LocationGraphView<P extends SavedLocation>({
  places,
  kind,
  onSelect,
  className = "",
}: LocationGraphViewProps<P>) {
  const isCompact = useIsCompact();
  const colors = useThemeColors();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // The graph is rebuilt only when the data or the axis changes. Rebuilding on
  // every render would restart the simulation from its seed positions, so the
  // layout would visibly jump on an unrelated state change.
  const graph = useMemo(() => buildLocationGraph(places, kind), [places, kind]);

  /**
   * View transform, in a ref rather than state: it changes on every wheel tick
   * and every pan frame, and a re-render per tick would make panning crawl. The
   * canvas reads it directly in the draw loop.
   */
  const viewRef = useRef({ zoom: 1, offsetX: 0, offsetY: 0 });
  /** Set when the layout has been fitted, so it only happens once per graph. */
  const hasFittedRef = useRef(false);

  // Hover is state, not a ref: it changes the picture *and* the caption below
  // it, and it only fires on pointer moves, which are not per-frame.
  const [hovered, setHovered] = useState<number | null>(null);

  const dragRef = useRef<{
    node: GraphNode<P> | null;
    pointerId: number;
    startX: number;
    startY: number;
    moved: number;
  } | null>(null);

  const litRef = useRef<Set<number> | null>(null);
  litRef.current = hovered === null ? null : neighbourIndices(graph, hovered);

  /** Canvas pixel -> graph coordinate, through the current transform. */
  const toGraph = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const view = viewRef.current;
    return {
      x: (clientX - rect.left - rect.width / 2) / view.zoom - view.offsetX,
      y: (clientY - rect.top - rect.height / 2) / view.zoom - view.offsetY,
    };
  }, []);

  // --- The draw loop --------------------------------------------------------
  //
  // One effect owns both the simulation and the painting, because they share a
  // frame: stepping the physics in a second effect would mean two loops racing
  // to describe the same positions.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    let frame = 0;
    let frameId = 0;
    let isRunning = true;

    /** Sizes the backing store to the element, accounting for a retina screen. */
    function resize() {
      if (!canvas || !wrapper) return;
      const ratio = window.devicePixelRatio || 1;
      const { width, height } = wrapper.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(width * ratio));
      canvas.height = Math.max(1, Math.floor(height * ratio));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    /** Frames the settled layout in the canvas, once per graph. */
    function fit() {
      if (!canvas || !wrapper || hasFittedRef.current) return;
      const { width, height } = wrapper.getBoundingClientRect();
      if (width === 0 || height === 0) return;

      const bounds = graphBounds(graph);
      const spanX = bounds.maxX - bounds.minX;
      const spanY = bounds.maxY - bounds.minY;
      const zoom = Math.min(width / spanX, height / spanY, MAX_ZOOM);

      viewRef.current = {
        zoom: Math.max(zoom, MIN_ZOOM),
        offsetX: -(bounds.minX + spanX / 2),
        offsetY: -(bounds.minY + spanY / 2),
      };
      hasFittedRef.current = true;
    }

    function draw() {
      if (!canvas || !context) return;
      const ratio = window.devicePixelRatio || 1;
      const view = viewRef.current;
      const lit = litRef.current;

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);

      // Centre the origin, then apply pan and zoom, so the maths above and the
      // drawing below agree about where a graph coordinate lands.
      context.setTransform(
        view.zoom * ratio,
        0,
        0,
        view.zoom * ratio,
        (canvas.width / 2) + view.offsetX * view.zoom * ratio,
        (canvas.height / 2) + view.offsetY * view.zoom * ratio,
      );

      // Edges first, so nodes sit on top of their own connections.
      for (const edge of graph.edges) {
        const a = graph.nodes[edge.source];
        const b = graph.nodes[edge.target];
        const isLit = lit === null || (lit.has(edge.source) && lit.has(edge.target));

        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.strokeStyle = isLit ? colors.brassDark : colors.line;
        // Thicker with more shared names, so the strongest relationships read
        // as the strongest lines.
        context.lineWidth = (0.6 + edge.strength * 1.8) / view.zoom;
        context.globalAlpha = isLit ? 0.75 : 0.12;
        context.stroke();
      }

      context.globalAlpha = 1;

      for (let index = 0; index < graph.nodes.length; index += 1) {
        const node = graph.nodes[index];
        const isLit = lit === null || lit.has(index);
        const isHovered = hovered === index;
        const radius = radiusOf(node);

        context.beginPath();
        context.arc(node.x, node.y, radius, 0, Math.PI * 2);
        // An unconnected place is drawn hollow: it is in the library but shares
        // nothing, which is a fact worth seeing rather than a dot like any other.
        context.fillStyle = node.degree === 0 ? colors.paper : colors.brass;
        context.globalAlpha = isLit ? 1 : 0.15;
        context.fill();
        context.lineWidth = (isHovered ? 2.5 : 1) / view.zoom;
        context.strokeStyle = isHovered ? colors.ink : colors.brassDark;
        context.stroke();

        // Labels only for the hovered neighbourhood, or when zoomed in far
        // enough that they will not overlap into mush.
        const showLabel = isHovered || (lit !== null && isLit) || view.zoom > 1.4;
        if (showLabel) {
          context.globalAlpha = 1;
          context.fillStyle = colors.ink;
          context.font = `${11 / view.zoom}px ui-sans-serif, system-ui, sans-serif`;
          context.textAlign = "center";
          context.textBaseline = "top";
          context.fillText(displayName(node.place), node.x, node.y + radius + 3 / view.zoom);
        }
      }

      context.globalAlpha = 1;
    }

    function loop() {
      if (!isRunning) return;
      // A dragged node keeps the simulation awake, so the graph reflows around
      // it instead of freezing mid-drag.
      const isDragging = dragRef.current?.node != null;
      if (frame < MAX_FRAMES || isDragging) {
        const energy = stepSimulation(graph);
        frame += 1;
        if (energy < REST_ENERGY && !isDragging) frame = MAX_FRAMES;
      }
      draw();
      frameId = window.requestAnimationFrame(loop);
    }

    resize();
    // Settle before the first paint so the graph appears arranged rather than
    // visibly exploding out of its seed circle.
    settleGraph(graph);
    fit();
    loop();

    const observer = new ResizeObserver(() => {
      resize();
      draw();
    });
    observer.observe(wrapper);

    return () => {
      isRunning = false;
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [graph, colors, hovered]);

  // Re-fit when the graph itself changes.
  useEffect(() => {
    hasFittedRef.current = false;
  }, [graph]);

  // --- Pointer handling -----------------------------------------------------

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const point = toGraph(event.clientX, event.clientY);
      const node = findNodeAt(graph, point.x, point.y, MAX_RADIUS);
      if (node) node.isPinned = true;

      dragRef.current = {
        node: node ?? null,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: 0,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [graph, toGraph],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;

      if (!drag) {
        // Not dragging: this is a hover.
        const point = toGraph(event.clientX, event.clientY);
        const node = findNodeAt(graph, point.x, point.y, MAX_RADIUS);
        const index = node ? graph.nodes.indexOf(node) : null;
        setHovered(index);
        return;
      }

      drag.moved += Math.abs(event.movementX) + Math.abs(event.movementY);

      if (drag.node) {
        // Dragging a node: it follows the cursor exactly.
        const point = toGraph(event.clientX, event.clientY);
        drag.node.x = point.x;
        drag.node.y = point.y;
        return;
      }

      // Dragging the background: pan. Divided by zoom so a drag moves the
      // picture by the distance the cursor travelled, at any magnification.
      const view = viewRef.current;
      view.offsetX += event.movementX / view.zoom;
      view.offsetY += event.movementY / view.zoom;
    },
    [graph, toGraph],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;

      if (drag.node) {
        // Released: hand the node back to the physics.
        drag.node.isPinned = false;
        // A press that never really moved is a click, not a drag.
        if (drag.moved <= CLICK_SLOP && onSelect) onSelect(drag.node.place);
      }

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [onSelect],
  );

  const handleWheel = useCallback((event: React.WheelEvent<HTMLCanvasElement>) => {
    const view = viewRef.current;
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    view.zoom = Math.min(Math.max(view.zoom * factor, MIN_ZOOM), MAX_ZOOM);
  }, []);

  const hoveredNode = hovered === null ? undefined : graph.nodes[hovered];
  const word = kind === "tag" ? "tags" : "categories";

  if (places.length === 0) {
    return (
      <p className={`rounded-md border border-dashed border-line p-6 text-center text-sm text-muted ${className}`}>
        No places to graph.
      </p>
    );
  }

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div
        ref={wrapperRef}
        className="relative w-full overflow-hidden rounded-md border border-line bg-paper-raised"
        style={{ height: isCompact ? "26rem" : "44rem" }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={() => setHovered(null)}
          onWheel={handleWheel}
          className="block touch-none"
          style={{ cursor: hovered === null ? "grab" : "pointer" }}
        />

        {/* The caption, not a tooltip: a fixed corner never covers the node you
            are pointing at, and it has room for the shared names. */}
        <div className="pointer-events-none absolute bottom-2 left-2 right-2 rounded bg-paper/90 px-2 py-1 text-xs text-muted">
          {hoveredNode ? (
            <>
              <span className="text-ink">{displayName(hoveredNode.place)}</span>
              {" — "}
              {hoveredNode.degree === 0
                ? `shares no ${word} with anything`
                : `${hoveredNode.degree} connection${hoveredNode.degree === 1 ? "" : "s"}`}
            </>
          ) : (
            <>
              {graph.nodes.length} place{graph.nodes.length === 1 ? "" : "s"},{" "}
              {graph.edges.length} link{graph.edges.length === 1 ? "" : "s"} by shared {word} —
              drag to move, scroll to zoom, click to edit
            </>
          )}
        </div>
      </div>

      {/* Type argument pinned: inference from two props that each mention `P`
          can resolve to the constraint rather than the caller's narrower type. */}
      <GraphList<P> graph={graph} onSelect={onSelect} />
    </div>
  );
}

/**
 * The keyboard and screen-reader path.
 *
 * A canvas is one element with no children, so none of the dots above are
 * reachable by keyboard or announced by a screen reader. Rather than fake it
 * with a focus ring drawn in pixels, the same places are listed underneath as
 * real buttons, collapsed by default so the graph keeps the room.
 *
 * Sorted by connection count, which also makes it a useful "which places are
 * hubs" readout for everyone, not only an accessibility fallback.
 */
function GraphList<P extends SavedLocation>({
  graph,
  onSelect,
}: {
  graph: LocationGraph<P>;
  onSelect?: (place: P) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const ordered = useMemo(
    () =>
      [...graph.nodes].sort(
        (a, b) => b.degree - a.degree || displayName(a.place).localeCompare(displayName(b.place)),
      ),
    [graph],
  );

  return (
    <div className="rounded-md border border-line">
      <button
        type="button"
        onClick={() => setIsOpen((previous) => !previous)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
      >
        <span>All places, most connected first ({ordered.length})</span>
        <span aria-hidden="true">{isOpen ? "−" : "+"}</span>
      </button>

      {isOpen && (
        <ul className="flex flex-col gap-0.5 border-t border-line p-2 text-sm">
          {ordered.map((node) => (
            <li key={node.place.id}>
              <button
                type="button"
                onClick={() => onSelect?.(node.place)}
                disabled={!onSelect}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-ink hover:bg-brass-soft hover:text-brass-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-ink"
              >
                <span className="truncate">{displayName(node.place)}</span>
                <span className="shrink-0 text-xs text-muted">
                  {node.degree === 0 ? "unconnected" : `${node.degree}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
