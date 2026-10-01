"use client";

// One-off home-screen widget (not a registered shared component) — the card is the TODO
// glance and nothing else will render it. Both pieces it is built from are registered:
// `CollapsibleCard` for the shell and `Tabs` for the list strip.
//
// A GLANCE WITH A CHECKBOX, NOT AN EDITOR. The card shows what is outstanding and lets
// you tick it off; adding, editing, deleting and the Completed group all live on the
// Tools screen, one click away through the title's own link. That split is why this
// file needs exactly one action — see `todo-widget-actions.ts`.
//
// NARROW: the tab strip already scrolls horizontally (the list count is unbounded), and
// the rows are a single column at every width, so nothing here forks on viewport.

import { useState } from "react";
import Link from "next/link";
import { CollapsibleCard } from "@/components/collapsible-card";
import { SlotIcon } from "@/components/slot-icon";
import { Tabs, type TabItem } from "@/components/tabs";
import { getIconSlot } from "@/lib/icons";
import type { TodoBoard, TodoCategoryBoard } from "@/lib/todo";
import { setHomeTodoItemDoneAction } from "./todo-widget-actions";

// Resolved once at module scope — `getIconSlot` reads the static registry, so this is
// not I/O. The guard is for the registry, not the user: a removed id costs the card its
// glyph rather than crashing it.
const CARD_SLOT = getIconSlot("homescreen_card_todo");

const TODO_HREF = "/modules/tools/todo";

export function TodoWidget({ board, className }: { board: TodoBoard; className?: string }) {
  // Ids ticked in this render pass, so a row greys out and leaves the list the moment
  // it is clicked rather than waiting for the server round trip. Cleared implicitly:
  // the action revalidates, the server sends a board without that item, and the id in
  // here stops matching anything.
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | undefined>(undefined);

  async function handleToggle(id: number) {
    setTicked((current) => new Set(current).add(id));
    const result = await setHomeTodoItemDoneAction({ id, isDone: true });
    if (!result.ok) {
      setError(result.error);
      // Put it back — the item is still outstanding, and leaving it greyed out would
      // tell the reader it was done when it wasn't.
      setTicked((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  const tabs: TabItem[] = board.categories.map((entry) => ({
    key: String(entry.category.id),
    // The count is the outstanding one, matching the Tools screen's panel: the number
    // means "how much is left", which is what makes it worth glancing at.
    label: `${entry.category.name} (${entry.open.length})`,
    content: <TodoTabBody entry={entry} ticked={ticked} onToggle={handleToggle} />,
  }));

  return (
    <CollapsibleCard
      title="TODO"
      titleIcon={CARD_SLOT ? <SlotIcon slot={CARD_SLOT} className="h-5 w-5" /> : undefined}
      defaultOpen
      // Adjacent to the name it acts on, which is what `titleAction` is for — the
      // "open the screen these rows came from" case the prop documents.
      titleAction={
        <Link
          href={TODO_HREF}
          className="rounded px-2 py-0.5 text-xs font-medium text-brass-dark transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        >
          Open
        </Link>
      }
      className={className}
    >
      {error && (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-red-800/60 bg-red-950/30 px-3 py-2 text-sm text-red-300"
        >
          {error}
        </p>
      )}

      {tabs.length === 0 ? (
        <p className="text-sm text-muted">
          No lists yet.{" "}
          <Link href={TODO_HREF} className="text-brass-dark hover:text-ink">
            Create one in Tools
          </Link>
          .
        </p>
      ) : (
        // The strip scrolls rather than wrapping: the tab count is the list count and
        // is unbounded, and a wrapping strip changes height as lists are added, which
        // would shuffle the cards below it on the home grid. `min-w-max` on the inner
        // row is what `overflow-x-auto` needs to scroll rather than compress — the
        // same pair, and the same reasoning, as the Floating Scratchpad's tab strip.
        <Tabs items={tabs} className="[&>div:first-child]:min-w-max [&>div:first-child]:overflow-x-auto" />
      )}
    </CollapsibleCard>
  );
}

/** One tab's body: that list's outstanding items, each with a checkbox. */
function TodoTabBody({
  entry,
  ticked,
  onToggle,
}: {
  entry: TodoCategoryBoard;
  ticked: Set<number>;
  onToggle: (id: number) => void;
}) {
  // Completed items are deliberately absent from the card — the Completed group is a
  // record to review, which is what the Tools screen is for. Optimistically ticked rows
  // drop out here too, so the list visibly shortens as you work down it.
  const open = entry.open.filter((item) => !ticked.has(item.id));

  if (open.length === 0) {
    return (
      <p className="text-sm text-muted">
        {entry.open.length === 0
          ? "Nothing to do here."
          : "All done — nice."}
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {open.map((item) => (
        <li key={item.id} className="flex items-start gap-2 rounded-lg px-1 py-1 hover:bg-paper">
          <input
            type="checkbox"
            checked={false}
            onChange={() => onToggle(item.id)}
            aria-label={`Mark "${item.title}" as done`}
            // `mt-0.5` so the box aligns with the first line of a title that wraps.
            className="mt-0.5 h-4 w-4 shrink-0 accent-brass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          />
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm text-ink">{item.title}</p>
            {item.notes !== "" && <p className="break-words text-xs text-muted">{item.notes}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}
