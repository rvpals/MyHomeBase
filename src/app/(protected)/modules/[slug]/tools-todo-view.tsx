"use client";

// TODO Lists' screen: a category panel on the left, a card per list on the right.
//
// Route-local rather than a registered component, per components.md: it is one screen
// bound to this section's actions. The pieces that *are* reusable are already registered
// and used here — `Button`, `CollapsibleCard` for the Completed group.
//
// NARROW (design.md → Phone and desktop): the two panes are one flex row that becomes a
// column under `max-lg:`, so the category panel sits above the cards on a phone and the
// card grid collapses to one column. No `useIsCompact()` — nothing here needs a
// genuinely different component, so restyling keeps the desktop classes provably
// untouched.

import { useState, type FormEvent } from "react";
import { Button } from "@/components/button";
import { SlotIcon } from "@/components/slot-icon";
import { TreeIcon } from "@/components/tree-icons";
import { getIconSlot } from "@/lib/icons";
import { CATEGORY_LIMIT, type TodoBoard, type TodoCategoryBoard, type TodoItem } from "@/lib/todo";
import {
  clearTodoCompletedAction,
  createTodoCategoryAction,
  createTodoItemAction,
  deleteTodoCategoryAction,
  deleteTodoItemAction,
  setTodoItemDoneAction,
  type ActionResult,
} from "./tools-todo-actions";

// Resolved once at module scope — `getIconSlot` reads the static registry, so this is
// not I/O. The guard is for the registry, not the user: a removed id costs the heading
// its glyph rather than crashing the screen.
const SECTION_SLOT = getIconSlot("tools_section_todo");

/** The form input styling design.md prescribes — copied, not reinvented. */
const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export function ToolsTodoView({ board }: { board: TodoBoard }) {
  // Which list the panel has selected. `undefined` means "all of them", which is the
  // landing state: the screenshot shows every list's card side by side, and picking one
  // narrows to it rather than being the only way to see anything.
  const [selectedId, setSelectedId] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const shown = board.categories.filter(
    (entry) => selectedId === undefined || entry.category.id === selectedId,
  );

  /**
   * Applies an action's outcome.
   *
   * One helper rather than the same five lines in seven handlers. No `router.refresh()`:
   * every action revalidates both paths on the server, so the screen re-renders with the
   * server's own answer — a client refresh on top would be a second render of the same
   * data.
   */
  async function run(action: Promise<ActionResult>): Promise<boolean> {
    const result = await action;
    setError(result.ok ? undefined : result.error);
    return result.ok;
  }

  return (
    <div>
      {error && (
        // One banner for the whole screen rather than one per card: these refusals are
        // sentences from `lib` ("that list still has 2 items in it"), and a reader who
        // just clicked knows which row they clicked.
        <p
          role="alert"
          className="mb-4 rounded-lg border border-red-800/60 bg-red-950/30 px-3 py-2 text-sm text-red-300"
        >
          {error}
        </p>
      )}

      <div className="flex gap-6 max-lg:flex-col max-lg:gap-4">
        <CategoryPanel
          board={board}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onRun={run}
        />

        {/* The cards. `items-start` so a short card beside a tall one does not grow an
            empty body — the same reason the home widget grid sets it. */}
        <div className="min-w-0 flex-1">
          {shown.length === 0 ? (
            <p className="rounded-xl border border-line p-6 text-sm text-muted">
              No lists yet. Add one on the left to get started.
            </p>
          ) : (
            <div className="grid grid-cols-3 items-start gap-4 max-xl:grid-cols-2 max-lg:grid-cols-1">
              {shown.map((entry) => (
                <TodoCard key={entry.category.id} entry={entry} onRun={run} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The left column: every list with its open count, plus the add box. */
function CategoryPanel({
  board,
  selectedId,
  onSelect,
  onRun,
}: {
  board: TodoBoard;
  selectedId: number | undefined;
  onSelect: (id: number | undefined) => void;
  onRun: (action: Promise<ActionResult>) => Promise<boolean>;
}) {
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const isFull = board.categories.length >= CATEGORY_LIMIT;

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    // Cleared only on success, so a refused name stays in the box to be corrected
    // rather than making the reader retype it.
    if (await onRun(createTodoCategoryAction({ name }))) setNewName("");
    setBusy(false);
  }

  async function handleDelete(id: number, name: string) {
    if (!window.confirm(`Delete the list "${name}"? This only works if it is empty.`)) return;
    setBusy(true);
    // Deleting the list currently filtered to would leave the screen showing nothing,
    // so the selection falls back to "all" first.
    if (await onRun(deleteTodoCategoryAction({ id })) && selectedId === id) onSelect(undefined);
    setBusy(false);
  }

  return (
    // `lg:w-64 lg:shrink-0` so the panel is a fixed column beside the cards on a wide
    // screen and a full-width block above them when stacked.
    <aside className="lg:w-64 lg:shrink-0">
      <div className="rounded-xl border border-line bg-paper-raised p-3">
        <h2 className="mb-2 flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wide text-muted">
          {SECTION_SLOT && <SlotIcon slot={SECTION_SLOT} className="h-4 w-4" />}
          Lists
        </h2>

        <ul className="space-y-0.5">
          <li>
            <button
              type="button"
              onClick={() => onSelect(undefined)}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                selectedId === undefined
                  ? "bg-brass/15 font-semibold text-ink"
                  : "text-muted hover:bg-paper hover:text-ink"
              }`}
            >
              <span className="truncate">All lists</span>
              <span className="shrink-0 text-xs tabular-nums text-muted">
                {board.categories.reduce((total, entry) => total + entry.open.length, 0)}
              </span>
            </button>
          </li>

          {board.categories.map((entry) => (
            <li key={entry.category.id} className="group/row flex items-center gap-1">
              <button
                type="button"
                onClick={() => onSelect(entry.category.id)}
                className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                  selectedId === entry.category.id
                    ? "bg-brass/15 font-semibold text-ink"
                    : "text-muted hover:bg-paper hover:text-ink"
                }`}
              >
                <span className="truncate">{entry.category.name}</span>
                {/* The open count, as in the screenshot. Completed items are
                    deliberately not counted here: the number is "how much is left",
                    which is what makes it worth glancing at. */}
                <span className="shrink-0 text-xs tabular-nums text-muted">
                  {entry.open.length}
                </span>
              </button>
              {/* A row action, so a bare glyph rather than a slot — coding-guide.md
                  keeps pencils and bins hand-drawn for exactly this position.
                  `max-lg:opacity-100` because hover does not exist on a touch screen;
                  hiding it there would make deleting a list impossible on a phone. */}
              <button
                type="button"
                onClick={() => handleDelete(entry.category.id, entry.category.name)}
                disabled={busy}
                title={`Delete ${entry.category.name}`}
                aria-label={`Delete ${entry.category.name}`}
                className="shrink-0 rounded p-1 text-muted opacity-0 transition-opacity hover:text-red-400 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass group-hover/row:opacity-100 max-lg:opacity-100"
              >
                <TreeIcon name="trash" className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>

        <form onSubmit={handleAdd} className="mt-3 border-t border-line pt-3">
          <label htmlFor="todo-new-list" className="sr-only">
            New list name
          </label>
          <input
            id="todo-new-list"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder={isFull ? "List limit reached" : "Create new list"}
            disabled={isFull || busy}
            maxLength={40}
            className={INPUT_CLASS}
          />
          {newName.trim() !== "" && (
            <Button type="submit" size="sm" disabled={busy} className="mt-2 w-full">
              Add list
            </Button>
          )}
        </form>
      </div>
    </aside>
  );
}

/** One list's card: the add box, the open items, and the Completed group. */
function TodoCard({
  entry,
  onRun,
}: {
  entry: TodoCategoryBoard;
  onRun: (action: Promise<ActionResult>) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    if (await onRun(createTodoItemAction({ categoryId: entry.category.id, title: trimmed }))) {
      setTitle("");
      // The box stays open after a successful add: entering a list of errands is
      // several adds in a row, and closing it would mean re-clicking "+" each time.
    }
    setBusy(false);
  }

  async function handleClear() {
    if (
      !window.confirm(
        `Permanently delete ${entry.completed.length} completed ${
          entry.completed.length === 1 ? "item" : "items"
        } from "${entry.category.name}"?`,
      )
    ) {
      return;
    }
    setBusy(true);
    await onRun(clearTodoCompletedAction({ categoryId: entry.category.id }));
    setBusy(false);
  }

  return (
    <section className="rounded-xl border border-line bg-paper-raised p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate font-display text-lg text-ink">{entry.category.name}</h3>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setAdding((open) => !open)}
          title={`Add an item to ${entry.category.name}`}
          ariaLabel={`Add an item to ${entry.category.name}`}
          ariaExpanded={adding}
        >
          <TreeIcon name="plus" className="h-4 w-4" />
        </Button>
      </header>

      {adding && (
        <form onSubmit={handleAdd} className="mb-3">
          <label htmlFor={`todo-add-${entry.category.id}`} className="sr-only">
            New item in {entry.category.name}
          </label>
          <input
            id={`todo-add-${entry.category.id}`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Add a task"
            disabled={busy}
            maxLength={500}
            // Focuses on open so the reader can type straight away — the control was
            // just clicked, so stealing focus is what they asked for.
            autoFocus
            className={INPUT_CLASS}
          />
        </form>
      )}

      {entry.open.length === 0 && entry.completed.length === 0 ? (
        <p className="py-2 text-sm text-muted">Nothing to do here yet.</p>
      ) : (
        <ul className="space-y-1">
          {entry.open.map((item) => (
            <TodoRow key={item.id} item={item} onRun={onRun} />
          ))}
        </ul>
      )}

      {entry.completed.length > 0 && (
        <div className="mt-3 border-t border-line pt-2">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowCompleted((open) => !open)}
              aria-expanded={showCompleted}
              className="flex items-center gap-1.5 rounded px-1 py-1 text-sm text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
            >
              {/* A disclosure triangle, not a slot: a state glyph, which
                  coding-guide.md keeps out of the slot registry. */}
              <span
                aria-hidden
                className={`inline-block transition-transform ${showCompleted ? "rotate-90" : ""}`}
              >
                ▸
              </span>
              Completed ({entry.completed.length})
            </button>
            {showCompleted && (
              <button
                type="button"
                onClick={handleClear}
                disabled={busy}
                className="rounded px-1 py-1 text-xs text-muted transition-colors hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
              >
                Clear all
              </button>
            )}
          </div>

          {showCompleted && (
            <ul className="mt-1 space-y-1">
              {entry.completed.map((item) => (
                <TodoRow key={item.id} item={item} onRun={onRun} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** One item: the checkbox, the text, and — once done — the hover ✕. */
function TodoRow({
  item,
  onRun,
}: {
  item: TodoItem;
  onRun: (action: Promise<ActionResult>) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);

  async function handleToggle() {
    setBusy(true);
    // `!item.isDone` is read from the row the server rendered, and sent as an explicit
    // target state rather than a toggle — so two people ticking at once converge
    // instead of flipping each other's click. See `setItemDoneSchema`.
    await onRun(setTodoItemDoneAction({ id: item.id, isDone: !item.isDone }));
    setBusy(false);
  }

  async function handleDelete() {
    setBusy(true);
    await onRun(deleteTodoItemAction({ id: item.id }));
    setBusy(false);
  }

  return (
    <li className="group/item flex items-start gap-2 rounded-lg px-1 py-1 hover:bg-paper">
      <input
        type="checkbox"
        checked={item.isDone}
        onChange={handleToggle}
        disabled={busy}
        aria-label={item.isDone ? `Mark "${item.title}" as not done` : `Mark "${item.title}" as done`}
        // `mt-0.5` so the box aligns with the first line of a title that wraps, rather
        // than centring itself against a two-line block.
        className="mt-0.5 h-4 w-4 shrink-0 accent-brass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
      />
      <div className="min-w-0 flex-1">
        <p className={`break-words text-sm ${item.isDone ? "text-muted line-through" : "text-ink"}`}>
          {item.title}
        </p>
        {item.notes !== "" && <p className="break-words text-xs text-muted">{item.notes}</p>}
      </div>
      {/* Only on a completed item, as the screenshot has it. An open item is removed by
          ticking it first — or from the Completed group afterwards — which keeps an
          accidental click from destroying something still outstanding.
          `max-lg:opacity-100` for the same reason as the list row's bin: there is no
          hover on a touch screen. */}
      {item.isDone && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={busy}
          title={`Delete "${item.title}"`}
          aria-label={`Delete "${item.title}"`}
          className="shrink-0 rounded p-0.5 text-muted opacity-0 transition-opacity hover:text-red-400 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass group-hover/item:opacity-100 max-lg:opacity-100"
        >
          ✕
        </button>
      )}
    </li>
  );
}
