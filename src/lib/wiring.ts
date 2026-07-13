// Composition root: builds real dependencies (repositories, clients) and hands them
// to use-cases. Both src/app and src/cli import `deps` from here — never construct a
// repository directly in a presentation file.
import path from "node:path";
import Database from "better-sqlite3";
import { SqliteModuleSettingsRepository } from "./module-settings/repository";
import { SqliteModuleRepository } from "./modules/repository";
import { SqliteSettingsRepository } from "./settings/repository";

const dbPath = process.env.MYHOMEBASE_DB ?? path.join(process.cwd(), "data", "myhomebase.db");

// Cache the connection on globalThis so Next.js dev-mode hot reloads reuse it
// instead of opening a new file handle on every module reload.
const globalForDb = globalThis as unknown as { __myhomebaseDb?: Database.Database };

const db =
  globalForDb.__myhomebaseDb ??
  (() => {
    const connection = new Database(dbPath);
    connection.pragma("journal_mode = WAL");
    return connection;
  })();

globalForDb.__myhomebaseDb = db;

export const deps = {
  moduleRepo: new SqliteModuleRepository(db),
  settingsRepo: new SqliteSettingsRepository(db),
  moduleSettingsRepo: new SqliteModuleSettingsRepository(db),
};
