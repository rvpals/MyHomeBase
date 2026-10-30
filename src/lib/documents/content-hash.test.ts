import { describe, expect, it } from "vitest";
import {
  UNHASHED,
  findDuplicates,
  hashAndFindDuplicates,
  hashContent,
  isHashed,
} from "./content-hash";
import { addAttachment, createDocument, type DocumentFiles, type DocumentLimitsInput } from "./documents";
import { FakeFileStore, FakeRepository } from "./test-fakes";

const LIMITS: DocumentLimitsInput = { maxFileBytes: 1024, maxFilesPerDocument: 5 };

function setup() {
  const repo = new FakeRepository();
  const store = new FakeFileStore();
  const files: DocumentFiles = { store, root: "/share/documents" };
  return { repo, store, files };
}

function makeDocument(repo: FakeRepository, title: string) {
  return createDocument(repo, { title, description: "", categories: [], tags: [] }, 1);
}

describe("hashContent", () => {
  it("is stable for the same bytes and differs for different ones", () => {
    const a = hashContent(Buffer.from("lease text"));
    const b = hashContent(Buffer.from("lease text"));
    const c = hashContent(Buffer.from("different"));

    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("is a lowercase hex sha-256", () => {
    expect(hashContent(Buffer.from("x"))).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes content only, so the file name cannot change the answer", () => {
    // The whole premise of duplicate detection: the names are exactly what differ in
    // the case worth catching ("Scan 12-03.pdf" vs "lease-final.pdf").
    expect(hashContent(Buffer.from("same"))).toBe(hashContent(Buffer.from("same")));
  });

  it("hashes an empty buffer rather than refusing", () => {
    // Upload validation refuses an empty file long before this; the hash itself has no
    // opinion, and a guard here would be a second place to disagree about the rule.
    expect(hashContent(Buffer.alloc(0))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("isHashed", () => {
  it("rejects the un-hashed marker and accepts a real hash", () => {
    expect(isHashed(UNHASHED)).toBe(false);
    expect(isHashed(hashContent(Buffer.from("x")))).toBe(true);
  });
});

describe("findDuplicates", () => {
  it("finds another document holding the same bytes", async () => {
    const { repo, files } = setup();
    const lease = makeDocument(repo, "Lease 2026");
    const taxes = makeDocument(repo, "Tax 2026");

    await addAttachment(repo, files, LIMITS, {
      documentId: lease.id,
      fileName: "Scan 12-03.pdf",
      data: Buffer.from("identical bytes"),
    });

    const matches = findDuplicates(repo, hashContent(Buffer.from("identical bytes")));

    expect(matches).toHaveLength(1);
    // The title, not just an id: the only useful phrasing of the warning names it.
    expect(matches[0].documentTitle).toBe("Lease 2026");
    expect(matches[0].originalName).toBe("Scan 12-03.pdf");
    expect(matches[0].documentId).toBe(lease.id);
    expect(taxes.id).not.toBe(lease.id);
  });

  it("returns nothing for bytes the library has never seen", async () => {
    const { repo, files } = setup();
    const document = makeDocument(repo, "Lease");
    await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "a.pdf",
      data: Buffer.from("one"),
    });

    expect(findDuplicates(repo, hashContent(Buffer.from("entirely new")))).toEqual([]);
  });

  it("refuses to search on the un-hashed marker", async () => {
    const { repo, files } = setup();
    const document = makeDocument(repo, "Lease");
    await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "a.pdf",
      data: Buffer.from("one"),
    });
    // A row predating migration 0163.
    repo.setAttachmentHash(repo.attachments[0].id, UNHASHED);

    // The failure this guards: searching on '' would match every un-backfilled row
    // and report a brand new file as a duplicate of the whole library.
    expect(findDuplicates(repo, UNHASHED)).toEqual([]);
  });

  it("leaves out the attachment being re-checked", async () => {
    const { repo, files } = setup();
    const document = makeDocument(repo, "Lease");
    const { attachment } = await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "a.pdf",
      data: Buffer.from("bytes"),
    });

    expect(findDuplicates(repo, attachment.contentHash)).toHaveLength(1);
    expect(findDuplicates(repo, attachment.contentHash, attachment.id)).toEqual([]);
  });

  it("finds every copy when the same file is filed three times", async () => {
    const { repo, files } = setup();
    const data = Buffer.from("same");
    for (const title of ["One", "Two", "Three"]) {
      const document = makeDocument(repo, title);
      await addAttachment(repo, files, LIMITS, {
        documentId: document.id,
        fileName: "a.pdf",
        data,
      });
    }

    expect(findDuplicates(repo, hashContent(data))).toHaveLength(3);
  });
});

describe("hashAndFindDuplicates", () => {
  it("returns the hash to store alongside the matches to report", async () => {
    const { repo, files } = setup();
    const document = makeDocument(repo, "Lease");
    await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "a.pdf",
      data: Buffer.from("shared"),
    });

    const result = hashAndFindDuplicates(repo, Buffer.from("shared"));

    expect(result.contentHash).toBe(hashContent(Buffer.from("shared")));
    expect(result.duplicates).toHaveLength(1);
  });
});

describe("addAttachment with hashing", () => {
  it("stores the hash on the new attachment", async () => {
    const { repo, files } = setup();
    const document = makeDocument(repo, "Lease");

    const { attachment } = await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "a.pdf",
      data: Buffer.from("bytes"),
    });

    expect(attachment.contentHash).toBe(hashContent(Buffer.from("bytes")));
  });

  it("warns about a duplicate but still stores the file", async () => {
    const { repo, store, files } = setup();
    const lease = makeDocument(repo, "Lease 2026");
    const taxes = makeDocument(repo, "Tax 2026");
    const data = Buffer.from("the same scan");

    await addAttachment(repo, files, LIMITS, {
      documentId: lease.id,
      fileName: "lease.pdf",
      data,
    });
    const second = await addAttachment(repo, files, LIMITS, {
      documentId: taxes.id,
      fileName: "receipt.pdf",
      data,
    });

    // Warn, never block: filing the same scan under two documents is sometimes
    // deliberate, and nothing here can tell that from a mistake.
    expect(second.duplicates).toHaveLength(1);
    expect(second.duplicates[0].documentTitle).toBe("Lease 2026");
    expect(repo.listAttachments(taxes.id)).toHaveLength(1);
    expect(store.files.has(`doc_${taxes.id}/receipt.pdf`)).toBe(true);
  });

  it("reports no duplicates for a genuinely new file", async () => {
    const { repo, files } = setup();
    const document = makeDocument(repo, "Lease");

    const result = await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "a.pdf",
      data: Buffer.from("brand new"),
    });

    expect(result.duplicates).toEqual([]);
  });

  it("describes the library as it was before this upload", async () => {
    const { repo, files } = setup();
    const document = makeDocument(repo, "Lease");

    // The file being uploaded must not report itself: the lookup runs before the row
    // is written, which is what makes the first upload of a file come back clean.
    const result = await addAttachment(repo, files, LIMITS, {
      documentId: document.id,
      fileName: "a.pdf",
      data: Buffer.from("first"),
    });

    expect(result.duplicates).toEqual([]);
  });
});
