import { noteLabel } from "./scratchpad";
import type { Note, NoteTextFile } from "./types";

/**
 * A label turned into a filename fragment.
 *
 * Lowercased, non-alphanumerics collapsed to single hyphens, trimmed of leading and
 * trailing ones. That is deliberately aggressive rather than a blocklist of the
 * characters Windows forbids (`\ / : * ? " < > |`): the input is a note title someone
 * typed, it may contain anything including emoji and right-to-left marks, and an
 * allowlist is the only version of this that can't be surprised. A download whose
 * filename the OS rejects is a silently failed save.
 *
 * Also guards the two path traversal shapes — a name of `..` or one starting with a dot
 * collapses to nothing and falls back to the caller's default.
 */
function toFileNameFragment(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    // 60 characters keeps the whole filename comfortably inside every filesystem's
    // limit once the prefix, the category and the extension are added.
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/**
 * One note as a text file: what to call it, and what goes in it.
 *
 * In `lib` rather than the component because every decision here is a rule about notes
 * rather than about markup — what the file is called, what capitalisation the fragment
 * takes, whether a header is included — and the CLI writes the identical file. The
 * browser's job is reduced to handing `content` to a `Blob`, which is the only part that
 * genuinely needs a DOM.
 *
 * The **header** is three lines: the label, the category, and when it was last edited.
 * A bare body would be the purer export, but a scratchpad note is often a fragment
 * ("3 boxes, Tuesday") that means nothing in a file called `note.txt` six months later.
 * The separator line keeps it visually distinct from the note itself.
 */
export function noteToTextFile(
  note: Pick<Note, "title" | "body" | "updatedAt">,
  categoryName: string,
): NoteTextFile {
  const label = noteLabel(note);

  const categoryFragment = toFileNameFragment(categoryName);
  const labelFragment = toFileNameFragment(label);

  // Every fragment can be empty — an untitled, unfiled note, or a category named
  // entirely in a script this function strips. The parts are filtered rather than
  // joined blindly, so the worst case is `scratchpad.txt` and never `scratchpad--.txt`.
  const fileName = `${["scratchpad", categoryFragment, labelFragment]
    .filter((part) => part !== "")
    .join("-")}.txt`;

  const header = [
    label,
    `Category: ${categoryName}`,
    `Last edited: ${note.updatedAt}`,
    "".padEnd(40, "-"),
  ].join("\n");

  // A trailing newline, as every text file should have — a file whose last line has no
  // terminator makes `cat` run the next prompt onto it.
  return { fileName, content: `${header}\n${note.body}\n` };
}

/**
 * A whole category as one text file.
 *
 * The "save the tab" case, for a reader who wants the shopping list rather than one item
 * of it. Notes are separated by a rule and arrive in the order they were given, which is
 * the order the window shows (most recently edited first) — re-sorting here would produce
 * a file that didn't match the screen it was saved from.
 */
export function categoryToTextFile(
  notes: readonly Pick<Note, "title" | "body" | "updatedAt">[],
  categoryName: string,
): NoteTextFile {
  const categoryFragment = toFileNameFragment(categoryName);
  const fileName = `${["scratchpad", categoryFragment].filter((part) => part !== "").join("-")}.txt`;

  const count = notes.length === 1 ? "1 note" : `${notes.length} notes`;
  const header = [categoryName, count, "".padEnd(40, "-")].join("\n");

  const body = notes
    .map((note) => `${noteLabel(note)}\n${"".padEnd(40, "-")}\n${note.body}`)
    .join("\n\n");

  // An empty category still produces a valid file rather than a special case: the header
  // says "0 notes" and the body is blank, which is a more useful answer than an error
  // for someone who clicked Save on a tab they had just emptied.
  return { fileName, content: notes.length === 0 ? `${header}\n` : `${header}\n${body}\n` };
}
