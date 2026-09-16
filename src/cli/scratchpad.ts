import { writeFileSync } from "node:fs";
import {
  categoryToTextFile,
  createCategory,
  createNote,
  deleteCategory,
  deleteNote,
  describeDeleteRefusal,
  listCategories,
  listNotes,
  noteLabel,
  noteToTextFile,
  renameCategory,
  resolveActiveCategoryId,
  saveNote,
} from "@/lib/scratchpad";
import { listUsers } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/**
 * Reads and writes the Scratchpad — the same use-cases the floating window drives, so
 * the two cannot diverge.
 *
 *   scratchpad --categories
 *   scratchpad --add-category "Recipes"
 *   scratchpad --rename-category 3 --name "Cooking"
 *   scratchpad --delete-category 3
 *   scratchpad --user min --list
 *   scratchpad --user min --category "Shopping" --list
 *   scratchpad --user min --category "Shopping" --new "milk, eggs" --title "Groceries"
 *   scratchpad --user min --save 7 --body "revised text"
 *   scratchpad --user min --delete 7
 *   scratchpad --user min --category "Shopping" --export ./shopping.txt
 *
 * The point of this command is not convenience: it is the ARCHITECTURE.md contract that
 * every use-case is reachable from a terminal. It is also the only way to get a note
 * into the app without a browser, which is what makes it useful for a scripted import.
 *
 * **The category commands take no `--user`** and the note commands all require one. That
 * is not an oversight — it is the ownership split the whole feature rests on: the tab
 * strip belongs to the household and the notes belong to a person (migration 0096).
 */
export async function scratchpadCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  // ---- Category commands. Household-wide, so no --user. ------------------------------

  if (flags.categories !== undefined) {
    const categories = listCategories(deps.noteCategoryRepo);
    if (categories.length === 0) {
      console.log("No categories. Add one with --add-category \"<name>\".");
      return;
    }
    console.log("Scratchpad categories (in tab order):");
    for (const category of categories) {
      // The id is printed because --rename-category and --delete-category take one, and
      // a terminal has no other way to find it.
      console.log(`  ${String(category.id).padStart(4)}  ${category.name}`);
    }
    return;
  }

  if (flags["add-category"]) {
    const result = createCategory(deps.noteCategoryRepo, { name: flags["add-category"] });
    if (!result.ok) {
      console.error(result.message);
      process.exitCode = 1;
      return;
    }
    console.log(`Added category "${result.category.name}" (id ${result.category.id}).`);
    return;
  }

  if (flags["rename-category"]) {
    const id = Number(flags["rename-category"]);
    if (!Number.isInteger(id) || id <= 0) {
      console.error(`--rename-category takes a category id, not "${flags["rename-category"]}".`);
      process.exitCode = 1;
      return;
    }
    if (!flags.name) {
      console.error("Give the new name with --name \"<name>\".");
      process.exitCode = 1;
      return;
    }
    const result = renameCategory(deps.noteCategoryRepo, { id, name: flags.name });
    if (!result.ok) {
      console.error(result.message);
      process.exitCode = 1;
      return;
    }
    console.log(`Renamed category ${id} to "${result.category.name}".`);
    return;
  }

  if (flags["delete-category"]) {
    const id = Number(flags["delete-category"]);
    if (!Number.isInteger(id) || id <= 0) {
      console.error(`--delete-category takes a category id, not "${flags["delete-category"]}".`);
      process.exitCode = 1;
      return;
    }
    const result = deleteCategory(deps.noteCategoryRepo, { id });
    if (!result.ok) {
      // The same sentence the admin screen shows — `describeDeleteRefusal` is in `lib`
      // precisely so the terminal and the browser explain a refusal identically.
      console.error(describeDeleteRefusal(result));
      process.exitCode = 1;
      return;
    }
    console.log(`Deleted category ${id}.`);
    return;
  }

  // ---- Note commands. Per-person, so --user is required. -----------------------------

  const username = flags.user;
  if (!username) {
    console.error(
      "Usage: scratchpad --categories\n" +
        '       scratchpad --add-category "<name>"\n' +
        '       scratchpad --rename-category <id> --name "<name>"\n' +
        "       scratchpad --delete-category <id>\n" +
        "       scratchpad --user <username> --list [--category <name|id>]\n" +
        '       scratchpad --user <username> --new "<text>" [--title "<title>"] [--category <name|id>]\n' +
        '       scratchpad --user <username> --save <id> [--title "<title>"] [--body "<text>"]\n' +
        "       scratchpad --user <username> --delete <id>\n" +
        "       scratchpad --user <username> --export <file> [--category <name|id>]",
    );
    process.exitCode = 1;
    return;
  }

  const user = listUsers(deps.userRepo).find((candidate) => candidate.username === username);
  if (!user) {
    console.error(`No user with the username "${username}".`);
    process.exitCode = 1;
    return;
  }

  /**
   * The category named by `--category`, by name or by id.
   *
   * Name first, because at a terminal `--category Shopping` is what someone types; the
   * id is accepted as a fallback for a name that is itself numeric or ambiguous. With no
   * flag it falls back to the first tab, exactly as the window's first open does — the
   * same `resolveActiveCategoryId` both use.
   */
  function resolveCategory() {
    const categories = listCategories(deps.noteCategoryRepo);
    const requested = flags.category;

    if (requested) {
      const byName = categories.find(
        (category) => category.name.toLowerCase() === requested.toLowerCase(),
      );
      if (byName) return byName;
      const byId = categories.find((category) => category.id === Number(requested));
      if (byId) return byId;
      return undefined;
    }

    const activeId = resolveActiveCategoryId(categories);
    return categories.find((category) => category.id === activeId);
  }

  // `--save` and `--delete` act on a note id and need no category, so they are handled
  // before the category is resolved — a note whose tab was deleted can still be edited.
  if (flags.save) {
    const id = Number(flags.save);
    if (!Number.isInteger(id) || id <= 0) {
      console.error(`--save takes a note id, not "${flags.save}".`);
      process.exitCode = 1;
      return;
    }
    if (flags.title === undefined && flags.body === undefined) {
      console.error("Give --title, --body, or both.");
      process.exitCode = 1;
      return;
    }
    const result = saveNote(deps.scratchpadRepo, user.id, {
      id,
      title: flags.title,
      body: flags.body,
    });
    if (!result.ok) {
      console.error(result.message);
      process.exitCode = 1;
      return;
    }
    console.log(`Saved note ${id}.`);
    return;
  }

  if (flags.delete) {
    const id = Number(flags.delete);
    if (!Number.isInteger(id) || id <= 0) {
      console.error(`--delete takes a note id, not "${flags.delete}".`);
      process.exitCode = 1;
      return;
    }
    const result = deleteNote(deps.scratchpadRepo, user.id, { id });
    if (!result.ok) {
      console.error(result.message);
      process.exitCode = 1;
      return;
    }
    console.log(`Deleted note ${id}.`);
    return;
  }

  const category = resolveCategory();
  if (!category) {
    console.error(
      flags.category
        ? `No category called "${flags.category}". Run --categories to see them.`
        : "There are no categories. Add one with --add-category \"<name>\".",
    );
    process.exitCode = 1;
    return;
  }

  if (flags.new !== undefined) {
    const result = createNote(deps.noteCategoryRepo, deps.scratchpadRepo, user.id, {
      categoryId: category.id,
      title: flags.title,
      body: flags.new,
    });
    if (!result.ok) {
      console.error(result.message);
      process.exitCode = 1;
      return;
    }
    // Just the id on stdout, so the command composes: the next call can --save it.
    console.log(String(result.note.id));
    return;
  }

  if (flags.export) {
    const notes = listNotes(deps.scratchpadRepo, user.id, category.id);
    const file = categoryToTextFile(notes, category.name);
    // The path the caller gave, not the generated filename: at a terminal, `--export
    // ./shopping.txt` means write it there. The generated name is what a browser
    // download needs, and is printed below so a script can see what it would have been.
    writeFileSync(flags.export, file.content, "utf8");
    console.log(
      `Wrote ${notes.length === 1 ? "1 note" : `${notes.length} notes`} from "${category.name}" to ${flags.export}.`,
    );
    return;
  }

  if (flags.list !== undefined) {
    const notes = listNotes(deps.scratchpadRepo, user.id, category.id);
    if (notes.length === 0) {
      console.log(`No notes for ${username} in "${category.name}".`);
      return;
    }
    console.log(`Notes for ${username} in "${category.name}" (most recently edited first):`);
    for (const note of notes) {
      // `noteLabel` rather than `note.title`, so an untitled note prints the same first
      // line the window shows in its list instead of an empty column.
      console.log(`  ${String(note.id).padStart(4)}  ${note.updatedAt}  ${noteLabel(note)}`);
    }
    return;
  }

  // A bare `--user … --category …` with no verb: print one note's file to stdout, which
  // is the most useful default for a pipe.
  if (flags.show) {
    const id = Number(flags.show);
    const note = deps.scratchpadRepo.findById(user.id, id);
    if (!note) {
      console.error(`No note ${flags.show} for ${username}.`);
      process.exitCode = 1;
      return;
    }
    console.log(noteToTextFile(note, category.name).content);
    return;
  }

  console.error("Give --list, --new, --save, --delete, --show or --export.");
  process.exitCode = 1;
}
