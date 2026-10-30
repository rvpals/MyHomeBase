import { describe, expect, it } from "vitest";
import {
  addAttachment,
  createDocument,
  type DocumentFiles,
  type DocumentLimitsInput,
} from "./documents";
import {
  countRecycledDocuments,
  deleteRecycledDocumentsForever,
  emptyDocumentsRecycleBin,
  listRecycledDocuments,
  recycleDocuments,
  restoreRecycledDocuments,
} from "./recycle";
import { FakeFileStore, FakeRepository } from "./test-fakes";

const LIMITS: DocumentLimitsInput = { maxFileBytes: 1024, maxFilesPerDocument: 5 };

function setup() {
  const repo = new FakeRepository();
  const store = new FakeFileStore();
  const files: DocumentFiles = { store, root: "/share/documents" };
  const make = (title: string, categories: string[] = [], tags: string[] = []) =>
    createDocument(repo, { title, description: "", categories, tags }, 1);
  return { repo, store, files, make };
}

describe("recycleDocuments", () => {
  it("moves a document out of the live list and into the bin", async () => {
    const { repo, files, make } = setup();
    const document = make("Lease 2026");

    const result = await recycleDocuments(repo, files, [document.id]);

    expect(result.movedCount).toBe(1);
    expect(repo.getDocumentById(document.id)).toBeUndefined();
    expect(countRecycledDocuments(repo)).toBe(1);
  });

  it("keeps the title, filing and attachment count in the bin", async () => {
    const { repo, files, make } = setup();
    const document = make("Lease 2026", ["Property"], ["house"]);
    await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "lease.pdf",
      data: Buffer.from("bytes"),
    });

    await recycleDocuments(repo, files, [document.id]);
    const [binned] = listRecycledDocuments(repo);

    // The index is the thing this bin exists to preserve: the files already survived
    // a delete before migration 0163, as an unidentifiable folder.
    expect(binned.title).toBe("Lease 2026");
    expect(binned.categories).toEqual(["Property"]);
    expect(binned.tags).toEqual(["house"]);
    expect(binned.attachmentCount).toBe(1);
    expect(binned.totalBytes).toBe(5);
  });

  it("records where the files were moved to", async () => {
    const { repo, files, make } = setup();
    const document = make("Lease");
    await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "a.pdf",
      data: Buffer.from("x"),
    });

    await recycleDocuments(repo, files, [document.id]);
    const [binned] = listRecycledDocuments(repo);

    // Stored rather than derived: the real store stamps the destination with a
    // timestamp recorded nowhere else, so with two deletes of the same document in
    // the bin, guessing which folder belongs to which row would be a coin flip.
    expect(binned.deletedFolder).toContain(`doc_${document.id}_`);
    expect(binned.deletedFolder.startsWith("_deleted/")).toBe(true);
  });

  it("bins a document with no files, recording no folder", async () => {
    const { repo, files, make } = setup();
    const document = make("Note only");

    await recycleDocuments(repo, files, [document.id]);

    // An index worth keeping even when there are no bytes behind it.
    expect(listRecycledDocuments(repo)[0].deletedFolder).toBe("");
  });

  it("skips an id that no longer exists", async () => {
    const { repo, files, make } = setup();
    const document = make("Lease");

    const result = await recycleDocuments(repo, files, [document.id, 9999]);

    expect(result.movedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
  });

  it("refuses an empty selection", async () => {
    const { repo, files } = setup();
    await expect(recycleDocuments(repo, files, [])).rejects.toThrow(/at least one/i);
  });

  it("refuses when no document folder is configured", async () => {
    const { repo, store, make } = setup();
    const document = make("Lease");

    await expect(
      recycleDocuments(repo, { store, root: "" }, [document.id]),
    ).rejects.toThrow(/No document folder/i);
  });

  it("lists the bin newest deleted first", async () => {
    const { repo, files, make } = setup();
    const first = make("First");
    const second = make("Second");

    await recycleDocuments(repo, files, [first.id]);
    await recycleDocuments(repo, files, [second.id]);

    expect(listRecycledDocuments(repo).map((row) => row.title)).toEqual(["Second", "First"]);
  });
});

describe("restoreRecycledDocuments — original id still free", () => {
  it("puts the document back at the id it had", async () => {
    const { repo, files, make } = setup();
    const document = make("Lease 2026", ["Property"], ["house"]);
    await recycleDocuments(repo, files, [document.id]);
    const [binned] = listRecycledDocuments(repo);

    const result = await restoreRecycledDocuments(repo, files, [binned.recycledId]);

    expect(result.restoredCount).toBe(1);
    expect(result.renumbered).toEqual([]);
    const restored = repo.getDocumentById(document.id);
    expect(restored?.title).toBe("Lease 2026");
    expect(restored?.categories).toEqual(["Property"]);
    expect(restored?.tags).toEqual(["house"]);
  });

  it("leaves attachment paths untouched and moves the files back", async () => {
    const { repo, store, files, make } = setup();
    const document = make("Lease");
    await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "lease.pdf",
      data: Buffer.from("bytes"),
    });
    const livePath = repo.listAttachments(document.id)[0].relativePath;

    await recycleDocuments(repo, files, [document.id]);
    const [binned] = listRecycledDocuments(repo);
    await restoreRecycledDocuments(repo, files, [binned.recycledId]);

    expect(repo.listAttachments(document.id)[0].relativePath).toBe(livePath);
    expect(store.files.has(livePath)).toBe(true);
  });

  it("empties the bin row, so a second restore cannot duplicate the document", async () => {
    const { repo, files, make } = setup();
    const document = make("Lease");
    await recycleDocuments(repo, files, [document.id]);
    const [binned] = listRecycledDocuments(repo);

    await restoreRecycledDocuments(repo, files, [binned.recycledId]);
    const second = await restoreRecycledDocuments(repo, files, [binned.recycledId]);

    expect(second.restoredCount).toBe(0);
    expect(countRecycledDocuments(repo)).toBe(0);
    expect(repo.listDocuments()).toHaveLength(1);
  });
});

describe("restoreRecycledDocuments — original id taken", () => {
  it("restores under a new id and rewrites every attachment path", async () => {
    const { repo, store, files, make } = setup();
    const original = make("Lease 2026");
    await addAttachment(repo, files, LIMITS, {
      documentId: original.id,
      fileName: "lease.pdf",
      data: Buffer.from("bytes"),
    });

    await recycleDocuments(repo, files, [original.id]);
    const [binned] = listRecycledDocuments(repo);

    // Something else takes the id while the document sits in the bin. Without the
    // rewrite below, the restored document's rows would still read `doc_1/...`,
    // pointing at THIS document's folder — downloads would serve the wrong files.
    const squatter = repo.createDocument({
      title: "Something else",
      description: "",
      categories: [],
      tags: [],
      createdBy: 1,
    });
    repo.documents[repo.documents.length - 1] = { ...squatter, id: original.id };

    const result = await restoreRecycledDocuments(repo, files, [binned.recycledId]);

    expect(result.restoredCount).toBe(1);
    expect(result.renumbered).toHaveLength(1);
    const landedId = result.renumbered[0].toId;
    expect(landedId).not.toBe(original.id);

    const restoredPath = repo.listAttachments(landedId)[0].relativePath;
    expect(restoredPath).toBe(`doc_${landedId}/lease.pdf`);
    expect(store.files.has(restoredPath)).toBe(true);
  });

  it("reports the renumbering so the reader is told, not left to discover it", async () => {
    const { repo, files, make } = setup();
    const original = make("Lease 2026");
    await recycleDocuments(repo, files, [original.id]);
    const [binned] = listRecycledDocuments(repo);

    const squatter = repo.createDocument({
      title: "Other",
      description: "",
      categories: [],
      tags: [],
      createdBy: 1,
    });
    repo.documents[repo.documents.length - 1] = { ...squatter, id: original.id };

    const result = await restoreRecycledDocuments(repo, files, [binned.recycledId]);

    expect(result.renumbered[0].title).toBe("Lease 2026");
    expect(result.renumbered[0].fromId).toBe(original.id);
  });
});

describe("restoreRecycledDocuments — edges", () => {
  it("skips a bin row that is already gone", async () => {
    const { repo, files } = setup();
    const result = await restoreRecycledDocuments(repo, files, [9999]);

    expect(result.restoredCount).toBe(0);
    expect(result.skippedCount).toBe(1);
  });

  it("refuses an empty selection", async () => {
    const { repo, files } = setup();
    await expect(restoreRecycledDocuments(repo, files, [])).rejects.toThrow(/at least one/i);
  });

  it("still restores the index when the files are gone from the share", async () => {
    const { repo, store, files, make } = setup();
    const document = make("Lease");
    await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "a.pdf",
      data: Buffer.from("x"),
    });
    await recycleDocuments(repo, files, [document.id]);
    const [binned] = listRecycledDocuments(repo);
    store.files.clear();

    const result = await restoreRecycledDocuments(repo, files, [binned.recycledId]);

    // The honest outcome: the document comes back, its rows point at files that are
    // not there, and reading one answers 404 the way any missing file does.
    expect(result.restoredCount).toBe(1);
    expect(repo.listAttachments(document.id)).toHaveLength(1);
  });
});

describe("deleteRecycledDocumentsForever", () => {
  it("removes the row from the bin", async () => {
    const { repo, files, make } = setup();
    const document = make("Lease");
    await recycleDocuments(repo, files, [document.id]);
    const [binned] = listRecycledDocuments(repo);

    const result = deleteRecycledDocumentsForever(repo, [binned.recycledId]);

    expect(result.deletedCount).toBe(1);
    expect(countRecycledDocuments(repo)).toBe(0);
  });

  it("leaves the files on the share", async () => {
    const { repo, store, files, make } = setup();
    const document = make("Lease");
    await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "a.pdf",
      data: Buffer.from("x"),
    });
    await recycleDocuments(repo, files, [document.id]);
    const [binned] = listRecycledDocuments(repo);

    deleteRecycledDocumentsForever(repo, [binned.recycledId]);

    // Nothing in this module unlinks a user's file. A purge drops the INDEX; the
    // bytes stay under `_deleted/`, where clearing them is a deliberate act on the NAS.
    expect([...store.files.keys()].some((key) => key.startsWith("_deleted/"))).toBe(true);
  });

  it("skips a row that is already gone", async () => {
    const { repo } = setup();
    const result = deleteRecycledDocumentsForever(repo, [9999]);

    expect(result.deletedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
  });

  it("refuses an empty selection", () => {
    const { repo } = setup();
    expect(() => deleteRecycledDocumentsForever(repo, [])).toThrow(/at least one/i);
  });
});

describe("emptyDocumentsRecycleBin", () => {
  it("clears every row and reports the count", async () => {
    const { repo, files, make } = setup();
    await recycleDocuments(repo, files, [make("One").id]);
    await recycleDocuments(repo, files, [make("Two").id]);

    expect(emptyDocumentsRecycleBin(repo).deletedCount).toBe(2);
    expect(countRecycledDocuments(repo)).toBe(0);
  });

  it("reports 0 on an already empty bin rather than refusing", () => {
    const { repo } = setup();

    // No id list, so no minimum: unlike a selection-based call, an empty bin is not a
    // UI that lost the reader's ticks.
    expect(emptyDocumentsRecycleBin(repo).deletedCount).toBe(0);
  });
});
