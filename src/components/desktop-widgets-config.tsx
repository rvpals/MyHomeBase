"use client";

// The editor for a screen's cards: one row per widget with a drag handle, its position
// number, and a checkbox that switches it on or off.
//
// Pure presentation. It raises intent (`onReorder`, `onToggle`) and the parent applies it
// — with the owning module's own functions — and passes the new list back in.
//
// Reorder is a **grip handle** dragged with the pointer (Pointer Events, so mouse, pen and
// touch all work — HTML5 drag-and-drop does not fire on most phones). The row moves live
// as the pointer crosses its neighbours. The handle is also a focusable button: with it
// focused, ArrowUp / ArrowDown move the row one place, so reordering stays keyboard- and
// screen-reader-operable without a drag.
//
// A single column of rows, so there is no compact variant.

import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

export interface DesktopWidgetItem<Id extends string = string> {
  id: Id;
  label: string;
  /** One line saying what the card shows. */
  description?: string;
  visible: boolean;
}

export interface DesktopWidgetsConfigProps<Id extends string = string> {
  /** The widgets, in the order they are drawn. */
  widgets: DesktopWidgetItem<Id>[];
  /**
   * `id` was dragged onto (or nudged past) `targetId`: it should now sit at the position
   * `targetId` occupies. Raised repeatedly during one drag as the pointer crosses rows.
   * The parent reorders; this never does.
   */
  onReorder: (id: Id, targetId: Id) => void;
  /** The checkbox was flipped on `id`. */
  onToggle: (id: Id) => void;
  /** Disables every control, e.g. while a save is in flight. */
  disabled?: boolean;
  /** Optional icon drawn before each label, by widget id. */
  renderIcon?: (id: Id) => ReactNode;
  /** Caller-supplied classes, merged last so they win. */
  className?: string;
}

export function DesktopWidgetsConfig<Id extends string = string>({
  widgets,
  onReorder,
  onToggle,
  disabled = false,
  renderIcon,
  className = "",
}: DesktopWidgetsConfigProps<Id>) {
  const [draggingId, setDraggingId] = useState<Id | undefined>(undefined);
  const rows = useRef(new Map<Id, HTMLLIElement>());

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>, id: Id) {
    if (disabled || event.button !== 0) return;
    // Capture keeps move/up events coming to the handle even after the row under the
    // pointer changes, which it does on every reorder.
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingId(id);
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>, id: Id) {
    if (draggingId !== id) return;
    for (const widget of widgets) {
      if (widget.id === id) continue;
      const rect = rows.current.get(widget.id)?.getBoundingClientRect();
      if (rect && event.clientY >= rect.top && event.clientY <= rect.bottom) {
        onReorder(id, widget.id);
        return;
      }
    }
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraggingId(undefined);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number, id: Id) {
    if (disabled) return;
    const neighbour =
      event.key === "ArrowUp" ? widgets[index - 1] : event.key === "ArrowDown" ? widgets[index + 1] : undefined;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    // Stop the page scrolling under the arrow press even at either end of the list.
    event.preventDefault();
    if (neighbour) onReorder(id, neighbour.id);
  }

  return (
    <ul className={`flex flex-col gap-2 ${className}`}>
      {widgets.map((widget, index) => (
        <li
          key={widget.id}
          ref={(element) => {
            if (element) rows.current.set(widget.id, element);
            else rows.current.delete(widget.id);
          }}
          className={`flex items-start gap-3 rounded-md border bg-paper p-3 ${
            draggingId === widget.id ? "border-brass shadow-md" : "border-line"
          } ${widget.visible ? "" : "opacity-60"}`}
        >
          <button
            type="button"
            disabled={disabled}
            aria-label={`Reorder ${widget.label}. Drag, or press the up and down arrow keys.`}
            title="Drag to reorder"
            onPointerDown={(event) => handlePointerDown(event, widget.id)}
            onPointerMove={(event) => handlePointerMove(event, widget.id)}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={(event) => handleKeyDown(event, index, widget.id)}
            // `touch-none` stops a finger on the handle scrolling the page instead of
            // dragging; the rest of the row still scrolls normally.
            className={`mt-0.5 flex h-7 w-7 shrink-0 touch-none select-none items-center justify-center rounded border border-line text-brass-dark hover:bg-paper-raised disabled:opacity-30 ${
              draggingId === widget.id ? "cursor-grabbing" : "cursor-grab"
            }`}
          >
            <svg viewBox="0 0 10 16" aria-hidden="true" className="h-4 w-2.5" fill="currentColor">
              <circle cx="2.5" cy="3" r="1.4" />
              <circle cx="7.5" cy="3" r="1.4" />
              <circle cx="2.5" cy="8" r="1.4" />
              <circle cx="7.5" cy="8" r="1.4" />
              <circle cx="2.5" cy="13" r="1.4" />
              <circle cx="7.5" cy="13" r="1.4" />
            </svg>
          </button>

          <span className="mt-1.5 shrink-0 font-mono text-xs text-muted">{index + 1}</span>

          <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={widget.visible}
              onChange={() => onToggle(widget.id)}
              disabled={disabled}
              className="mt-1"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-medium text-ink">
                {renderIcon?.(widget.id)}
                {widget.label}
              </span>
              {widget.description && (
                <span className="block text-xs text-muted">{widget.description}</span>
              )}
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}
