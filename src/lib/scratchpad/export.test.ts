import { describe, expect, it } from "vitest";
import { categoryToTextFile, noteToTextFile } from "./export";

const NOTE = {
  title: "Holiday plan",
  body: "fly on the 3rd\nhire a car",
  updatedAt: "2026-09-15T12:00:00Z",
};

describe("noteToTextFile", () => {
  it("names the file from the category and the note's label", () => {
    expect(noteToTextFile(NOTE, "Shopping").fileName).toBe(
      "scratchpad-shopping-holiday-plan.txt",
    );
  });

  it("includes a header and the body, ending with a newline", () => {
    const { content } = noteToTextFile(NOTE, "Shopping");

    expect(content).toContain("Holiday plan");
    expect(content).toContain("Category: Shopping");
    expect(content).toContain("Last edited: 2026-09-15T12:00:00Z");
    expect(content).toContain("fly on the 3rd\nhire a car");
    // A file whose last line has no terminator makes `cat` run the next shell prompt
    // onto it.
    expect(content.endsWith("\n")).toBe(true);
  });

  it("falls back to the body's first line when there is no title", () => {
    const file = noteToTextFile({ ...NOTE, title: "" }, "Shopping");
    expect(file.fileName).toBe("scratchpad-shopping-fly-on-the-3rd.txt");
  });

  it("strips characters an OS would reject from a filename", () => {
    // An allowlist rather than a blocklist of Windows' forbidden set: the input is a
    // title someone typed and may contain anything at all. A filename the OS rejects is
    // a silently failed download.
    const file = noteToTextFile({ ...NOTE, title: 'a/b\\c:d*e?f"g<h>i|j' }, "Work");
    expect(file.fileName).toBe("scratchpad-work-a-b-c-d-e-f-g-h-i-j.txt");
    expect(file.fileName).toMatch(/^[a-z0-9.-]+$/);
  });

  it("cannot be talked into a path traversal", () => {
    expect(noteToTextFile({ ...NOTE, title: "../../etc/passwd" }, "Work").fileName).toBe(
      "scratchpad-work-etc-passwd.txt",
    );
    expect(noteToTextFile({ ...NOTE, title: ".." }, "..").fileName).toBe("scratchpad.txt");
  });

  it("survives a title and category with nothing usable in them", () => {
    // Every fragment can collapse to empty — a category named entirely in a script this
    // strips. The worst case is a clean join, never `scratchpad--.txt`.
    //
    // The untitled note still contributes a fragment, because `noteLabel` gives it the
    // "Untitled note" fallback before the filename is built: the label a reader sees in
    // the list and the file they save are deliberately the same string.
    expect(noteToTextFile({ title: "", body: "", updatedAt: "x" }, "日本語").fileName).toBe(
      "scratchpad-untitled-note.txt",
    );
    // A real title in a script the allowlist strips leaves *both* fragments empty, and
    // it degrades to the bare prefix rather than to a name with dangling separators.
    // This is the case the `.filter()` in `noteToTextFile` exists for.
    expect(noteToTextFile({ title: "日本語", body: "", updatedAt: "x" }, "日本語").fileName).toBe(
      "scratchpad.txt",
    );
  });

  it("keeps a long title from overrunning the filesystem's limit", () => {
    const file = noteToTextFile({ ...NOTE, title: "word ".repeat(100) }, "Work");
    expect(file.fileName.length).toBeLessThanOrEqual(90);
    // No trailing hyphen where the slice happened to land on one.
    expect(file.fileName).not.toContain("-.txt");
  });
});

describe("categoryToTextFile", () => {
  const notes = [
    { title: "Milk", body: "semi-skimmed", updatedAt: "2026-09-15T12:00:00Z" },
    { title: "", body: "eggs\nsix of them", updatedAt: "2026-09-15T11:00:00Z" },
  ];

  it("names the file after the category alone", () => {
    expect(categoryToTextFile(notes, "Shopping").fileName).toBe("scratchpad-shopping.txt");
  });

  it("writes every note under a header that counts them", () => {
    const { content } = categoryToTextFile(notes, "Shopping");

    expect(content).toContain("Shopping");
    expect(content).toContain("2 notes");
    expect(content).toContain("semi-skimmed");
    expect(content).toContain("eggs\nsix of them");
    // The untitled note is labelled by its first line, as the window labels it.
    expect(content).toContain("eggs");
  });

  it("keeps the order it was given, which is the order on screen", () => {
    const { content } = categoryToTextFile(notes, "Shopping");
    expect(content.indexOf("semi-skimmed")).toBeLessThan(content.indexOf("six of them"));
  });

  it("pluralises a single note", () => {
    expect(categoryToTextFile([notes[0]!], "Shopping").content).toContain("1 note");
  });

  it("produces a valid file for an empty category", () => {
    // A more useful answer than an error for someone who clicked Save on a tab they had
    // just emptied.
    const { content, fileName } = categoryToTextFile([], "Shopping");
    expect(fileName).toBe("scratchpad-shopping.txt");
    expect(content).toContain("0 notes");
    expect(content.endsWith("\n")).toBe(true);
  });
});
