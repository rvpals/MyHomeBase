import type Database from "better-sqlite3";
import { userPreferenceSchema } from "./schema";
import type { UserPreference } from "./types";
import type { UserPreferencesRepository } from "./ports";

interface UserPreferenceRow {
  id: number;
  user_id: number;
  preference_key: string;
  preference_value: string;
}

function toDomain(row: UserPreferenceRow): UserPreference {
  return userPreferenceSchema.parse({
    id: row.id,
    userId: row.user_id,
    key: row.preference_key,
    value: row.preference_value,
  });
}

// The real repository. Swap the database without touching any use-case.
export class SqliteUserPreferencesRepository implements UserPreferencesRepository {
  constructor(private db: Database.Database) {}

  listByUserId(userId: number): UserPreference[] {
    const rows = this.db
      .prepare(
        "SELECT id, user_id, preference_key, preference_value FROM sys_user_preferences WHERE user_id = ? ORDER BY preference_key ASC",
      )
      .all(userId) as UserPreferenceRow[];
    return rows.map(toDomain);
  }

  setValue(userId: number, key: string, value: string): void {
    // One upsert per key, riding UNIQUE (user_id, preference_key). The trigger
    // maintains updated_at on the update branch.
    this.db
      .prepare(
        `INSERT INTO sys_user_preferences (user_id, preference_key, preference_value)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, preference_key) DO UPDATE SET preference_value = excluded.preference_value`,
      )
      .run(userId, key, value);
  }

  deleteForUser(userId: number): void {
    this.db.prepare("DELETE FROM sys_user_preferences WHERE user_id = ?").run(userId);
  }
}
