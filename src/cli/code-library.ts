import { readFileSync } from "node:fs";
import {
  SNIPPET_LANGUAGE_LABELS,
  createSnippet,
  emptyRecycleBin,
  getSnippet,
  listRecycledSnippets,
  listSnippetCategories,
  listSnippetTags,
  listSnippets,
  purgeRecycledSnippet,
  recycleSnippet,
  restoreRecycledSnippet,
  setSnippetColor,
  setSnippetPinned,
  updateSnippet,
  type SnippetCardColor,
  type SnippetLanguage,
} from "@/lib/code-library";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/**
 * Drives the Code Library use-cases from the terminal — the same functions the web
 * app calls, through the same `index.ts` and the same `deps`.
 *
 *   code-library list
 *   code-library list --search "group by"
 *   code-library list --language sql
 *   code-library list --category Query --tag postgres   (AND: both must match)
 *   code-library console.error(
        "Usage: code-library <list|show|add|edit|delete|recycled|restore|purge|empty-bin|pin|unpin|colour|labels>",
      ); --id 3      /  code-library unpin --id 3
 *   code-library labels          (the categories and tags, with usage counts)
 *   code-library colour --id 3 --colour ocean       (--colour "" clears it)
 *   code-library delete --id 3        (moves it to the bin; nothing here destroys)
 *   code-library recycled
 *   code-library restore --recycled 5
 *   code-library purge --recycled 5   (irreversible, and names a BIN row)
 *   code-library empty-bin
 *   code-library colour --id 3 --colour ocean     (--colour "" clears it)
 *   code-library show --id 3
 *   code-library add --file ./query.sql --title "Monthly rollup" --language sql
 *   code-library add --code "SELECT 1" --language sql
 *   code-library edit --id 3 --file ./query.sql
 *
 * `show` prints the snippet **verbatim** and nothing else around it, so
 * `npm run cli -- code-library show --id 3 > thing.sql` produces the file the
 * snippet was. That is the same promise the Copy button will make in the browser,
 * and it is only possible because the body is stored as plain text.
 *
 * `--file` is the way in that matches it. A snippet's whole point is its exact
 * bytes, and passing those on argv means a shell has already mangled the tabs,
 * the newlines and anything that looked like a variable. Reading a file leaves
 * them alone. `--code` exists for one-liners, where that does not matter.
 *
 * `delete` moves a snippet to the bin and has **no `--forever`**. The only
 * irreversible command is `purge`, and it names a *bin row* rather than a
 * snippet — so a mistyped id there cannot destroy something still in the
 * library. `empty-bin` is the other one, and it says how many it took.
 */
export async function codeLibraryCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const flags = parseFlags(rest);

  switch (subcommand) {
    case "list": {
      const rows = listSnippets(deps.codeLibraryRepo, {
        search: flags.search ?? "",
        language: flags.language ?? "",
        categories: splitList(flags.category),
        tags: splitList(flags.tag),
      });

      if (rows.length === 0) {
        console.log("No snippets.");
        return;
      }

      for (const row of rows) {
        console.log(
          `${row.isPinned ? "*" : " "}${String(row.id).padStart(4)}  ${
            row.title || "(untitled)"
          }  [${SNIPPET_LANGUAGE_LABELS[row.language]}, ${row.lineCount} ${
            row.lineCount === 1 ? "line" : "lines"
          }]`,
        );
        const labels = [...row.categories, ...row.tags];
        if (labels.length > 0) console.log(`       ${labels.join(" · ")}`);
      }
      return;
    }

    case "labels": {
      const categories = listSnippetCategories(deps.codeLibraryRepo);
      const tags = listSnippetTags(deps.codeLibraryRepo);

      console.log("Categories:");
      if (categories.length === 0) console.log("  (none)");
      for (const item of categories) console.log(`  ${item.name}  (${item.usageCount})`);

      console.log("Tags:");
      if (tags.length === 0) console.log("  (none)");
      for (const item of tags) console.log(`  ${item.name}  (${item.usageCount})`);
      return;
    }

    case "colour":
    case "color": {
      const id = Number(flags.id);
      if (!id) {
        console.error("Usage: code-library colour --id 3 --colour ocean");
        console.error("  (an empty --colour clears the tint)");
        process.exitCode = 1;
        return;
      }

      // Both spellings accepted, because half the codebase says colour and the
      // other half says color. The value is a palette KEY, never a hex — the
      // schema refuses anything else, which is what keeps a stored tint
      // themeable.
      const chosen = flags.colour ?? flags.color ?? "";
      setSnippetColor(deps.codeLibraryRepo, {
        id,
        color: chosen as SnippetCardColor | "",
      });
      console.log(chosen === "" ? `Cleared the colour on ${id}.` : `Coloured ${id} ${chosen}.`);
      return;
    }

    case "delete": {
      const id = Number(flags.id);
      if (!id) {
        console.error("Usage: code-library delete --id 3   (moves it to the bin)");
        process.exitCode = 1;
        return;
      }

      // Always the bin, never destruction — there is no `--forever` here. The
      // irreversible step is `purge`, which names a BIN row, so a mistyped id
      // cannot destroy a live snippet.
      recycleSnippet(deps.codeLibraryRepo, id);
      console.log(`Moved snippet ${id} to the bin. Restore it with: code-library recycled`);
      return;
    }

    case "recycled": {
      const rows = listRecycledSnippets(deps.codeLibraryRepo);
      if (rows.length === 0) {
        console.log("The bin is empty.");
        return;
      }

      for (const row of rows) {
        // The BIN row's id first, because that is what restore and purge take.
        // Printing the snippet's old id in the same column is how someone
        // purges the wrong thing.
        console.log(
          `${String(row.id).padStart(4)}  ${row.title || "(untitled)"}  [was #${
            row.snippetId
          }, deleted ${row.deletedAt}]`,
        );
      }
      return;
    }

    case "restore": {
      const recycledId = Number(flags.recycled);
      if (!recycledId) {
        console.error("Usage: code-library restore --recycled 5");
        process.exitCode = 1;
        return;
      }

      const id = restoreRecycledSnippet(deps.codeLibraryRepo, recycledId);
      console.log(`Restored as snippet ${id}.`);
      return;
    }

    case "purge": {
      const recycledId = Number(flags.recycled);
      if (!recycledId) {
        console.error("Usage: code-library purge --recycled 5");
        process.exitCode = 1;
        return;
      }

      purgeRecycledSnippet(deps.codeLibraryRepo, recycledId);
      console.log(`Removed bin entry ${recycledId} for good.`);
      return;
    }

    case "empty-bin": {
      const count = emptyRecycleBin(deps.codeLibraryRepo);
      console.log(`Removed ${count} snippet${count === 1 ? "" : "s"} for good.`);
      return;
    }

    case "pin":
    case "unpin": {
      const id = Number(flags.id);
      if (!id) {
        console.error(`Usage: code-library ${subcommand} --id 3`);
        process.exitCode = 1;
        return;
      }

      // Throws SnippetNotFoundError for an id that is gone, which the top-level
      // handler reports — so the CLI and the web app fail the same way.
      setSnippetPinned(deps.codeLibraryRepo, { id, isPinned: subcommand === "pin" });
      console.log(`${subcommand === "pin" ? "Pinned" : "Unpinned"} snippet ${id}.`);
      return;
    }

    case "show": {
      const id = Number(flags.id);
      if (!id) {
        console.error("Usage: code-library show --id 3");
        process.exitCode = 1;
        return;
      }

      const snippet = getSnippet(deps.codeLibraryRepo, id);
      if (!snippet) {
        console.error(`No snippet with id ${id}.`);
        process.exitCode = 1;
        return;
      }

      // The body alone, on stdout, with no heading and no framing — so the output
      // can be redirected into a file and be the snippet. The title and language
      // go to stderr, where they stay visible in a terminal and out of a pipe.
      console.error(
        `${snippet.title || "(untitled)"} — ${SNIPPET_LANGUAGE_LABELS[snippet.language]}`,
      );
      console.log(snippet.code);
      return;
    }

    case "add": {
      const code = readCodeFlag(flags);
      if (code === undefined) {
        console.error("Usage: code-library add --file ./thing.sql [--title ...] [--language sql]");
        console.error("   or: code-library add --code \"SELECT 1\" [--title ...] [--language sql]");
        process.exitCode = 1;
        return;
      }

      // No `createdBy`: a CLI run has no session behind it, and `created_by` is
      // attribution rather than ownership, so null is the honest value.
      const snippet = createSnippet(
        deps.codeLibraryRepo,
        {
          title: flags.title ?? "",
          code,
          language: (flags.language ?? "text") as SnippetLanguage,
          categories: splitList(flags.category),
          tags: splitList(flags.tag),
        },
        null,
      );

      console.log(`Added snippet ${snippet.id}.`);
      return;
    }

    case "edit": {
      const id = Number(flags.id);
      if (!id) {
        console.error("Usage: code-library edit --id 3 [--file ./thing.sql] [--title ...] [--language sql]");
        process.exitCode = 1;
        return;
      }

      const existing = getSnippet(deps.codeLibraryRepo, id);
      if (!existing) {
        console.error(`No snippet with id ${id}.`);
        process.exitCode = 1;
        return;
      }

      // Each field falls back to what is stored, so `edit --id 3 --language sql`
      // changes only the language. The schema is whole-record, which is why the
      // existing values are read first rather than a partial being sent.
      const code = readCodeFlag(flags) ?? existing.code;

      const snippet = updateSnippet(deps.codeLibraryRepo, {
        id,
        title: flags.title ?? existing.title,
        code,
        language: (flags.language ?? existing.language) as SnippetLanguage,
        // The pairings are replaced wholesale by a save, so leaving the flag out
        // has to mean "keep what is there" rather than "clear them".
        categories: flags.category === undefined ? existing.categories : splitList(flags.category),
        tags: flags.tag === undefined ? existing.tags : splitList(flags.tag),
      });

      console.log(`Updated snippet ${snippet.id}.`);
      return;
    }

    default:
      console.error("Usage: code-library <list|show|add|edit|pin|unpin|colour|labels>");
      process.exitCode = 1;
  }
}

/**
 * A comma-separated flag to a list.
 *
 * An absent flag is an empty list, which for a *filter* means "do not narrow by
 * this". `edit` checks for `undefined` before calling this, because there the
 * same absence has to mean "leave the labels alone".
 */
function splitList(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") return [];
  return value.split(",");
}

/**
 * The body from `--file` or `--code`, or `undefined` when neither was given.
 *
 * `--file` wins when both are present. Read as UTF-8 and passed on untouched —
 * no trim, no newline normalisation — because the file's bytes are the snippet.
 */
function readCodeFlag(flags: Record<string, string | undefined>): string | undefined {
  if (flags.file !== undefined) return readFileSync(flags.file, "utf8");
  return flags.code;
}
