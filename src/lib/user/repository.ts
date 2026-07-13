import type Database from "better-sqlite3";
import { userSchema } from "./schema";
import type { User, UserCredentials, UserRole } from "./types";
import type { NewUserRecord, UserRepository } from "./ports";
import { DuplicateGoogleEmailError } from "./user";

interface UserRow {
  id: number;
  username: string;
  full_name: string;
  description: string | null;
  password_hash: string;
  role: UserRole;
  is_disabled: number;
  google_email: string | null;
  created_at: string;
  updated_at: string;
}

function toDomain(row: UserRow): User {
  return userSchema.parse({
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    description: row.description ?? undefined,
    role: row.role,
    isDisabled: row.is_disabled === 1,
    googleEmail: row.google_email ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toCredentials(row: UserRow): UserCredentials {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    isDisabled: row.is_disabled === 1,
  };
}

// The real repository. Swap the database without touching any use-case.
export class SqliteUserRepository implements UserRepository {
  constructor(private db: Database.Database) {}

  listUsers(): User[] {
    const rows = this.db.prepare("SELECT * FROM users ORDER BY username ASC").all() as UserRow[];
    return rows.map(toDomain);
  }

  getUserById(id: number): User | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
    return row ? toDomain(row) : undefined;
  }

  getUserByUsername(username: string): User | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
      | UserRow
      | undefined;
    return row ? toDomain(row) : undefined;
  }

  getUserByGoogleEmail(googleEmail: string): User | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE google_email = ?").get(googleEmail) as
      | UserRow
      | undefined;
    return row ? toDomain(row) : undefined;
  }

  existsByUsername(username: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM users WHERE username = ?").get(username);
    return row !== undefined;
  }

  findCredentialsByUsername(username: string): UserCredentials | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
      | UserRow
      | undefined;
    return row ? toCredentials(row) : undefined;
  }

  createUser(record: NewUserRecord): User {
    const result = this.db
      .prepare(
        `INSERT INTO users (username, full_name, description, password_hash, role)
         VALUES (@username, @fullName, @description, @passwordHash, @role)`,
      )
      .run({
        username: record.username,
        fullName: record.fullName,
        description: record.description ?? null,
        passwordHash: record.passwordHash,
        role: record.role,
      });

    const created = this.getUserById(Number(result.lastInsertRowid));
    if (!created) throw new Error("Failed to read back newly created user.");
    return created;
  }

  setPasswordHash(id: number, passwordHash: string): void {
    this.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
  }

  setRole(id: number, role: UserRole): void {
    this.db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
  }

  setDisabled(id: number, isDisabled: boolean): void {
    this.db.prepare("UPDATE users SET is_disabled = ? WHERE id = ?").run(isDisabled ? 1 : 0, id);
  }

  setGoogleEmail(id: number, googleEmail: string | undefined): void {
    try {
      this.db
        .prepare("UPDATE users SET google_email = ? WHERE id = ?")
        .run(googleEmail ?? null, id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("UNIQUE constraint failed") && googleEmail) {
        throw new DuplicateGoogleEmailError(googleEmail);
      }
      throw error;
    }
  }

  deleteUser(id: number): void {
    // Session cleanup for the deleted user is the caller's job (see
    // invalidateSessionsForUser in src/lib/auth) — sessions is that
    // module's table, not this one's.
    const deleteUserTransaction = this.db.transaction((userId: number) => {
      this.db.prepare("DELETE FROM user_module_access WHERE user_id = ?").run(userId);
      this.db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    });
    deleteUserTransaction(id);
  }

  getAccessibleModuleIds(userId: number): number[] {
    const rows = this.db
      .prepare("SELECT module_id FROM user_module_access WHERE user_id = ?")
      .all(userId) as { module_id: number }[];
    return rows.map((row) => row.module_id);
  }

  setAccessibleModuleIds(userId: number, moduleIds: number[]): void {
    const insert = this.db.prepare(
      "INSERT INTO user_module_access (user_id, module_id) VALUES (?, ?)",
    );
    const applyGrants = this.db.transaction((ids: number[]) => {
      this.db.prepare("DELETE FROM user_module_access WHERE user_id = ?").run(userId);
      for (const moduleId of ids) insert.run(userId, moduleId);
    });
    applyGrants(moduleIds);
  }
}
