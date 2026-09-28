import { beforeEach, describe, expect, it } from "vitest";
import type { NavigationTree } from "@/lib/navigation";
import type { UserShortcutsRepository } from "./ports";
import type { Shortcut, ShortcutDraft } from "./types";
import { MAX_SHORTCUTS_PER_USER } from "./types";
import {
  addShortcut,
  canAddShortcut,
  clearShortcutIcon,
  editShortcut,
  moveShortcut,
  removeShortcut,
  reorderShortcuts,
  resolveShortcut,
  resolveShortcuts,
  setShortcutIcon,
} from "./user-shortcuts";

/**
 * An in-memory `UserShortcutsRepository`.
 *
 * Hand-written rather than mocked, per ARCHITECTURE.md. It reproduces the
 * behaviours the real repository is responsible for — `(sortOrder, id)`
 * ordering, append-at-the-end on create, and above all the **per-user scoping**
 * — so a use-case test exercises the same contract the SQL implements. The
 * scoping in particular has to be real here: the security property under test
 * is that another user's id falls out as a miss, and a fake that ignored
 * `userId` would make those tests pass vacuously.
 */
class FakeShortcutsRepository implements UserShortcutsRepository {
  private rows: Shortcut[] = [];
  private nextId = 1;
  /** Stands in for the BLOB column, which `Shortcut` deliberately never carries. */
  private icons = new Map<number, { data: Buffer; mimeType: string }>();

  private own(userId: number): Shortcut[] {
    return this.rows
      .filter((row) => row.userId === userId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }

  list(userId: number): Shortcut[] {
    return this.own(userId);
  }

  findById(userId: number, id: number): Shortcut | undefined {
    return this.rows.find((row) => row.userId === userId && row.id === id);
  }

  count(userId: number): number {
    return this.own(userId).length;
  }

  create(userId: number, draft: ShortcutDraft): Shortcut {
    const existing = this.own(userId);
    const row: Shortcut = {
      id: this.nextId++,
      userId,
      hasIconImage: false,
      ...draft,
      sortOrder: existing.length === 0 ? 0 : existing[existing.length - 1].sortOrder + 1,
      createdAt: "2026-09-27T00:00:00Z",
      updatedAt: "2026-09-27T00:00:00Z",
    };
    this.rows.push(row);
    return row;
  }

  update(userId: number, id: number, draft: ShortcutDraft): Shortcut | undefined {
    const row = this.findById(userId, id);
    if (!row) return undefined;
    Object.assign(row, draft);
    return row;
  }

  delete(userId: number, id: number): boolean {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => !(row.userId === userId && row.id === id));
    return this.rows.length < before;
  }

  reorder(userId: number, ids: readonly number[]): Shortcut[] {
    ids.forEach((id, position) => {
      const row = this.findById(userId, id);
      if (row) row.sortOrder = position;
    });
    return this.own(userId);
  }

  getIcon(userId: number, id: number) {
    // Scoped like the real one — a row that isn't this user's yields nothing,
    // which is the property the serving route's privacy depends on.
    return this.findById(userId, id) ? this.icons.get(id) : undefined;
  }

  setIcon(userId: number, id: number, image: { data: Buffer; mimeType: string }): boolean {
    const row = this.findById(userId, id);
    if (!row) return false;
    this.icons.set(id, image);
    row.hasIconImage = true;
    return true;
  }

  clearIcon(userId: number, id: number): boolean {
    const row = this.findById(userId, id);
    if (!row) return false;
    this.icons.delete(id);
    row.hasIconImage = false;
    return true;
  }
}

/** A two-module tree, one of which has sections. Stands in for `getNavTreeData`'s output. */
const TREE: NavigationTree = {
  home: { id: "home", label: "Home", href: "/" },
  modules: [
    {
      slug: "journal",
      name: "Journal",
      href: "/modules/journal",
      icon: "note",
      sections: [
        { id: "main", label: "Home screen", href: "/modules/journal" },
        { id: "photos", label: "Photos", href: "/modules/journal/photos" },
      ],
    },
    {
      slug: "music",
      name: "Music Library",
      href: "/modules/music",
      icon: "player",
      sections: [{ id: "tracks", label: "Tracks", href: "/modules/music/tracks" }],
    },
  ],
};

const USER = 1;
const OTHER_USER = 2;

const urlDraft = {
  kind: "url" as const,
  name: "Weather",
  icon: "map",
  url: "https://example.com/weather",
};

const sectionDraft = {
  kind: "section" as const,
  name: "Holiday pics",
  icon: "photo",
  moduleSlug: "journal",
  sectionId: "photos",
};

let repo: FakeShortcutsRepository;

beforeEach(() => {
  repo = new FakeShortcutsRepository();
});

describe("addShortcut", () => {
  it("stores a URL shortcut and blanks the section columns", () => {
    const result = addShortcut(repo, USER, urlDraft);

    expect(result.ok).toBe(true);
    expect(result.shortcuts).toHaveLength(1);
    expect(result.shortcuts![0]).toMatchObject({
      kind: "url",
      name: "Weather",
      url: "https://example.com/weather",
      // The unused kind's columns are empty, not undefined — that is what the
      // table stores, and it saves every reader a null check.
      moduleSlug: "",
      sectionId: "",
    });
  });

  it("stores a section shortcut and blanks the url column", () => {
    const result = addShortcut(repo, USER, sectionDraft);

    expect(result.ok).toBe(true);
    expect(result.shortcuts![0]).toMatchObject({
      kind: "section",
      moduleSlug: "journal",
      sectionId: "photos",
      url: "",
    });
  });

  it("accepts a module-root shortcut, which is a section shortcut with no section", () => {
    const result = addShortcut(repo, USER, {
      kind: "section",
      name: "Journal",
      icon: "note",
      moduleSlug: "journal",
    });

    expect(result.ok).toBe(true);
    expect(result.shortcuts![0].sectionId).toBe("");
  });

  it("gives a bare host the https protocol rather than rejecting it", () => {
    const result = addShortcut(repo, USER, { ...urlDraft, url: "example.com" });

    expect(result.ok).toBe(true);
    expect(result.shortcuts![0].url).toBe("https://example.com/");
  });

  it("returns the new row's id, so a picture can be uploaded against it", () => {
    const result = addShortcut(repo, USER, urlDraft);

    expect(result.createdId).toBe(repo.list(USER)[0].id);
  });

  it("appends each new shortcut after the last", () => {
    addShortcut(repo, USER, urlDraft);
    addShortcut(repo, USER, { ...urlDraft, name: "Second" });

    expect(repo.list(USER).map((s) => s.name)).toEqual(["Weather", "Second"]);
  });

  // --- failure paths ---

  it("rejects a blank name", () => {
    const result = addShortcut(repo, USER, { ...urlDraft, name: "   " });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/name/i);
    expect(repo.count(USER)).toBe(0);
  });

  it("rejects a javascript: URL", () => {
    // The stored-self-XSS case the protocol allowlist exists for: this would
    // otherwise run in the reader's own session on every home-screen visit.
    const result = addShortcut(repo, USER, {
      ...urlDraft,
      url: "javascript:alert(document.cookie)",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/http/i);
    expect(repo.count(USER)).toBe(0);
  });

  it("rejects a data: URL", () => {
    const result = addShortcut(repo, USER, {
      ...urlDraft,
      url: "data:text/html;base64,PHNjcmlwdD4=",
    });

    expect(result.ok).toBe(false);
    expect(repo.count(USER)).toBe(0);
  });

  it("rejects a section shortcut with no module", () => {
    const result = addShortcut(repo, USER, { ...sectionDraft, moduleSlug: "" });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/module/i);
  });

  it("refuses to go past the cap, and says so", () => {
    for (let i = 0; i < MAX_SHORTCUTS_PER_USER; i++) {
      expect(addShortcut(repo, USER, { ...urlDraft, name: `Link ${i}` }).ok).toBe(true);
    }

    const result = addShortcut(repo, USER, { ...urlDraft, name: "One too many" });

    expect(result.ok).toBe(false);
    expect(result.error).toContain(String(MAX_SHORTCUTS_PER_USER));
    expect(repo.count(USER)).toBe(MAX_SHORTCUTS_PER_USER);
  });

  it("counts the cap per person, not across the household", () => {
    for (let i = 0; i < MAX_SHORTCUTS_PER_USER; i++) {
      addShortcut(repo, USER, { ...urlDraft, name: `Link ${i}` });
    }

    expect(addShortcut(repo, OTHER_USER, urlDraft).ok).toBe(true);
  });
});

describe("editShortcut", () => {
  it("overwrites the fields, leaving the position alone", () => {
    addShortcut(repo, USER, urlDraft);
    addShortcut(repo, USER, { ...urlDraft, name: "Second" });
    const target = repo.list(USER)[0];

    const result = editShortcut(repo, USER, target.id, { ...urlDraft, name: "Renamed" });

    expect(result.ok).toBe(true);
    expect(repo.list(USER).map((s) => s.name)).toEqual(["Renamed", "Second"]);
  });

  it("blanks the old kind's columns when the kind changes", () => {
    addShortcut(repo, USER, urlDraft);
    const target = repo.list(USER)[0];

    editShortcut(repo, USER, target.id, sectionDraft);

    // The URL must not survive on a row that is now a section shortcut —
    // otherwise the row carries two destinations.
    expect(repo.list(USER)[0]).toMatchObject({ kind: "section", url: "", moduleSlug: "journal" });
  });

  it("reports a miss for an id that doesn't exist", () => {
    const result = editShortcut(repo, USER, 999, urlDraft);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no longer exists/i);
  });

  it("cannot touch another person's shortcut", () => {
    addShortcut(repo, OTHER_USER, urlDraft);
    const theirs = repo.list(OTHER_USER)[0];

    const result = editShortcut(repo, USER, theirs.id, { ...urlDraft, name: "Hijacked" });

    expect(result.ok).toBe(false);
    expect(repo.list(OTHER_USER)[0].name).toBe("Weather");
  });

  it("rejects an invalid edit without changing the stored row", () => {
    addShortcut(repo, USER, urlDraft);
    const target = repo.list(USER)[0];

    const result = editShortcut(repo, USER, target.id, { ...urlDraft, url: "javascript:void 0" });

    expect(result.ok).toBe(false);
    expect(repo.list(USER)[0].url).toBe("https://example.com/weather");
  });
});

describe("removeShortcut", () => {
  it("deletes one", () => {
    addShortcut(repo, USER, urlDraft);
    const target = repo.list(USER)[0];

    expect(removeShortcut(repo, USER, target.id).ok).toBe(true);
    expect(repo.count(USER)).toBe(0);
  });

  it("reports a miss rather than succeeding silently", () => {
    expect(removeShortcut(repo, USER, 999)).toMatchObject({ ok: false });
  });

  it("cannot delete another person's shortcut", () => {
    addShortcut(repo, OTHER_USER, urlDraft);
    const theirs = repo.list(OTHER_USER)[0];

    expect(removeShortcut(repo, USER, theirs.id).ok).toBe(false);
    expect(repo.count(OTHER_USER)).toBe(1);
  });
});

describe("reorderShortcuts", () => {
  it("writes the given order", () => {
    addShortcut(repo, USER, { ...urlDraft, name: "A" });
    addShortcut(repo, USER, { ...urlDraft, name: "B" });
    addShortcut(repo, USER, { ...urlDraft, name: "C" });
    const [a, b, c] = repo.list(USER);

    const result = reorderShortcuts(repo, USER, [c.id, a.id, b.id]);

    expect(result.ok).toBe(true);
    expect(result.shortcuts!.map((s) => s.name)).toEqual(["C", "A", "B"]);
  });

  it("rejects a list naming the same shortcut twice", () => {
    addShortcut(repo, USER, urlDraft);
    const target = repo.list(USER)[0];

    const result = reorderShortcuts(repo, USER, [target.id, target.id]);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/more than once/i);
  });
});

describe("moveShortcut", () => {
  function three(): Shortcut[] {
    addShortcut(repo, USER, { ...urlDraft, name: "A" });
    addShortcut(repo, USER, { ...urlDraft, name: "B" });
    addShortcut(repo, USER, { ...urlDraft, name: "C" });
    return repo.list(USER);
  }

  it("swaps with the neighbour above", () => {
    const [a, b, c] = three();
    expect(moveShortcut([a, b, c], b.id, "up")).toEqual([b.id, a.id, c.id]);
  });

  it("swaps with the neighbour below", () => {
    const [a, b, c] = three();
    expect(moveShortcut([a, b, c], b.id, "down")).toEqual([a.id, c.id, b.id]);
  });

  it("leaves the first unchanged rather than wrapping to the end", () => {
    const [a, b, c] = three();
    expect(moveShortcut([a, b, c], a.id, "up")).toEqual([a.id, b.id, c.id]);
  });

  it("leaves the last unchanged rather than wrapping to the start", () => {
    const [a, b, c] = three();
    expect(moveShortcut([a, b, c], c.id, "down")).toEqual([a.id, b.id, c.id]);
  });

  it("returns the order untouched for an unknown id", () => {
    const [a, b, c] = three();
    expect(moveShortcut([a, b, c], 999, "up")).toEqual([a.id, b.id, c.id]);
  });
});

describe("resolveShortcut", () => {
  function stored(overrides: Partial<Shortcut>): Shortcut {
    return {
      id: 1,
      userId: USER,
      kind: "section",
      name: "Somewhere",
      icon: "photo",
      hasIconImage: false,
      url: "",
      moduleSlug: "journal",
      sectionId: "photos",
      sortOrder: 0,
      createdAt: "2026-09-27T00:00:00Z",
      updatedAt: "2026-09-27T00:00:00Z",
      ...overrides,
    };
  }

  it("resolves a section to its live href", () => {
    expect(resolveShortcut(stored({}), TREE)).toMatchObject({
      href: "/modules/journal/photos",
      reachable: true,
    });
  });

  it("resolves an empty section id to the module root", () => {
    expect(resolveShortcut(stored({ sectionId: "" }), TREE)).toMatchObject({
      href: "/modules/journal",
      reachable: true,
    });
  });

  it("passes a URL shortcut straight through", () => {
    const resolved = resolveShortcut(
      stored({ kind: "url", url: "https://example.com", moduleSlug: "", sectionId: "" }),
      TREE,
    );

    expect(resolved).toMatchObject({ href: "https://example.com", reachable: true });
  });

  it("marks a shortcut unreachable when the reader has lost the module", () => {
    // The tree is already filtered to what this reader may see, so a module
    // absent from it is one they can no longer open. This is the access
    // re-check: it must not be trusted from the stored row.
    const resolved = resolveShortcut(stored({ moduleSlug: "investments" }), TREE);

    expect(resolved.reachable).toBe(false);
    expect(resolved.href).toBe("");
    expect(resolved.unreachableReason).toMatch(/no longer available/i);
  });

  it("marks a shortcut unreachable when the section is gone but the module remains", () => {
    const resolved = resolveShortcut(stored({ sectionId: "retired-section" }), TREE);

    expect(resolved.reachable).toBe(false);
    expect(resolved.unreachableReason).toContain("Journal");
  });

  it("falls back to the default glyph when the stored icon is blank", () => {
    expect(resolveShortcut(stored({ icon: "" }), TREE).icon).toBe("rocket");
  });

  it("carries the stored coordinates through so the edit dialog can reopen on them", () => {
    expect(resolveShortcut(stored({}), TREE).target).toEqual({
      kind: "section",
      url: "",
      moduleSlug: "journal",
      sectionId: "photos",
    });
  });

  it("carries the coordinates even when the target is unreachable", () => {
    // The case that rules out deriving them from `href`: there is no href here.
    const resolved = resolveShortcut(stored({ moduleSlug: "investments" }), TREE);

    expect(resolved.href).toBe("");
    expect(resolved.target.moduleSlug).toBe("investments");
  });

  it("follows a moved route rather than going stale", () => {
    // The point of storing coordinates instead of a path: the same stored row
    // resolves to whatever the tree says today.
    const moved: NavigationTree = {
      ...TREE,
      modules: [
        {
          ...TREE.modules[0],
          sections: [{ id: "photos", label: "Photos", href: "/modules/journal/gallery" }],
        },
      ],
    };

    expect(resolveShortcut(stored({}), moved).href).toBe("/modules/journal/gallery");
  });

  it("preserves order when resolving a list", () => {
    const list = [stored({ id: 1, name: "A" }), stored({ id: 2, name: "B" })];
    expect(resolveShortcuts(list, TREE).map((s) => s.name)).toEqual(["A", "B"]);
  });
});

describe("uploaded icons", () => {
  const png = { data: Buffer.from("not-really-a-png"), mimeType: "image/webp" };

  function oneShortcut(): number {
    addShortcut(repo, USER, urlDraft);
    return repo.list(USER)[0].id;
  }

  it("stores a picture against a shortcut", () => {
    const id = oneShortcut();

    expect(setShortcutIcon(repo, USER, id, png).ok).toBe(true);
    expect(repo.list(USER)[0].hasIconImage).toBe(true);
  });

  it("draws the picture instead of the glyph once one is uploaded", () => {
    const id = oneShortcut();
    setShortcutIcon(repo, USER, id, png);

    const resolved = resolveShortcut(repo.list(USER)[0], TREE);

    expect(resolved.iconImageUrl).toContain(`/api/shortcuts/${id}/icon`);
    // The glyph is still carried — it is what the tile falls back to.
    expect(resolved.icon).toBe("map");
  });

  it("puts a cache-buster on the url so a replaced picture is refetched", () => {
    const id = oneShortcut();
    setShortcutIcon(repo, USER, id, png);

    expect(resolveShortcut(repo.list(USER)[0], TREE).iconImageUrl).toContain("?v=");
  });

  it("offers no picture url when there is no upload", () => {
    oneShortcut();
    expect(resolveShortcut(repo.list(USER)[0], TREE).iconImageUrl).toBeUndefined();
  });

  it("falls back to the glyph when the picture is cleared", () => {
    const id = oneShortcut();
    setShortcutIcon(repo, USER, id, png);

    expect(clearShortcutIcon(repo, USER, id).ok).toBe(true);

    const resolved = resolveShortcut(repo.list(USER)[0], TREE);
    expect(resolved.iconImageUrl).toBeUndefined();
    // Clearing reveals the glyph rather than blanking the tile — the reason
    // `icon` stays populated underneath an upload.
    expect(resolved.icon).toBe("map");
  });

  it("keeps the picture when the shortcut is renamed", () => {
    const id = oneShortcut();
    setShortcutIcon(repo, USER, id, png);

    editShortcut(repo, USER, id, { ...urlDraft, name: "Renamed" });

    expect(repo.list(USER)[0].hasIconImage).toBe(true);
  });

  it("cannot put a picture on another person's shortcut", () => {
    addShortcut(repo, OTHER_USER, urlDraft);
    const theirs = repo.list(OTHER_USER)[0].id;

    expect(setShortcutIcon(repo, USER, theirs, png).ok).toBe(false);
    expect(repo.list(OTHER_USER)[0].hasIconImage).toBe(false);
  });

  it("cannot read another person's picture", () => {
    // The property the serving route's privacy rests on: these images are
    // per-user, so a signed-in reader must not be able to fetch someone
    // else's by id.
    addShortcut(repo, OTHER_USER, urlDraft);
    const theirs = repo.list(OTHER_USER)[0].id;
    setShortcutIcon(repo, OTHER_USER, theirs, png);

    expect(repo.getIcon(OTHER_USER, theirs)).toBeDefined();
    expect(repo.getIcon(USER, theirs)).toBeUndefined();
  });

  it("cannot clear another person's picture", () => {
    addShortcut(repo, OTHER_USER, urlDraft);
    const theirs = repo.list(OTHER_USER)[0].id;
    setShortcutIcon(repo, OTHER_USER, theirs, png);

    expect(clearShortcutIcon(repo, USER, theirs).ok).toBe(false);
    expect(repo.list(OTHER_USER)[0].hasIconImage).toBe(true);
  });

  it("reports a miss for a shortcut that doesn't exist", () => {
    expect(setShortcutIcon(repo, USER, 999, png).ok).toBe(false);
    expect(clearShortcutIcon(repo, USER, 999).ok).toBe(false);
  });
});

describe("canAddShortcut", () => {
  it("allows a list below the cap and refuses one at it", () => {
    expect(canAddShortcut(0)).toBe(true);
    expect(canAddShortcut(MAX_SHORTCUTS_PER_USER - 1)).toBe(true);
    expect(canAddShortcut(MAX_SHORTCUTS_PER_USER)).toBe(false);
  });
});
