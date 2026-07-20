import type { BackupFilesSummary } from "./types";

export interface FileStat {
  sizeBytes: number;
  modifiedAt: string;
}

export interface RawMemoryInfo {
  totalBytes: number;
  freeBytes: number;
  processRssBytes: number;
  processHeapUsedBytes: number;
  processHeapTotalBytes: number;
}

export interface RawServerInfo {
  hostname: string;
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCount: number;
  nodeVersion: string;
  systemUptimeSeconds: number;
  processUptimeSeconds: number;
}

export interface SystemInfoRepository {
  getEnvFilePath(): string;
  /** Undefined when no .env file exists at that path. */
  readEnvFileText(): string | undefined;
  getDatabasePath(): string;
  /** Undefined when the file doesn't exist (e.g. no -wal file outside an open WAL session). */
  statFile(path: string): FileStat | undefined;
  listBackupFiles(databaseDir: string, baseFileName: string): BackupFilesSummary;
  getMemoryInfo(): RawMemoryInfo;
  getServerInfo(): RawServerInfo;
}
