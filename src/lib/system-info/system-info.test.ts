import { describe, expect, it } from "vitest";
import type { SystemInfoRepository } from "./ports";
import { formatBytes, getSystemInfo, parseEnvFile } from "./system-info";

describe("parseEnvFile", () => {
  it("parses simple KEY=VALUE lines", () => {
    expect(parseEnvFile("PORT=3000\nHOST=localhost")).toEqual([
      { key: "PORT", value: "3000" },
      { key: "HOST", value: "localhost" },
    ]);
  });

  it("ignores blank lines and comments", () => {
    expect(parseEnvFile("# a comment\n\nPORT=3000\n  # another\n")).toEqual([{ key: "PORT", value: "3000" }]);
  });

  it("strips matching surrounding quotes", () => {
    expect(parseEnvFile('NAME="My App"\nOTHER=\'value\'')).toEqual([
      { key: "NAME", value: "My App" },
      { key: "OTHER", value: "value" },
    ]);
  });

  it("handles an empty value", () => {
    expect(parseEnvFile("EMPTY=")).toEqual([{ key: "EMPTY", value: "" }]);
  });

  it("keeps everything after the first = for values containing =", () => {
    expect(parseEnvFile("URL=http://x?a=1&b=2")).toEqual([{ key: "URL", value: "http://x?a=1&b=2" }]);
  });

  it("ignores a line with no =", () => {
    expect(parseEnvFile("not a valid line\nPORT=3000")).toEqual([{ key: "PORT", value: "3000" }]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseEnvFile("")).toEqual([]);
  });
});

describe("formatBytes", () => {
  it("formats bytes at each unit step", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024 * 2.5)).toBe("2.5 MB");
    expect(formatBytes(1024 * 1024 * 1024 * 3)).toBe("3.0 GB");
  });

  it("treats non-positive input as zero", () => {
    expect(formatBytes(-5)).toBe("0 B");
  });
});

function fakeRepo(overrides: Partial<SystemInfoRepository> = {}): SystemInfoRepository {
  return {
    getEnvFilePath: () => "/app/.env",
    readEnvFileText: () => "SESSION_SECRET=abc123\nPORT=5200",
    getDatabasePath: () => "/app/data/myhomebase.db",
    statFile: (filePath) =>
      filePath === "/app/data/myhomebase.db"
        ? { sizeBytes: 102400, modifiedAt: "2026-01-01T00:00:00.000Z" }
        : undefined,
    listBackupFiles: () => ({ count: 3, totalSizeBytes: 30000 }),
    getMemoryInfo: () => ({
      totalBytes: 16_000_000_000,
      freeBytes: 4_000_000_000,
      processRssBytes: 100_000_000,
      processHeapUsedBytes: 50_000_000,
      processHeapTotalBytes: 80_000_000,
    }),
    getServerInfo: () => ({
      hostname: "test-host",
      platform: "win32",
      arch: "x64",
      cpuModel: "Test CPU",
      cpuCount: 8,
      nodeVersion: "v20.0.0",
      systemUptimeSeconds: 3600,
      processUptimeSeconds: 60,
    }),
    ...overrides,
  };
}

describe("getSystemInfo", () => {
  it("assembles env variables, database files, backups, memory, and server info", () => {
    const info = getSystemInfo(fakeRepo());

    expect(info.envVariables).toEqual([
      { key: "SESSION_SECRET", value: "abc123" },
      { key: "PORT", value: "5200" },
    ]);
    expect(info.databaseFiles).toEqual([
      { label: "Database", path: "/app/data/myhomebase.db", sizeBytes: 102400, modifiedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    expect(info.backupFiles).toEqual({ count: 3, totalSizeBytes: 30000 });
    expect(info.memory.usedBytes).toBe(12_000_000_000);
    expect(info.server.hostname).toBe("test-host");
  });

  it("returns no env variables when there's no .env file", () => {
    const info = getSystemInfo(fakeRepo({ readEnvFileText: () => undefined }));
    expect(info.envVariables).toEqual([]);
  });

  it("only includes database sidecar files that actually exist", () => {
    const info = getSystemInfo(
      fakeRepo({
        statFile: (filePath) =>
          filePath.endsWith("-wal") ? { sizeBytes: 500, modifiedAt: "2026-01-02T00:00:00.000Z" } : undefined,
      }),
    );
    expect(info.databaseFiles).toEqual([
      { label: "Write-Ahead Log", path: "/app/data/myhomebase.db-wal", sizeBytes: 500, modifiedAt: "2026-01-02T00:00:00.000Z" },
    ]);
  });
});
