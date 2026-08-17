import { QUOTE_CATEGORIES } from "@/lib/daily-quote";
import { CollapsibleCard } from "@/components/collapsible-card";
import { NewsletterImport } from "../newsletter-import";
import { PAGE_CONTAINER } from "../../../page-container";

export default function ImportFromNewsletterPage() {
  return (
    <div className={PAGE_CONTAINER}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Daily Quote
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">
        Import from Newsletter
      </h1>
      <p className="mt-2 text-sm text-muted">
        Paste a &ldquo;3-2-1&rdquo; issue, review what was found, and import the quotes you want
        to keep.
      </p>

      <div className="mt-6">
        <CollapsibleCard title="Import from newsletter" defaultOpen>
          <NewsletterImport categories={QUOTE_CATEGORIES} />
        </CollapsibleCard>
      </div>
    </div>
  );
}
