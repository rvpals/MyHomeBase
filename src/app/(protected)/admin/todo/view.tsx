"use client";

// The TODO lists: add, rename, reorder and delete them.
//
// Route-local rather than a registered component, for the reason components.md gives:
// it's one admin control bound to this screen's actions. It follows the Scratchpad
// Categories view's shape exactly — **each row saves itself** rather than batching into
// one Save, because these are individual named rows added, renamed, moved and deleted
// one at a time, and each of those is its own use-case with its own refusal ("that name
// is taken", "that list still has items in it"). A single Save over a list of pending
// edits would have to surface four different failures at once and decide what to do when
// two of five succeeded.
//
// NARROW: each row is a flex line that wraps its controls under the name with
// `max-lg:flex-wrap`, so nothing is cut off on a phone and the desktop classes are
// untouched.

import { useState } from "react";
import { Button } from "@/components/button";
import { TreeIcon } from "@/components/tree-icons";
import { CATEGORY_LIMIT, type TodoCategory } from "@/lib/todo";
import {
  createTodoListAction,
  deleteTodoListAction,
  renameTodoListAction,
  reorderTodoListsAction,
  type TodoCategoriesResult,
} from "./actions";

/** One row as the page read it: the list plus how full it is. */
export interface TodoListRow {
  category: TodoCategory;
  open: number;
  completed: number;
}

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export function TodoListsView({ lists }: { lists: readonly TodoListRow[] }) {
  // The server's list is the default and a local write overrides it, rather than
  // mirroring the prop into state and re-syncing in an effect — the cascading-render
  // pattern `react-hooks/set-state-in-effect` exists to catch.
  //
  // Only the *categories* are overridden locally: an action returns the stored panel but
  // not the item counts, so the counts below fall back to what the page read. They are
  // re-read on the next server render, and a rename or a reorder cannot change them.
  const [localCategories, setLocalCategories] = useState<TodoCategory[] | undefined>(undefined);
  const countsById = new Map(lists.map((row) => [row.category.id, row]));
  const rows = localCategories ?? lists.map((row) => row.category);

  const [newName, setNewName] = useState("");
  // Which row is being renamed, and to what. One at a time: renaming a list is a
  // deliberate act, and an editable grid of every name invites accidental edits.
  const [editingId, setEditingId] = useState<number | undefined>(undefined);
  const [editingName, setEditingName] = useState("");
  const [busyId, setBusyId] = useState<number | "new" | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const isFull = rows.length >= CATEGORY_LIMIT;

  /**
   * Applies an action's outcome.
   *
   * One helper rather than the same eight lines in five handlers. No `router.refresh()`:
   * each action revalidates all three paths that draw these lists, and the stored panel
   * it returns is what the rows render from meanwhile.
   */
  async function apply(
    action: Promise<TodoCategoriesResult>,
    successMessage: string,
  ): Promise<boolean> {
    const result = await action;
    if (result.ok) {
      if (result.categories) setLocalCategories(result.categories);
      setMessage(successMessage);
      setError(undefined);
      return true;
    }
    setError(result.error ?? "That didn't work.");
    setMessage(undefined);
    return false;
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setBusyId("new");
    // Cleared only on success, so a refused name stays in the box to be corrected
    // rather than making the admin retype it.
    if (await apply(createTodoListAction(name), `Added "${name}".`)) setNewName("");
    setBusyId(undefined);
  }

  async function handleRename(id: number) {
    const name = editingName.trim();
    if (!name) return;
    setBusyId(id);
    if (await apply(renameTodoListAction(id, name), `Renamed to "${name}".`)) {
      setEditingId(undefined);
    }
    setBusyId(undefined);
  }

  async function handleMove(id: number, direction: "up" | "down") {
    const index = rows.findIndex((row) => row.id === id);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= rows.length) return;

    // The whole order, not one id and a direction — so the panel can never be left
    // half-reordered. See `reorderCategoriesSchema`.
    const ids = rows.map((row) => row.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];

    setBusyId(id);
    await apply(reorderTodoListsAction(ids), "Order saved.");
    setBusyId(undefined);
  }

  async function handleDelete(row: TodoCategory) {
    if (!window.confirm(`Delete the list "${row.name}"?`)) return;
    setBusyId(row.id);
    await apply(deleteTodoListAction(row.id), `Deleted "${row.name}".`);
    setBusyId(undefined);
  }

  return (
    <div className="mt-6 rounded-xl border border-line bg-paper-raised p-4">
      {message && (
        <p className="mb-3 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink">
          {message}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-red-800/60 bg-red-950/30 px-3 py-2 text-sm text-red-300"
        >
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted">No lists yet. Add the first one below.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row, index) => {
            const counts = countsById.get(row.id);
            const busy = busyId === row.id;

            return (
              <li
                key={row.id}
                className="flex items-center gap-2 rounded-lg border border-line bg-paper px-3 py-2 max-lg:flex-wrap"
              >
                {editingId === row.id ? (
                  <>
                    <input
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void handleRename(row.id);
                        if (event.key === "Escape") setEditingId(undefined);
                      }}
                      maxLength={40}
                      autoFocus
                      aria-label={`New name for ${row.name}`}
                      className={`${INPUT_CLASS} min-w-0 flex-1`}
                    />
                    <Button size="sm" onClick={() => void handleRename(row.id)} disabled={busy}>
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setEditingId(undefined)}
                      disabled={busy}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{row.name}</span>
                    {counts && (
                      // Shown because these items are the household's, not private —
                      // see the note at the top of page.tsx. It is also what explains a
                      // refused delete before the admin clicks it.
                      <span className="shrink-0 text-xs tabular-nums text-muted">
                        {counts.open} to do · {counts.completed} done
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleMove(row.id, "up")}
                      disabled={busy || index === 0}
                      title={`Move ${row.name} up`}
                      ariaLabel={`Move ${row.name} up`}
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleMove(row.id, "down")}
                      disabled={busy || index === rows.length - 1}
                      title={`Move ${row.name} down`}
                      ariaLabel={`Move ${row.name} down`}
                    >
                      ↓
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setEditingId(row.id);
                        setEditingName(row.name);
                      }}
                      disabled={busy}
                      title={`Rename ${row.name}`}
                      ariaLabel={`Rename ${row.name}`}
                    >
                      <TreeIcon name="pencil" className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => void handleDelete(row)}
                      disabled={busy}
                      title={`Delete ${row.name}`}
                      ariaLabel={`Delete ${row.name}`}
                    >
                      <TreeIcon name="trash" className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 flex items-center gap-2 border-t border-line pt-4 max-lg:flex-wrap">
        <label htmlFor="admin-new-todo-list" className="sr-only">
          New list name
        </label>
        <input
          id="admin-new-todo-list"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void handleCreate();
          }}
          placeholder={isFull ? `Limit of ${CATEGORY_LIMIT} lists reached` : "New list name"}
          disabled={isFull || busyId === "new"}
          maxLength={40}
          className={`${INPUT_CLASS} min-w-0 flex-1`}
        />
        <Button
          onClick={() => void handleCreate()}
          disabled={isFull || busyId === "new" || newName.trim() === ""}
        >
          Add list
        </Button>
      </div>
    </div>
  );
}
