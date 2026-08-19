import { describe, expect, it } from "vitest";
import { TREE_ICON_NAMES_FOR_TEST } from "./browse-icons.fixture";
import {
  LIBRARY_VIEWS,
  LIBRARY_VIEW_ICONS,
  LIBRARY_VIEW_INFO,
  isLibraryView,
  labelForEmptyGroup,
} from "./browse";

describe("the library view registry", () => {
  it("lists the eight views the Library section offers", () => {
    expect(LIBRARY_VIEWS).toEqual([
      "all-songs",
      "artists",
      "genres",
      "playlists",
      "most-played",
      "years",
      "folders",
      "folder-tree",
    ]);
  });

  it("gives every view a label and a description", () => {
    for (const view of LIBRARY_VIEWS) {
      expect(LIBRARY_VIEW_INFO[view].label).not.toBe("");
      expect(LIBRARY_VIEW_INFO[view].description).not.toBe("");
    }
  });

  it("gives every view an icon", () => {
    for (const view of LIBRARY_VIEWS) {
      expect(LIBRARY_VIEW_ICONS[view]).not.toBe("");
    }
  });

  it("only uses icon names TreeIcon actually knows", () => {
    // TreeIcon renders NOTHING for a name it does not know rather than falling back, so an
    // invented key is a silently blank icon. This is the guard against that.
    for (const view of LIBRARY_VIEWS) {
      expect(TREE_ICON_NAMES_FOR_TEST).toContain(LIBRARY_VIEW_ICONS[view]);
    }
  });

  it("gives each view a distinct icon, so two tabs never look the same", () => {
    const icons = LIBRARY_VIEWS.map((view) => LIBRARY_VIEW_ICONS[view]);
    expect(new Set(icons).size).toBe(icons.length);
  });
});

describe("isLibraryView", () => {
  it("accepts every registered view", () => {
    for (const view of LIBRARY_VIEWS) expect(isLibraryView(view)).toBe(true);
  });

  it("rejects anything else, so a URL cannot name a view that does not exist", () => {
    expect(isLibraryView("all songs")).toBe(false);
    expect(isLibraryView("")).toBe(false);
    expect(isLibraryView("albums")).toBe(false);
    expect(isLibraryView("toString")).toBe(false);
  });
});

describe("labelForEmptyGroup", () => {
  it("names the untagged group per view", () => {
    // An untagged file is common here, so "no genre" is a category a listener clicks --
    // it needs a name, not a blank row.
    expect(labelForEmptyGroup("artists")).toBe("Unknown artist");
    expect(labelForEmptyGroup("genres")).toBe("No genre");
    expect(labelForEmptyGroup("years")).toBe("Year unknown");
  });

  it("falls back to something printable for the other views", () => {
    expect(labelForEmptyGroup("folders")).not.toBe("");
    expect(labelForEmptyGroup("all-songs")).not.toBe("");
  });
});
