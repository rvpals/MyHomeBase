// Small pieces shared across the Expense sections. Kept here rather than in one
// of the section views so importing a helper never drags a whole screen with it.

import type { IconSelectOption } from "@/components/icon-select";
import type { CreditCardAccount, ExpenseCategory } from "@/lib/expense";

/** Cents to a signed currency string, e.g. -4500 → "-$45.00". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}$${(absolute / 100).toFixed(2)}`;
}

/** Today's date as YYYY-MM-DD in local time (not UTC, which can be the wrong day). */
export function todayIso(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Where a category's icon is served from, or undefined when it has none. Same
 * deal as the card image: bytes come from a route, not the page payload, and
 * `updatedAt` busts the cache when the icon is replaced. The name is the key, so
 * it's URL-encoded.
 */
export function categoryIconUrl(category: ExpenseCategory): string | undefined {
  if (!category.iconMimeType) return undefined;
  return `/api/expense/categories/${encodeURIComponent(category.name)}/icon?v=${encodeURIComponent(
    category.updatedAt,
  )}`;
}

/** The category rows for an `IconSelect`, icons included. */
export function categoryIconSelectOptions(categories: ExpenseCategory[]): IconSelectOption[] {
  return categories.map((category) => ({
    value: category.name,
    label: category.name,
    iconUrl: categoryIconUrl(category),
  }));
}

/**
 * Name -> icon URL, for the screens that only have a category *name* to render
 * (the transactions grid, the spend rollups) and still want its icon.
 */
export function categoryIconUrlsByName(categories: ExpenseCategory[]): Map<string, string> {
  const urls = new Map<string, string>();
  for (const category of categories) {
    const url = categoryIconUrl(category);
    if (url) urls.set(category.name, url);
  }
  return urls;
}

/** A category's icon at label size, or nothing when it has none. */
export function CategoryIconThumbnail({
  iconUrl,
  className = "",
}: {
  iconUrl?: string;
  className?: string;
}) {
  if (!iconUrl) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- icon bytes are served from our own DB-backed route, not a static asset next/image can optimize.
    <img
      src={iconUrl}
      alt=""
      loading="lazy"
      className={`h-5 w-5 shrink-0 rounded border border-line object-cover ${className}`}
    />
  );
}

/**
 * The small card image, or nothing when the account has none. The bytes come
 * from the image route rather than the page payload; `updatedAt` is appended as
 * a cache-buster so a replaced image appears immediately.
 */
export function CardThumbnail({
  account,
  className = "",
}: {
  account: CreditCardAccount;
  className?: string;
}) {
  if (!account.imageMimeType) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- card image bytes are served from our own DB-backed route, not a static asset next/image can optimize.
    <img
      src={`/api/expense/accounts/${account.id}/image?v=${encodeURIComponent(account.updatedAt)}`}
      alt=""
      className={`h-6 w-9 shrink-0 rounded border border-line object-cover ${className}`}
    />
  );
}
