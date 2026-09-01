import { getAppVersion } from "@/lib/app-version";
import { getChangeHistory } from "@/lib/change-history";
import { listDeployments } from "@/lib/deployments";
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
  const changeHistory = getChangeHistory(deps.changeHistoryRepo);
  const appVersion = getAppVersion(deps.buildIdRepo);
  const deployments = listDeployments(deps.deploymentRepo);

  const stats = [
    { label: "Hostname", value: systemInfo.server.hostname },
    { label: "Platform", value: `${systemInfo.server.platform} (${systemInfo.server.arch})` },
    { label: "CPU", value: `${systemInfo.server.cpuModel} x${systemInfo.server.cpuCount}` },
    { label: "Node Version", value: systemInfo.server.nodeVersion },
    { label: "System Uptime", value: formatUptime(systemInfo.server.systemUptimeSeconds) },
    { label: "Process Uptime", value: formatUptime(systemInfo.server.processUptimeSeconds) },
    { label: "RAM Free", value: formatBytes(systemInfo.memory.freeBytes) },
  ];

  // The three memory figures that have a denominator, shown as meters below the
  // tiles. RSS is one process's resident set — it isn't a slice of anything else
  // on this page, so total system RAM is the only honest scale, and the caption
  // says so rather than leaving the reader to assume.
  const ramMeter = {
    label: "RAM Used / Total",
    usedBytes: systemInfo.memory.usedBytes,
    totalBytes: systemInfo.memory.totalBytes,
    caption: `${formatBytes(systemInfo.memory.freeBytes)} free.`,
  };

  const processMeters = [
    {
      label: "Process RSS",
      usedBytes: systemInfo.memory.processRssBytes,
      totalBytes: systemInfo.memory.totalBytes,
      caption: `Of ${formatBytes(systemInfo.memory.totalBytes)} system RAM.`,
    },
    {
      label: "Process Heap",
      usedBytes: systemInfo.memory.processHeapUsedBytes,
      totalBytes: systemInfo.memory.processHeapTotalBytes,
      caption: "Heap used of heap allocated.",
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

  // Formatted here rather than in the view, like databaseRows above: the view is a client
  // component, and a Date rendered there would format against the browser's locale on a
  // phone and the server's on a desktop. `deployedAt` stays alongside its text so the grid
  // can still sort on the raw ISO value.
  const deploymentRows = deployments.map((deployment) => ({
    id: deployment.id,
    deployedAt: deployment.deployedAt,
    deployedText: new Date(deployment.deployedAt).toLocaleString(),
    builtAt: deployment.builtAt,
    builtText: deployment.builtAt ? new Date(deployment.builtAt).toLocaleString() : null,
    buildId: deployment.buildId,
    appVersion: deployment.appVersion,
    builtOnHost: deployment.builtOnHost,
    nodeAbi: deployment.nodeAbi,
    packageSizeBytes: deployment.packageSizeBytes,
    packageSizeText: deployment.packageSizeBytes === null ? null : formatBytes(deployment.packageSizeBytes),
    migrated: deployment.migrated,
    buildOutput: deployment.buildOutput,
    /** True for the build this server is running — the row worth pointing at. */
    isCurrent: deployment.buildId !== null && deployment.buildId === appVersion.buildId,
  }));

  return (
    <AboutView
      appName={packageJson.name}
      appVersion={packageJson.version}
      buildId={appVersion.buildId}
      stats={stats}
      ramMeter={ramMeter}
      processMeters={processMeters}
      backupText={`${systemInfo.backupFiles.count} backup file(s) totaling ${formatBytes(systemInfo.backupFiles.totalSizeBytes)}.`}
      databaseRows={databaseRows}
      envFilePath={systemInfo.envFilePath}
      envRows={envRows}
      deployments={deploymentRows}
      changeHistoryMarkdown={changeHistory.markdown}
      changeHistorySummary={changeHistory.summary}
    />
  );
}
