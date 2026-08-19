"use client";

// Multi-select over a list, and the action bar that appears once something is ticked.
//
// Generic on purpose: it knows about *ids* and *targets*, not about tracks or playlists.
// Use it for any "tick several rows, then do one thing with them" flow — add tracks to a
// playlist, tag several journal entries, categorise a batch of transactions. If the bulk
// action is a single button with no target to choose, this is more machinery than you
// need; render your own button.
//
// Pure presentation, per ARCHITECTURE.md: props in, events out. It performs no fetching
// and calls no server action. The caller owns the data and decides what "add" means —
// which is what lets the same component serve a playlist picker and, later, anything else.

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Button } from "./button";

export interface SelectionState {
  selected: Set<number>;
  toggle: (id: number) => void;
  clear: () => void;
  /** Ticks or unticks every id given — backs "select all on this page". */
  setMany: (ids: readonly number[], selected: boolean) => void;
  count: number;
}

/**
 * Holds which rows are ticked.
 *
 * Ids rather than rows, so a selection survives paging: tick three, page forward, page
 * back, and they are still ticked. The Set is replaced rather than mutated so React sees
 * a new value.
 *
 * Deliberately not URL-backed. A tick is transient working state, not something worth
 * linking to or restoring on reload — and forty ids in a query string is unreadable.
 */
export function useSelection(): SelectionState {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const toggle = useCallback((id: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const setMany = useCallback((ids: readonly number[], shouldSelect: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (shouldSelect) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  return { selected, toggle, clear, setMany, count: selected.size };
}

/** One thing the selection can be sent to — a playlist, a category, a tag. */
export interface SelectionTarget {
  id: number;
  label: string;
  /** Optional count or hint shown after the label. */
  detail?: string;
}

export interface SelectionBarProps {
  selection: SelectionState;
  /** Ids on the current page, for "select all". */
  pageIds: readonly number[];
  /** Where the selection can be sent. Empty renders the picker as a disabled hint. */
  targets: readonly SelectionTarget[];
  /** Raised when a target is chosen. The caller performs the action and reports back. */
  onSend: (targetId: number) => void;
  /**
   * Raised when the user names a brand-new target. Omit to hide the create affordance.
   * Creating and sending in one step, because making an empty thing and then having to
   * find it again is a pointless second move.
   */
  onCreateAndSend?: (name: string) => void;
  /** Disables the controls while the caller is working. */
  isBusy?: boolean;
  /** Feedback from the caller — "Added 3 to Favourites", or an error. */
  message?: string;
  /** Noun for the ticked things, singularised automatically. Default "item". */
  itemNoun?: string;
  /** Noun for a target, used in the picker and the create button. Default "list". */
  targetNoun?: string;
  /** Extra controls, rendered before the picker. */
  children?: ReactNode;
  className?: string;
}

/**
 * The bar that appears once something is ticked.
 *
 * `sticky bottom` rather than `fixed`: an app may already have something owning the bottom
 * of the viewport (MyHomeBase has the music player bar), and two stacked fixed bars fight.
 * With nothing ticked it collapses to just the "select all" link, so it costs almost no
 * space while browsing.
 */
export function SelectionBar({
  selection,
  pageIds,
  targets,
  onSend,
  onCreateAndSend,
  isBusy = false,
  message,
  itemNoun = "item",
  targetNoun = "list",
  children,
  className = "",
}: SelectionBarProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const allPageSelected = useMemo(
    () => pageIds.length > 0 && pageIds.every((id) => selection.selected.has(id)),
    [pageIds, selection.selected],
  );

  if (selection.count === 0) {
    // Still offer "select all" — otherwise the only way to begin a bulk selection is one
    // row at a time.
    if (pageIds.length === 0) return null;
    return (
      <div className={`mb-2 flex items-center gap-2 ${className}`}>
        <button
          type="button"
          onClick={() => selection.setMany(pageIds, true)}
          className="rounded px-2 py-1 text-xs text-brass-dark hover:bg-brass-soft"
        >
          Select all {pageIds.length} on this page
        </button>
      </div>
    );
  }

  return (
    <div
      className={`sticky bottom-2 z-30 mb-3 rounded-xl border border-line bg-paper-raised p-3 shadow-lg ${className}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink">
          {selection.count} {selection.count === 1 ? itemNoun : `${itemNoun}s`} selected
        </span>

        <button
          type="button"
          onClick={() => selection.setMany(pageIds, !allPageSelected)}
          className="rounded px-2 py-1 text-xs text-brass-dark hover:bg-brass-soft"
        >
          {allPageSelected ? "Deselect page" : `Select all ${pageIds.length} on page`}
        </button>

        <button
          type="button"
          onClick={selection.clear}
          className="rounded px-2 py-1 text-xs text-muted hover:text-ink"
        >
          Clear
        </button>

        <span className="flex-1 max-lg:hidden" />

        {children}

        {isCreating && onCreateAndSend !== undefined ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onCreateAndSend(newName);
              setNewName("");
              setIsCreating(false);
            }}
            className="flex items-center gap-2"
          >
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={`New ${targetNoun} name`}
              aria-label={`New ${targetNoun} name`}
              autoFocus
              className="min-w-0 rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink"
            />
            <Button type="submit" disabled={isBusy || newName.trim() === ""}>
              Create &amp; add
            </Button>
            <button
              type="button"
              onClick={() => {
                setIsCreating(false);
                setNewName("");
              }}
              className="rounded px-2 py-1 text-xs text-muted hover:text-ink"
            >
              Cancel
            </button>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <select
              value=""
              onChange={(event) => {
                const id = Number(event.target.value);
                if (id) onSend(id);
              }}
              aria-label={`Add selected ${itemNoun}s to a ${targetNoun}`}
              disabled={isBusy || targets.length === 0}
              className="rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink"
            >
              <option value="">
                {targets.length === 0 ? `No ${targetNoun}s yet` : `Add to ${targetNoun}...`}
              </option>
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label}
                  {target.detail !== undefined && ` (${target.detail})`}
                </option>
              ))}
            </select>
            {onCreateAndSend !== undefined && (
              <Button variant="secondary" onClick={() => setIsCreating(true)} disabled={isBusy}>
                New {targetNoun}
              </Button>
            )}
          </div>
        )}
      </div>

      {message !== undefined && <p className="mt-2 text-xs text-muted">{message}</p>}
    </div>
  );
}
