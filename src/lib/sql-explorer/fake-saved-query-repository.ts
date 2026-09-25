import type { SavedQueryRepository } from "./ports";
import type { SavedQuery, SaveQueryInput } from "./types";

/**
 * In-memory SavedQueryRepository for the use-case tests.
 *
 * Hand-written rather than mocked, per ARCHITECTURE.md — it reproduces the one
 * behaviour of the real table the use-cases depend on (UNIQUE (name), so a
 * repeat name replaces), which a call-order mock would not.
 */
export class FakeSavedQueryRepository implements SavedQueryRepository {
  private rows: SavedQuery[] = [];
  private nextId = 1;

  constructor(seed: SavedQuery[] = []) {
    for (const row of seed) {
      this.rows.push(row);
      this.nextId = Math.max(this.nextId, row.id + 1);
    }
  }

  listSavedQueries(): SavedQuery[] {
    return [...this.rows].sort((a, b) => a.name.localeCompare(b.name));
  }

  upsertSavedQuery(input: SaveQueryInput): SavedQuery {
    const existing = this.rows.find((row) => row.name === input.name);
    if (existing) {
      // Keeps id and createdAt, replaces the rest — what ON CONFLICT does.
      const updated: SavedQuery = { ...existing, ...input, updatedAt: "2026-01-02T00:00:00Z" };
      this.rows = this.rows.map((row) => (row.id === existing.id ? updated : row));
      return updated;
    }
    const created: SavedQuery = {
      id: this.nextId++,
      ...input,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    this.rows.push(created);
    return created;
  }

  deleteSavedQuery(id: number): boolean {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => row.id !== id);
    return this.rows.length < before;
  }
}
