import type { ComponentListRepository } from "./ports";
import type { ComponentEntry, ComponentList } from "./types";

// The use-case for the component registry. No file access here — the repository
// supplies the text, exactly as in `feature-list` and `change-history`, so the
// same result is reachable from the web app, the CLI and a test with a string
// literal.

/** The heading that opens the table this module reads. */
const INDEX_HEADING = /^##\s+Index\s*$/;
/** Any `## ` heading — what ends the Index section. */
const ANY_HEADING = /^##\s/;
/** A table rule row: `|---|---|`. Not data. */
const RULE_ROW = /^\|[\s:-]*\|/;

/**
 * Placeholder for a backslash-escaped pipe while a row is split on `|`.
 *
 * `components.md` has none today, but it is a hand-edited document and a purpose
 * mentioning a union type (`"a" \| "b"`) is exactly the kind of line someone adds
 * later. Without this the row would split into five cells and be dropped — a
 * silent loss of one component from the screen, which is worse than the four
 * lines it costs to handle.
 */
const PIPE_SENTINEL = "\u0000PIPE\u0000";

/**
 * Strips markdown decoration down to the plain text a view will render.
 *
 * The registry's cells are written for a reader of the document — `[`Button`](#button)`
 * for the name, `**Result grid** — any table` for the purpose. The screen wants
 * "Button" and "Result grid — any table", so link syntax, backticks, bold and
 * strikethrough all come off here rather than in the `.tsx`.
 *
 * Link *text* is kept and the target dropped: every link in this table points at
 * an anchor inside `components.md` or at a source file, neither of which is
 * reachable or useful from the About screen.
 */
function plainText(cell: string): string {
  return cell
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/~~/g, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .trim();
}

/** The href out of a `[text](target)` cell, or the cell itself when it is bare. */
function linkTarget(cell: string): string {
  const match = /\[[^\]]*\]\(([^)]*)\)/.exec(cell);
  return (match ? match[1] : cell).trim();
}

/**
 * Splits one table row into its cells, honouring `\|` inside a cell.
 *
 * Returns the cells between the leading and trailing pipes, so a well-formed
 * 4-column row gives exactly 4 strings.
 */
function splitRow(line: string): string[] {
  return line
    .replace(/\\\|/g, PIPE_SENTINEL)
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.split(PIPE_SENTINEL).join("|"));
}

/**
 * Reads the registry's Index table.
 *
 * **Only the Index table**, not the `##` section per component. The index is
 * curated, one row per component, and already carries the one-line purpose; the
 * sections are long-form prose whose shape varies entry to entry. Parsing the
 * sections instead would mean guessing where a purpose ends.
 *
 * A missing file comes back as `isAvailable: false` rather than throwing: the
 * document is checked into the repo, but a checkout that doesn't have it should
 * render an empty state instead of failing the whole About screen.
 *
 * A row that isn't four cells is skipped rather than throwing, for the same
 * reason — a hand-edited table with one malformed row should cost that row, not
 * the screen.
 */
export function getComponentList(repo: ComponentListRepository): ComponentList {
  const markdown = repo.readComponentList();
  if (markdown === null) return { entries: [], isAvailable: false };

  const entries: ComponentEntry[] = [];
  let inIndex = false;

  for (const line of markdown.split(/\r?\n/)) {
    if (!inIndex) {
      if (INDEX_HEADING.test(line)) inIndex = true;
      continue;
    }
    // The next `## ` closes the section. Everything this module wants is above it.
    if (ANY_HEADING.test(line)) break;
    if (!line.startsWith("|") || RULE_ROW.test(line)) continue;

    const cells = splitRow(line);
    if (cells.length !== 4) continue;

    const name = plainText(cells[0]);
    // The header row has no link syntax, so its first cell survives `plainText`
    // as the literal word "Component". Matching on that is what skips it without
    // assuming the header is always the first row encountered.
    if (name === "" || name === "Component") continue;

    entries.push({
      name,
      purpose: plainText(cells[1]),
      sourcePath: linkTarget(cells[2]),
      // Anything that isn't a clear "yes" is treated as not-a-client-component.
      // The column only ever holds `yes` or `no`, and defaulting an unreadable
      // value to `false` understates rather than invents.
      isClient: plainText(cells[3]).toLowerCase() === "yes",
    });
  }

  return { entries, isAvailable: true };
}
