import { describe, expect, it } from "vitest";
import { FakeMessageRepository } from "./fakes";
import {
  countMessages,
  createMessage,
  deleteMessages,
  getMessage,
  getMessageQueue,
  listAllMessages,
  listMessages,
  markAllMessagesRead,
  markMessagesRead,
  pruneMessages,
} from "./messages";
import { createMessageSchema, markMessagesReadSchema, MESSAGE_TITLE_MAX } from "./schema";
import type { SystemMessage } from "./types";

describe("createMessage", () => {
  it("files a message and returns it", () => {
    const repo = new FakeMessageRepository();

    const message = createMessage(repo, {
      title: "NVDA near your target",
      body: "Unrealized gain is $9,800.",
      source: "Investments monitor",
    });

    expect(message.id).toBe(1);
    expect(message.title).toBe("NVDA near your target");
    expect(message.readAt).toBeUndefined();
    expect(repo.messages).toHaveLength(1);
  });

  it("accepts a title-only message, defaulting the body and source to blank", () => {
    const repo = new FakeMessageRepository();

    const message = createMessage(repo, { title: "Refresh finished" });

    expect(message.body).toBe("");
    expect(message.source).toBe("");
  });

  it("trims the title", () => {
    const repo = new FakeMessageRepository();

    const message = createMessage(repo, { title: "  Padded  ", body: "", source: "" });

    expect(message.title).toBe("Padded");
  });

  it("rejects a blank title — an untitled row would be unreadable in the list", () => {
    const repo = new FakeMessageRepository();

    expect(() => createMessage(repo, { title: "   ", body: "", source: "" })).toThrow();
    expect(repo.messages).toHaveLength(0);
  });

  it("rejects a title past the column's limit", () => {
    const repo = new FakeMessageRepository();

    expect(() =>
      createMessage(repo, { title: "x".repeat(MESSAGE_TITLE_MAX + 1), body: "", source: "" }),
    ).toThrow();
  });
});

describe("listMessages", () => {
  it("returns only the requested half", () => {
    const repo = new FakeMessageRepository();
    createMessage(repo, { title: "One", body: "", source: "" });
    const second = createMessage(repo, { title: "Two", body: "", source: "" });
    markMessagesRead(repo, [second.id]);

    expect(listMessages(repo, "unread").map((m) => m.title)).toEqual(["One"]);
    expect(listMessages(repo, "read").map((m) => m.title)).toEqual(["Two"]);
  });

  it("rejects a state that is neither half", () => {
    const repo = new FakeMessageRepository();

    expect(() => listMessages(repo, "everything" as never)).toThrow();
  });
});

describe("markMessagesRead", () => {
  it("stamps the given messages and reports how many changed", () => {
    const repo = new FakeMessageRepository();
    const first = createMessage(repo, { title: "One", body: "", source: "" });
    const second = createMessage(repo, { title: "Two", body: "", source: "" });

    expect(markMessagesRead(repo, [first.id, second.id])).toBe(2);
    expect(countMessages(repo)).toEqual({ unread: 0, read: 2 });
  });

  it("tolerates an id that was already read — two tabs on one queue", () => {
    const repo = new FakeMessageRepository();
    const message = createMessage(repo, { title: "One", body: "", source: "" });
    markMessagesRead(repo, [message.id]);

    // The second click changes nothing rather than throwing.
    expect(markMessagesRead(repo, [message.id])).toBe(0);
    expect(countMessages(repo)).toEqual({ unread: 0, read: 1 });
  });

  it("tolerates an id that does not exist", () => {
    const repo = new FakeMessageRepository();

    expect(markMessagesRead(repo, [999])).toBe(0);
  });

  it("rejects an empty selection — that is a caller bug, not a no-op", () => {
    const repo = new FakeMessageRepository();

    expect(() => markMessagesRead(repo, [])).toThrow();
  });

  it("rejects a non-positive id", () => {
    expect(() => markMessagesReadSchema.parse({ messageIds: [0] })).toThrow();
    expect(() => markMessagesReadSchema.parse({ messageIds: [-1] })).toThrow();
  });
});

describe("markAllMessagesRead", () => {
  it("empties the unread half and reports the count", () => {
    const repo = new FakeMessageRepository();
    createMessage(repo, { title: "One", body: "", source: "" });
    createMessage(repo, { title: "Two", body: "", source: "" });

    expect(markAllMessagesRead(repo)).toBe(2);
    expect(countMessages(repo)).toEqual({ unread: 0, read: 2 });
  });

  it("is a no-op on an already-empty unread half", () => {
    const repo = new FakeMessageRepository();

    expect(markAllMessagesRead(repo)).toBe(0);
  });
});

describe("getMessage", () => {
  it("returns the message, or undefined when there is none", () => {
    const repo = new FakeMessageRepository();
    const message = createMessage(repo, { title: "One", body: "Body", source: "" });

    expect(getMessage(repo, message.id)?.body).toBe("Body");
    expect(getMessage(repo, 999)).toBeUndefined();
  });
});

describe("getMessageQueue", () => {
  it("returns both halves and both counts consistently", () => {
    const repo = new FakeMessageRepository();
    createMessage(repo, { title: "Unread one", body: "", source: "" });
    const read = createMessage(repo, { title: "Read one", body: "", source: "" });
    markMessagesRead(repo, [read.id]);

    const queue = getMessageQueue(repo);

    expect(queue.unread).toHaveLength(1);
    expect(queue.read).toHaveLength(1);
    expect(queue.counts).toEqual({ unread: 1, read: 1 });
    // The counts must agree with the lists under them — that disagreement is
    // the bug this one call exists to prevent.
    expect(queue.counts.unread).toBe(queue.unread.length);
    expect(queue.counts.read).toBe(queue.read.length);
  });

  it("is empty on a fresh queue rather than throwing", () => {
    const queue = getMessageQueue(new FakeMessageRepository());

    expect(queue.unread).toEqual([]);
    expect(queue.counts).toEqual({ unread: 0, read: 0 });
  });
});

describe("createMessageSchema", () => {
  it("does not accept a caller-supplied createdAt or readAt", () => {
    const parsed = createMessageSchema.parse({
      title: "One",
      body: "",
      source: "",
      readAt: "2020-01-01",
      createdAt: "2020-01-01",
    } as never);

    // Stripped, not stored: the database stamps the first and only a reader
    // sets the second, so neither may arrive from the boundary.
    expect(parsed).not.toHaveProperty("readAt");
    expect(parsed).not.toHaveProperty("createdAt");
  });
});

/**
 * A message with an explicit `createdAt`, for the purge tests. The fake's own
 * `createMessage` stamps a fixed date, which is right for ordering tests and
 * useless for one about age.
 */
function aged(id: number, createdAt: string): SystemMessage {
  return { id, createdAt, title: `Message ${id}`, body: "", source: "test" };
}

describe("listAllMessages", () => {
  it("returns both halves together, newest first", () => {
    const repo = new FakeMessageRepository();
    createMessage(repo, { title: "First" });
    createMessage(repo, { title: "Second" });
    createMessage(repo, { title: "Third" });
    markMessagesRead(repo, [2]);

    const all = listAllMessages(repo);

    // Three rows, not the two the unread tab would show — the admin grid is the
    // one place that sees a read message next to an unread one.
    expect(all.map((message) => message.title)).toEqual(["Third", "Second", "First"]);
    expect(all.filter((message) => message.readAt)).toHaveLength(1);
  });

  it("is empty on a fresh queue rather than throwing", () => {
    expect(listAllMessages(new FakeMessageRepository())).toEqual([]);
  });
});

describe("deleteMessages", () => {
  it("removes the selected messages and returns how many went", () => {
    const repo = new FakeMessageRepository();
    createMessage(repo, { title: "Keep" });
    createMessage(repo, { title: "Drop" });

    expect(deleteMessages(repo, [2])).toBe(1);
    expect(listAllMessages(repo).map((message) => message.title)).toEqual(["Keep"]);
  });

  it("deletes read and unread alike", () => {
    const repo = new FakeMessageRepository();
    createMessage(repo, { title: "Read one" });
    createMessage(repo, { title: "Unread one" });
    markMessagesRead(repo, [1]);

    // Delete is not mark-read: having been read does not protect a row, and not
    // having been read does not either.
    expect(deleteMessages(repo, [1, 2])).toBe(2);
    expect(countMessages(repo)).toEqual({ unread: 0, read: 0 });
  });

  it("counts an id that is already gone as zero rather than throwing", () => {
    const repo = new FakeMessageRepository();
    createMessage(repo, { title: "Only" });
    deleteMessages(repo, [1]);

    // Two admins on the same grid is an ordinary thing; the second click must not
    // produce an error for doing what the first already did.
    expect(deleteMessages(repo, [1])).toBe(0);
  });

  it("rejects an empty selection", () => {
    // Throws where mark-read would tolerate it: a delete is deliberate, so
    // "you selected nothing" has to reach the admin.
    expect(() => deleteMessages(new FakeMessageRepository(), [])).toThrow();
  });

  it("rejects an id that is not a positive integer", () => {
    expect(() => deleteMessages(new FakeMessageRepository(), [0])).toThrow();
    expect(() => deleteMessages(new FakeMessageRepository(), [-4])).toThrow();
    expect(() => deleteMessages(new FakeMessageRepository(), [1.5])).toThrow();
  });

  it("deduplicates a repeated id so the count is honest", () => {
    const repo = new FakeMessageRepository();
    createMessage(repo, { title: "Only" });

    // One row went, so the answer is 1 — not 2, which is what a naive loop over
    // the raw list would report back to the screen.
    expect(deleteMessages(repo, [1, 1])).toBe(1);
  });
});

describe("pruneMessages", () => {
  const now = new Date("2026-03-31T12:00:00Z");

  it("deletes messages older than the window and keeps the rest", () => {
    const repo = new FakeMessageRepository([
      aged(1, "2026-01-01 09:00:00"),
      aged(2, "2026-03-25 09:00:00"),
      aged(3, "2026-03-30 09:00:00"),
    ]);

    // 30 days back from 2026-03-31 is 2026-03-01: only the January row is older.
    expect(pruneMessages(repo, 30, now)).toBe(1);
    expect(listAllMessages(repo).map((message) => message.id)).toEqual([3, 2]);
  });

  it("deletes a read message and an unread one alike", () => {
    const repo = new FakeMessageRepository([
      { ...aged(1, "2026-01-01 09:00:00"), readAt: "2026-01-02 09:00:00" },
      aged(2, "2026-01-01 09:00:00"),
    ]);

    // Age is the only criterion. An unread message old enough to fall in the
    // window goes with the rest — the purge is housekeeping, not an inbox rule.
    expect(pruneMessages(repo, 30, now)).toBe(2);
    expect(listAllMessages(repo)).toEqual([]);
  });

  it("keeps a message filed exactly at the cutoff", () => {
    const repo = new FakeMessageRepository([aged(1, "2026-03-01 12:00:00")]);

    // Strictly-before: a message filed exactly 30 days ago is 30 days old, not
    // older than 30, so the honest reading of "older than" keeps it.
    expect(pruneMessages(repo, 30, now)).toBe(0);
    expect(listAllMessages(repo)).toHaveLength(1);
  });

  it("returns zero when nothing is old enough", () => {
    const repo = new FakeMessageRepository([aged(1, "2026-03-30 09:00:00")]);

    expect(pruneMessages(repo, 30, now)).toBe(0);
  });

  it("rejects a window of zero days, which would empty the queue", () => {
    // The floor is what stops a mistyped window being read as "delete everything".
    expect(() => pruneMessages(new FakeMessageRepository(), 0, now)).toThrow();
  });

  it("rejects a negative or fractional window", () => {
    expect(() => pruneMessages(new FakeMessageRepository(), -1, now)).toThrow();
    expect(() => pruneMessages(new FakeMessageRepository(), 2.5, now)).toThrow();
  });
});
