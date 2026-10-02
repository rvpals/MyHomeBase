// Personal toolbars, from the terminal.
//
// The CLI peer of Administration -> Display Settings -> Personal Toolbars. Same
// use-cases and the same zod schemas, so a bad colour or a destination-less
// shortcut is rejected identically in both — the litmus test in ARCHITECTURE.md.
//
// A toolbar is ADDITIVE chrome: it sits beside the navigation tree and the compact
// bottom bar rather than replacing either. Nothing here can remove navigation.

import { listMenuItems } from "@/lib/menu-items";
import { listModules } from "@/lib/modules";
import {
  addToolbarItem,
  createToolbar,
  deleteToolbar,
  isOrnamentalKind,
  listToolbars,
  removeToolbarItem,
  updateToolbar,
  type ToolbarEdge,
  type ToolbarItemKind,
} from "@/lib/toolbars";
import { deps } from "@/lib/wiring";
import { createMenuItemSource } from "@/app/(protected)/menu-item-source";

const USAGE = `Usage:
  toolbars list
  toolbars add --name <text> [--edge top|bottom|left|right] [--background <colour>]
               [--border <colour>] [--text <colour>] [--full-mode-only] [--hidden]
  toolbars set <id> [--name <text>] [--edge <edge>] [--background <colour>]
               [--border <colour>] [--text <colour>] [--full-mode-only <0|1>]
               [--visible <0|1>]
  toolbars delete <id>
  toolbars add-item <toolbarId> --screen <menuItemId> [--label <text>]
  toolbars add-item <toolbarId> --separator
  toolbars add-item <toolbarId> --space
  toolbars remove-item <itemId>

Colours are hex (#2f6f4f) or rgb()/hsl(). Omit one to follow the application's
theme, which is the default and keeps the bar in step with a theme change.

--separator draws a dividing line between two groups and takes no room along the
bar. --space is invisible and takes all the slack, pushing whatever follows it to
the far end. They are different items; a bar can use both.

Items are appended to the end of the toolbar, in the order you add them.

A screen is named by its menu item id -- run \`menu-items list\` to find one.`;

function source() {
  return createMenuItemSource(listModules(deps.moduleRepo, { includeHidden: true }));
}

function knownMenuItemIds(): string[] {
  return listMenuItems(source(), deps.menuItemOverrideRepo).map((item) => item.id);
}

function optionValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1] ?? "";
}

/** A `--flag 0|1` tri-state: absent leaves the stored value alone. */
function booleanOption(args: string[], flag: string): boolean | undefined {
  const raw = optionValue(args, flag);
  if (raw === undefined) return undefined;
  return raw !== "0" && raw !== "false";
}

function listCommand(): void {
  const toolbars = listToolbars(deps.toolbarRepo);
  if (toolbars.length === 0) {
    console.log("No toolbars.");
    return;
  }

  const menuItems = new Map(
    listMenuItems(source(), deps.menuItemOverrideRepo).map((item) => [item.id, item]),
  );

  for (const toolbar of toolbars) {
    const flags = [
      toolbar.isVisible ? "visible" : "hidden",
      toolbar.fullModeOnly ? "full mode only" : undefined,
    ].filter(Boolean);
    console.log(`\n#${toolbar.id} ${toolbar.name} — ${toolbar.edge} edge (${flags.join(", ")})`);

    if (toolbar.items.length === 0) {
      console.log("    (empty)");
      continue;
    }

    for (const item of toolbar.items) {
      if (item.kind === "spacer") {
        console.log(`    #${item.id} <<<< flexible space >>>>`);
      } else if (item.kind === "separator") {
        console.log(`    #${item.id} ──────── separator ────────`);
      } else {
        const target = item.menuItemId ? menuItems.get(item.menuItemId) : undefined;
        // A row whose menu item is gone is not drawn on the real toolbar. Saying so
        // here is the only way to find out it is there in order to remove it.
        const where = target ? target.href : `MISSING (${item.menuItemId}) — not shown`;
        console.log(`    #${item.id} ${item.label ?? target?.title ?? "?"}  ${where}`);
      }
    }
  }
  console.log();
}

function addCommand(args: string[]): void {
  const name = optionValue(args, "--name");
  if (!name) {
    console.error("toolbars add needs --name.");
    process.exitCode = 1;
    return;
  }

  const created = createToolbar(deps.toolbarRepo, {
    name,
    edge: (optionValue(args, "--edge") ?? "left") as ToolbarEdge,
    backgroundColor: optionValue(args, "--background"),
    borderColor: optionValue(args, "--border"),
    textColor: optionValue(args, "--text"),
    fullModeOnly: args.includes("--full-mode-only"),
    // `--hidden` so the default (absent) is a visible toolbar: creating one and
    // finding nothing on screen would read as a failure.
    isVisible: !args.includes("--hidden"),
  });
  console.log(`Created toolbar #${created.id} "${created.name}" on the ${created.edge} edge.`);
}

function setCommand(args: string[]): void {
  const id = Number(args[0]);
  if (!Number.isInteger(id)) {
    console.error("toolbars set needs a toolbar id.");
    process.exitCode = 1;
    return;
  }

  const existing = deps.toolbarRepo.getToolbar(id);
  if (!existing) {
    console.error(`No toolbar with the id ${id}.`);
    process.exitCode = 1;
    return;
  }

  // Every field defaults to what is stored, so a flag left off is left alone — the
  // use-case takes a whole toolbar, not a patch.
  const updated = updateToolbar(deps.toolbarRepo, id, {
    name: optionValue(args, "--name") ?? existing.name,
    edge: (optionValue(args, "--edge") ?? existing.edge) as ToolbarEdge,
    backgroundColor: optionValue(args, "--background") ?? existing.backgroundColor,
    borderColor: optionValue(args, "--border") ?? existing.borderColor,
    textColor: optionValue(args, "--text") ?? existing.textColor,
    fullModeOnly: booleanOption(args, "--full-mode-only") ?? existing.fullModeOnly,
    isVisible: booleanOption(args, "--visible") ?? existing.isVisible,
  });
  console.log(`Updated toolbar #${updated.id} "${updated.name}".`);
}

function addItemCommand(args: string[]): void {
  const toolbarId = Number(args[0]);
  if (!Number.isInteger(toolbarId)) {
    console.error("toolbars add-item needs a toolbar id.");
    process.exitCode = 1;
    return;
  }

  const screen = optionValue(args, "--screen");

  let kind: ToolbarItemKind;
  if (screen) kind = "menu-item";
  else if (args.includes("--separator")) kind = "separator";
  else if (args.includes("--space")) kind = "spacer";
  else {
    console.error("Pass --screen <menuItemId>, --separator, or --space.");
    process.exitCode = 1;
    return;
  }

  const added = addToolbarItem(
    deps.toolbarRepo,
    toolbarId,
    {
      kind,
      menuItemId: screen,
      // The ornamental kinds carry no label — the schema rejects one, so `--label`
      // is read only where it means something.
      label: isOrnamentalKind(kind) ? undefined : optionValue(args, "--label"),
    },
    knownMenuItemIds(),
  );
  console.log(`Added item #${added.id} to toolbar #${toolbarId}.`);
}

export async function toolbarsCommand(args: string[]): Promise<void> {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }

  const [subcommand, ...rest] = args;
  try {
    switch (subcommand) {
      case "list":
        listCommand();
        return;
      case "add":
        addCommand(rest);
        return;
      case "set":
        setCommand(rest);
        return;
      case "delete":
        deleteToolbar(deps.toolbarRepo, Number(rest[0]));
        console.log(`Deleted toolbar #${rest[0]} and its items.`);
        return;
      case "add-item":
        addItemCommand(rest);
        return;
      case "remove-item":
        removeToolbarItem(deps.toolbarRepo, Number(rest[0]));
        console.log(`Removed item #${rest[0]}.`);
        return;
      default:
        console.error(`Unknown subcommand "${subcommand}".`);
        console.error(USAGE);
        process.exitCode = 1;
    }
  } catch (error) {
    // The lib's schemas and guards produce these — a bad colour, an unknown edge,
    // a screen that does not exist. Printed rather than thrown so the terminal
    // gets a message instead of a stack trace.
    console.error(error instanceof Error ? error.message : "The change could not be saved.");
    process.exitCode = 1;
  }
}
