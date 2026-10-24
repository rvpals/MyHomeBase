import { beforeEach, describe, expect, it } from "vitest";
import { WrongPasswordError } from "@/lib/shared/encryption";
import type { DecodedImage } from "@/lib/shared/image-upload";
import {
  ClipIsEncryptedError,
  ClipNotFoundError,
  TooManyClipImagesError,
  addClipImage,
  countClipsForTargets,
  createClip,
  decryptClip,
  deleteClip,
  encryptClip,
  getClip,
  linkClip,
  listClips,
  openClip,
  toClipSummary,
  unlinkClip,
  updateClip,
} from "./clips";
import type { ClipEncryptionData, ClipImageProcessor, ClipsRepository, ClipWriteData } from "./ports";
import type { Clip, ClipImage, ClipLink, ClipLinkModule, ClipSummary, ClipTaxonomyItem } from "./types";
import { CLIP_MAX_IMAGES } from "./schema";

/**
 * An in-memory `ClipsRepository`. A hand-written fake rather than a mock, per
 * ARCHITECTURE.md — it is readable, reusable across these tests, and does not
 * couple them to call order.
 */
class FakeClipsRepository implements ClipsRepository {
  clips = new Map<number, Clip>();
  images: ClipImage[] = [];
  links: ClipLink[] = [];
  categories = new Map<string, string>();
  tags = new Map<string, string>();
  private nextId = 1;

  private stamp = "2026-10-23 10:00:00";

  listClips(filter: { categories: string[]; tags: string[]; search: string; targetModule?: ClipLinkModule; targetId?: number }): ClipSummary[] {
    let rows = [...this.clips.values()];

    if (filter.search !== "") {
      const needle = filter.search.toLowerCase();
      rows = rows.filter(
        (c) =>
          c.title.toLowerCase().includes(needle) || c.contentHtml.toLowerCase().includes(needle),
      );
    }
    if (filter.categories.length > 0) {
      rows = rows.filter((c) => filter.categories.every((name) => c.categories.includes(name)));
    }
    if (filter.tags.length > 0) {
      rows = rows.filter((c) => filter.tags.every((name) => c.tags.includes(name)));
    }
    if (filter.targetModule !== undefined && filter.targetId !== undefined) {
      const ids = new Set(
        this.links
          .filter((l) => l.targetModule === filter.targetModule && l.targetId === filter.targetId)
          .map((l) => l.clipId),
      );
      rows = rows.filter((c) => ids.has(c.id));
    }

    return rows.map((c) =>
      toClipSummary(
        c,
        this.images.filter((i) => i.clipId === c.id).length,
        this.links.filter((l) => l.clipId === c.id).length,
      ),
    );
  }

  getClipById(id: number): Clip | undefined {
    return this.clips.get(id);
  }

  createClip(input: ClipWriteData): Clip {
    const clip: Clip = {
      id: this.nextId++,
      title: input.title,
      contentHtml: input.contentHtml,
      isEncrypted: false,
      titleEncrypted: "",
      contentEncrypted: "",
      passwordHint: "",
      categories: input.categories,
      tags: input.tags,
      createdBy: input.createdBy,
      createdAt: this.stamp,
      updatedAt: this.stamp,
    };
    this.clips.set(clip.id, clip);
    return clip;
  }

  updateClip(id: number, input: ClipWriteData): Clip {
    const existing = this.clips.get(id)!;
    const updated: Clip = {
      ...existing,
      title: input.title,
      contentHtml: input.contentHtml,
      categories: input.categories,
      tags: input.tags,
    };
    this.clips.set(id, updated);
    return updated;
  }

  deleteClip(id: number): void {
    this.clips.delete(id);
    this.images = this.images.filter((i) => i.clipId !== id);
    this.links = this.links.filter((l) => l.clipId !== id);
  }

  sealClip(id: number, data: ClipEncryptionData): Clip {
    const existing = this.clips.get(id)!;
    const sealed: Clip = {
      ...existing,
      isEncrypted: true,
      title: "",
      contentHtml: "",
      titleEncrypted: data.titleEncrypted,
      contentEncrypted: data.contentEncrypted,
      passwordHint: data.passwordHint,
    };
    this.clips.set(id, sealed);
    return sealed;
  }

  unsealClip(id: number, title: string, contentHtml: string): Clip {
    const existing = this.clips.get(id)!;
    const open: Clip = {
      ...existing,
      isEncrypted: false,
      title,
      contentHtml,
      titleEncrypted: "",
      contentEncrypted: "",
      passwordHint: "",
    };
    this.clips.set(id, open);
    return open;
  }

  listCategories(): ClipTaxonomyItem[] {
    return [...this.categories.entries()].map(([name, description]) => ({
      name,
      description,
      usageCount: [...this.clips.values()].filter((c) => c.categories.includes(name)).length,
    }));
  }

  listTags(): ClipTaxonomyItem[] {
    return [...this.tags.entries()].map(([name, description]) => ({
      name,
      description,
      usageCount: [...this.clips.values()].filter((c) => c.tags.includes(name)).length,
    }));
  }

  upsertCategory(name: string, description: string): ClipTaxonomyItem {
    if (description !== "" || !this.categories.has(name)) this.categories.set(name, description);
    return { name, description: this.categories.get(name) ?? "", usageCount: 0 };
  }

  upsertTag(name: string, description: string): ClipTaxonomyItem {
    if (description !== "" || !this.tags.has(name)) this.tags.set(name, description);
    return { name, description: this.tags.get(name) ?? "", usageCount: 0 };
  }

  deleteCategory(name: string): void {
    this.categories.delete(name);
  }

  deleteTag(name: string): void {
    this.tags.delete(name);
  }

  getCategoryIcon(): DecodedImage | undefined {
    return undefined;
  }

  getTagIcon(): DecodedImage | undefined {
    return undefined;
  }

  setCategoryIcon(): void {}
  setTagIcon(): void {}

  listClipImages(clipId: number): ClipImage[] {
    return this.images.filter((i) => i.clipId === clipId);
  }

  getClipImage(): DecodedImage | undefined {
    return undefined;
  }

  addClipImage(clipId: number, image: DecodedImage, width: number, height: number): ClipImage {
    const row: ClipImage = {
      id: this.nextId++,
      clipId,
      mimeType: image.mimeType,
      width,
      height,
      byteSize: image.data.length,
      sortOrder: this.images.filter((i) => i.clipId === clipId).length,
    };
    this.images.push(row);
    return row;
  }

  deleteClipImage(id: number): void {
    this.images = this.images.filter((i) => i.id !== id);
  }

  listLinksForClip(clipId: number): ClipLink[] {
    return this.links.filter((l) => l.clipId === clipId);
  }

  listLinksForTarget(targetModule: ClipLinkModule, targetId: number): ClipLink[] {
    return this.links.filter((l) => l.targetModule === targetModule && l.targetId === targetId);
  }

  countLinksForTargets(targetModule: ClipLinkModule, targetIds: number[]): Map<number, number> {
    const map = new Map<number, number>();
    for (const id of targetIds) {
      const count = this.links.filter((l) => l.targetModule === targetModule && l.targetId === id).length;
      if (count > 0) map.set(id, count);
    }
    return map;
  }

  createLink(clipId: number, targetModule: ClipLinkModule, targetId: number): ClipLink {
    const existing = this.links.find(
      (l) => l.clipId === clipId && l.targetModule === targetModule && l.targetId === targetId,
    );
    if (existing) return existing;

    const link: ClipLink = {
      id: this.nextId++,
      clipId,
      targetModule,
      targetId,
      createdAt: this.stamp,
    };
    this.links.push(link);
    return link;
  }

  deleteLink(linkId: number): void {
    this.links = this.links.filter((l) => l.id !== linkId);
  }
}

/** A processor that does no work — these tests are about the use-cases, not sharp. */
const fakeProcessor: ClipImageProcessor = {
  async prepare(image) {
    return { image, width: 100, height: 50 };
  },
};

const PNG = { mimeType: "image/png" as const, base64Data: Buffer.from("x".repeat(64)).toString("base64") };

let repo: FakeClipsRepository;

beforeEach(() => {
  repo = new FakeClipsRepository();
});

describe("createClip", () => {
  it("stores a clip and returns it", () => {
    const { clip } = createClip(repo, { title: "Flight details", contentHtml: "<p>BA117</p>", categories: [], tags: [] });
    expect(clip.id).toBeGreaterThan(0);
    expect(clip.title).toBe("Flight details");
    expect(clip.contentHtml).toBe("<p>BA117</p>");
  });

  it("sanitizes the body before storing it, and reports what went", () => {
    const { clip, removed } = createClip(repo, {
      title: "Pasted",
      contentHtml: '<p onclick="steal()">Hi</p><script>steal()</script>',
      categories: [],
      tags: [],
    });
    expect(clip.contentHtml).toBe("<p>Hi</p>");
    expect(removed.length).toBeGreaterThan(0);
  });

  it("creates categories and tags named inline so the managed lists stay complete", () => {
    createClip(repo, { title: "x", contentHtml: "", categories: ["Travel"], tags: ["flight"] });
    expect(repo.categories.has("Travel")).toBe(true);
    expect(repo.tags.has("flight")).toBe(true);
  });

  it("de-duplicates taxonomy case-insensitively, keeping the first spelling", () => {
    const { clip } = createClip(repo, {
      title: "x",
      contentHtml: "",
      categories: ["Travel", "travel", "TRAVEL"],
      tags: [],
    });
    expect(clip.categories).toEqual(["Travel"]);
  });

  it("drops blank taxonomy names rather than storing empty chips", () => {
    const { clip } = createClip(repo, { title: "x", contentHtml: "", categories: ["  ", "Real"], tags: [] });
    expect(clip.categories).toEqual(["Real"]);
  });

  it("accepts an untitled clip", () => {
    const { clip } = createClip(repo, { title: "", contentHtml: "<p>Just a jotting</p>", categories: [], tags: [] });
    expect(clip.title).toBe("");
  });

  it("rejects a title past the cap", () => {
    expect(() =>
      createClip(repo, { title: "a".repeat(201), contentHtml: "", categories: [], tags: [] }),
    ).toThrow();
  });

  it("records who wrote it when told", () => {
    const { clip } = createClip(repo, { title: "x", contentHtml: "", categories: [], tags: [] }, 7);
    expect(clip.createdBy).toBe(7);
  });
});

describe("updateClip", () => {
  it("replaces the fields and the taxonomy", () => {
    const { clip } = createClip(repo, { title: "Old", contentHtml: "<p>a</p>", categories: ["One"], tags: [] });
    const { clip: updated } = updateClip(repo, {
      id: clip.id,
      title: "New",
      contentHtml: "<p>b</p>",
      categories: ["Two"],
      tags: [],
    });
    expect(updated.title).toBe("New");
    expect(updated.categories).toEqual(["Two"]);
  });

  it("throws for an id that does not exist", () => {
    expect(() =>
      updateClip(repo, { id: 999, title: "x", contentHtml: "", categories: [], tags: [] }),
    ).toThrow(ClipNotFoundError);
  });

  it("refuses to update a sealed clip rather than discarding its body", () => {
    const { clip } = createClip(repo, { title: "Secret", contentHtml: "<p>s</p>", categories: [], tags: [] });
    encryptClip(repo, { id: clip.id, password: "pw", passwordHint: "" });

    expect(() =>
      updateClip(repo, { id: clip.id, title: "x", contentHtml: "", categories: [], tags: [] }),
    ).toThrow(ClipIsEncryptedError);
  });
});

describe("deleteClip", () => {
  it("removes the clip and everything belonging to it", async () => {
    const { clip } = createClip(repo, { title: "x", contentHtml: "", categories: [], tags: [] });
    await addClipImage(repo, fakeProcessor, clip.id, PNG);
    linkClip(repo, { clipId: clip.id, targetModule: "journal", targetId: 1 });

    deleteClip(repo, clip.id);

    expect(repo.clips.size).toBe(0);
    expect(repo.images).toHaveLength(0);
    expect(repo.links).toHaveLength(0);
  });

  it("throws for an id that does not exist", () => {
    expect(() => deleteClip(repo, 999)).toThrow(ClipNotFoundError);
  });
});

describe("encryption", () => {
  it("seals a clip, blanking the plaintext", () => {
    const { clip } = createClip(repo, { title: "Secret", contentHtml: "<p>hidden</p>", categories: [], tags: [] });
    const sealed = encryptClip(repo, { id: clip.id, password: "pw", passwordHint: "the usual" });

    expect(sealed.isEncrypted).toBe(true);
    expect(sealed.title).toBe("");
    expect(sealed.contentHtml).toBe("");
    expect(sealed.titleEncrypted).not.toBe("");
    expect(sealed.passwordHint).toBe("the usual");
  });

  it("keeps the taxonomy readable so a sealed clip is still findable by its tags", () => {
    const { clip } = createClip(repo, {
      title: "Secret",
      contentHtml: "<p>hidden</p>",
      categories: ["Work"],
      tags: ["pay"],
    });
    const sealed = encryptClip(repo, { id: clip.id, password: "pw", passwordHint: "" });

    expect(sealed.categories).toEqual(["Work"]);
    expect(sealed.tags).toEqual(["pay"]);
  });

  it("opens a sealed clip with the right password without changing what is stored", () => {
    const { clip } = createClip(repo, { title: "Secret", contentHtml: "<p>hidden</p>", categories: [], tags: [] });
    encryptClip(repo, { id: clip.id, password: "pw", passwordHint: "" });

    const opened = openClip(repo, { id: clip.id, password: "pw" });
    expect(opened.title).toBe("Secret");
    expect(opened.contentHtml).toBe("<p>hidden</p>");
    expect(repo.getClipById(clip.id)!.isEncrypted).toBe(true);
  });

  it("refuses the wrong password", () => {
    const { clip } = createClip(repo, { title: "Secret", contentHtml: "<p>hidden</p>", categories: [], tags: [] });
    encryptClip(repo, { id: clip.id, password: "pw", passwordHint: "" });

    expect(() => openClip(repo, { id: clip.id, password: "wrong" })).toThrow(WrongPasswordError);
  });

  it("unseals permanently with the right password", () => {
    const { clip } = createClip(repo, { title: "Secret", contentHtml: "<p>hidden</p>", categories: [], tags: [] });
    encryptClip(repo, { id: clip.id, password: "pw", passwordHint: "" });

    const open = decryptClip(repo, { id: clip.id, password: "pw" });
    expect(open.isEncrypted).toBe(false);
    expect(open.title).toBe("Secret");
    expect(open.contentHtml).toBe("<p>hidden</p>");
    expect(open.passwordHint).toBe("");
  });

  it("refuses to seal a clip twice, which would encrypt the blank columns", () => {
    const { clip } = createClip(repo, { title: "Secret", contentHtml: "<p>s</p>", categories: [], tags: [] });
    encryptClip(repo, { id: clip.id, password: "pw", passwordHint: "" });

    expect(() => encryptClip(repo, { id: clip.id, password: "pw2", passwordHint: "" })).toThrow(
      ClipIsEncryptedError,
    );
  });

  it("refuses a hint that contains the password", () => {
    const { clip } = createClip(repo, { title: "x", contentHtml: "", categories: [], tags: [] });
    expect(() =>
      encryptClip(repo, { id: clip.id, password: "hunter2", passwordHint: "it is hunter2" }),
    ).toThrow();
  });

  it("catches a hint containing the password in a different case", () => {
    const { clip } = createClip(repo, { title: "x", contentHtml: "", categories: [], tags: [] });
    expect(() =>
      encryptClip(repo, { id: clip.id, password: "hunter2", passwordHint: "HUNTER2" }),
    ).toThrow();
  });

  it("shows (encrypted) and no excerpt in the list", () => {
    const { clip } = createClip(repo, { title: "Secret", contentHtml: "<p>hidden</p>", categories: [], tags: [] });
    encryptClip(repo, { id: clip.id, password: "pw", passwordHint: "" });

    const [row] = listClips(repo);
    expect(row.title).toBe("(encrypted)");
    expect(row.excerpt).toBe("");
  });

  it("returns the plaintext unchanged when the clip was never sealed", () => {
    const { clip } = createClip(repo, { title: "Open", contentHtml: "<p>x</p>", categories: [], tags: [] });
    expect(openClip(repo, { id: clip.id, password: "anything" }).title).toBe("Open");
  });
});

describe("images", () => {
  it("adds an image and returns its row", async () => {
    const { clip } = createClip(repo, { title: "x", contentHtml: "", categories: [], tags: [] });
    const image = await addClipImage(repo, fakeProcessor, clip.id, PNG);

    expect(image.clipId).toBe(clip.id);
    expect(image.width).toBe(100);
  });

  it("throws for a clip that does not exist", async () => {
    await expect(addClipImage(repo, fakeProcessor, 999, PNG)).rejects.toThrow(ClipNotFoundError);
  });

  it("refuses past the per-clip cap", async () => {
    const { clip } = createClip(repo, { title: "x", contentHtml: "", categories: [], tags: [] });
    for (let i = 0; i < CLIP_MAX_IMAGES; i++) {
      await addClipImage(repo, fakeProcessor, clip.id, PNG);
    }
    await expect(addClipImage(repo, fakeProcessor, clip.id, PNG)).rejects.toThrow(
      TooManyClipImagesError,
    );
  });

  it("refuses a disallowed image type", async () => {
    const { clip } = createClip(repo, { title: "x", contentHtml: "", categories: [], tags: [] });
    await expect(
      addClipImage(repo, fakeProcessor, clip.id, {
        mimeType: "image/svg+xml" as never,
        base64Data: "eA==",
      }),
    ).rejects.toThrow();
  });
});

describe("links", () => {
  it("attaches a clip to a journal entry", () => {
    const { clip } = createClip(repo, { title: "Email", contentHtml: "", categories: [], tags: [] });
    const link = linkClip(repo, { clipId: clip.id, targetModule: "journal", targetId: 42 });

    expect(link.targetModule).toBe("journal");
    expect(link.targetId).toBe(42);
  });

  it("is idempotent, so attaching twice is not an error", () => {
    const { clip } = createClip(repo, { title: "x", contentHtml: "", categories: [], tags: [] });
    linkClip(repo, { clipId: clip.id, targetModule: "journal", targetId: 42 });
    linkClip(repo, { clipId: clip.id, targetModule: "journal", targetId: 42 });

    expect(repo.links).toHaveLength(1);
  });

  it("throws when the clip does not exist", () => {
    expect(() => linkClip(repo, { clipId: 999, targetModule: "journal", targetId: 1 })).toThrow(
      ClipNotFoundError,
    );
  });

  it("rejects a module that cannot carry clips", () => {
    const { clip } = createClip(repo, { title: "x", contentHtml: "", categories: [], tags: [] });
    expect(() =>
      linkClip(repo, { clipId: clip.id, targetModule: "expense" as never, targetId: 1 }),
    ).toThrow();
  });

  it("does NOT delete the clip when its link is removed", () => {
    const { clip } = createClip(repo, { title: "x", contentHtml: "", categories: [], tags: [] });
    const link = linkClip(repo, { clipId: clip.id, targetModule: "journal", targetId: 42 });

    unlinkClip(repo, { linkId: link.id });

    expect(repo.links).toHaveLength(0);
    expect(repo.getClipById(clip.id)).toBeDefined();
  });

  it("counts links for many targets in one call, omitting targets with none", () => {
    const { clip: a } = createClip(repo, { title: "a", contentHtml: "", categories: [], tags: [] });
    const { clip: b } = createClip(repo, { title: "b", contentHtml: "", categories: [], tags: [] });
    linkClip(repo, { clipId: a.id, targetModule: "journal", targetId: 1 });
    linkClip(repo, { clipId: b.id, targetModule: "journal", targetId: 1 });
    linkClip(repo, { clipId: a.id, targetModule: "journal", targetId: 2 });

    const counts = countClipsForTargets(repo, "journal", [1, 2, 3]);
    expect(counts.get(1)).toBe(2);
    expect(counts.get(2)).toBe(1);
    expect(counts.has(3)).toBe(false);
  });

  it("returns an empty map for no targets without querying", () => {
    expect(countClipsForTargets(repo, "journal", []).size).toBe(0);
  });
});

describe("listClips filtering", () => {
  beforeEach(() => {
    createClip(repo, { title: "Flight", contentHtml: "<p>BA117 to JFK</p>", categories: ["Travel"], tags: ["flight"] });
    createClip(repo, { title: "Hotel", contentHtml: "<p>Marriott</p>", categories: ["Travel"], tags: ["stay"] });
    createClip(repo, { title: "Recipe", contentHtml: "<p>Pasta</p>", categories: ["Food"], tags: [] });
  });

  it("returns everything when unfiltered", () => {
    expect(listClips(repo)).toHaveLength(3);
  });

  it("filters by category", () => {
    expect(listClips(repo, { categories: ["Travel"] })).toHaveLength(2);
  });

  it("ANDs several tags rather than ORing them", () => {
    expect(listClips(repo, { tags: ["flight", "stay"] })).toHaveLength(0);
  });

  it("searches the body as well as the title", () => {
    expect(listClips(repo, { search: "JFK" })).toHaveLength(1);
  });

  it("builds an excerpt from the body", () => {
    const [row] = listClips(repo, { search: "Pasta" });
    expect(row.excerpt).toBe("Pasta");
  });
});

describe("getClip", () => {
  it("returns the full record", () => {
    const { clip } = createClip(repo, { title: "x", contentHtml: "<p>body</p>", categories: [], tags: [] });
    expect(getClip(repo, clip.id).contentHtml).toBe("<p>body</p>");
  });

  it("throws for an unknown id", () => {
    expect(() => getClip(repo, 999)).toThrow(ClipNotFoundError);
  });
});
