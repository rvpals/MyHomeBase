import { describe, expect, it } from "vitest";
import type { AuthEvent, AuthEventFilter, AuthEventRepository, AuthEventSummary, NewAuthEvent } from "@/lib/auth-events";
import { hashPassword } from "@/lib/shared/password";
import type { NewUserRecord, UserRepository } from "@/lib/user";
import type { User, UserCredentials, UserRole } from "@/lib/user";
import type { GoogleOAuthClient, GoogleUserInfo, SessionRepository } from "./ports";
import type { Session } from "./types";
import { completeGoogleLogin, getCurrentUser, invalidateSessionsForUser, login, logout } from "./auth";

/**
 * Minimal recorder — only `recordEvent` is exercised here; the read side is covered by
 * `src/lib/auth-events/auth-events.test.ts`.
 */
class FakeAuthEventRepository implements AuthEventRepository {
  events: NewAuthEvent[] = [];

  recordEvent(event: NewAuthEvent): void {
    this.events.push(event);
  }

  listEvents(_filter: AuthEventFilter): AuthEvent[] {
    return [];
  }

  getSummary(): AuthEventSummary {
    return { totalFailures: 0, unreviewedFailures: 0, totalSuccesses: 0 };
  }

  markFailuresReviewed(): void {}

  deleteEventsBefore(): number {
    return 0;
  }
}

class FakeUserRepository implements UserRepository {
  private users: (User & { passwordHash: string })[] = [];
  private nextId = 1;

  seed(user: Omit<User, "id" | "createdAt" | "updatedAt">, passwordHash: string): User {
    const created = {
      ...user,
      id: this.nextId++,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      passwordHash,
    };
    this.users.push(created);
    const { passwordHash: _unused, ...publicUser } = created;
    return publicUser;
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

  deleteUser(id: number): void {
    this.users = this.users.filter((user) => user.id !== id);
  }

  setGoogleEmail(id: number, googleEmail: string | undefined): void {
    const found = this.users.find((user) => user.id === id);
    if (found) found.googleEmail = googleEmail;
  }

  getAccessibleModuleIds(): number[] {
    return [];
  }

  setAccessibleModuleIds(): void {}

  getAvatar(): undefined {
    return undefined;
  }

  setAvatar(): void {}

  setLastLoginAt(id: number, timestamp: string): void {
    const user = this.users.find((candidate) => candidate.id === id);
    if (user) user.lastLoginAt = timestamp;
  }
}

class FakeGoogleOAuthClient implements GoogleOAuthClient {
  constructor(private userInfo: GoogleUserInfo) {}

  getAuthorizationUrl(state: string): string {
    return `https://accounts.google.com/fake?state=${state}`;
  }

  async exchangeCodeForUserInfo(): Promise<GoogleUserInfo> {
    return this.userInfo;
  }
}

class FakeSessionRepository implements SessionRepository {
  private sessions: Session[] = [];
  private nextId = 1;

  createSession(userId: number, expiresAt: string): Session {
    const session: Session = {
      id: `session-${this.nextId++}`,
      userId,
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt,
    };
    this.sessions.push(session);
    return session;
  }

  getSessionById(id: string): Session | undefined {
    return this.sessions.find((session) => session.id === id);
  }

  deleteSession(id: string): void {
    this.sessions = this.sessions.filter((session) => session.id !== id);
  }

  deleteSessionsForUser(userId: number): void {
    this.sessions = this.sessions.filter((session) => session.userId !== userId);
  }
}

describe("login", () => {
  it("creates a session on a correct password", () => {
    const userRepo = new FakeUserRepository();
    const sessionRepo = new FakeSessionRepository();
    userRepo.seed(
      { username: "bob", fullName: "Bob", role: "user", isDisabled: false },
      hashPassword("correct-password"),
    );

    const result = login({ username: "bob", password: "correct-password" }, userRepo, sessionRepo);
    expect(result?.user.username).toBe("bob");
    expect(sessionRepo.getSessionById(result!.session.id)).toBeDefined();
  });

  it("returns undefined for a wrong password", () => {
    const userRepo = new FakeUserRepository();
    const sessionRepo = new FakeSessionRepository();
    userRepo.seed(
      { username: "bob", fullName: "Bob", role: "user", isDisabled: false },
      hashPassword("correct-password"),
    );

    expect(login({ username: "bob", password: "wrong" }, userRepo, sessionRepo)).toBeUndefined();
  });

  it("returns undefined for a disabled user", () => {
    const userRepo = new FakeUserRepository();
    const sessionRepo = new FakeSessionRepository();
    userRepo.seed(
      { username: "bob", fullName: "Bob", role: "user", isDisabled: true },
      hashPassword("correct-password"),
    );

    expect(
      login({ username: "bob", password: "correct-password" }, userRepo, sessionRepo),
    ).toBeUndefined();
  });
});

// The audit trail is optional, so every test above proves `login` still works without
// it. These prove that when it IS supplied, the reason reaches the log even though the
// caller still receives a bare `undefined` — see migrations/0045.
describe("login auditing", () => {
  function setup() {
    const userRepo = new FakeUserRepository();
    const sessionRepo = new FakeSessionRepository();
    const authEventRepo = new FakeAuthEventRepository();
    const user = userRepo.seed(
      { username: "bob", fullName: "Bob", role: "user", isDisabled: false },
      hashPassword("correct-password"),
    );
    return { userRepo, sessionRepo, authEventRepo, user };
  }

  const audit = (repo: FakeAuthEventRepository) => ({
    repo,
    context: { ipAddress: "10.0.0.5", userAgent: "TestAgent/1.0" },
  });

  it("records a success with the user and the request metadata", () => {
    const { userRepo, sessionRepo, authEventRepo, user } = setup();

    login({ username: "bob", password: "correct-password" }, userRepo, sessionRepo, audit(authEventRepo));

    expect(authEventRepo.events).toHaveLength(1);
    expect(authEventRepo.events[0]).toMatchObject({
      eventType: "login_success",
      attemptedUsername: "bob",
      userId: user.id,
      ipAddress: "10.0.0.5",
      userAgent: "TestAgent/1.0",
    });
  });

  it("stamps last_login_at on a success", () => {
    const { userRepo, sessionRepo, authEventRepo, user } = setup();

    login({ username: "bob", password: "correct-password" }, userRepo, sessionRepo, audit(authEventRepo));

    expect(userRepo.getUserById(user.id)?.lastLoginAt).toBeDefined();
  });

  it("records a wrong password as bad_password, with the account it was aimed at", () => {
    const { userRepo, sessionRepo, authEventRepo, user } = setup();

    const result = login({ username: "bob", password: "wrong" }, userRepo, sessionRepo, audit(authEventRepo));

    // The caller learns nothing; the log learns everything.
    expect(result).toBeUndefined();
    expect(authEventRepo.events[0]).toMatchObject({
      eventType: "login_failure",
      failureReason: "bad_password",
      attemptedUsername: "bob",
      userId: user.id,
    });
  });

  it("records an unknown username as unknown_user with no account", () => {
    const { userRepo, sessionRepo, authEventRepo } = setup();

    login({ username: "nobody", password: "whatever" }, userRepo, sessionRepo, audit(authEventRepo));

    expect(authEventRepo.events[0]).toMatchObject({
      failureReason: "unknown_user",
      attemptedUsername: "nobody",
    });
    expect(authEventRepo.events[0].userId).toBeUndefined();
  });

  it("distinguishes a disabled account from a wrong password", () => {
    const userRepo = new FakeUserRepository();
    const sessionRepo = new FakeSessionRepository();
    const authEventRepo = new FakeAuthEventRepository();
    userRepo.seed(
      { username: "gone", fullName: "Gone", role: "user", isDisabled: true },
      hashPassword("correct-password"),
    );

    login({ username: "gone", password: "correct-password" }, userRepo, sessionRepo, audit(authEventRepo));

    expect(authEventRepo.events[0].failureReason).toBe("account_disabled");
  });

  it("records a schema failure as invalid_input and still throws", () => {
    const { userRepo, sessionRepo, authEventRepo } = setup();

    expect(() =>
      login({ username: "", password: "" }, userRepo, sessionRepo, audit(authEventRepo)),
    ).toThrow();

    expect(authEventRepo.events[0]).toMatchObject({
      eventType: "login_failure",
      failureReason: "invalid_input",
    });
  });

  it("records nothing when no audit trail is supplied", () => {
    const { userRepo, sessionRepo, authEventRepo } = setup();

    login({ username: "bob", password: "correct-password" }, userRepo, sessionRepo);

    expect(authEventRepo.events).toHaveLength(0);
  });

  it("records a logout against the user who was signed in", () => {
    const { userRepo, sessionRepo, authEventRepo, user } = setup();
    const result = login(
      { username: "bob", password: "correct-password" },
      userRepo,
      sessionRepo,
      audit(authEventRepo),
    );

    logout(result!.session.id, sessionRepo, { repo: authEventRepo, userId: user.id });

    expect(authEventRepo.events.at(-1)).toMatchObject({ eventType: "logout", userId: user.id });
  });
});

describe("getCurrentUser", () => {
  it("resolves a valid session to its user", () => {
    const userRepo = new FakeUserRepository();
    const sessionRepo = new FakeSessionRepository();
    const user = userRepo.seed(
      { username: "bob", fullName: "Bob", role: "user", isDisabled: false },
      hashPassword("x"),
    );
    const session = sessionRepo.createSession(user.id, new Date(Date.now() + 10_000).toISOString());

    expect(getCurrentUser(session.id, sessionRepo, userRepo)?.username).toBe("bob");
  });

  it("returns undefined and deletes an expired session", () => {
    const userRepo = new FakeUserRepository();
    const sessionRepo = new FakeSessionRepository();
    const user = userRepo.seed(
      { username: "bob", fullName: "Bob", role: "user", isDisabled: false },
      hashPassword("x"),
    );
    const session = sessionRepo.createSession(user.id, new Date(Date.now() - 10_000).toISOString());

    expect(getCurrentUser(session.id, sessionRepo, userRepo)).toBeUndefined();
    expect(sessionRepo.getSessionById(session.id)).toBeUndefined();
  });

  it("returns undefined for a missing session id", () => {
    const userRepo = new FakeUserRepository();
    const sessionRepo = new FakeSessionRepository();
    expect(getCurrentUser(undefined, sessionRepo, userRepo)).toBeUndefined();
    expect(getCurrentUser("nonexistent", sessionRepo, userRepo)).toBeUndefined();
  });
});

describe("logout / invalidateSessionsForUser", () => {
  it("logout removes just the one session", () => {
    const userRepo = new FakeUserRepository();
    const sessionRepo = new FakeSessionRepository();
    const user = userRepo.seed(
      { username: "bob", fullName: "Bob", role: "user", isDisabled: false },
      hashPassword("x"),
    );
    const session = sessionRepo.createSession(user.id, new Date(Date.now() + 10_000).toISOString());

    logout(session.id, sessionRepo);
    expect(sessionRepo.getSessionById(session.id)).toBeUndefined();
  });

  it("invalidateSessionsForUser removes every session for that user", () => {
    const userRepo = new FakeUserRepository();
    const sessionRepo = new FakeSessionRepository();
    const user = userRepo.seed(
      { username: "bob", fullName: "Bob", role: "user", isDisabled: false },
      hashPassword("x"),
    );
    const sessionA = sessionRepo.createSession(user.id, new Date(Date.now() + 10_000).toISOString());
    const sessionB = sessionRepo.createSession(user.id, new Date(Date.now() + 10_000).toISOString());

    invalidateSessionsForUser(user.id, sessionRepo);
    expect(sessionRepo.getSessionById(sessionA.id)).toBeUndefined();
    expect(sessionRepo.getSessionById(sessionB.id)).toBeUndefined();
  });
});

describe("completeGoogleLogin", () => {
  it("creates a session when the verified email is linked to an enabled user", async () => {
    const userRepo = new FakeUserRepository();
    const sessionRepo = new FakeSessionRepository();
    const user = userRepo.seed(
      { username: "bob", fullName: "Bob", role: "user", isDisabled: false, googleEmail: "bob@example.com" },
      hashPassword("x"),
    );
    const googleClient = new FakeGoogleOAuthClient({ email: "bob@example.com", emailVerified: true });

    const result = await completeGoogleLogin("some-code", googleClient, userRepo, sessionRepo);
    if (!result.ok) throw new Error("expected success");
    expect(result.user.id).toBe(user.id);
    expect(sessionRepo.getSessionById(result.session.id)).toBeDefined();
  });

  it("auto-creates a user-role account for a verified email with no existing link", async () => {
    const userRepo = new FakeUserRepository();
    const sessionRepo = new FakeSessionRepository();
    const googleClient = new FakeGoogleOAuthClient({
      email: "stranger@example.com",
      emailVerified: true,
      name: "Stranger Person",
    });

    const result = await completeGoogleLogin("some-code", googleClient, userRepo, sessionRepo);
    if (!result.ok) throw new Error("expected success");
    expect(result.user.role).toBe("user");
    expect(result.user.fullName).toBe("Stranger Person");
    expect(result.user.googleEmail).toBe("stranger@example.com");
    expect(sessionRepo.getSessionById(result.session.id)).toBeDefined();
  });

  it("signs the same auto-created account back in on a second visit rather than creating another", async () => {
    const userRepo = new FakeUserRepository();
    const sessionRepo = new FakeSessionRepository();
    const googleClient = new FakeGoogleOAuthClient({ email: "stranger@example.com", emailVerified: true });

    const first = await completeGoogleLogin("code-1", googleClient, userRepo, sessionRepo);
    const second = await completeGoogleLogin("code-2", googleClient, userRepo, sessionRepo);
    if (!first.ok || !second.ok) throw new Error("expected success");
    expect(second.user.id).toBe(first.user.id);
    expect(userRepo.listUsers()).toHaveLength(1);
  });

  it("rejects an unverified email even if it's linked", async () => {
    const userRepo = new FakeUserRepository();
    const sessionRepo = new FakeSessionRepository();
    userRepo.seed(
      { username: "bob", fullName: "Bob", role: "user", isDisabled: false, googleEmail: "bob@example.com" },
      hashPassword("x"),
    );
    const googleClient = new FakeGoogleOAuthClient({ email: "bob@example.com", emailVerified: false });

    const result = await completeGoogleLogin("some-code", googleClient, userRepo, sessionRepo);
    expect(result).toEqual({ ok: false, reason: "unverified_email" });
  });

  it("rejects a linked but disabled user without re-enabling them", async () => {
    const userRepo = new FakeUserRepository();
    const sessionRepo = new FakeSessionRepository();
    userRepo.seed(
      { username: "bob", fullName: "Bob", role: "user", isDisabled: true, googleEmail: "bob@example.com" },
      hashPassword("x"),
    );
    const googleClient = new FakeGoogleOAuthClient({ email: "bob@example.com", emailVerified: true });

    const result = await completeGoogleLogin("some-code", googleClient, userRepo, sessionRepo);
    expect(result).toEqual({ ok: false, reason: "account_disabled" });
  });
});
