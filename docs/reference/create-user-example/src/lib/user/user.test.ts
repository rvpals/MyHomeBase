import { describe, it, expect } from "vitest";
import { createUser, EmailTakenError } from "./user.js";
import type { User } from "./types.js";
import type { UserRepository } from "./ports.js";

// Hand-written fake — no mocking framework, reusable across tests.
function fakeRepo(seed: User[] = []): UserRepository & { saved: User[] } {
  const saved = [...seed];
  return {
    saved,
    async existsByEmail(email) { return saved.some((u) => u.email === email); },
    async save(u) { saved.push(u); },
  };
}

describe("createUser", () => {
  it("creates a user and hashes the password", async () => {
    const repo = fakeRepo();
    const user = await createUser(
      { email: "a@b.com", name: "Alice", password: "secret123" }, repo,
    );
    expect(user.email).toBe("a@b.com");
    expect(user.passwordHash).not.toContain("secret123"); // never store plaintext
    expect(repo.saved).toHaveLength(1);
  });

  it("rejects a duplicate email", async () => {
    const repo = fakeRepo([
      { id: "1", email: "a@b.com", name: "A", passwordHash: "x", createdAt: "" },
    ]);
    await expect(
      createUser({ email: "a@b.com", name: "Alice", password: "secret123" }, repo),
    ).rejects.toBeInstanceOf(EmailTakenError);
  });

  it("rejects invalid input via the shared schema", async () => {
    const repo = fakeRepo();
    await expect(
      createUser({ email: "not-an-email", name: "Alice", password: "secret123" } as any, repo),
    ).rejects.toThrow();
  });
});
