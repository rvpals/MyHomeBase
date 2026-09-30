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
  /** For the drag handle's accessible name and the move buttons' tooltips. */
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
              className={`${item.spansBothColumns ? "xl:col-span-2" : ""} ${
                isDragging ? "opacity-40" : ""
              } ${isDropTarget ? "rounded-xl ring-2 ring-brass" : ""}`}
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
                // The handle row: a grab affordance plus the keyboard path. Sits above
                // the card rather than inside it, because `CollapsibleCard`'s header is
                // a toggle and anything dropped in there competes with it for clicks.
                <div className="mb-1 flex items-center justify-end gap-1">
                  <span className="cursor-grab select-none px-1 text-muted" title={`Drag to move ${item.label}`} aria-hidden>
                    ⠿
                  </span>
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

      {/* Said once, under the grid, rather than as a tooltip on each handle. Only in
          two-column mode, which is the only place the handles exist. */}
      {isTwoColumn && draggableCount > 1 && (
        <p className="mt-4 hidden text-xs text-muted xl:block">
          Drag a card by its handle to rearrange, or use the arrows. Your arrangement is
          saved automatically.
        </p>
      )}
    </div>
  );
}
