import { beforeEach, describe, expect, it } from "vitest";
import { FakeNoteCategoryRepository, FakeScratchpadRepository, resetFakeClock } from "./fakes";
import { NOTES_PER_CATEGORY_LIMIT } from "./schema";
import {
  createNote,
  deleteNote,
  getScratchpad,
  listNotes,
  noteLabel,
  resolveActiveCategoryId,
  saveNote,
} from "./scratchpad";

const MIN = 1;
const OTHER = 2;

beforeEach(() => resetFakeClock());

describe("noteLabel", () => {
  it("prefers the reader's own title", () => {
    expect(noteLabel({ title: "Holiday plan", body: "fly on the 3rd" })).toBe("Holiday plan");
  });

  it("falls back to the first non-blank line of the body", () => {
    expect(noteLabel({ title: "", body: "\n\n  3 boxes, Tuesday\nand a ladder" })).toBe(
      "3 boxes, Tuesday",
    );
  });

  it("ignores a carriage return so a pasted Windows note has no stray character", () => {
    // The bug this guards: splitting on `\n` alone leaves a trailing `\r`, which renders
    // as a box glyph at the end of every label in the list.
    expect(noteLabel({ title: "", body: "milk\r\neggs" })).toBe("milk");
  });

  it("truncates a long first line with an ellipsis", () => {
    const label = noteLabel({ title: "", body: "x".repeat(200) });
    expect(label).toHaveLength(60);
    expect(label.endsWith("…")).toBe(true);
  });

  it("calls a note with nothing in it 'Untitled note'", () => {
    // What "New note" produces before anyone types. An empty string here would collapse
    // the list row to nothing clickable.
    expect(noteLabel({ title: "", body: "" })).toBe("Untitled note");
    expect(noteLabel({ title: "   ", body: "\n  \n" })).toBe("Untitled note");
  });
});

describe("resolveActiveCategoryId", () => {
  const categories = [{ id: 7 }, { id: 8 }];

  it("honours a category that exists", () => {
    expect(resolveActiveCategoryId(categories, 8)).toBe(8);
  });

  it("falls back to the first tab when the requested one is gone", () => {
    // A reader whose window remembered a tab an admin has since deleted should land on
    // the first tab, not on a broken window.
    expect(resolveActiveCategoryId(categories, 999)).toBe(7);
  });

  it("returns nothing when an admin has deleted every category", () => {
    expect(resolveActiveCategoryId([], undefined)).toBeUndefined();
  });
});

describe("getScratchpad", () => {
  it("returns the strip, the active tab and only that tab's notes", () => {
    const categoryRepo = new FakeNoteCategoryRepository(["Ideas", "Shopping"]);
    const noteRepo = new FakeScratchpadRepository();
    noteRepo.create(MIN, 1, "", "an idea");
    noteRepo.create(MIN, 2, "", "milk");

    const snapshot = getScratchpad(categoryRepo, noteRepo, MIN, { categoryId: 2 });

    expect(snapshot.categories.map((category) => category.name)).toEqual(["Ideas", "Shopping"]);
    expect(snapshot.activeCategoryId).toBe(2);
    // Only the active tab — loading every tab to render one is the waste the snapshot
    // exists to avoid.
    expect(snapshot.notes.map((note) => note.body)).toEqual(["milk"]);
  });

  it("opens on the first tab when none is requested", () => {
    const categoryRepo = new FakeNoteCategoryRepository(["Ideas", "Shopping"]);
    const snapshot = getScratchpad(categoryRepo, new FakeScratchpadRepository(), MIN);
    expect(snapshot.activeCategoryId).toBe(1);
  });

  it("degrades to an empty window when there are no categories", () => {
    const snapshot = getScratchpad(
      new FakeNoteCategoryRepository(),
      new FakeScratchpadRepository(),
      MIN,
    );
    expect(snapshot).toEqual({ categories: [], notes: [], activeCategoryId: undefined });
  });

  it("never shows one reader another's notes", () => {
    const categoryRepo = new FakeNoteCategoryRepository(["Ideas"]);
    const noteRepo = new FakeScratchpadRepository();
    noteRepo.create(OTHER, 1, "", "not yours");

    expect(getScratchpad(categoryRepo, noteRepo, MIN).notes).toEqual([]);
  });
});

describe("listNotes", () => {
  it("orders most recently edited first", () => {
    const noteRepo = new FakeScratchpadRepository();
    const first = noteRepo.create(MIN, 1, "", "first");
    noteRepo.create(MIN, 1, "", "second");
    // Editing the older note moves it to the top: the note you were just typing in is
    // what should be there when you come back.
    noteRepo.update(MIN, first.id, { body: "first, edited" });

    expect(listNotes(noteRepo, MIN, 1).map((note) => note.body)).toEqual([
      "first, edited",
      "second",
    ]);
  });
});

describe("createNote", () => {
  it("creates an empty note in an existing category", () => {
    const categoryRepo = new FakeNoteCategoryRepository(["Ideas"]);
    const noteRepo = new FakeScratchpadRepository();

    const result = createNote(categoryRepo, noteRepo, MIN, { categoryId: 1 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note).toMatchObject({ userId: MIN, categoryId: 1, title: "", body: "" });
  });

  it("refuses a category that no longer exists", () => {
    // A stale window filing a note under a deleted tab would put it somewhere nothing
    // ever shows it again.
    const result = createNote(
      new FakeNoteCategoryRepository(["Ideas"]),
      new FakeScratchpadRepository(),
      MIN,
      { categoryId: 999 },
    );

    expect(result).toEqual({ ok: false, message: "That category no longer exists." });
  });

  it("refuses rather than pruning when the category is full", () => {
    // The deliberate difference from the calculator's tape: a tape drops its oldest
    // line by design, but a note is something someone wrote, so the cap refuses the
    // create instead of deleting their oldest note to make room.
    const categoryRepo = new FakeNoteCategoryRepository(["Ideas"]);
    const noteRepo = new FakeScratchpadRepository();
    for (let index = 0; index < NOTES_PER_CATEGORY_LIMIT; index += 1) {
      noteRepo.create(MIN, 1, "", `note ${index}`);
    }

    const result = createNote(categoryRepo, noteRepo, MIN, { categoryId: 1 });

    expect(result.ok).toBe(false);
    expect(noteRepo.countInCategory(MIN, 1)).toBe(NOTES_PER_CATEGORY_LIMIT);
  });

  it("counts the cap per person, not per household", () => {
    const categoryRepo = new FakeNoteCategoryRepository(["Ideas"]);
    const noteRepo = new FakeScratchpadRepository();
    for (let index = 0; index < NOTES_PER_CATEGORY_LIMIT; index += 1) {
      noteRepo.create(OTHER, 1, "", `theirs ${index}`);
    }

    // Someone else filling their own tab must not lock this reader out of theirs.
    expect(createNote(categoryRepo, noteRepo, MIN, { categoryId: 1 }).ok).toBe(true);
  });

  it("rejects a body past the cap at the boundary", () => {
    expect(() =>
      createNote(
        new FakeNoteCategoryRepository(["Ideas"]),
        new FakeScratchpadRepository(),
        MIN,
        { categoryId: 1, body: "x".repeat(20001) },
      ),
    ).toThrow();
  });
});

describe("saveNote", () => {
  it("writes the body and leaves an unmentioned title alone", () => {
    // The autosave case, and the reason `update` builds its statement from the fields
    // supplied: a body save must not clobber a title the reader just set.
    const noteRepo = new FakeScratchpadRepository();
    const note = noteRepo.create(MIN, 1, "Holiday plan", "");

    const result = saveNote(noteRepo, MIN, { id: note.id, body: "fly on the 3rd" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note).toMatchObject({ title: "Holiday plan", body: "fly on the 3rd" });
  });

  it("keeps the body's whitespace exactly as typed", () => {
    // The one string in the module that is not trimmed. A scratchpad is where people
    // paste indented text and leave blank lines; autosave reformatting what is on
    // screen mid-typing would be its worst possible behaviour.
    const noteRepo = new FakeScratchpadRepository();
    const note = noteRepo.create(MIN, 1, "", "");
    const body = "  indented\n\n\ttabbed\n";

    const result = saveNote(noteRepo, MIN, { id: note.id, body });

    expect(result.ok && result.note.body).toBe(body);
  });

  it("reports a miss rather than succeeding for a deleted note", () => {
    const result = saveNote(new FakeScratchpadRepository(), MIN, { id: 404, body: "x" });
    expect(result).toEqual({ ok: false, message: "That note no longer exists." });
  });

  it("cannot write to someone else's note", () => {
    // The security property the per-user scoping exists for: the id crosses a boundary
    // from a client, and the session decides whose note it may touch.
    const noteRepo = new FakeScratchpadRepository();
    const theirs = noteRepo.create(OTHER, 1, "", "not yours");

    const result = saveNote(noteRepo, MIN, { id: theirs.id, body: "tampered" });

    expect(result.ok).toBe(false);
    expect(noteRepo.findById(OTHER, theirs.id)?.body).toBe("not yours");
  });

  it("rejects a multi-line title at the boundary", () => {
    const noteRepo = new FakeScratchpadRepository();
    const note = noteRepo.create(MIN, 1, "", "");
    expect(() => saveNote(noteRepo, MIN, { id: note.id, title: "two\nlines" })).toThrow();
  });
});

describe("deleteNote", () => {
  it("deletes the reader's own note", () => {
    const noteRepo = new FakeScratchpadRepository();
    const note = noteRepo.create(MIN, 1, "", "throwaway");

    expect(deleteNote(noteRepo, MIN, { id: note.id })).toEqual({ ok: true });
    expect(noteRepo.findById(MIN, note.id)).toBeUndefined();
  });

  it("cannot delete someone else's note", () => {
    const noteRepo = new FakeScratchpadRepository();
    const theirs = noteRepo.create(OTHER, 1, "", "not yours");

    expect(deleteNote(noteRepo, MIN, { id: theirs.id }).ok).toBe(false);
    expect(noteRepo.findById(OTHER, theirs.id)).toBeDefined();
  });

  it("reports a miss for a note that has already gone", () => {
    expect(deleteNote(new FakeScratchpadRepository(), MIN, { id: 404 })).toEqual({
      ok: false,
      message: "That note no longer exists.",
    });
  });
});
