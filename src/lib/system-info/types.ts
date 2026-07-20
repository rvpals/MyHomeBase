export interface EnvVariable {
  key: string;
  value: string;
}

export interface DatabaseFileInfo {
  label: string;
  path: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface BackupFilesSummary {
  count: number;
  totalSizeBytes: number;
}

export interface MemoryInfo {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  processRssBytes: number;
  processHeapUsedBytes: number;
  processHeapTotalBytes: number;
}

export interface ServerInfo {
  hostname: string;
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCount: number;
  nodeVersion: string;
  systemUptimeSeconds: number;
  processUptimeSeconds: number;
}

export interface SystemInfo {
  envFilePath: string;
  envVariables: EnvVariable[];
  databaseFiles: DatabaseFileInfo[];
  backupFiles: BackupFilesSummary;
  memory: MemoryInfo;
  server: ServerInfo;
}
