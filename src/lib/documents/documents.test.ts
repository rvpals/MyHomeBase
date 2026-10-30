import { describe, expect, it } from "vitest";
import {
  addAttachment,
  buildDocumentArchive,
  clearCategoryIcon,
  createDocument,
  deleteDocument,
  getDocument,
  listAttachmentsFor,
  listDocuments,
  readAttachment,
  removeAttachment,
  saveCategory,
  saveTag,
  setCategoryIcon,
  setTagIcon,
  updateDocument,
  MAX_DOCUMENT_ICON_BYTES,
  type DocumentFiles,
  type DocumentLimitsInput,
} from "./documents";
import { FakeFileStore, FakeRepository } from "./test-fakes";


const LIMITS: DocumentLimitsInput = { maxFileBytes: 1024, maxFilesPerDocument: 3 };

function setup() {
  const repo = new FakeRepository();
  const store = new FakeFileStore();
  const files: DocumentFiles = { store, root: "/share/documents" };
  return { repo, store, files };
}

describe("createDocument", () => {
  it("files a document and creates its taxonomy inline", () => {
    const { repo } = setup();
    const document = createDocument(
      repo,
      { title: "Lease", description: "The flat", categories: ["Housing"], tags: ["2026"] },
      7,
    );

    expect(document.title).toBe("Lease");
    expect(document.createdBy).toBe(7);
    // The chip picker's names became real taxonomy rows.
    expect(repo.categories.has("Housing")).toBe(true);
    expect(repo.tags.has("2026")).toBe(true);
  });

  it("de-duplicates taxonomy case-insensitively, keeping the first spelling", () => {
    const { repo } = setup();
    const document = createDocument(
      repo,
      { title: "A", description: "", categories: ["Tax", "tax", "TAX"], tags: [] },
      null,
    );
    expect(document.categories).toEqual(["Tax"]);
  });

  it("drops blank chips rather than refusing the whole save", () => {
    const { repo } = setup();
    const document = createDocument(
      repo,
      { title: "A", description: "", categories: ["Tax", "  ", ""], tags: [] },
      null,
    );
    expect(document.categories).toEqual(["Tax"]);
  });

  it("refuses a document with no title", () => {
    const { repo } = setup();
    expect(() =>
      createDocument(repo, { title: "   ", description: "", categories: [], tags: [] }, null),
    ).toThrow(/title/i);
  });
});

describe("updateDocument", () => {
  it("replaces the fields and keeps the original filer", () => {
    const { repo } = setup();
    const created = createDocument(
      repo,
      { title: "Lease", description: "", categories: ["Housing"], tags: [] },
      7,
    );

    const updated = updateDocument(repo, {
      id: created.id,
      title: "Lease 2026",
      description: "Renewed",
      categories: [],
      tags: ["signed"],
    });

    expect(updated.title).toBe("Lease 2026");
    expect(updated.categories).toEqual([]);
    expect(updated.tags).toEqual(["signed"]);
    // Attribution records who filed it, not who touched it last.
    expect(updated.createdBy).toBe(7);
  });

  it("refuses to update a document that is gone", () => {
    const { repo } = setup();
    expect(() =>
      updateDocument(repo, { id: 404, title: "x", description: "", categories: [], tags: [] }),
    ).toThrow(/no longer exists/i);
  });
});

describe("addAttachment", () => {
  it("stores the bytes and indexes them", async () => {
    const { repo, store, files } = setup();
    const document = createDocument(
      repo,
      { title: "Lease", description: "", categories: [], tags: [] },
      null,
    );

    const { attachment } = await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "Lease 2026.pdf",
      data: Buffer.from("pdf-bytes"),
    });

    expect(attachment.relativePath).toBe(`doc_${document.id}/Lease-2026.pdf`);
    expect(attachment.originalName).toBe("Lease 2026.pdf");
    expect(attachment.mimeType).toBe("application/pdf");
    expect(store.files.has(attachment.relativePath)).toBe(true);
  });

  it("suffixes a second file of the same name rather than overwriting it", async () => {
    const { repo, files, store } = setup();
    const document = createDocument(
      repo,
      { title: "Scans", description: "", categories: [], tags: [] },
      null,
    );

    const { attachment: first } = await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "Scan.pdf",
      data: Buffer.from("one"),
    });
    const { attachment: second } = await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "Scan.pdf",
      data: Buffer.from("two"),
    });

    expect(first.relativePath).toBe(`doc_${document.id}/Scan.pdf`);
    expect(second.relativePath).toBe(`doc_${document.id}/Scan-2.pdf`);
    expect(store.files.size).toBe(2);
  });

  it("derives the mime type from the extension, not from what was claimed", async () => {
    const { repo, files } = setup();
    const document = createDocument(
      repo,
      { title: "A", description: "", categories: [], tags: [] },
      null,
    );
    const { attachment } = await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "page.html",
      data: Buffer.from("<script>"),
    });
    // Not text/html: an unknown-or-risky type downloads rather than renders.
    expect(attachment.mimeType).toBe("application/octet-stream");
  });

  it("refuses a file over the configured size limit", async () => {
    const { repo, files } = setup();
    const document = createDocument(
      repo,
      { title: "A", description: "", categories: [], tags: [] },
      null,
    );
    await expect(
      addAttachment(repo, files, LIMITS, {
        documentId: document.id,
        fileName: "big.pdf",
        data: Buffer.alloc(LIMITS.maxFileBytes + 1),
      }),
    ).rejects.toThrow(/larger than/i);
  });

  it("refuses more files than the configured count", async () => {
    const { repo, files } = setup();
    const document = createDocument(
      repo,
      { title: "A", description: "", categories: [], tags: [] },
      null,
    );
    for (let n = 0; n < LIMITS.maxFilesPerDocument; n += 1) {
      await addAttachment(repo, files, LIMITS, {
        documentId: document.id,
        fileName: `f${n}.pdf`,
        data: Buffer.from("x"),
      });
    }
    await expect(
      addAttachment(repo, files, LIMITS, {
        documentId: document.id,
        fileName: "one-too-many.pdf",
        data: Buffer.from("x"),
      }),
    ).rejects.toThrow(/at most 3 files/i);
  });

  it("refuses an empty file", async () => {
    const { repo, files } = setup();
    const document = createDocument(
      repo,
      { title: "A", description: "", categories: [], tags: [] },
      null,
    );
    await expect(
      addAttachment(repo, files, LIMITS, {
        documentId: document.id,
        fileName: "empty.pdf",
        data: Buffer.alloc(0),
      }),
    ).rejects.toThrow(/empty/i);
  });

  it("refuses when no folder is configured", async () => {
    const { repo, store } = setup();
    const document = createDocument(
      repo,
      { title: "A", description: "", categories: [], tags: [] },
      null,
    );
    await expect(
      addAttachment(repo, { store, root: "" }, LIMITS, {
        documentId: document.id,
        fileName: "a.pdf",
        data: Buffer.from("x"),
      }),
    ).rejects.toThrow(/no document folder is set/i);
  });

  it("refuses an attachment on a document that is gone", async () => {
    const { repo, files } = setup();
    await expect(
      addAttachment(repo, files, LIMITS, {
        documentId: 404,
        fileName: "a.pdf",
        data: Buffer.from("x"),
      }),
    ).rejects.toThrow(/no longer exists/i);
  });
});

describe("readAttachment", () => {
  it("returns the bytes", async () => {
    const { repo, files } = setup();
    const document = createDocument(
      repo,
      { title: "A", description: "", categories: [], tags: [] },
      null,
    );
    const { attachment } = await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "a.pdf",
      data: Buffer.from("hello"),
    });

    const result = await readAttachment(repo, files, attachment.id);
    expect(result?.data.toString()).toBe("hello");
  });

  it("is undefined when the file was removed from the share by hand", async () => {
    const { repo, store, files } = setup();
    const document = createDocument(
      repo,
      { title: "A", description: "", categories: [], tags: [] },
      null,
    );
    const { attachment } = await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "a.pdf",
      data: Buffer.from("hello"),
    });
    store.files.clear();

    // A normal state, not an error: the row survives, the route answers 404.
    expect(await readAttachment(repo, files, attachment.id)).toBeUndefined();
  });
});

describe("deleteDocument", () => {
  it("keeps the files when not asked to delete them", async () => {
    const { repo, store, files } = setup();
    const document = createDocument(
      repo,
      { title: "A", description: "", categories: [], tags: [] },
      null,
    );
    await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "a.pdf",
      data: Buffer.from("x"),
    });

    await deleteDocument(repo, files, { id: document.id, deleteFiles: false });

    expect(repo.getDocumentById(document.id)).toBeUndefined();
    expect(store.files.size).toBe(1);
    expect(store.moved).toEqual([]);
  });

  it("moves the files aside rather than unlinking them when asked", async () => {
    const { repo, store, files } = setup();
    const document = createDocument(
      repo,
      { title: "A", description: "", categories: [], tags: [] },
      null,
    );
    await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "a.pdf",
      data: Buffer.from("x"),
    });

    await deleteDocument(repo, files, { id: document.id, deleteFiles: true });

    expect(repo.getDocumentById(document.id)).toBeUndefined();
    expect(store.moved).toEqual([`doc_${document.id}/a.pdf`]);
  });

  it("defaults to keeping the files when the flag is absent", async () => {
    const { repo, store, files } = setup();
    const document = createDocument(
      repo,
      { title: "A", description: "", categories: [], tags: [] },
      null,
    );
    await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "a.pdf",
      data: Buffer.from("x"),
    });

    // The destructive reading is never the default one.
    await deleteDocument(repo, files, { id: document.id } as never);
    expect(store.moved).toEqual([]);
  });

  it("deletes a document that has no files at all", async () => {
    const { repo, files } = setup();
    const document = createDocument(
      repo,
      { title: "A", description: "", categories: [], tags: [] },
      null,
    );
    await deleteDocument(repo, files, { id: document.id, deleteFiles: true });
    expect(repo.getDocumentById(document.id)).toBeUndefined();
  });

  it("refuses to delete a document that is gone", async () => {
    const { repo, files } = setup();
    await expect(deleteDocument(repo, files, { id: 404, deleteFiles: false })).rejects.toThrow(
      /no longer exists/i,
    );
  });
});

describe("removeAttachment", () => {
  it("removes the row and keeps the file by default", async () => {
    const { repo, store, files } = setup();
    const document = createDocument(
      repo,
      { title: "A", description: "", categories: [], tags: [] },
      null,
    );
    const { attachment } = await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "a.pdf",
      data: Buffer.from("x"),
    });

    await removeAttachment(repo, files, { attachmentId: attachment.id, deleteFile: false });

    expect(repo.listAttachments(document.id)).toEqual([]);
    expect(store.files.size).toBe(1);
  });

  it("moves the file aside when asked", async () => {
    const { repo, store, files } = setup();
    const document = createDocument(
      repo,
      { title: "A", description: "", categories: [], tags: [] },
      null,
    );
    const { attachment } = await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "a.pdf",
      data: Buffer.from("x"),
    });

    await removeAttachment(repo, files, { attachmentId: attachment.id, deleteFile: true });

    expect(store.moved).toEqual([`doc_${document.id}/a.pdf`]);
  });

  it("refuses an attachment that is gone", async () => {
    const { repo, files } = setup();
    await expect(
      removeAttachment(repo, files, { attachmentId: 404, deleteFile: false }),
    ).rejects.toThrow(/no longer exists/i);
  });
});

describe("buildDocumentArchive", () => {
  it("zips every attachment", async () => {
    const { repo, files } = setup();
    const document = createDocument(
      repo,
      { title: "Lease", description: "", categories: [], tags: [] },
      null,
    );
    await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "a.pdf",
      data: Buffer.from("one"),
    });
    await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "b.pdf",
      data: Buffer.from("two"),
    });

    const archive = await buildDocumentArchive(repo, files, document.id);

    expect(archive?.fileName).toBe("Lease.zip");
    expect(archive?.missing).toEqual([]);
    // A real zip: the local file header magic.
    expect(Buffer.from(archive!.data.slice(0, 4))).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  it("skips a file missing from the share and reports it", async () => {
    const { repo, store, files } = setup();
    const document = createDocument(
      repo,
      { title: "Lease", description: "", categories: [], tags: [] },
      null,
    );
    await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "there.pdf",
      data: Buffer.from("one"),
    });
    const { attachment: gone } = await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "gone.pdf",
      data: Buffer.from("two"),
    });
    store.files.delete(gone.relativePath);

    const archive = await buildDocumentArchive(repo, files, document.id);

    // What is there still downloads; the loss is named rather than fatal.
    expect(archive?.missing).toEqual(["gone.pdf"]);
  });

  it("does not fail when two files share an original name", async () => {
    const { repo, files } = setup();
    const document = createDocument(
      repo,
      { title: "Scans", description: "", categories: [], tags: [] },
      null,
    );
    await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "Scan.pdf",
      data: Buffer.from("one"),
    });
    await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "Scan.pdf",
      data: Buffer.from("two"),
    });

    // buildZip refuses duplicate entry names, so the archive re-applies the suffix.
    const archive = await buildDocumentArchive(repo, files, document.id);
    expect(archive).toBeDefined();
    expect(archive?.missing).toEqual([]);
  });

  it("is undefined for a document with no attachments", async () => {
    const { repo, files } = setup();
    const document = createDocument(
      repo,
      { title: "A", description: "", categories: [], tags: [] },
      null,
    );
    expect(await buildDocumentArchive(repo, files, document.id)).toBeUndefined();
  });

  it("is undefined for a document that does not exist", async () => {
    const { repo, files } = setup();
    expect(await buildDocumentArchive(repo, files, 404)).toBeUndefined();
  });
});

describe("listDocuments / getDocument", () => {
  it("reports the attachment count and total size on a summary", async () => {
    const { repo, files } = setup();
    const document = createDocument(
      repo,
      { title: "A", description: "", categories: [], tags: [] },
      null,
    );
    await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "a.pdf",
      data: Buffer.from("12345"),
    });

    const [summary] = listDocuments(repo);
    expect(summary.attachmentCount).toBe(1);
    expect(summary.totalBytes).toBe(5);
  });

  it("returns the full record with its attachments", async () => {
    const { repo, files } = setup();
    const document = createDocument(
      repo,
      { title: "A", description: "", categories: [], tags: [] },
      null,
    );
    await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "a.pdf",
      data: Buffer.from("x"),
    });

    const result = getDocument(repo, document.id);
    expect(result?.document.title).toBe("A");
    expect(result?.attachments).toHaveLength(1);
  });

  it("is undefined for a document that does not exist", () => {
    const { repo } = setup();
    expect(getDocument(repo, 404)).toBeUndefined();
  });
});

// A 1x1 transparent PNG. A real decodable image rather than arbitrary bytes, because
// `decodeImageUpload` validates the declared mime type against its allowlist and the
// decoded length against the cap — both of which a made-up string would pass or fail
// for the wrong reason.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("taxonomy icons", () => {
  it("stores and reads back a category icon", () => {
    const { repo } = setup();
    saveCategory(repo, { name: "Insurance" });

    setCategoryIcon(repo, "Insurance", { mimeType: "image/png", base64Data: PNG_BASE64 });

    const icon = repo.getCategoryIcon("Insurance");
    expect(icon?.mimeType).toBe("image/png");
    expect(icon?.data.byteLength).toBeGreaterThan(0);
  });

  it("stores a tag icon independently of the category of the same name", () => {
    const { repo } = setup();
    saveCategory(repo, { name: "Car" });
    saveTag(repo, { name: "Car" });

    setTagIcon(repo, "Car", { mimeType: "image/png", base64Data: PNG_BASE64 });

    // The two lists are separate: an icon on the tag must not appear on the category.
    expect(repo.getTagIcon("Car")).toBeDefined();
    expect(repo.getCategoryIcon("Car")).toBeUndefined();
  });

  it("matches the name case-insensitively, as the tables do", () => {
    const { repo } = setup();
    saveCategory(repo, { name: "Insurance" });
    // The table is COLLATE NOCASE, so a case-sensitive existence check here would
    // reject a name the database would have matched.
    expect(() =>
      setCategoryIcon(repo, "insurance", { mimeType: "image/png", base64Data: PNG_BASE64 }),
    ).not.toThrow();
  });

  it("clears an icon without deleting the category", () => {
    const { repo } = setup();
    saveCategory(repo, { name: "Insurance" });
    setCategoryIcon(repo, "Insurance", { mimeType: "image/png", base64Data: PNG_BASE64 });

    clearCategoryIcon(repo, "Insurance");

    expect(repo.getCategoryIcon("Insurance")).toBeUndefined();
    expect(repo.listCategories().some((item) => item.name === "Insurance")).toBe(true);
  });

  it("refuses an icon for a category that does not exist", () => {
    const { repo } = setup();
    expect(() =>
      setCategoryIcon(repo, "Nope", { mimeType: "image/png", base64Data: PNG_BASE64 }),
    ).toThrow(/no category named/i);
  });

  it("refuses a file type that is not an allowed image", () => {
    const { repo } = setup();
    saveCategory(repo, { name: "Insurance" });
    expect(() =>
      setCategoryIcon(repo, "Insurance", {
        mimeType: "application/pdf",
        base64Data: PNG_BASE64,
      } as never),
    ).toThrow();
  });

  it("refuses an icon over the size cap", () => {
    const { repo } = setup();
    saveTag(repo, { name: "Big" });
    // Checked against the DECODED length, so the base64 is ~33% longer than the cap.
    const tooBig = Buffer.alloc(MAX_DOCUMENT_ICON_BYTES + 1).toString("base64");
    expect(() =>
      setTagIcon(repo, "Big", { mimeType: "image/png", base64Data: tooBig }),
    ).toThrow(/too large/i);
  });
});

describe("listAttachmentsFor", () => {
  it("returns each document's files keyed by id, in one call", async () => {
    const { repo, files } = setup();
    const a = createDocument(repo, { title: "A", description: "", categories: [], tags: [] }, null);
    const b = createDocument(repo, { title: "B", description: "", categories: [], tags: [] }, null);
    await addAttachment(repo, files, LIMITS, {
      documentId: a.id,
      fileName: "one.pdf",
      data: Buffer.from("x"),
    });
    await addAttachment(repo, files, LIMITS, {
      documentId: b.id,
      fileName: "two.pdf",
      data: Buffer.from("y"),
    });

    const map = listAttachmentsFor(repo, [a.id, b.id]);

    expect(map.get(a.id)?.[0].originalName).toBe("one.pdf");
    expect(map.get(b.id)?.[0].originalName).toBe("two.pdf");
  });

  it("omits a document with no files rather than mapping it to an empty array", () => {
    const { repo } = setup();
    const a = createDocument(repo, { title: "A", description: "", categories: [], tags: [] }, null);
    // One kind of nothing, so a caller reads `?? []` once.
    expect(listAttachmentsFor(repo, [a.id]).has(a.id)).toBe(false);
  });

  it("is an empty map for an empty page, without touching the repository", () => {
    const { repo } = setup();
    expect(listAttachmentsFor(repo, []).size).toBe(0);
  });
});
