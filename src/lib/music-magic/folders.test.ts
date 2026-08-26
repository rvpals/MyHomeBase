import { describe, expect, it } from "vitest";
import {
  folderLabel,
  folderLikePattern,
  folderParent,
  isFolderWithin,
  pruneRedundantFolders,
} from "./folders";

// Pure functions, so tested directly with plain inputs -- no fake, no database. The SQL
// that consumes `folderLikePattern` is the repository's business and is not re-tested here.

describe("folderLikePattern", () => {
  it("matches a folder's whole subtree", () => {
    expect(folderLikePattern("Rock/Queen")).toBe("Rock/Queen/%");
  });

  it("treats the empty path as the whole catalog", () => {
    // The root's subtree IS everything -- a criterion that matches nothing would be worse.
    expect(folderLikePattern("")).toBe("%");
  });

  it("tolerates a trailing slash from SQL's folder expression", () => {
    expect(folderLikePattern("Rock/Queen/")).toBe("Rock/Queen/%");
  });
});

describe("folderLabel", () => {
  it("shows the last segment, not the whole path", () => {
    expect(folderLabel("Music/Rock/Queen")).toBe("Queen");
  });

  it("labels a top-level folder with its own name", () => {
    expect(folderLabel("Rock")).toBe("Rock");
  });

  it("names the root rather than returning a blank label", () => {
    expect(folderLabel("")).toBe("(library root)");
  });
});

describe("folderParent", () => {
  it("drops the last segment", () => {
    expect(folderParent("Music/Rock/Queen")).toBe("Music/Rock");
  });

  it("reports the root for a top-level folder", () => {
    expect(folderParent("Rock")).toBe("");
  });
});

describe("isFolderWithin", () => {
  it("counts a folder as within itself", () => {
    expect(isFolderWithin("Rock", "Rock")).toBe(true);
  });

  it("counts a descendant as within its ancestor", () => {
    expect(isFolderWithin("Rock/Queen/Live", "Rock")).toBe(true);
  });

  it("rejects a sibling", () => {
    expect(isFolderWithin("Pop", "Rock")).toBe(false);
  });

  it("does not treat a shared name PREFIX as containment", () => {
    // `Rockabilly` starts with `Rock` as a string but is not inside it -- the slash is
    // what makes it a path rather than a substring.
    expect(isFolderWithin("Rockabilly", "Rock")).toBe(false);
  });

  it("puts everything within the root", () => {
    expect(isFolderWithin("Rock/Queen", "")).toBe(true);
  });
});

describe("pruneRedundantFolders", () => {
  it("drops a child when its parent is also picked", () => {
    expect(pruneRedundantFolders(["Rock", "Rock/Queen"])).toEqual(["Rock"]);
  });

  it("keeps siblings, which select different tracks", () => {
    expect(pruneRedundantFolders(["Rock/Queen", "Rock/Wings"])).toEqual([
      "Rock/Queen",
      "Rock/Wings",
    ]);
  });

  it("preserves input order so the chip list does not reshuffle", () => {
    expect(pruneRedundantFolders(["Pop", "Jazz", "Rock"])).toEqual(["Pop", "Jazz", "Rock"]);
  });

  it("removes an exact duplicate", () => {
    // Guards the "within itself" trap: a naive filter would drop BOTH copies.
    expect(pruneRedundantFolders(["Rock", "Rock"])).toEqual(["Rock"]);
  });

  it("drops the root, which restricts nothing", () => {
    expect(pruneRedundantFolders(["", "Rock"])).toEqual(["Rock"]);
  });

  it("collapses a whole chain to its topmost folder", () => {
    expect(pruneRedundantFolders(["Rock/Queen/Live", "Rock", "Rock/Queen"])).toEqual(["Rock"]);
  });

  it("returns nothing for nothing", () => {
    expect(pruneRedundantFolders([])).toEqual([]);
  });
});
