"use client";

// Client presentation for the About screen. The server page (page.tsx) fetches
// system info and reads CHANGE_HISTORY.md, and hands down fully serializable,
// display-ready data — this view only renders it. Columns carry a `value`
// accessor (raw sort key) alongside `render` (formatted display) so the grids
// sort and export correctly.

import type { ReactNode } from "react";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { Tabs, type TabItem } from "@/components/tabs";
import {
  readChangeTag,
  type ChangeCounts,
  type ChangeHistorySummary,
  type ChangeKind,
} from "@/lib/change-history";
import { PAGE_CONTAINER } from "../../page-container";

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

// Added / Changed / Fixed use emphasis rather than three hues, per design.md:
// "added" takes the documented tinted accent chip, "changed" is a quiet outline.
// "fixed" is the one literal color — a resolved defect is the success semantic
// the design system reserves emerald for.
const KIND_CHIP: Record<ChangeKind, string> = {
  added: "bg-brass-soft text-brass-dark",
  changed: "border border-line text-muted",
  fixed: "border border-emerald-400/40 text-emerald-400",
};

function KindBadge({ kind, count }: { kind: ChangeKind; count?: number }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide ${KIND_CHIP[kind]}`}
    >
      {count === undefined ? null : <span className="font-mono">{count}</span>}
      {kind}
    </span>
  );
}

function CountsCard({ label, caption, counts }: { label: string; caption: string; counts: ChangeCounts }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl text-ink">
        {counts.total}{" "}
        <span className="text-base text-muted">{counts.total === 1 ? "change" : "changes"}</span>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <KindBadge kind="added" count={counts.added} />
        <KindBadge kind="changed" count={counts.changed} />
        <KindBadge kind="fixed" count={counts.fixed} />
      </div>
      <p className="mt-3 text-xs text-muted">{caption}</p>
    </div>
  );
}

function ChangeHistoryTotals({ summary }: { summary: ChangeHistorySummary }) {
  const releaseCount = summary.releases.length;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {summary.latest ? (
        <CountsCard label="This release" caption={summary.latest.title} counts={summary.latest.counts} />
      ) : null}
      <CountsCard
        label="All time"
        caption={`Across ${releaseCount} ${releaseCount === 1 ? "release" : "releases"}.`}
        counts={summary.allTime}
      />
    </div>
  );
}

// Minimal renderer for the specific subset of markdown CHANGE_HISTORY.md
// actually uses (#/##/### headings, "-"/"*" bullet lists, plain paragraphs)
// plus this project's `[Added]` / `[Changed]` / `[Fixed]` item tags, which are
// lifted out of the text and shown as a badge. Not a general markdown parser.
function renderChangeHistory(markdown: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  let listItems: { kind: ChangeKind | null; text: string }[] = [];

  function flushList() {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={`list-${blocks.length}`} className="list-disc space-y-1 pl-5 text-sm text-ink">
        {listItems.map((item, index) => (
          <li key={index}>
            {item.kind ? (
              <>
                <KindBadge kind={item.kind} />{" "}
              </>
            ) : null}
            {item.text}
          </li>
        ))}
      </ul>,
    );
    listItems = [];
  }

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.startsWith("### ")) {
      flushList();
      const { kind, text } = readChangeTag(line.slice(4));
      blocks.push(
        <h3
          key={blocks.length}
          className="mt-4 flex flex-wrap items-center gap-2 font-display text-base font-semibold text-ink"
        >
          {kind ? <KindBadge kind={kind} /> : null}
          {text}
        </h3>,
      );
    } else if (line.startsWith("## ")) {
      flushList();
      blocks.push(
        <h2
          key={blocks.length}
          className="mt-6 border-t border-line pt-4 font-display text-lg font-semibold text-ink first:mt-0 first:border-t-0 first:pt-0"
        >
          {line.slice(3)}
        </h2>,
      );
    } else if (line.startsWith("# ")) {
      flushList();
      blocks.push(
        <h1 key={blocks.length} className="font-display text-2xl font-semibold text-ink">
          {line.slice(2)}
        </h1>,
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      listItems.push(readChangeTag(line.slice(2)));
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      blocks.push(
        <p key={blocks.length} className="text-sm text-muted">
          {line}
        </p>,
      );
    }
  }
  flushList();

  return blocks;
}

export function AboutView({
  appName,
  appVersion,
  stats,
  backupText,
  databaseRows,
  envFilePath,
  envRows,
  changeHistoryMarkdown,
  changeHistorySummary,
}: {
  appName: string;
  appVersion: string;
  stats: StatItem[];
  backupText: string;
  databaseRows: DatabaseRow[];
  envFilePath: string;
  envRows: EnvRow[];
  changeHistoryMarkdown: string | null;
  changeHistorySummary: ChangeHistorySummary | null;
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

  const tabs: TabItem[] = [
    {
      key: "application",
      label: "Application",
      content: (
        <>
          <CollapsibleCard title="Application & System Info" defaultOpen>
            <p className="font-display text-lg text-ink">{appName}</p>
            <p className="mt-1 text-sm text-muted">Version {appVersion}</p>

            <p className="mt-4 text-sm text-muted">
              Live details about the server process this instance is running on.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {stats.map((stat) => (
                <StatTile key={stat.label} label={stat.label} value={stat.value} />
              ))}
            </div>
          </CollapsibleCard>

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
              <span className="font-mono text-xs">{envFilePath}</span> — shown in full, including
              secrets. This page is admin-only; treat it accordingly.
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
        </>
      ),
    },
    {
      key: "change-history",
      label: "Change History",
      content: (
        <div className="space-y-2">
          {changeHistorySummary ? (
            <div className="mb-8">
              <ChangeHistoryTotals summary={changeHistorySummary} />
            </div>
          ) : null}
          {changeHistoryMarkdown ? (
            renderChangeHistory(changeHistoryMarkdown)
          ) : (
            <div className="rounded-xl border border-dashed border-line p-8 text-center">
              <p className="font-display text-lg text-ink">No change history yet</p>
              <p className="mt-1 text-sm text-muted">
                Run the <code className="font-mono">build_project</code> skill to create{" "}
                <code className="font-mono">CHANGE_HISTORY.md</code>.
              </p>
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className={PAGE_CONTAINER}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Administration
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">About</h1>

      <Tabs items={tabs} className="mt-8" />
    </div>
  );
}
