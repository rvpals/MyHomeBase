import { describe, expect, it } from "vitest";
import type { Module } from "@/lib/modules";
import { hashPassword } from "@/lib/shared/password";
import type { NewUserRecord, UserRepository } from "./ports";
import type { User, UserCredentials, UserRole } from "./types";
import {
  DuplicateGoogleEmailError,
  DuplicateUsernameError,
  SelfLockoutError,
  createUser,
  deleteUser,
  getAccessibleModules,
  getUserByGoogleEmail,
  isAdmin,
  setUserDisabled,
  setUserGoogleEmail,
  setUserModuleAccess,
  setUserPassword,
  setUserRole,
  userHasModuleAccess,
  verifyCredentials,
} from "./user";

class FakeUserRepository implements UserRepository {
  private users: (User & { passwordHash: string })[] = [];
  private accessByUserId = new Map<number, Set<number>>();
  private nextId = 1;

  seed(user: Omit<User, "id" | "createdAt" | "updatedAt">, passwordHash: string): User {
    const created: User & { passwordHash: string } = {
      ...user,
      id: this.nextId++,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      passwordHash,
    };
    this.users.push(created);
    return created;
  }

  listUsers(): User[] {
    return this.users.map(({ passwordHash: _unused, ...user }) => user);
  }

  getUserById(id: number): User | undefined {
    const found = this.users.find((user) => user.id === id);
    if (!found) return undefined;
    const { passwordHash: _unused, ...user } = found;
    return user;
  }

  getUserByUsername(username: string): User | undefined {
    const found = this.users.find((user) => user.username === username);
    if (!found) return undefined;
    const { passwordHash: _unused, ...user } = found;
    return user;
  }

  getUserByGoogleEmail(googleEmail: string): User | undefined {
    const found = this.users.find((user) => user.googleEmail === googleEmail);
    if (!found) return undefined;
    const { passwordHash: _unused, ...user } = found;
    return user;
  }

  existsByUsername(username: string): boolean {
    return this.users.some((user) => user.username === username);
  }

  findCredentialsByUsername(username: string): UserCredentials | undefined {
    const found = this.users.find((user) => user.username === username);
    if (!found) return undefined;
    return {
      id: found.id,
      username: found.username,
      passwordHash: found.passwordHash,
      role: found.role,
      isDisabled: found.isDisabled,
    };
  }

  createUser(record: NewUserRecord): User {
    return this.seed(
      {
        username: record.username,
        fullName: record.fullName,
        description: record.description,
        role: record.role,
        isDisabled: false,
      },
      record.passwordHash,
    );
  }

  setPasswordHash(id: number, passwordHash: string): void {
    const found = this.users.find((user) => user.id === id);
    if (found) found.passwordHash = passwordHash;
  }

  setRole(id: number, role: UserRole): void {
    const found = this.users.find((user) => user.id === id);
    if (found) found.role = role;
  }

  setDisabled(id: number, isDisabled: boolean): void {
    const found = this.users.find((user) => user.id === id);
    if (found) found.isDisabled = isDisabled;
  }

  setGoogleEmail(id: number, googleEmail: string | undefined): void {
    if (googleEmail && this.users.some((user) => user.id !== id && user.googleEmail === googleEmail)) {
      throw new DuplicateGoogleEmailError(googleEmail);
    }
    const found = this.users.find((user) => user.id === id);
    if (found) found.googleEmail = googleEmail;
  }

  deleteUser(id: number): void {
    this.users = this.users.filter((user) => user.id !== id);
    this.accessByUserId.delete(id);
  }

  getAccessibleModuleIds(userId: number): number[] {
    return Array.from(this.accessByUserId.get(userId) ?? []);
  }

  setAccessibleModuleIds(userId: number, moduleIds: number[]): void {
    this.accessByUserId.set(userId, new Set(moduleIds));
  }
}

function makeModule(id: number, slug: string): Module {
  return {
    id,
    slug,
    shortName: slug,
    longName: slug,
    sequence: id,
    isVisible: true,
    icon: "home",
  };
}

describe("createUser", () => {
  it("creates a user with a hashed password", () => {
    const repo = new FakeUserRepository();
    const user = createUser(
      { username: "alice", fullName: "Alice Admin", password: "supersecret", role: "admin" },
      repo,
    );
    expect(user.username).toBe("alice");
    expect(repo.findCredentialsByUsername("alice")?.passwordHash).not.toBe("supersecret");
  });

  it("rejects a duplicate username", () => {
    const repo = new FakeUserRepository();
    createUser({ username: "alice", fullName: "Alice", password: "supersecret", role: "user" }, repo);
    expect(() =>
      createUser({ username: "alice", fullName: "Alice 2", password: "supersecret", role: "user" }, repo),
    ).toThrow(DuplicateUsernameError);
  });
});

describe("verifyCredentials", () => {
  it("returns the user when the password matches", () => {
    const repo = new FakeUserRepository();
    repo.seed(
      { username: "bob", fullName: "Bob", role: "user", isDisabled: false },
      hashPassword("correct-password"),
    );
    const result = verifyCredentials({ username: "bob", password: "correct-password" }, repo);
    expect(result?.username).toBe("bob");
  });

  it("returns undefined for a wrong password", () => {
    const repo = new FakeUserRepository();
    repo.seed(
      { username: "bob", fullName: "Bob", role: "user", isDisabled: false },
      hashPassword("correct-password"),
    );
    expect(verifyCredentials({ username: "bob", password: "wrong" }, repo)).toBeUndefined();
  });

  it("returns undefined for a disabled account even with the correct password", () => {
    const repo = new FakeUserRepository();
    repo.seed(
      { username: "bob", fullName: "Bob", role: "user", isDisabled: true },
      hashPassword("correct-password"),
    );
    expect(verifyCredentials({ username: "bob", password: "correct-password" }, repo)).toBeUndefined();
  });
});

describe("self-lockout guards", () => {
  it("prevents an admin from demoting themselves", () => {
    const repo = new FakeUserRepository();
    const admin = repo.seed(
      { username: "admin", fullName: "Admin", role: "admin", isDisabled: false },
      hashPassword("x"),
    );
    expect(() => setUserRole(admin.id, admin.id, "user", repo)).toThrow(SelfLockoutError);
  });

  it("prevents an admin from disabling themselves", () => {
    const repo = new FakeUserRepository();
    const admin = repo.seed(
      { username: "admin", fullName: "Admin", role: "admin", isDisabled: false },
      hashPassword("x"),
    );
    expect(() => setUserDisabled(admin.id, admin.id, true, repo)).toThrow(SelfLockoutError);
  });

  it("prevents an admin from deleting themselves", () => {
    const repo = new FakeUserRepository();
    const admin = repo.seed(
      { username: "admin", fullName: "Admin", role: "admin", isDisabled: false },
      hashPassword("x"),
    );
    expect(() => deleteUser(admin.id, admin.id, repo)).toThrow(SelfLockoutError);
  });

  it("allows an admin to change their own password", () => {
    const repo = new FakeUserRepository();
    const admin = repo.seed(
      { username: "admin", fullName: "Admin", role: "admin", isDisabled: false },
      hashPassword("x"),
    );
    expect(() => setUserPassword(admin.id, { password: "new-password" }, repo)).not.toThrow();
  });
});

describe("getAccessibleModules / userHasModuleAccess", () => {
  const modules = [makeModule(1, "real-estate"), makeModule(2, "stock-etfs")];

  it("gives an admin every module, granted or not", () => {
    const repo = new FakeUserRepository();
    const admin = repo.seed(
      { username: "admin", fullName: "Admin", role: "admin", isDisabled: false },
      hashPassword("x"),
    );
    expect(isAdmin(admin)).toBe(true);
    expect(getAccessibleModules(admin, modules, repo)).toHaveLength(2);
    expect(userHasModuleAccess(admin, 999, repo)).toBe(true);
  });

  it("gives a regular user only their granted modules", () => {
    const repo = new FakeUserRepository();
    const user = repo.seed(
      { username: "bob", fullName: "Bob", role: "user", isDisabled: false },
      hashPassword("x"),
    );
    expect(getAccessibleModules(user, modules, repo)).toHaveLength(0);

    setUserModuleAccess(user.id, [1], repo);
    const accessible = getAccessibleModules(user, modules, repo);
    expect(accessible.map((module) => module.slug)).toEqual(["real-estate"]);
    expect(userHasModuleAccess(user, 1, repo)).toBe(true);
    expect(userHasModuleAccess(user, 2, repo)).toBe(false);
  });
});

describe("setUserGoogleEmail / getUserByGoogleEmail", () => {
  it("links a Google email that can then be looked up", () => {
    const repo = new FakeUserRepository();
    const user = repo.seed(
      { username: "bob", fullName: "Bob", role: "user", isDisabled: false },
      hashPassword("x"),
    );
    setUserGoogleEmail(user.id, { googleEmail: "bob@example.com" }, repo);
    expect(getUserByGoogleEmail("bob@example.com", repo)?.id).toBe(user.id);
  });

  it("rejects linking the same Google email to a second user", () => {
    const repo = new FakeUserRepository();
    const bob = repo.seed(
      { username: "bob", fullName: "Bob", role: "user", isDisabled: false },
      hashPassword("x"),
    );
    const alice = repo.seed(
      { username: "alice", fullName: "Alice", role: "user", isDisabled: false },
      hashPassword("x"),
    );
    setUserGoogleEmail(bob.id, { googleEmail: "shared@example.com" }, repo);
    expect(() =>
      setUserGoogleEmail(alice.id, { googleEmail: "shared@example.com" }, repo),
    ).toThrow(DuplicateGoogleEmailError);
  });

  it("unlinks a Google email when given undefined", () => {
    const repo = new FakeUserRepository();
    const user = repo.seed(
      { username: "bob", fullName: "Bob", role: "user", isDisabled: false },
      hashPassword("x"),
    );
    setUserGoogleEmail(user.id, { googleEmail: "bob@example.com" }, repo);
    setUserGoogleEmail(user.id, {}, repo);
    expect(getUserByGoogleEmail("bob@example.com", repo)).toBeUndefined();
  });
});
