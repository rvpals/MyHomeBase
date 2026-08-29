import { listEntries as listCsvAnalyticsEntries } from "@/lib/csv-analytics";
import { deps } from "@/lib/wiring";
import { CsvAnalyticsView } from "./csv-analytics-view";
import { CsvConfigurationView } from "./csv-configuration-view";
import { CsvShell } from "./csv-shell";
import { CSV_SECTION_INFO, type CsvSection as CsvSectionName } from "./csv-sections";

// Composes one CSV Analysis section: the section nav, a heading, and the section's
// own view. A server component, so it can read `deps` directly and hand plain data
// to the client views. Mirrors music-section.tsx.

export async function CsvSection({ section }: { section: CsvSectionName }) {
  const info = CSV_SECTION_INFO[section];

  return (
    // The two-tier shell: a module rail, a section panel and a utility header,
    // all placed by `CsvShell`. See design.md, "Navigation: the two-tier shell".
    //
    // `async` because the shell reads cookies for the session and the pinned
    // layout, which `next/headers` only exposes as a promise.
    <CsvShell>
      <div>
        <header className="mb-4">
          <h1 className="font-display text-2xl text-ink">{info.label}</h1>
          <p className="text-sm text-muted">{info.description}</p>
        </header>

        {section === "main" && (
          <CsvAnalyticsView entries={listCsvAnalyticsEntries(deps.csvAnalyticsRepo)} />
        )}
        {section === "configuration" && <CsvConfigurationView />}
      </div>
    </CsvShell>
  );
}
