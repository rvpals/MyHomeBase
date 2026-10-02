// The menu item registry, from the terminal.
//
// The CLI peer of Administration -> Display Settings -> Menu Items. Same use-cases,
// same registry, so the ids a toolbar will store can be listed, renamed and reset
// without a browser — which is the litmus test in ARCHITECTURE.md.
//
// It imports `createMenuItemSource` from `src/app/`, which looks like a layering
// violation and is not: that file is the composition root for `MenuItemSource`,
// exactly as `module-sections.ts` is for `SectionSource`. It is plain data with no
// React and no Next import, and the rule runs the other way — `src/lib` may not
// import from `src/app`. The section lists live there because a section's href is
// route knowledge (see `src/lib/navigation/ports.ts` for the full reasoning).

import {
  clearMenuItemOverride,
  listMenuItems,
  setMenuItemOverride,
  type MenuItem,
} from "@/lib/menu-items";
import { listModules } from "@/lib/modules";
import { deps } from "@/lib/wiring";
import { createMenuItemSource } from "@/app/(protected)/menu-item-source";

const USAGE = `Usage:
  menu-items list [--module <slug>] [--renamed] [--filter <text>]
  menu-items set <id> [--title <text>] [--hint <text>]
  menu-items reset <id>

  list     Every reachable destination, with the id a toolbar stores it by.
    --module   Only one module's items. Use "admin" for Administration.
    --renamed  Only items an administrator has changed.
    --filter   Substring match on the id, title or description.

  set      Rename one item, or change its description.
    --title    The new name. Pass "" to restore the shipped one.
    --hint     The new description. Pass "" to clear it entirely.

  reset    Restore one item's shipped name and description.

An item's id is its icon slot id, so the same id addresses its artwork on
Administration -> Display Settings -> Icons. Ids are permanent.`;

/** The registry source over the live database. Includes hidden modules — see the page. */
function source() {
  return createMenuItemSource(listModules(deps.moduleRepo, { includeHidden: true }));
}

/** The value after `flag`, or `undefined`. Distinguishes absent from deliberately blank. */
function optionValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1] ?? "";
}

function printItem(item: MenuItem): void {
  const mark = item.isOverridden ? "*" : " ";
  console.log(`${mark} ${item.id.padEnd(44)} ${item.title}`);
  if (item.hint) console.log(`${" ".repeat(47)}${item.hint}`);
}

function listCommand(args: string[]): void {
  const items = listMenuItems(source(), deps.menuItemOverrideRepo);
  const moduleSlug = optionValue(args, "--module");
  const filter = optionValue(args, "--filter")?.toLowerCase();
  const renamedOnly = args.includes("--renamed");

  const matched = items.filter((item) => {
    if (moduleSlug && item.moduleSlug !== moduleSlug) return false;
    if (renamedOnly && !item.isOverridden) return false;
    if (filter) {
      const haystack = `${item.id} ${item.title} ${item.hint ?? ""} ${item.moduleName}`.toLowerCase();
      if (!haystack.includes(filter)) return false;
    }
    return true;
  });

  if (matched.length === 0) {
    console.log("No menu items match.");
    return;
  }

  let lastModule: string | undefined;
  for (const item of matched) {
    if (item.moduleName !== lastModule) {
      console.log(`\n${item.moduleName}`);
      lastModule = item.moduleName;
    }
    printItem(item);
  }

  const renamed = matched.filter((item) => item.isOverridden).length;
  console.log(`\n${matched.length} item(s), ${renamed} renamed. * = renamed.`);
}

function setCommand(args: string[]): void {
  const id = args[0];
  if (!id || id.startsWith("--")) {
    console.error("menu-items set needs an id.");
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const title = optionValue(args, "--title");
  const hint = optionValue(args, "--hint");
  if (title === undefined && hint === undefined) {
    console.error("Pass --title or --hint (or both).");
    process.exitCode = 1;
    return;
  }

  try {
    // The lib validates the id, the caps, and that the item exists — the CLI is an
    // adapter and re-checking here would be a second rule to keep in step.
    const item = setMenuItemOverride(source(), deps.menuItemOverrideRepo, {
      menuItemId: id,
      title,
      hint,
    });
    console.log(item.isOverridden ? `Renamed to "${item.title}".` : `Reset to "${item.title}".`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to set the menu item.");
    process.exitCode = 1;
  }
}

function resetCommand(args: string[]): void {
  const id = args[0];
  if (!id) {
    console.error("menu-items reset needs an id.");
    process.exitCode = 1;
    return;
  }

  try {
    const item = clearMenuItemOverride(source(), deps.menuItemOverrideRepo, id);
    console.log(`Reset to "${item.title}".`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to reset the menu item.");
    process.exitCode = 1;
  }
}

export async function menuItemsCommand(args: string[]): Promise<void> {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }

  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case "list":
      listCommand(rest);
      return;
    case "set":
      setCommand(rest);
      return;
    case "reset":
      resetCommand(rest);
      return;
    default:
      console.error(`Unknown subcommand "${subcommand}".`);
      console.error(USAGE);
      process.exitCode = 1;
  }
}
