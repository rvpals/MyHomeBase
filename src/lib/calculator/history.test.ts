import { describe, expect, it } from "vitest";
import {
  calculateAndRecord,
  clearCalculations,
  listCalculations,
  recordCalculation,
} from "./history";
import type { CalculatorHistoryRepository } from "./ports";
import { HISTORY_LIMIT } from "./schema";
import type { CalculationEntry } from "./types";

/**
 * An in-memory tape.
 *
 * A hand-written fake rather than a mocking framework, per ARCHITECTURE.md — it is
 * readable, reusable across these tests, and doesn't couple them to call order. It
 * reproduces the two behaviours the real repository is responsible for: newest-first
 * ordering by id, and the per-user cap.
 */
class FakeHistoryRepository implements CalculatorHistoryRepository {
  private rows: (CalculationEntry & { userId: number })[] = [];
  private nextId = 1;

  record(userId: number, expression: string, result: string): CalculationEntry {
    const entry: CalculationEntry = {
      id: this.nextId,
      expression,
      result,
      createdAt: "2026-09-15T12:00:00Z",
    };
    this.nextId += 1;
    this.rows.push({ ...entry, userId });

    // The cap, per user, exactly as the SQL prune does.
    const mine = this.rows.filter((row) => row.userId === userId).sort((a, b) => b.id - a.id);
    const keep = new Set(mine.slice(0, HISTORY_LIMIT).map((row) => row.id));
    this.rows = this.rows.filter((row) => row.userId !== userId || keep.has(row.id));

    return entry;
  }

  list(userId: number, limit: number): CalculationEntry[] {
    return this.rows
      .filter((row) => row.userId === userId)
      .sort((a, b) => b.id - a.id)
      .slice(0, limit)
      // The stored row carries `userId`; a `CalculationEntry` does not, so it is
      // dropped rather than leaked to a caller.
      .map((row) => ({
        id: row.id,
        expression: row.expression,
        result: row.result,
        createdAt: row.createdAt,
      }));
  }

  clear(userId: number): void {
    this.rows = this.rows.filter((row) => row.userId !== userId);
  }

  countAll(): number {
    return this.rows.length;
  }
}

describe("recordCalculation", () => {
  it("stores a calculation and returns it", () => {
    const repo = new FakeHistoryRepository();
    const entry = recordCalculation(repo, 7, { expression: "2+2", result: "4" });
    expect(entry).toMatchObject({ expression: "2+2", result: "4" });
    expect(listCalculations(repo, 7)).toHaveLength(1);
  });

  it("trims whitespace at the boundary", () => {
    const repo = new FakeHistoryRepository();
    const entry = recordCalculation(repo, 7, { expression: "  2+2  ", result: " 4 " });
    expect(entry.expression).toBe("2+2");
    expect(entry.result).toBe("4");
  });

  it("refuses a blank expression", () => {
    const repo = new FakeHistoryRepository();
    expect(() => recordCalculation(repo, 7, { expression: "", result: "4" })).toThrow();
    expect(() => recordCalculation(repo, 7, { expression: "   ", result: "4" })).toThrow();
  });

  it("refuses a blank result", () => {
    const repo = new FakeHistoryRepository();
    expect(() => recordCalculation(repo, 7, { expression: "2+2", result: "" })).toThrow();
  });

  it("refuses an expression longer than the cap", () => {
    const repo = new FakeHistoryRepository();
    expect(() =>
      recordCalculation(repo, 7, { expression: "1+".repeat(300), result: "4" }),
    ).toThrow();
  });
});

describe("listCalculations", () => {
  it("returns newest first", () => {
    const repo = new FakeHistoryRepository();
    recordCalculation(repo, 7, { expression: "1+1", result: "2" });
    recordCalculation(repo, 7, { expression: "2+2", result: "4" });
    expect(listCalculations(repo, 7).map((entry) => entry.expression)).toEqual(["2+2", "1+1"]);
  });

  it("keeps users' tapes separate", () => {
    // A calculator tape is private working-out, not a shared board.
    const repo = new FakeHistoryRepository();
    recordCalculation(repo, 7, { expression: "1+1", result: "2" });
    expect(listCalculations(repo, 8)).toEqual([]);
  });

  it("clamps a limit above the cap", () => {
    const repo = new FakeHistoryRepository();
    for (let index = 0; index < 5; index += 1) {
      recordCalculation(repo, 7, { expression: `${index}+1`, result: String(index + 1) });
    }
    // A hand-rolled request asking for a million rows gets the cap, not a million.
    expect(listCalculations(repo, 7, 1_000_000).length).toBeLessThanOrEqual(HISTORY_LIMIT);
  });

  it("clamps a nonsensical limit to at least one", () => {
    const repo = new FakeHistoryRepository();
    recordCalculation(repo, 7, { expression: "1+1", result: "2" });
    expect(listCalculations(repo, 7, 0)).toHaveLength(1);
    expect(listCalculations(repo, 7, -5)).toHaveLength(1);
  });
});

describe("the per-user cap", () => {
  it("keeps only the newest HISTORY_LIMIT calculations", () => {
    const repo = new FakeHistoryRepository();
    for (let index = 0; index < HISTORY_LIMIT + 10; index += 1) {
      recordCalculation(repo, 7, { expression: `${index}+0`, result: String(index) });
    }
    const tape = listCalculations(repo, 7);
    expect(tape).toHaveLength(HISTORY_LIMIT);
    // The newest survived and the oldest went.
    expect(tape[0].expression).toBe(`${HISTORY_LIMIT + 9}+0`);
    expect(tape.some((entry) => entry.expression === "0+0")).toBe(false);
  });

  it("caps each user independently", () => {
    const repo = new FakeHistoryRepository();
    for (let index = 0; index < HISTORY_LIMIT + 5; index += 1) {
      recordCalculation(repo, 7, { expression: `${index}+0`, result: String(index) });
    }
    recordCalculation(repo, 8, { expression: "9+9", result: "18" });
    // One reader filling their tape must not evict another's.
    expect(listCalculations(repo, 8)).toHaveLength(1);
    expect(listCalculations(repo, 7)).toHaveLength(HISTORY_LIMIT);
  });
});

describe("clearCalculations", () => {
  it("wipes one user's tape and nobody else's", () => {
    const repo = new FakeHistoryRepository();
    recordCalculation(repo, 7, { expression: "1+1", result: "2" });
    recordCalculation(repo, 8, { expression: "2+2", result: "4" });

    clearCalculations(repo, 7);

    expect(listCalculations(repo, 7)).toEqual([]);
    expect(listCalculations(repo, 8)).toHaveLength(1);
  });
});

describe("calculateAndRecord", () => {
  it("evaluates and records in one call", () => {
    const repo = new FakeHistoryRepository();
    const outcome = calculateAndRecord(repo, 7, { expression: "6*7" });
    expect(outcome).toMatchObject({ ok: true, result: "42" });
    expect(listCalculations(repo, 7)[0]).toMatchObject({ expression: "6*7", result: "42" });
  });

  it("defaults to degrees", () => {
    const repo = new FakeHistoryRepository();
    expect(calculateAndRecord(repo, 7, { expression: "sin(90)" })).toMatchObject({
      ok: true,
      result: "1",
    });
  });

  it("honours an explicit angle mode", () => {
    const repo = new FakeHistoryRepository();
    const outcome = calculateAndRecord(repo, 7, { expression: "sin(90)", angleMode: "rad" });
    expect(outcome).toMatchObject({ ok: true });
    if (outcome.ok) expect(outcome.result).not.toBe("1");
  });

  it("does not record a failed expression", () => {
    // The tape is a record of results; a syntax error has none.
    const repo = new FakeHistoryRepository();
    const outcome = calculateAndRecord(repo, 7, { expression: "1/0" });
    expect(outcome.ok).toBe(false);
    expect(repo.countAll()).toBe(0);
  });

  it("corrects an unrecognised angle mode rather than rejecting the calculation", () => {
    const repo = new FakeHistoryRepository();
    const outcome = calculateAndRecord(repo, 7, {
      expression: "1+1",
      angleMode: "gradians" as "deg",
    });
    expect(outcome).toMatchObject({ ok: true, result: "2" });
  });

  it("throws on input that isn't an expression at all", () => {
    const repo = new FakeHistoryRepository();
    expect(() => calculateAndRecord(repo, 7, { expression: "" })).toThrow();
  });
});
