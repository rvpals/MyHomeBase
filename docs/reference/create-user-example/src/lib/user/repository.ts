import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { User } from "./types.js";
import type { UserRepository } from "./ports.js";

// A real repository. Swap this for Postgres/Oracle/etc. without touching the use-case.
// Backed by a JSON file here so the UI path and the CLI path visibly share one store.
export class JsonFileUserRepository implements UserRepository {
  constructor(private path: string) {}

  private async load(): Promise<User[]> {
    if (!existsSync(this.path)) return [];
    return JSON.parse(await readFile(this.path, "utf8")) as User[];
  }

  async existsByEmail(email: string): Promise<boolean> {
    return (await this.load()).some((u) => u.email === email);
  }

  async save(user: User): Promise<void> {
    const users = await this.load();
    users.push(user);
    await writeFile(this.path, JSON.stringify(users, null, 2));
  }
}
