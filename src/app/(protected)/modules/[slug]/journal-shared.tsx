// Small pieces shared across the My Journal sections. Kept here rather than in
// one of the section views so importing a helper never drags a whole screen
// with it. Mirrors expense-shared.tsx.

import type { JournalCategory, JournalTag } from "@/lib/journal";

type TaxonomyKind = "category" | "tag";

/**
 * Where a category's or tag's icon is served from, or undefined when it has
 * none. Bytes come from a route, not the page payload; `updatedAt` busts the
 * cache when the icon is replaced. The name is the key, so it's URL-encoded.
 */
export function journalTaxonomyIconUrl(
  kind: TaxonomyKind,
  item: Pick<JournalCategory | JournalTag, "name" | "iconMimeType" | "updatedAt">,
): string | undefined {
  if (!item.iconMimeType) return undefined;
  const path = kind === "category" ? "categories" : "tags";
  return `/api/journal/${path}/${encodeURIComponent(item.name)}/icon?v=${encodeURIComponent(item.updatedAt)}`;
}

/**
 * Name -> icon URL, for screens that only have category/tag *names* to render
 * (a journal entry lists its categories/tags as strings) and still want icons.
 * Only names with an uploaded icon get an entry.
 */
export function journalTaxonomyIconUrlsByName(
  kind: TaxonomyKind,
  items: (JournalCategory | JournalTag)[],
): Map<string, string> {
  const urls = new Map<string, string>();
  for (const item of items) {
    const url = journalTaxonomyIconUrl(kind, item);
    if (url) urls.set(item.name, url);
  }
  return urls;
}

/**
 * Link to the Entries section pre-filtered to one category or tag.
 *
 * The name is URL-encoded, but note the sharper problem: a comma is the query
 * grammar's "any of" separator, so a category literally named "A, B" would arrive
 * as two values. Such a name can't be expressed in the query syntax at all, so
 * those fall back to an unfiltered link rather than a quietly wrong one — the
 * Entries dropdown can still get the reader there via a saved filter.
 */
export function journalEntriesFilterHref(kind: TaxonomyKind, name: string): string {
  const base = "/modules/journal/entries";
  if (name.includes(",")) return base;
  const field = kind === "category" ? "category" : "tags";
  return `${base}?filter=${encodeURIComponent(`${field} = ${name}`)}`;
}

/** A category's or tag's icon at label size, with its name as a hover hint. */
export function TaxonomyIconThumbnail({
  name,
  url,
  className = "",
}: {
  name: string;
  url?: string;
  className?: string;
}) {
  if (!url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- icon bytes are served from our own DB-backed route, not a static asset next/image can optimize.
    <img
      src={url}
      alt={name}
      title={name}
      loading="lazy"
      className={`h-5 w-5 shrink-0 rounded border border-line object-cover ${className}`}
    />
  );
}
