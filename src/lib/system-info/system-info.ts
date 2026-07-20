import path from "node:path";
import type { SystemInfoRepository } from "./ports";
import type { DatabaseFileInfo, EnvVariable, MemoryInfo, ServerInfo, SystemInfo } from "./types";

/** Parses `KEY=VALUE` lines from .env text — no I/O, pure. Ignores blank lines and `#` comments. */
export function parseEnvFile(text: string): EnvVariable[] {
  const variables: EnvVariable[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }

    if (key !== "") variables.push({ key, value });
  }
  return variables;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** Formats a byte count as a human-readable string, e.g. 1536 -> "1.5 KB". */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${exponent === 0 ? value : value.toFixed(1)} ${BYTE_UNITS[exponent]}`;
}

function toMemoryInfo(raw: ReturnType<SystemInfoRepository["getMemoryInfo"]>): MemoryInfo {
  return {
    totalBytes: raw.totalBytes,
    freeBytes: raw.freeBytes,
    usedBytes: raw.totalBytes - raw.freeBytes,
    processRssBytes: raw.processRssBytes,
    processHeapUsedBytes: raw.processHeapUsedBytes,
    processHeapTotalBytes: raw.processHeapTotalBytes,
  };
}

/** Gathers .env contents, database file sizes, memory, and server info for the About page. */
export function getSystemInfo(repo: SystemInfoRepository): SystemInfo {
  const envFilePath = repo.getEnvFilePath();
  const envText = repo.readEnvFileText();
  const envVariables = envText ? parseEnvFile(envText) : [];

  const databasePath = repo.getDatabasePath();
  const databaseDir = path.dirname(databasePath);
  const databaseFileName = path.basename(databasePath);

  const databaseFiles: DatabaseFileInfo[] = (
    [
      { label: "Database", suffix: "" },
      { label: "Write-Ahead Log", suffix: "-wal" },
      { label: "Shared Memory", suffix: "-shm" },
    ] as const
  ).flatMap(({ label, suffix }) => {
    const filePath = `${databasePath}${suffix}`;
    const stat = repo.statFile(filePath);
    return stat ? [{ label, path: filePath, sizeBytes: stat.sizeBytes, modifiedAt: stat.modifiedAt }] : [];
  });

  const backupFiles = repo.listBackupFiles(databaseDir, databaseFileName);
  const memory = toMemoryInfo(repo.getMemoryInfo());
  const server: ServerInfo = repo.getServerInfo();

  return { envFilePath, envVariables, databaseFiles, backupFiles, memory, server };
}
