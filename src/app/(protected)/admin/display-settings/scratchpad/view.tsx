"use client";

// The Scratchpad's category list: add, rename, reorder and delete the window's tabs.
//
// Route-local rather than a registered component, for the reason components.md gives:
// it's one admin control bound to this screen's actions. It follows the Floating
// Components view next door — same card, same message placement — but **not** its
// draft-then-save shape, and that difference is deliberate.
//
// Floating Components is a set of checkboxes, so batching them into one Save is right.
// These are individual named rows that are added, renamed, moved and deleted one at a
// time, and each of those is its own use-case with its own refusal ("that name is
// taken", "that category still has notes in it"). A single Save over a list of pending
// edits would have to surface four different failures at once and decide what to do when
// two of five succeeded. So each row saves itself and reports its own outcome.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CATEGORY_LIMIT, type NoteCategory } from "@/lib/scratchpad";
import {
  createScratchpadCategoryAction,
  deleteScratchpadCategoryAction,
  renameScratchpadCategoryAction,
  reorderScratchpadCategoriesAction,
} from "./actions";

export function ScratchpadCategoriesView({
  categories,
}: {
  categories: readonly NoteCategory[];
}) {
  const router = useRouter();
  // The server's list is the default and a local write overrides it, rather than
  // mirroring the prop into state and re-syncing in an effect — the cascading-render
  // pattern `react-hooks/set-state-in-effect` exists to catch.
  const [localCategories, setLocalCategories] = useState<NoteCategory[] | undefined>(
    undefined,
  );
  const rows = localCategories ?? categories;

  const [newName, setNewName] = useState("");
  // Which row is being renamed, and to what. One at a time: an admin renaming a tab is
  // a deliberate act, and an editable grid of every name invites accidental edits.
  const [editingId, setEditingId] = useState<number | undefined>(undefined);
  const [editingName, setEditingName] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<number | undefined>(undefined);
  const [busyId, setBusyId] = useState<number | "new" | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const isFull = rows.length >= CATEGORY_LIMIT;

  /**
   * Applies an action's outcome.
   *
   * One helper rather than the same eight lines in five handlers. `router.refresh()` on
   * success because the Scratchpad's window is mounted by the protected layout — a
   * renamed tab has to reach the window on this very page, not just the next navigation.
   */
  function apply(
    outcome: { ok: boolean; error?: string; categories?: NoteCategory[] },
    successMessage: string,
  ): boolean {
    if (!outcome.ok) {
      setError(outcome.error ?? "That change could not be saved.");
      setMessage(undefined);
      return false;
    }
    if (outcome.categories) setLocalCategories(outcome.categories);
    setMessage(successMessage);
    setError(undefined);
    router.refresh();
    return true;
  }

  async function handleAdd() {
    const name = newName.trim();
    if (name === "") return;
    setBusyId("new");
    try {
      if (apply(await createScratchpadCategoryAction(name), `Added "${name}".`)) {
        setNewName("");
      }
    } finally {
      setBusyId(undefined);
    }
  }

  async function handleRename(id: number) {
    const name = editingName.trim();
    if (name === "") return;
    setBusyId(id);
    try {
      if (apply(await renameScratchpadCategoryAction({ id, name }), `Renamed to "${name}".`)) {
        setEditingId(undefined);
      }
    } finally {
      setBusyId(undefined);
    }
  }

  /**
   * Moves a category one place up or down.
   *
   * Arrows rather than drag-and-drop: the list is short, arrows work on a phone and with
   * a keyboard without any of drag's accessibility problems, and the action takes the
   * whole reordered list anyway — so this computes the new order and posts it as one
   * write, which is what stops the strip being left half-reordered.
   */
  async function handleMove(id: number, direction: -1 | 1) {
    const index = rows.findIndex((row) => row.id === id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= rows.length) return;

    const ids = rows.map((row) => row.id);
    // Swap in place, then post the whole order.
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];

    setBusyId(id);
    try {
      apply(await reorderScratchpadCategoriesAction(ids), "Order saved.");
    } finally {
      setBusyId(undefined);
    }
  }

  async function handleDelete(id: number) {
    setBusyId(id);
    try {
      const name = rows.find((row) => row.id === id)?.name ?? "that category";
      if (apply(await deleteScratchpadCategoryAction(id), `Deleted "${name}".`)) {
        setPendingDeleteId(undefined);
      }
      // A refusal deliberately leaves the confirm strip open: the message explains that
      // notes are still filed under it, and closing the strip would hide the reason
      // behind the click that produced it.
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-line bg-paper-raised p-5">
      <h2 className="font-display text-lg font-semibold text-ink">Categories</h2>
      <p className="mt-1 text-sm text-muted">
        Each category is a tab in the Scratchpad, in the order below. A category can only
        be deleted once it holds no notes — so nobody&rsquo;s notes are ever removed from
        this screen.
      </p>

      {rows.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-line px-3 py-6 text-center text-sm text-muted">
          There are no categories. The Scratchpad&rsquo;s window has nothing to show until
          you add one.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {rows.map((category, index) => (
            <li key={category.id} className="rounded-md border border-line p-3">
              {editingId === category.id ? (
                // Renaming: the row becomes a field. Enter saves, Escape abandons —
                // both bound because a rename is a one-field form and reaching for a
                // button is the slower path.
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={editingName}
                    onChange={(event) => setEditingName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void handleRename(category.id);
                      if (event.key === "Escape") setEditingId(undefined);
                    }}
                    maxLength={40}
                    autoFocus
                    aria-label={`Rename ${category.name}`}
                    className="min-w-0 flex-1 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                  />
                  <Button
                    size="sm"
                    onClick={() => void handleRename(category.id)}
                    disabled={busyId === category.id || editingName.trim() === ""}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setEditingId(undefined)}
                    disabled={busyId === category.id}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                    {category.name}
                  </span>

                  {/* Reorder arrows. Disabled at the ends rather than hidden, so the
                      row's controls don't shift position between rows. */}
                  <button
                    type="button"
                    onClick={() => void handleMove(category.id, -1)}
                    disabled={index === 0 || busyId !== undefined}
                    title="Move up"
                    aria-label={`Move ${category.name} up`}
                    className="rounded p-1 text-muted transition-colors hover:text-brass-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-4 w-4"
                      aria-hidden="true"
                    >
                      <path d="M6 14l6-6 6 6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleMove(category.id, 1)}
                    disabled={index === rows.length - 1 || busyId !== undefined}
                    title="Move down"
                    aria-label={`Move ${category.name} down`}
                    className="rounded p-1 text-muted transition-colors hover:text-brass-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-4 w-4"
                      aria-hidden="true"
                    >
                      <path d="M6 10l6 6 6-6" />
                    </svg>
                  </button>

                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setEditingId(category.id);
                      setEditingName(category.name);
                      setMessage(undefined);
                      setError(undefined);
                    }}
                    disabled={busyId !== undefined}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      setPendingDeleteId(category.id);
                      setMessage(undefined);
                      setError(undefined);
                    }}
                    disabled={busyId !== undefined}
                  >
                    Delete
                  </Button>
                </div>
              )}

              {pendingDeleteId === category.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-red-400/40 bg-red-400/5 px-3 py-2">
                  <span className="text-xs text-ink">
                    Delete &ldquo;{category.name}&rdquo;? This removes the tab for everyone.
                  </span>
                  <div className="ml-auto flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setPendingDeleteId(undefined)}
                      disabled={busyId === category.id}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => void handleDelete(category.id)}
                      disabled={busyId === category.id}
                    >
                      {busyId === category.id ? "Deleting…" : "Delete"}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Add. At the bottom because a new category is appended to the end of the strip,
          so the control sits where the result will appear. */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <input
          type="text"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void handleAdd();
          }}
          placeholder={isFull ? "The category list is full" : "New category name"}
          maxLength={40}
          disabled={isFull || busyId !== undefined}
          aria-label="New category name"
          className="min-w-0 flex-1 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:cursor-not-allowed disabled:opacity-60"
        />
        <Button
          size="sm"
          onClick={() => void handleAdd()}
          disabled={isFull || newName.trim() === "" || busyId !== undefined}
        >
          {busyId === "new" ? "Adding…" : "Add category"}
        </Button>
      </div>

      {message && <p className="mt-3 text-sm text-brass-dark">{message}</p>}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}
