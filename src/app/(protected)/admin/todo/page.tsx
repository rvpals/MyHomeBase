// Administration → TODO Lists.
//
// A server component, mirroring the Scratchpad Categories screen: it reads the stored
// lists so the view starts on the real values with no fetch-then-populate flicker.
//
// Unlike that screen, this one shows **counts of the items**, and that difference
// follows migration 0123's ownership call rather than being an oversight. Scratchpad
// notes are private, so its admin screen learns a number only when a delete is refused;
// TODO items are the household's, visible to everyone granted Tools, so showing how full
// each list is here reveals nothing an admin could not already see on the module screen.

import { buildTodoBoard } from "@/lib/todo";
import { deps } from "@/lib/wiring";
import { PAGE_CONTAINER } from "../../page-container";
import { TodoListsView } from "./view";

export default function TodoListsPage() {
  // The whole board rather than `listCategories`, because the view shows each list's
  // open and completed counts — one read of each table, the same call the module screen
  // makes.
  const board = buildTodoBoard({
    categoryRepo: deps.todoCategoryRepo,
    itemRepo: deps.todoItemRepo,
  });

  const lists = board.categories.map((entry) => ({
    category: entry.category,
    open: entry.open.length,
    completed: entry.completed.length,
  }));

  return (
    <div className={PAGE_CONTAINER}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Administration
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">TODO Lists</h1>
      <p className="mt-2 text-sm text-muted">
        The lists behind the TODO screen in <strong>Tools</strong> and the TODO card on
        the home screen. One set for the whole household, not per person — everyone who
        can open Tools sees the same lists and the same items, and can tick any of them
        off.
      </p>
      <p className="mt-2 text-sm text-muted">
        Lists can also be added from the Tools screen itself; this is where they get
        renamed, reordered and removed. A list can only be deleted once it is empty.
        Switch the home-screen card on or off under{" "}
        <strong>Display Settings → Dashboard Widgets</strong>.
      </p>

      <TodoListsView lists={lists} />
    </div>
  );
}
