import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FileStat, RawMemoryInfo, RawServerInfo, SystemInfoRepository } from "./ports";
import type { BackupFilesSummary } from "./types";

// The real repository. Mirrors the exact env var / db path resolution used by
// src/lib/wiring.ts and scripts/migrate.ts, so this always describes the
// files this running instance actually reads and writes.
export class RealSystemInfoRepository implements SystemInfoRepository {
  getEnvFilePath(): string {
    return path.join(process.cwd(), ".env");
  }

  readEnvFileText(): string | undefined {
    const envPath = this.getEnvFilePath();
    if (!existsSync(envPath)) return undefined;
    return readFileSync(envPath, "utf8");
  }

  getDatabasePath(): string {
    return process.env.MYHOMEBASE_DB ?? path.join(process.cwd(), "data", "myhomebase.db");
  }

  statFile(filePath: string): FileStat | undefined {
    if (!existsSync(filePath)) return undefined;
    const stats = statSync(filePath);
    return { sizeBytes: stats.size, modifiedAt: stats.mtime.toISOString() };
  }

  listBackupFiles(databaseDir: string, baseFileName: string): BackupFilesSummary {
    if (!existsSync(databaseDir)) return { count: 0, totalSizeBytes: 0 };

    const backupFiles = readdirSync(databaseDir).filter((name) => name.startsWith(`${baseFileName}.bak`));
    const totalSizeBytes = backupFiles.reduce(
      (sum, name) => sum + statSync(path.join(databaseDir, name)).size,
      0,
    );
    return { count: backupFiles.length, totalSizeBytes };
  }

  getMemoryInfo(): RawMemoryInfo {
    const usage = process.memoryUsage();
    return {
      totalBytes: os.totalmem(),
      freeBytes: os.freemem(),
      processRssBytes: usage.rss,
      processHeapUsedBytes: usage.heapUsed,
      processHeapTotalBytes: usage.heapTotal,
    };
  }

  getServerInfo(): RawServerInfo {
    const cpus = os.cpus();
    return {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      cpuModel: cpus[0]?.model.trim() ?? "Unknown",
      cpuCount: cpus.length,
      nodeVersion: process.version,
      systemUptimeSeconds: os.uptime(),
      processUptimeSeconds: process.uptime(),
    };
  }
}
