// The encryption *use-cases* — `encryptEntry` and friends over a repository.
// The crypto primitives they sit on are tested in ./encryption.test.ts.
//
// Kept out of journal.test.ts because that file's fake repository is already
// 1300 lines of unrelated assertions; this one needs the same fake and nothing
// else, so it builds a small one of its own.

import { describe, expect, it } from "vitest";
import {
  createEncryptedEntry,
  createEntry,
  decryptEntry,
  editEncryptedEntry,
  encryptEntry,
  getEntry,
  removeEntryEncryption,
  setLocked,
  updateEntry,
} from "./journal";
import { WrongPasswordError } from "./encryption";
import type { JournalRepository } from "./ports";
import type { EntryWriteData } from "./schema";
import type { EntryLocation, JournalEntry } from "./types";

const PASSWORD = "a strong entry password";

/**
 * The slice of `JournalRepository` these use-cases touch.
 *
 * Every other method is simply absent, so a use-case quietly growing a
 * dependency on one fails here (calling `undefined`) rather than reading a
 * stub's empty answer and passing for the wrong reason.
 */
function fakeRepo(): JournalRepository {
  let entries: JournalEntry[] = [];
  let nextEntryId = 1;
  let nextLocationId = 1;
  const now = "2026-03-04T00:00:00.000Z";

  function toLocations(entryId: number, inputs: EntryWriteData["locations"]): EntryLocation[] {
    return inputs.map((location, index) => ({
      id: nextLocationId++,
      entryId,
      latitude: location.latitude,
      longitude: location.longitude,
      locationName: location.locationName,
      sortOrder: index,
    }));
  }

  function assemble(id: number, input: EntryWriteData): JournalEntry {
    return {
      id,
      date: input.date,
      time: input.time,
      title: input.title,
      content: input.content,
      placeName: input.placeName,
      weather: input.weather,
      isPinned: input.isPinned,
      isLocked: input.isLocked,
      isEncrypted: input.isEncrypted,
      titleEncrypted: input.titleEncrypted,
      contentEncrypted: input.contentEncrypted,
      passwordHint: input.passwordHint,
      categories: [...input.categories],
      tags: [...input.tags],
      locations: toLocations(id, input.locations),
      source: input.source,
      externalId: input.externalId,
      externalContent: input.externalContent,
      createdAt: now,
      updatedAt: now,
    };
  }

  // Typed as a Partial first, so each method below still gets its parameter
  // types inferred from the interface. Casting the object literal directly to
  // JournalRepository would widen every parameter to `any` -- the cast is what
  // suppresses the arity check, and it suppresses inference with it.
  const partial: Partial<JournalRepository> = {
    getEntryById(id: number) {
      return entries.find((entry) => entry.id === id);
    },
    createEntry(input: EntryWriteData) {
      const created = assemble(nextEntryId++, input);
      entries.push(created);
      return created;
    },
    updateEntry(id: number, input: EntryWriteData) {
      const index = entries.findIndex((entry) => entry.id === id);
      if (index === -1) throw new Error(`No entry ${id}.`);
      const updated = assemble(id, input);
      entries[index] = updated;
      return updated;
    },
    setEntryLocked(id: number, isLocked: boolean) {
      const existing = entries.find((entry) => entry.id === id);
      if (!existing) throw new Error(`No entry ${id}.`);
      existing.isLocked = isLocked;
      return existing;
    },
    registerCategoriesIfMissing() {},
    registerTagsIfMissing() {},
  };

  // Everything these use-cases don't touch stays absent: a use-case that grows a
  // new dependency fails loudly here rather than reading `undefined`.
  return partial as JournalRepository;
}

function sealedEntry(repo: JournalRepository) {
  const created = createEntry(repo, {
    date: "2026-03-04",
    title: "Dinner with Sam",
    content: "We talked about the move.",
    categories: ["Personal"],
    tags: ["food"],
  });
  return encryptEntry(repo, created.id, PASSWORD, "the usual one");
}

describe("encryptEntry", () => {
  it("seals the title and content and blanks the plaintext columns", () => {
    const repo = fakeRepo();
    const sealed = sealedEntry(repo);

    expect(sealed.isEncrypted).toBe(true);
    expect(sealed.title).toBe("");
    expect(sealed.content).toBe("");
    expect(sealed.titleEncrypted).not.toBe("");
    expect(sealed.contentEncrypted).not.toBe("");
  });

  it("does not leave the plaintext inside the ciphertext", () => {
    const repo = fakeRepo();
    const sealed = sealedEntry(repo);
    expect(sealed.titleEncrypted).not.toContain("Dinner");
    expect(sealed.contentEncrypted).not.toContain("move");
  });

  it("leaves everything that is not the entry's text readable", () => {
    const repo = fakeRepo();
    const sealed = sealedEntry(repo);

    expect(sealed.date).toBe("2026-03-04");
    expect(sealed.categories).toEqual(["Personal"]);
    expect(sealed.tags).toEqual(["food"]);
    expect(sealed.passwordHint).toBe("the usual one");
  });

  it("never stores the password itself", () => {
    const repo = fakeRepo();
    const sealed = sealedEntry(repo);
    expect(JSON.stringify(sealed)).not.toContain(PASSWORD);
  });

  it("gives two entries different ciphertext for identical text and password", () => {
    const repo = fakeRepo();
    const first = encryptEntry(
      repo,
      createEntry(repo, { date: "2026-03-04", title: "Same", content: "Same" }).id,
      PASSWORD,
    );
    const second = encryptEntry(
      repo,
      createEntry(repo, { date: "2026-03-05", title: "Same", content: "Same" }).id,
      PASSWORD,
    );
    expect(first.titleEncrypted).not.toBe(second.titleEncrypted);
  });

  it("refuses to encrypt an entry twice", () => {
    const repo = fakeRepo();
    const sealed = sealedEntry(repo);
    expect(() => encryptEntry(repo, sealed.id, PASSWORD)).toThrow(/already encrypted/i);
  });

  it("refuses a locked entry", () => {
    const repo = fakeRepo();
    const created = createEntry(repo, { date: "2026-03-04", title: "T" });
    setLocked(repo, created.id, true);
    expect(() => encryptEntry(repo, created.id, PASSWORD)).toThrow(/locked/i);
  });

  it("refuses an empty password", () => {
    const repo = fakeRepo();
    const created = createEntry(repo, { date: "2026-03-04", title: "T" });
    expect(() => encryptEntry(repo, created.id, "")).toThrow();
  });

  it("refuses an unknown id", () => {
    expect(() => encryptEntry(fakeRepo(), 999, PASSWORD)).toThrow(/No journal entry/i);
  });
});

describe("decryptEntry", () => {
  it("round-trips the text through the right password", () => {
    const repo = fakeRepo();
    const sealed = sealedEntry(repo);
    expect(decryptEntry(repo, sealed.id, PASSWORD)).toEqual({
      title: "Dinner with Sam",
      content: "We talked about the move.",
    });
  });

  it("refuses the wrong password", () => {
    const repo = fakeRepo();
    const sealed = sealedEntry(repo);
    expect(() => decryptEntry(repo, sealed.id, "wrong")).toThrow(WrongPasswordError);
  });

  it("writes nothing", () => {
    const repo = fakeRepo();
    const sealed = sealedEntry(repo);
    decryptEntry(repo, sealed.id, PASSWORD);
    expect(getEntry(repo, sealed.id)?.titleEncrypted).toBe(sealed.titleEncrypted);
  });

  it("refuses an entry that is not encrypted", () => {
    const repo = fakeRepo();
    const created = createEntry(repo, { date: "2026-03-04", title: "T" });
    expect(() => decryptEntry(repo, created.id, PASSWORD)).toThrow(/not encrypted/i);
  });
});

describe("editEncryptedEntry", () => {
  it("re-seals new text under the same password", () => {
    const repo = fakeRepo();
    const sealed = sealedEntry(repo);

    editEncryptedEntry(repo, sealed.id, PASSWORD, {
      title: "Dinner with Sam (edited)",
      content: "We talked about the move, and the dog.",
    });

    expect(decryptEntry(repo, sealed.id, PASSWORD)).toEqual({
      title: "Dinner with Sam (edited)",
      content: "We talked about the move, and the dog.",
    });
    expect(getEntry(repo, sealed.id)?.title).toBe("");
  });

  it("re-encrypts with a fresh salt and IV rather than reusing the old ones", () => {
    const repo = fakeRepo();
    const sealed = sealedEntry(repo);
    const before = sealed.titleEncrypted;

    // Same text, same password: the blob must still differ, or an IV was reused.
    editEncryptedEntry(repo, sealed.id, PASSWORD, {
      title: "Dinner with Sam",
      content: "We talked about the move.",
    });

    expect(getEntry(repo, sealed.id)?.titleEncrypted).not.toBe(before);
  });

  it("rejects a wrong password before writing anything", () => {
    const repo = fakeRepo();
    const sealed = sealedEntry(repo);
    const before = getEntry(repo, sealed.id)?.contentEncrypted;

    expect(() =>
      editEncryptedEntry(repo, sealed.id, "wrong", { title: "x", content: "y" }),
    ).toThrow(WrongPasswordError);

    // A typo must not re-seal the entry under a password nobody knows.
    expect(getEntry(repo, sealed.id)?.contentEncrypted).toBe(before);
    expect(decryptEntry(repo, sealed.id, PASSWORD).title).toBe("Dinner with Sam");
  });

  it("keeps the hint across an edit", () => {
    const repo = fakeRepo();
    const sealed = sealedEntry(repo);
    editEncryptedEntry(repo, sealed.id, PASSWORD, { title: "a", content: "b" });
    expect(getEntry(repo, sealed.id)?.passwordHint).toBe("the usual one");
  });

  it("refuses an entry that is not encrypted", () => {
    const repo = fakeRepo();
    const created = createEntry(repo, { date: "2026-03-04", title: "T" });
    expect(() =>
      editEncryptedEntry(repo, created.id, PASSWORD, { title: "a", content: "b" }),
    ).toThrow(/not encrypted/i);
  });
});

// The failure this guards against is the one that is both silent and
// unrecoverable: an ordinary save putting an encrypted entry's text back in the
// clear, or blanking the ciphertext while leaving the flag set.
describe("updateEntry on an encrypted entry", () => {
  it("never writes plaintext over the ciphertext", () => {
    const repo = fakeRepo();
    const sealed = sealedEntry(repo);

    updateEntry(repo, sealed.id, {
      date: "2026-03-04",
      title: "Dinner with Sam",
      content: "We talked about the move.",
    });

    const after = getEntry(repo, sealed.id);
    expect(after?.title).toBe("");
    expect(after?.content).toBe("");
    expect(after?.isEncrypted).toBe(true);
  });

  it("does not blank the ciphertext when a caller omits the encryption fields", () => {
    const repo = fakeRepo();
    const sealed = sealedEntry(repo);

    updateEntry(repo, sealed.id, { date: "2026-03-04", placeName: "Home" });

    const after = getEntry(repo, sealed.id);
    expect(after?.titleEncrypted).toBe(sealed.titleEncrypted);
    expect(after?.contentEncrypted).toBe(sealed.contentEncrypted);
    expect(after?.placeName).toBe("Home");
    // Still openable: a metadata edit did not cost the entry its text.
    expect(decryptEntry(repo, sealed.id, PASSWORD).title).toBe("Dinner with Sam");
  });

  it("leaves an unencrypted entry's plaintext alone", () => {
    const repo = fakeRepo();
    const created = createEntry(repo, { date: "2026-03-04", title: "Plain", content: "Text" });

    updateEntry(repo, created.id, { date: "2026-03-04", title: "Edited", content: "New" });

    const after = getEntry(repo, created.id);
    expect(after?.title).toBe("Edited");
    expect(after?.content).toBe("New");
    expect(after?.isEncrypted).toBe(false);
  });
});

describe("removeEntryEncryption", () => {
  it("restores the plaintext and clears the blobs, flag and hint", () => {
    const repo = fakeRepo();
    const sealed = sealedEntry(repo);

    const restored = removeEntryEncryption(repo, sealed.id, PASSWORD);

    expect(restored.isEncrypted).toBe(false);
    expect(restored.title).toBe("Dinner with Sam");
    expect(restored.content).toBe("We talked about the move.");
    expect(restored.titleEncrypted).toBe("");
    expect(restored.contentEncrypted).toBe("");
    expect(restored.passwordHint).toBe("");
  });

  it("refuses the wrong password and leaves the entry sealed", () => {
    const repo = fakeRepo();
    const sealed = sealedEntry(repo);

    expect(() => removeEntryEncryption(repo, sealed.id, "wrong")).toThrow(WrongPasswordError);
    expect(getEntry(repo, sealed.id)?.isEncrypted).toBe(true);
  });

  it("refuses an entry that is not encrypted", () => {
    const repo = fakeRepo();
    const created = createEntry(repo, { date: "2026-03-04", title: "T" });
    expect(() => removeEntryEncryption(repo, created.id, PASSWORD)).toThrow(/not encrypted/i);
  });
});

// "Save entry encrypted" on the New Entry screen. The distinction that matters
// is that the plaintext is never written at all -- not written and then
// overwritten -- so a crash between the two steps cannot leave a readable entry
// the writer believes is sealed.
describe("createEncryptedEntry", () => {
  it("creates an entry that is already sealed", () => {
    const repo = fakeRepo();
    const created = createEncryptedEntry(
      repo,
      { date: "2026-03-04", title: "Dinner with Sam", content: "We talked about the move." },
      PASSWORD,
      "the usual one",
    );

    expect(created.isEncrypted).toBe(true);
    expect(created.title).toBe("");
    expect(created.content).toBe("");
    expect(created.passwordHint).toBe("the usual one");
  });

  it("round-trips the text through the password", () => {
    const repo = fakeRepo();
    const created = createEncryptedEntry(
      repo,
      { date: "2026-03-04", title: "Dinner with Sam", content: "We talked about the move." },
      PASSWORD,
    );

    expect(decryptEntry(repo, created.id, PASSWORD)).toEqual({
      title: "Dinner with Sam",
      content: "We talked about the move.",
    });
  });

  it("keeps the metadata plaintext, exactly as an ordinary entry would", () => {
    const repo = fakeRepo();
    const created = createEncryptedEntry(
      repo,
      {
        date: "2026-03-04",
        time: "19:30",
        title: "T",
        content: "C",
        placeName: "Home",
        categories: ["Personal"],
        tags: ["food"],
      },
      PASSWORD,
    );

    expect(created.date).toBe("2026-03-04");
    expect(created.time).toBe("19:30");
    expect(created.placeName).toBe("Home");
    expect(created.categories).toEqual(["Personal"]);
    expect(created.tags).toEqual(["food"]);
  });

  it("never leaves the plaintext anywhere on the stored row", () => {
    const repo = fakeRepo();
    const created = createEncryptedEntry(
      repo,
      { date: "2026-03-04", title: "Dinner with Sam", content: "irreplaceable" },
      PASSWORD,
    );

    const serialized = JSON.stringify(getEntry(repo, created.id));
    expect(serialized).not.toContain("Dinner");
    expect(serialized).not.toContain("irreplaceable");
    expect(serialized).not.toContain(PASSWORD);
  });

  it("refuses an empty password rather than creating a readable entry", () => {
    const repo = fakeRepo();
    expect(() =>
      createEncryptedEntry(repo, { date: "2026-03-04", title: "T", content: "C" }, ""),
    ).toThrow();
    // Nothing was written -- the guard runs before createEntry.
    expect(getEntry(repo, 1)).toBeUndefined();
  });

  it("defaults the hint to empty when none is given", () => {
    const repo = fakeRepo();
    const created = createEncryptedEntry(repo, { date: "2026-03-04", title: "T" }, PASSWORD);
    expect(created.passwordHint).toBe("");
  });
});
