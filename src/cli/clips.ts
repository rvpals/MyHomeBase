import {
  createClip,
  deleteClip,
  getClip,
  linkClip,
  listClips,
  openClip,
  clipHtmlToText,
} from "@/lib/clips";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/**
 * Drives the Clips use-cases from the terminal — the same functions the web app
 * calls, through the same `index.ts` and the same `deps`.
 *
 *   clips list
 *   clips list --tag flight --category Travel
 *   clips list --search JFK
 *   clips show --id 3
 *   clips show --id 3 --password "correct horse"
 *   clips add --title "Flight confirmation" --content "<p>BA117</p>" --tags "flight,travel"
 *   clips link --id 3 --entry 42
 *   clips delete --id 3
 *
 * `--content` takes HTML and is sanitized exactly as a paste in the browser is —
 * that is the point of routing both through the use-case rather than the view.
 *
 * Images are deliberately not reachable here: pasting one is a browser gesture,
 * and a CLI flag taking a base64 blob on argv would be unusable. Everything else
 * a clip does is available.
 */
export async function clipsCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const flags = parseFlags(rest);

  switch (subcommand) {
    case "list": {
      const rows = listClips(deps.clipsRepo, {
        search: flags.search ?? "",
        categories: splitList(flags.category),
        tags: splitList(flags.tag),
      });

      if (rows.length === 0) {
        console.log("No clips.");
        return;
      }

      for (const row of rows) {
        const marks = [
          row.isEncrypted ? "locked" : "",
          row.imageCount > 0 ? `${row.imageCount} image${row.imageCount === 1 ? "" : "s"}` : "",
          row.linkCount > 0 ? `${row.linkCount} link${row.linkCount === 1 ? "" : "s"}` : "",
        ].filter(Boolean);

        console.log(
          `${String(row.id).padStart(4)}  ${row.title || "(untitled)"}${
            marks.length > 0 ? `  [${marks.join(", ")}]` : ""
          }`,
        );
        if (row.excerpt) console.log(`      ${row.excerpt}`);
        const taxonomy = [...row.categories, ...row.tags];
        if (taxonomy.length > 0) console.log(`      ${taxonomy.join(" · ")}`);
      }
      return;
    }

    case "show": {
      const id = Number(flags.id);
      if (!id) {
        console.error("Usage: clips show --id 3 [--password ...]");
        process.exitCode = 1;
        return;
      }

      const clip = getClip(deps.clipsRepo, id);

      // A sealed clip needs its password even to print. `openClip` throws
      // WrongPasswordError, which the top-level handler reports — no special case
      // here, so the CLI and the web app fail the same way.
      const text = clip.isEncrypted
        ? openClip(deps.clipsRepo, { id, password: flags.password ?? "" })
        : { title: clip.title, contentHtml: clip.contentHtml };

      console.log(text.title || "(untitled)");
      if (clip.categories.length > 0) console.log(`Categories: ${clip.categories.join(", ")}`);
      if (clip.tags.length > 0) console.log(`Tags: ${clip.tags.join(", ")}`);
      console.log("");
      // Plain text, not markup: a terminal cannot render the HTML, and dumping raw
      // tags would make the useful part unreadable.
      console.log(clipHtmlToText(text.contentHtml));
      return;
    }

    case "add": {
      const { clip, removed } = createClip(deps.clipsRepo, {
        title: flags.title ?? "",
        contentHtml: flags.content ?? "",
        categories: splitList(flags.categories),
        tags: splitList(flags.tags),
      });

      console.log(`Created clip ${clip.id}.`);
      // Reported rather than silent: the same information the editor shows after a
      // paste, so a scripted import can tell that its markup was reduced.
      for (const line of removed) console.log(`  removed: ${line}`);
      return;
    }

    case "link": {
      const id = Number(flags.id);
      const entry = Number(flags.entry);
      if (!id || !entry) {
        console.error("Usage: clips link --id 3 --entry 42");
        process.exitCode = 1;
        return;
      }

      linkClip(deps.clipsRepo, { clipId: id, targetModule: "journal", targetId: entry });
      console.log(`Clip ${id} is attached to journal entry ${entry}.`);
      return;
    }

    case "delete": {
      const id = Number(flags.id);
      if (!id) {
        console.error("Usage: clips delete --id 3");
        process.exitCode = 1;
        return;
      }

      deleteClip(deps.clipsRepo, id);
      console.log(`Deleted clip ${id}.`);
      return;
    }

    default:
      console.error("Usage: clips <list|show|add|link|delete> [flags]");
      process.exitCode = 1;
  }
}

/** A comma-separated flag into a trimmed list, with empties dropped. */
function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}
