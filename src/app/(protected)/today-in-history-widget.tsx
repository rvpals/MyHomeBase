"use client";

// One-off home-screen widget (not a registered shared component), mirroring
// daily-quote-widget.tsx. Moved here from MyJournal's main section so it's
// visible on the landing page without opening the module.

import { useRouter } from "next/navigation";
import { CollapsibleCard } from "@/components/collapsible-card";
import { Comments } from "@/components/comments";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { ModuleIcon } from "@/components/module-icons";
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
  icon,
  className,
}: {
  todayInHistory: TodayInHistoryEntry[];
  /**
   * The journal module's own icon name — these entries are journal entries, and
   * the rows link into that module. Passed in because the icon is a DB column an
   * admin can change.
   */
  icon?: string;
  className?: string;
}) {
  const router = useRouter();

  return (
    <CollapsibleCard
      title="Today In History"
      // Badged with the module the entries come from, matching Daily Glance.
      titleIcon={icon && <ModuleIcon name={icon} className="h-4 w-4" />}
      className={className}
      defaultOpen={todayInHistory.length > 0}
      // In the header slot rather than the body: the card starts collapsed when
      // there's nothing from earlier years, which is exactly when a reader is
      // most likely to wonder what it's for.
      headerAction={
        <Comments
          title="About"
          label="About"
          content="This card displays what happened # number of years ago on the same month and date of today."
        />
      }
    >
      <DataGrid
        columns={TODAY_IN_HISTORY_COLUMNS}
        rows={todayInHistory}
        getRowKey={(item) => item.entry.id}
        emptyMessage="No entries from earlier years on today's date."
        enableExport
        exportFileName="journal-today-in-history"
        showStatusBar={false}
        // A handful of rows on a dashboard card: search, filters, column picker
        // and density are all chrome here.
        showToolbar={false}
        onRowClick={(item) => router.push(`/modules/journal/entries/${item.entry.id}`)}
      />
    </CollapsibleCard>
  );
}
