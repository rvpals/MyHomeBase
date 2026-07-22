import { formatBytes, getSystemInfo } from "@/lib/system-info";
import { deps } from "@/lib/wiring";
import packageJson from "../../../../../package.json";
import { AboutView } from "./view";

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

export default function AboutPage() {
  const systemInfo = getSystemInfo(deps.systemInfoRepo);

  const stats = [
    { label: "Hostname", value: systemInfo.server.hostname },
    { label: "Platform", value: `${systemInfo.server.platform} (${systemInfo.server.arch})` },
    { label: "CPU", value: `${systemInfo.server.cpuModel} x${systemInfo.server.cpuCount}` },
    { label: "Node Version", value: systemInfo.server.nodeVersion },
    { label: "System Uptime", value: formatUptime(systemInfo.server.systemUptimeSeconds) },
    { label: "Process Uptime", value: formatUptime(systemInfo.server.processUptimeSeconds) },
    {
      label: "RAM Used / Total",
      value: `${formatBytes(systemInfo.memory.usedBytes)} / ${formatBytes(systemInfo.memory.totalBytes)}`,
    },
    { label: "RAM Free", value: formatBytes(systemInfo.memory.freeBytes) },
    { label: "Process RSS", value: formatBytes(systemInfo.memory.processRssBytes) },
    {
      label: "Process Heap",
      value: `${formatBytes(systemInfo.memory.processHeapUsedBytes)} / ${formatBytes(systemInfo.memory.processHeapTotalBytes)}`,
    },
  ];

  const databaseRows = systemInfo.databaseFiles.map((file) => ({
    label: file.label,
    path: file.path,
    sizeBytes: file.sizeBytes,
    sizeText: formatBytes(file.sizeBytes),
    modifiedAt: file.modifiedAt,
    modifiedText: new Date(file.modifiedAt).toLocaleString(),
  }));

  const envRows = systemInfo.envVariables.map((variable) => ({ key: variable.key, value: variable.value }));

  return (
    <AboutView
      appName={packageJson.name}
      appVersion={packageJson.version}
      stats={stats}
      backupText={`${systemInfo.backupFiles.count} backup file(s) totaling ${formatBytes(systemInfo.backupFiles.totalSizeBytes)}.`}
      databaseRows={databaseRows}
      envFilePath={systemInfo.envFilePath}
      envRows={envRows}
    />
  );
}
