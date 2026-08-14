"use client";

// One-off home-screen widget (not a registered shared component), mirroring
// daily-quote-widget.tsx. Moved here from MyJournal's main section so it's
// visible on the landing page without opening the module.

import { useRouter } from "next/navigation";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import type { TodayInHistoryEntry } from "@/lib/journal";

function yearsAgoLabel(yearsAgo: number): string {
  return yearsAgo === 1 ? "1 year ago" : `${yearsAgo} years ago`;
}

const TODAY_IN_HISTORY_COLUMNS: DataGridColumn<TodayInHistoryEntry>[] = [
  {
    key: "yearsAgo",
    header: "When",
    value: (item) => item.yearsAgo,
    render: (item) => yearsAgoLabel(item.yearsAgo),
  },
  { key: "date", header: "Date", value: (item) => item.entry.date, render: (item) => item.entry.date },
  { key: "title", header: "Title", value: (item) => item.entry.title, render: (item) => item.entry.title },
  {
    key: "categories",
    header: "Categories",
    value: (item) => item.entry.categories.join(", "),
    render: (item) => item.entry.categories.join(", "),
  },
];

export function TodayInHistoryWidget({
  todayInHistory,
  className,
}: {
  todayInHistory: TodayInHistoryEntry[];
  className?: string;
}) {
  const router = useRouter();

  return (
    <CollapsibleCard title="Today In History" className={className} defaultOpen={todayInHistory.length > 0}>
      <p className="mb-3 text-sm text-muted">
        {todayInHistory.length > 0
          ? `${todayInHistory.length} past ${todayInHistory.length === 1 ? "entry" : "entries"} on this month and day. Click a row to open it.`
          : "Nothing recorded on this month and day in an earlier year."}
      </p>
      <DataGrid
        columns={TODAY_IN_HISTORY_COLUMNS}
        rows={todayInHistory}
        getRowKey={(item) => item.entry.id}
        emptyMessage="No entries from earlier years on today's date."
        enableExport
        exportFileName="journal-today-in-history"
        showStatusBar={false}
        onRowClick={(item) => router.push(`/modules/journal/entries/${item.entry.id}`)}
      />
    </CollapsibleCard>
  );
}
