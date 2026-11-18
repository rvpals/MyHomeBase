import { describe, expect, it } from "vitest";
import { backfillContentHashes } from "./backfill-hashes";
import { hashContent } from "./content-hash";
import { addAttachment, createDocument, type DocumentFiles, type DocumentLimitsInput } from "./documents";
import { findDuplicateGroups, groupDuplicates } from "./duplicates";
import { FakeFileStore, FakeRepository } from "./test-fakes";
import type { DuplicateAttachment } from "./types";

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

async function attach(
  repo: FakeRepository,
  files: DocumentFiles,
  documentId: number,
  fileName: string,
  bytes: string,
) {
  const { attachment } = await addAttachment(repo, files, LIMITS, {
    documentId,
    fileName,
    data: Buffer.from(bytes),
  });
  return attachment;
}

/** Simulates a row uploaded before migration 0163. */
function forgetHash(repo: FakeRepository, attachmentId: number) {
  repo.setAttachmentHash(attachmentId, "");
}

describe("findDuplicateGroups", () => {
  it("returns nothing when every file is unique", async () => {
    const { repo, files } = setup();
    const lease = makeDocument(repo, "Lease");
    await attach(repo, files, lease.id, "a.pdf", "one");
    await attach(repo, files, lease.id, "b.pdf", "two");

    expect(findDuplicateGroups(repo)).toEqual({ groups: [], unhashedCount: 0 });
  });

  it("groups the same bytes filed under two documents", async () => {
    const { repo, files } = setup();
    const lease = makeDocument(repo, "Lease 2026");
    const taxes = makeDocument(repo, "Tax 2026");
    await attach(repo, files, lease.id, "Scan 12-03.pdf", "same bytes");
    await attach(repo, files, taxes.id, "lease-final.pdf", "same bytes");
    await attach(repo, files, taxes.id, "w2.pdf", "unique");

    const { groups } = findDuplicateGroups(repo);

    expect(groups).toHaveLength(1);
    expect(groups[0].contentHash).toBe(hashContent(Buffer.from("same bytes")));
    expect(groups[0].files.map((f) => [f.documentTitle, f.originalName])).toEqual([
      ["Lease 2026", "Scan 12-03.pdf"],
      ["Tax 2026", "lease-final.pdf"],
    ]);
  });

  it("counts the same file attached twice to one document", async () => {
    const { repo, files } = setup();
    const lease = makeDocument(repo, "Lease");
    await attach(repo, files, lease.id, "a.pdf", "dup");
    await attach(repo, files, lease.id, "a copy.pdf", "dup");

    const { groups } = findDuplicateGroups(repo);
    expect(groups).toHaveLength(1);
    expect(groups[0].files.every((f) => f.documentId === lease.id)).toBe(true);
  });

  it("leaves un-hashed rows out and reports how many there are", async () => {
    const { repo, files } = setup();
    const lease = makeDocument(repo, "Lease");
    const first = await attach(repo, files, lease.id, "a.pdf", "dup");
    const second = await attach(repo, files, lease.id, "b.pdf", "dup");
    forgetHash(repo, first.id);
    forgetHash(repo, second.id);

    // Blank hashes must never match each other — that would make every unchecked
    // file a duplicate of every other.
    expect(findDuplicateGroups(repo)).toEqual({ groups: [], unhashedCount: 2 });
  });
});

describe("groupDuplicates", () => {
  const row = (
    attachmentId: number,
    contentHash: string,
    documentTitle: string,
    byteSize = 10,
  ): DuplicateAttachment => ({
    attachmentId,
    documentId: attachmentId,
    documentTitle,
    originalName: `${attachmentId}.pdf`,
    contentHash,
    byteSize,
    mimeType: "application/pdf",
    createdAt: "2026-01-01",
  });

  it("puts the most copies first, then the largest file", () => {
    const groups = groupDuplicates([
      row(1, "small", "A", 10),
      row(2, "small", "B", 10),
      row(3, "big", "C", 900),
      row(4, "big", "D", 900),
      row(5, "many", "E", 5),
      row(6, "many", "F", 5),
      row(7, "many", "G", 5),
    ]);
    expect(groups.map((g) => g.contentHash)).toEqual(["many", "big", "small"]);
  });

  it("drops a group left with a single file", () => {
    expect(groupDuplicates([row(1, "lonely", "A")])).toEqual([]);
  });
});

describe("backfillContentHashes", () => {
  it("hashes un-hashed rows so they join the duplicate check", async () => {
    const { repo, files } = setup();
    const lease = makeDocument(repo, "Lease");
    const taxes = makeDocument(repo, "Taxes");
    const a = await attach(repo, files, lease.id, "a.pdf", "dup");
    await attach(repo, files, taxes.id, "b.pdf", "dup");
    forgetHash(repo, a.id);

    const result = await backfillContentHashes(repo, files, { limit: 10 });

    expect(result).toMatchObject({ examined: 1, hashed: 1, remaining: 0, lastId: a.id });
    expect(result.duplicates).toEqual([
      { attachmentId: a.id, originalName: "a.pdf", byteSize: 3, alsoIn: ["Taxes"] },
    ]);
    expect(findDuplicateGroups(repo).groups).toHaveLength(1);
  });

  it("reports a missing file, leaves it un-hashed, and steps past it", async () => {
    const { repo, files, store } = setup();
    const lease = makeDocument(repo, "Lease");
    const gone = await attach(repo, files, lease.id, "gone.pdf", "x");
    const there = await attach(repo, files, lease.id, "there.pdf", "y");
    forgetHash(repo, gone.id);
    forgetHash(repo, there.id);
    store.files.delete(gone.relativePath);

    const first = await backfillContentHashes(repo, files, { limit: 1 });
    expect(first.missing.map((m) => m.originalName)).toEqual(["gone.pdf"]);
    expect(first.hashed).toBe(0);

    // The cursor is what keeps a batched run from stalling on the same gap.
    const second = await backfillContentHashes(repo, files, {
      limit: 1,
      afterId: first.lastId,
    });
    expect(second.hashed).toBe(1);
    expect(second.remaining).toBe(1);

    const third = await backfillContentHashes(repo, files, {
      limit: 1,
      afterId: second.lastId,
    });
    expect(third.examined).toBe(0);
  });

  it("writes nothing on a dry run", async () => {
    const { repo, files } = setup();
    const lease = makeDocument(repo, "Lease");
    const a = await attach(repo, files, lease.id, "a.pdf", "x");
    forgetHash(repo, a.id);

    const result = await backfillContentHashes(repo, files, { limit: 10, dryRun: true });
    expect(result.hashed).toBe(1);
    expect(result.remaining).toBe(1);
  });

  it("refuses when no document folder is set", async () => {
    const { repo, store } = setup();
    await expect(
      backfillContentHashes(repo, { store, root: "" }, { limit: 10 }),
    ).rejects.toThrow(/No document folder/);
  });

  it("refuses a batch size that is not a positive whole number", async () => {
    const { repo, files } = setup();
    await expect(backfillContentHashes(repo, files, { limit: 0 })).rejects.toThrow(
      /positive whole number/,
    );
  });
});
