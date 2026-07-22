"use client";

// Client presentation for the About screen. The server page (page.tsx) fetches
// system info and hands down fully serializable, display-ready data — this view
// only renders it. Columns carry a `value` accessor (raw sort key) alongside
// `render` (formatted display) so the grids sort and export correctly.

import { DataGrid, type DataGridColumn } from "@/components/data-grid";

interface StatItem {
  label: string;
  value: string;
}

interface DatabaseRow {
  label: string;
  path: string;
  sizeBytes: number;
  sizeText: string;
  modifiedAt: string;
  modifiedText: string;
}

interface EnvRow {
  key: string;
  value: string;
}

function StatTile({ label, value }: StatItem) {
  return (
    <div className="rounded-xl border border-line p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-display text-lg text-ink">{value}</p>
    </div>
  );
}

export function AboutView({
  appName,
  appVersion,
  stats,
  backupText,
  databaseRows,
  envFilePath,
  envRows,
}: {
  appName: string;
  appVersion: string;
  stats: StatItem[];
  backupText: string;
  databaseRows: DatabaseRow[];
  envFilePath: string;
  envRows: EnvRow[];
}) {
  const databaseColumns: DataGridColumn<DatabaseRow>[] = [
    { key: "label", header: "File", value: (file) => file.label, render: (file) => file.label },
    {
      key: "path",
      header: "Path",
      value: (file) => file.path,
      render: (file) => <span className="font-mono text-xs">{file.path}</span>,
    },
    { key: "size", header: "Size", value: (file) => file.sizeBytes, render: (file) => file.sizeText },
    { key: "modified", header: "Modified", value: (file) => file.modifiedAt, render: (file) => file.modifiedText },
  ];

  const envColumns: DataGridColumn<EnvRow>[] = [
    {
      key: "key",
      header: "Key",
      value: (variable) => variable.key,
      render: (variable) => <span className="font-mono text-xs">{variable.key}</span>,
    },
    {
      key: "value",
      header: "Value",
      value: (variable) => variable.value,
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
        <p className="font-display text-lg">{appName}</p>
        <p className="mt-1 text-muted">Version {appVersion}</p>
      </div>

      <div className="mt-10">
        <h2 className="font-display text-xl text-ink">System Information</h2>
        <p className="mt-1 text-sm text-muted">
          Live details about the server process this instance is running on.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {stats.map((stat) => (
            <StatTile key={stat.label} label={stat.label} value={stat.value} />
          ))}
        </div>
      </div>

      <div className="mt-10">
        <h2 className="font-display text-xl text-ink">Database Files</h2>
        <p className="mt-1 text-sm text-muted">{backupText}</p>
        <div className="mt-4">
          <DataGrid
            columns={databaseColumns}
            rows={databaseRows}
            getRowKey={(file) => file.path}
            emptyMessage="No database files found."
            exportFileName="database-files"
          />
        </div>
      </div>

      <div className="mt-10">
        <h2 className="font-display text-xl text-ink">Environment Variables</h2>
        <p className="mt-1 text-sm text-muted">
          <span className="font-mono text-xs">{envFilePath}</span> — shown in full, including secrets.
          This page is admin-only; treat it accordingly.
        </p>
        <div className="mt-4">
          <DataGrid
            columns={envColumns}
            rows={envRows}
            getRowKey={(variable) => variable.key}
            emptyMessage="No .env file found at this path."
            exportFileName="env-variables"
          />
        </div>
      </div>
    </div>
  );
}
