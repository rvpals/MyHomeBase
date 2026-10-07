import { describe, expect, it } from "vitest";
import { bulkEncryptEntries, describeBulkEncryptResult } from "./bulk-encrypt";
import { decryptEntryText, isEncryptedBlob } from "./encryption";
import type { BulkEncryptOutcome, BulkEncryptRequest, JournalRepository } from "./index";

interface Row {
  title: string;
  content: string;
  isLocked?: boolean;
  isEncrypted?: boolean;
}

/**
 * A fake standing in for the one repository method this use-case calls.
 *
 * It models the eligibility rules the real repository applies — skip locked,
 * skip already-encrypted — and actually *stores* what the seal callback
 * returns, because the property most worth pinning down here is that the
 * plaintext is gone afterwards and the ciphertext opens with the password.
 * A fake that only counted calls could not show that.
 */
function fakeRepo(rows: Record<number, Row>) {
  const stored = new Map<number, Row & { titleEncrypted: string; contentEncrypted: string; hint: string }>();
  for (const [id, row] of Object.entries(rows)) {
    stored.set(Number(id), { ...row, titleEncrypted: "", contentEncrypted: "", hint: "" });
  }

  const repo = {
    bulkEncryptEntries: (ids: number[], request: BulkEncryptRequest): BulkEncryptOutcome => {
      const outcome: BulkEncryptOutcome = {
        encryptedIds: [],
        skippedLockedIds: [],
        skippedEncryptedIds: [],
        missingIds: [],
      };
      for (const id of ids) {
        const row = stored.get(id);
        if (!row) {
          outcome.missingIds.push(id);
          continue;
        }
        if (row.isLocked) {
          outcome.skippedLockedIds.push(id);
          continue;
        }
        if (row.isEncrypted) {
          outcome.skippedEncryptedIds.push(id);
          continue;
        }
        const sealed = request.seal(row.title, row.content);
        row.titleEncrypted = sealed.titleEncrypted;
        row.contentEncrypted = sealed.contentEncrypted;
        row.hint = request.hint;
        row.isEncrypted = true;
        // The real UPDATE blanks these in the same statement; the fake has to
        // do it too or the test below proves nothing about the plaintext.
        row.title = "";
        row.content = "";
        outcome.encryptedIds.push(id);
      }
      return outcome;
    },
  } as unknown as JournalRepository;

  return { repo, stored };
}

describe("bulkEncryptEntries", () => {
  it("seals every eligible entry and reports the count", () => {
    const { repo } = fakeRepo({
      1: { title: "Monday", content: "Rained all day." },
      2: { title: "Tuesday", content: "Better." },
    });

    const result = bulkEncryptEntries(repo, [1, 2], "correct horse");

    expect(result).toEqual({
      encryptedCount: 2,
      skippedLockedCount: 0,
      skippedEncryptedCount: 0,
      missingCount: 0,
    });
  });

  it("leaves no plaintext behind, and the ciphertext opens with the password", () => {
    // The whole point of the feature. If this ever passes while the title is
    // still readable, the encrypt is decorative.
    const { repo, stored } = fakeRepo({ 1: { title: "Monday", content: "Rained all day." } });

    bulkEncryptEntries(repo, [1], "correct horse");

    const row = stored.get(1)!;
    expect(row.title).toBe("");
    expect(row.content).toBe("");
    expect(isEncryptedBlob(row.titleEncrypted)).toBe(true);
    expect(decryptEntryText(row.titleEncrypted, "correct horse")).toBe("Monday");
    expect(decryptEntryText(row.contentEncrypted, "correct horse")).toBe("Rained all day.");
  });

  it("gives every entry its own salt and IV, even under one password", () => {
    // Two identical entries under one password must not produce identical
    // blobs — a shared IV under one key is exactly what GCM must not do.
    const { repo, stored } = fakeRepo({
      1: { title: "Same", content: "Same" },
      2: { title: "Same", content: "Same" },
    });

    bulkEncryptEntries(repo, [1, 2], "one password");

    expect(stored.get(1)!.titleEncrypted).not.toBe(stored.get(2)!.titleEncrypted);
  });

  it("skips locked entries rather than failing the whole batch", () => {
    const { repo, stored } = fakeRepo({
      1: { title: "Open", content: "" },
      2: { title: "Shut", content: "", isLocked: true },
    });

    const result = bulkEncryptEntries(repo, [1, 2], "pw");

    expect(result.encryptedCount).toBe(1);
    expect(result.skippedLockedCount).toBe(1);
    // Untouched, not half-written.
    expect(stored.get(2)!.title).toBe("Shut");
  });

  it("skips entries that are already encrypted", () => {
    // Re-sealing would need each entry's existing password to open it first,
    // which a batch under one new password doesn't have.
    const { repo } = fakeRepo({
      1: { title: "Plain", content: "" },
      2: { title: "", content: "", isEncrypted: true },
    });

    const result = bulkEncryptEntries(repo, [1, 2], "pw");

    expect(result.encryptedCount).toBe(1);
    expect(result.skippedEncryptedCount).toBe(1);
  });

  it("reports ids that no longer exist separately", () => {
    const { repo } = fakeRepo({ 1: { title: "Here", content: "" } });

    const result = bulkEncryptEntries(repo, [1, 9], "pw");

    expect(result.encryptedCount).toBe(1);
    expect(result.missingCount).toBe(1);
  });

  it("stores the hint in the clear, once per sealed entry", () => {
    const { repo, stored } = fakeRepo({ 1: { title: "A", content: "B" } });

    bulkEncryptEntries(repo, [1], "pw", "the usual one");

    expect(stored.get(1)!.hint).toBe("the usual one");
  });

  it("refuses an empty password before touching a single row", () => {
    const { repo, stored } = fakeRepo({ 1: { title: "Monday", content: "x" } });

    expect(() => bulkEncryptEntries(repo, [1], "")).toThrow(/password is required/i);
    expect(stored.get(1)!.title).toBe("Monday");
  });

  it("refuses an empty selection", () => {
    const { repo } = fakeRepo({});

    expect(() => bulkEncryptEntries(repo, [], "pw")).toThrow(/Select at least one entry/);
  });

  it("de-dupes so one entry can't be sealed twice in a batch", () => {
    // Sealing twice would encrypt the already-blanked plaintext, destroying the
    // text while reporting success.
    const { repo, stored } = fakeRepo({ 1: { title: "Monday", content: "x" } });

    const result = bulkEncryptEntries(repo, [1, 1, 1], "pw");

    expect(result.encryptedCount).toBe(1);
    expect(decryptEntryText(stored.get(1)!.titleEncrypted, "pw")).toBe("Monday");
  });
});

describe("describeBulkEncryptResult", () => {
  it("counts a clean batch", () => {
    expect(
      describeBulkEncryptResult({
        encryptedCount: 4,
        skippedLockedCount: 0,
        skippedEncryptedCount: 0,
        missingCount: 0,
      }),
    ).toBe("Encrypted 4 entries.");
  });

  it("uses the singular for one entry", () => {
    expect(
      describeBulkEncryptResult({
        encryptedCount: 1,
        skippedLockedCount: 0,
        skippedEncryptedCount: 0,
        missingCount: 0,
      }),
    ).toBe("Encrypted 1 entry.");
  });

  it("explains every kind of short count rather than leaving it a mystery", () => {
    expect(
      describeBulkEncryptResult({
        encryptedCount: 2,
        skippedLockedCount: 1,
        skippedEncryptedCount: 3,
        missingCount: 1,
      }),
    ).toBe(
      "Encrypted 2 entries. 1 was locked and skipped. 3 were already encrypted. 1 no longer exists.",
    );
  });
});
