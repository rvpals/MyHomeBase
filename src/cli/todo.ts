import {
  buildTodoBoard,
  clearCompleted,
  createCategory,
  createItem,
  deleteCategory,
  deleteItem,
  listCategories,
  renameCategory,
  setItemDone,
  type TodoDeps,
} from "@/lib/todo";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/**
 * The household's TODO lists, from the terminal — the same use-cases the Tools screen
 * and the home card call.
 *
 *   todo                              # every list with its outstanding items
 *   todo --all                        # include the completed ones
 *   todo --list "To BUY"              # one list only
 *   todo --add "Costco LR44 battery" --list "To BUY"
 *   todo --add "Instrument analysis" --list "Work TODO" --notes "SpectraMax L"
 *   todo --done 12                    # tick item 12 off
 *   todo --undone 12                  # put it back
 *   todo --delete 12                  # remove it for good
 *   todo --new-list "Learning"
 *   todo --rename-list 3 --name "Reading"
 *   todo --delete-list 3              # only works once the list is empty
 *   todo --clear-completed "To BUY"
 *
 * The item listing prints the id first so ids copy straight back into `--done` and
 * `--delete`, the same shape `browse-sqlite` uses for rowids.
 *
 * Everything here is the household's — there is no per-user filter, because there is no
 * per-user data (migration 0123). That is why no `--user` flag exists: unlike
 * `take-attendance`, nothing this command does is recorded against a person except the
 * `created_by` attribution, which the terminal deliberately leaves unset rather than
 * inventing an identity for.
 */
export async function todoCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const todoDeps: TodoDeps = {
    categoryRepo: deps.todoCategoryRepo,
    itemRepo: deps.todoItemRepo,
  };

  /** Resolves a list by name, case-insensitively — a terminal knows the name, not the id. */
  function findList(name: string) {
    return listCategories(deps.todoCategoryRepo).find(
      (category) => category.name.toLowerCase() === name.toLowerCase(),
    );
  }

  /** Reports a failed use-case and sets a non-zero exit code. */
  function fail(message: string): void {
    console.error(message);
    process.exitCode = 1;
  }

  // --- lists -------------------------------------------------------------------

  if (flags["new-list"]) {
    const result = createCategory(deps.todoCategoryRepo, { name: flags["new-list"] });
    if (!result.ok) return fail(result.message);
    console.log(`Created list "${result.category.name}" (id ${result.category.id}).`);
    return;
  }

  if (flags["rename-list"]) {
    const id = Number(flags["rename-list"]);
    const name = flags.name || undefined;
    if (!id || !name) {
      return fail('Usage: todo --rename-list <id> --name "New name"');
    }
    const result = renameCategory(deps.todoCategoryRepo, { id, name });
    if (!result.ok) return fail(result.message);
    console.log(`Renamed list ${id} to "${result.category.name}".`);
    return;
  }

  if (flags["delete-list"]) {
    const id = Number(flags["delete-list"]);
    if (!id) return fail("Usage: todo --delete-list <id>");
    const result = deleteCategory(deps.todoCategoryRepo, deps.todoItemRepo, { id });
    // The refusal already names the counts and what to do about it, so it is printed
    // as-is rather than being re-worded here.
    if (!result.ok) return fail(result.message);
    console.log(`Deleted list ${id}.`);
    return;
  }

  if (flags["clear-completed"]) {
    const list = findList(flags["clear-completed"]);
    if (!list) return fail(`No list called "${flags["clear-completed"]}".`);
    const result = clearCompleted(todoDeps, { categoryId: list.id });
    if (!result.ok) return fail(result.message);
    console.log(`Removed ${result.removed} completed item(s) from "${list.name}".`);
    return;
  }

  // --- items -------------------------------------------------------------------

  if (flags.add) {
    const listName = flags.list || undefined;
    if (!listName) {
      return fail('Usage: todo --add "Something to do" --list "To BUY" [--notes "detail"]');
    }
    const list = findList(listName);
    if (!list) return fail(`No list called "${listName}".`);

    const result = createItem(todoDeps, {
      categoryId: list.id,
      title: flags.add,
      notes: flags.notes || undefined,
    });
    if (!result.ok) return fail(result.message);
    console.log(`Added to "${list.name}": [${result.item.id}] ${result.item.title}`);
    return;
  }

  if (flags.done || flags.undone) {
    const isDone = Boolean(flags.done);
    const id = Number(isDone ? flags.done : flags.undone);
    if (!id) return fail(`Usage: todo --${isDone ? "done" : "undone"} <id>`);
    const result = setItemDone(todoDeps, { id, isDone });
    if (!result.ok) return fail(result.message);
    console.log(`${isDone ? "Completed" : "Reopened"}: [${result.item.id}] ${result.item.title}`);
    return;
  }

  if (flags.delete) {
    const id = Number(flags.delete);
    if (!id) return fail("Usage: todo --delete <id>");
    const result = deleteItem(todoDeps, { id });
    if (!result.ok) return fail(result.message);
    console.log(`Deleted item ${id}.`);
    return;
  }

  // --- the listing (the default) -----------------------------------------------

  const listName = flags.list || undefined;
  let categoryId: number | undefined;
  if (listName) {
    const list = findList(listName);
    if (!list) return fail(`No list called "${listName}".`);
    categoryId = list.id;
  }

  const board = buildTodoBoard(todoDeps, { categoryId });
  if (board.categories.length === 0) {
    console.log("No lists yet. Create one with --new-list.");
    return;
  }

  // `parseFlags` stores a valueless flag as `""`, so presence is tested with `in`
  // rather than truthiness — `Boolean(flags.all)` would be false for a bare `--all`,
  // which is exactly how it is meant to be typed.
  const showCompleted = "all" in flags;

  for (const entry of board.categories) {
    console.log(`\n${entry.category.name}  (${entry.open.length} to do, ${entry.completed.length} done)  [list ${entry.category.id}]`);

    if (entry.open.length === 0 && (!showCompleted || entry.completed.length === 0)) {
      console.log("  (nothing)");
      continue;
    }

    for (const item of entry.open) {
      console.log(`  [${item.id}] [ ] ${item.title}`);
      if (item.notes !== "") console.log(`         ${item.notes}`);
    }

    if (showCompleted) {
      for (const item of entry.completed) {
        console.log(`  [${item.id}] [x] ${item.title}`);
        if (item.notes !== "") console.log(`         ${item.notes}`);
      }
    } else if (entry.completed.length > 0) {
      console.log(`  (${entry.completed.length} completed — use --all to show)`);
    }
  }
}
