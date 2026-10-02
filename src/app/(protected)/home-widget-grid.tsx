"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/button";
import { TreeIcon } from "@/components/tree-icons";
import type { HomeWidgetId } from "@/lib/home-dashboard";
import {
  applyPersonalOrder,
  moveHomeWidgetInOrder,
  reorderHomeWidgets,
  type HomeColumnCount,
} from "@/lib/home-layout";
import { setHomeLayoutAction } from "./home-layout-actions";

/**
 * One card the grid lays out. The page renders the card itself and hands it over
 * already built — this component never knows what a Daily Quote is, only that it is
 * a draggable block with an id and a label.
 */
export interface HomeWidgetItem {
  id: HomeWidgetId;
  /** Names the card in the move buttons' tooltips and accessible names. */
  label: string;
  node: ReactNode;
  /**
   * Whether the card spans both columns instead of taking one.
   *
   * The module carousel does: it is a horizontally-scrolling full-bleed strip, so
   * halving its width defeats what it is for. A spanning card is also **not
   * draggable** — there is only one position a full-width band can occupy relative
   * to the cards around it, and letting it be dragged would imply otherwise.
   */
  spansBothColumns?: boolean;
}

/**
 * The home screen's card layout: one column or two, and drag to rearrange.
 *
 * **Why this is a client island and the page is not.** The page stays a server
 * component and does all the data reading; this takes the finished cards as
 * `ReactNode`s and only decides where they sit. That keeps the drag state and the
 * optimistic reorder on the client without dragging the quote, the journal and the
 * positions across the boundary with them.
 *
 * **Full layout only, by construction.** The whole control strip is `hidden xl:flex`
 * and the second column is an `xl:` grid variant, so below 1280px this renders exactly
 * the single stack the home screen has always been — no `useIsCompact()`, so the
 * desktop classes cannot regress the phone. 1280px rather than the app's usual 1024px
 * boundary is deliberate: this is a refinement *within* the full layout (how wide is
 * too wide), not a compact-versus-full decision, and two columns of cards on a 1024px
 * laptop are cramped. See design.md.
 *
 * **Drag is mouse-only, and that is why the move buttons exist.** This ships on the
 * native HTML5 drag events rather than a library, which means it does not fire for
 * touch or for a keyboard. Touch is out of scope by construction — the control only
 * renders at 1280px and up — but a keyboard is not, so every draggable card also
 * carries up/down buttons. Those are the accessible path, not a nicety.
 *
 * **The card is grabbed by its frame, not by a handle row.** A draggable card sits in
 * a few pixels of padding that are themselves the drag surface: the whole border of
 * the card is the grab target, which is what a reader reaches for anyway. There is no
 * permanent strip above the card, because a row of chrome on every card is a standing
 * cost paid for an action taken once. The move buttons live in that frame too and
 * surface on hover or keyboard focus — present when wanted, invisible at rest, and
 * never occupying a row of their own.
 *
 * **Why the frame and not the card itself.** `CollapsibleCard` fills its own top edge
 * with a toggle button and its body with content, so it has no spare edge to grab —
 * making the card element draggable would mean every drag starting on a header or a
 * link inside it. The padding belongs to this layout, not to the card.
 */
export function HomeWidgetGrid({
  items,
  initialColumns,
  initialOrder,
}: {
  /** The cards to draw, in the household order the page resolved. */
  items: HomeWidgetItem[];
  initialColumns: HomeColumnCount;
  /** This reader's stored arrangement, or `[]` when they have never dragged. */
  initialOrder: HomeWidgetId[];
}) {
  const [columns, setColumns] = useState<HomeColumnCount>(initialColumns);
  const [order, setOrder] = useState<HomeWidgetId[]>(initialOrder);
  const [draggingId, setDraggingId] = useState<HomeWidgetId | undefined>();
  // The card the pointer is currently over, for the drop indicator. Separate from
  // `draggingId` because the two are different cards for the whole of a drag.
  const [dropTargetId, setDropTargetId] = useState<HomeWidgetId | undefined>();

  // The household order, rearranged by this reader's preference. Derived on every
  // render rather than held in state: `items` is the server's answer to "what is
  // drawn today", and a copy in state would go stale the moment a card's data
  // appears or disappears.
  const laid = applyPersonalOrder(
    items.map((item) => item.id),
    order,
  );
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = laid.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });

  // What a reorder writes. `ordered` rather than `order`, so a reader whose stored
  // order was empty (or partial) persists the full arrangement they can actually see
  // rather than a fragment — otherwise the first drag would save two ids and let
  // `applyPersonalOrder` append the rest in an order they never chose.
  const currentOrder = ordered.map((item) => item.id);

  function persistOrder(next: HomeWidgetId[]) {
    setOrder(next);
    // Deliberately not awaited and deliberately not surfaced: the cards have already
    // moved, and a failed write costs a remembered arrangement, not a navigation.
    void setHomeLayoutAction({ order: next });
  }

  function handleColumns(next: HomeColumnCount) {
    setColumns(next);
    // Only the columns — sending the order too would rewrite it on every flip of the
    // switch for no reason. `saveHomeLayout` writes one key at a time.
    void setHomeLayoutAction({ columns: next });
  }

  function handleDrop(targetId: HomeWidgetId) {
    setDropTargetId(undefined);
    if (!draggingId) return;
    const next = reorderHomeWidgets(currentOrder, draggingId, targetId);
    setDraggingId(undefined);
    if (next !== currentOrder) persistOrder(next);
  }

  function handleMove(id: HomeWidgetId, direction: "up" | "down") {
    const next = moveHomeWidgetInOrder(currentOrder, id, direction);
    if (next !== currentOrder) persistOrder(next);
  }

  // "No opinion" is the empty order — the same value a fresh account has — so reset
  // hands the reader back to whatever the household default currently is rather than
  // freezing today's default into their row.
  function handleReset() {
    setOrder([]);
    void setHomeLayoutAction({ order: [] });
  }

  const isTwoColumn = columns === 2;
  const draggableCount = ordered.filter((item) => !item.spansBothColumns).length;

  return (
    <div>
      {/* The control strip. `xl:flex` with a base `hidden`, so it is absent — not
          merely invisible — on every layout that cannot use it. */}
      <div className="mt-4 hidden items-center justify-end gap-2 xl:flex">
        <span className="text-sm font-medium text-muted">Layout</span>
        <Button
          size="sm"
          variant={columns === 1 ? "primary" : "secondary"}
          onClick={() => handleColumns(1)}
          title="One column"
          ariaLabel="One column"
        >
          <TreeIcon name="list" className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant={columns === 2 ? "primary" : "secondary"}
          onClick={() => handleColumns(2)}
          title="Two columns"
          ariaLabel="Two columns"
        >
          <TreeIcon name="grid" className="h-4 w-4" />
        </Button>
        {/* Only worth offering once there is something to reset. */}
        {order.length > 0 && (
          <Button size="sm" variant="secondary" onClick={handleReset} title="Reset to the default order">
            Reset order
          </Button>
        )}
      </div>

      {/*
        The layout itself.

        `items-start` is load-bearing: without it a grid cell stretches its card to
        the height of the tallest in its row, so a collapsed card sitting beside an
        expanded one grows a tall empty body. With it they top-align and the spare
        height falls harmlessly below the shorter card.

        `gap-8` replaces the per-card `mt-8` the page used to apply — spacing belongs
        to the layout now that cards sit side by side, not to each card.
      */}
      <div
        className={`mt-4 grid grid-cols-1 items-start gap-8 ${
          isTwoColumn ? "xl:grid-cols-2" : ""
        }`}
      >
        {ordered.map((item, position) => {
          const canDrag = isTwoColumn && !item.spansBothColumns;
          const isDragging = draggingId === item.id;
          const isDropTarget = dropTargetId === item.id && draggingId !== item.id;

          return (
            <div
              key={item.id}
              // `group` so the move buttons can reveal on hover/focus anywhere in the
              // frame. The padding is what makes the border grabbable: without it the
              // draggable element would be exactly the card, whose every pixel is
              // already a toggle, a link or a chart.
              className={`${item.spansBothColumns ? "xl:col-span-2" : ""} ${
                canDrag
                  ? "group relative cursor-grab rounded-xl p-1.5 transition-shadow active:cursor-grabbing motion-reduce:transition-none"
                  : ""
              } ${isDragging ? "opacity-40" : ""} ${
                // The two rings are written as one choice rather than two classes:
                // `ring-1` and `ring-2` set the same property, so leaving both in
                // the string would let whichever Tailwind happens to emit later win.
                isDropTarget
                  ? "ring-2 ring-brass"
                  : canDrag
                    ? "ring-1 ring-transparent hover:ring-brass-dark/40"
                    : ""
              }`}
              draggable={canDrag}
              onDragStart={() => canDrag && setDraggingId(item.id)}
              // Without `preventDefault` the browser treats this as an invalid drop
              // target and `onDrop` never fires at all.
              onDragOver={(event) => {
                if (!canDrag || !draggingId) return;
                event.preventDefault();
                setDropTargetId(item.id);
              }}
              // Fires on the way out of *child* elements too, so it is guarded on the
              // card actually being the current target — otherwise moving across the
              // cards inside makes the indicator flicker.
              onDragLeave={() => setDropTargetId((current) => (current === item.id ? undefined : current))}
              onDrop={(event) => {
                if (!canDrag) return;
                event.preventDefault();
                handleDrop(item.id);
              }}
              onDragEnd={() => {
                setDraggingId(undefined);
                setDropTargetId(undefined);
              }}
            >
              {canDrag && (
                /*
                  The keyboard path, parked in the frame's top-right corner.

                  `absolute` so it costs no height — this is the whole point of the
                  change, that a card gains no row it has to carry at rest. It is
                  `opacity-0` until the frame is hovered or something inside the
                  buttons takes focus (`focus-within`), so the resting card is clean
                  while a tabbing reader still gets a visible, reachable control.

                  Not hidden behind `hidden`/`display:none`: that would take the
                  buttons out of the tab order entirely and with them the only way to
                  reorder cards without a mouse. Transparent-but-present keeps them
                  focusable, which is what `focus-within` then reveals.
                */
                <div
                  className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1 opacity-0 transition-opacity motion-reduce:transition-none group-hover:opacity-100 group-focus-within:opacity-100"
                  // The buttons are clicks, not grabs. Without this, pressing one
                  // starts a card drag instead of moving the card by a slot.
                  draggable={false}
                  onDragStart={(event) => event.preventDefault()}
                >
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleMove(item.id, "up")}
                    disabled={position === 0}
                    title={`Move ${item.label} earlier`}
                    ariaLabel={`Move ${item.label} earlier`}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleMove(item.id, "down")}
                    disabled={position === ordered.length - 1}
                    title={`Move ${item.label} later`}
                    ariaLabel={`Move ${item.label} later`}
                  >
                    ↓
                  </Button>
                </div>
              )}
              {item.node}
            </div>
          );
        })}
      </div>

      {/* Said once, under the grid, rather than as a tooltip on every card. Only in
          two-column mode, which is the only place dragging is possible. */}
      {isTwoColumn && draggableCount > 1 && (
        <p className="mt-4 hidden text-xs text-muted xl:block">
          Drag a card by its edge to rearrange, or use the arrows that appear on hover.
          Your arrangement is saved automatically.
        </p>
      )}
    </div>
  );
}
