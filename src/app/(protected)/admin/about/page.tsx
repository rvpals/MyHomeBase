import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { formatBytes, getSystemInfo, type DatabaseFileInfo, type EnvVariable } from "@/lib/system-info";
import { deps } from "@/lib/wiring";
import packageJson from "../../../../../package.json";

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-display text-lg text-ink">{value}</p>
    </div>
  );
}

export default function AboutPage() {
  const systemInfo = getSystemInfo(deps.systemInfoRepo);

  const databaseColumns: DataGridColumn<DatabaseFileInfo>[] = [
    { key: "label", header: "File", render: (file) => file.label },
    { key: "path", header: "Path", render: (file) => <span className="font-mono text-xs">{file.path}</span> },
    { key: "size", header: "Size", render: (file) => formatBytes(file.sizeBytes) },
    { key: "modified", header: "Modified", render: (file) => new Date(file.modifiedAt).toLocaleString() },
  ];

  const envColumns: DataGridColumn<EnvVariable>[] = [
    { key: "key", header: "Key", render: (variable) => <span className="font-mono text-xs">{variable.key}</span> },
    {
      key: "value",
      header: "Value",
      render: (variable) => <span className="break-all font-mono text-xs">{variable.value || "—"}</span>,
    },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Administration
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">About</h1>

      <div className="mt-8 rounded-xl border border-line bg-paper-raised p-5 text-sm text-ink">
        <p className="font-display text-lg">{packageJson.name}</p>
        <p className="mt-1 text-muted">Version {packageJson.version}</p>
      </div>

      <div className="mt-10">
        <h2 className="font-display text-xl text-ink">System Information</h2>
        <p className="mt-1 text-sm text-muted">
          Live details about the server process this instance is running on.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatTile label="Hostname" value={systemInfo.server.hostname} />
          <StatTile label="Platform" value={`${systemInfo.server.platform} (${systemInfo.server.arch})`} />
          <StatTile label="CPU" value={`${systemInfo.server.cpuModel} x${systemInfo.server.cpuCount}`} />
          <StatTile label="Node Version" value={systemInfo.server.nodeVersion} />
          <StatTile label="System Uptime" value={formatUptime(systemInfo.server.systemUptimeSeconds)} />
          <StatTile label="Process Uptime" value={formatUptime(systemInfo.server.processUptimeSeconds)} />
          <StatTile
            label="RAM Used / Total"
            value={`${formatBytes(systemInfo.memory.usedBytes)} / ${formatBytes(systemInfo.memory.totalBytes)}`}
          />
          <StatTile label="RAM Free" value={formatBytes(systemInfo.memory.freeBytes)} />
          <StatTile label="Process RSS" value={formatBytes(systemInfo.memory.processRssBytes)} />
          <StatTile
            label="Process Heap"
            value={`${formatBytes(systemInfo.memory.processHeapUsedBytes)} / ${formatBytes(systemInfo.memory.processHeapTotalBytes)}`}
          />
        </div>
      </div>

      <div className="mt-10">
        <h2 className="font-display text-xl text-ink">Database Files</h2>
        <p className="mt-1 text-sm text-muted">
          {systemInfo.backupFiles.count} backup file(s) totaling {formatBytes(systemInfo.backupFiles.totalSizeBytes)}.
        </p>
        <div className="mt-4">
          <DataGrid
            columns={databaseColumns}
            rows={systemInfo.databaseFiles}
            getRowKey={(file) => file.path}
            emptyMessage="No database files found."
          />
        </div>
      </div>

      <div className="mt-10">
        <h2 className="font-display text-xl text-ink">Environment Variables</h2>
        <p className="mt-1 text-sm text-muted">
          <span className="font-mono text-xs">{systemInfo.envFilePath}</span> — shown in full, including
          secrets. This page is admin-only; treat it accordingly.
        </p>
        <div className="mt-4">
          <DataGrid
            columns={envColumns}
            rows={systemInfo.envVariables}
            getRowKey={(variable) => variable.key}
            emptyMessage="No .env file found at this path."
          />
        </div>
      </div>
    </div>
  );
}
