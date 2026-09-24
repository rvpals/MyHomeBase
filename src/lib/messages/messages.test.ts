import { describe, expect, it } from "vitest";
import { FakeMessageRepository } from "./fakes";
import {
  countMessages,
  createMessage,
  getMessage,
  getMessageQueue,
  listMessages,
  markAllMessagesRead,
  markMessagesRead,
} from "./messages";
import { createMessageSchema, markMessagesReadSchema, MESSAGE_TITLE_MAX } from "./schema";

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
