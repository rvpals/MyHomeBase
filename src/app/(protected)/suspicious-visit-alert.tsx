// Admin-only home-screen warning that suspicious site arrivals are waiting to be
// reviewed.
//
// The sibling of `BadLoginAlert`, and deliberately the same shape: a banner rather
// than a modal, driven by `reviewed_at IS NULL` rather than a dismissible message, so
// no user can clear it for anyone else and it returns the moment a new one lands.
//
// Fires on `suspicious` only, never on `watch`. A public hostname is scanned
// constantly, so a banner that counted every odd-looking arrival would be on every
// day and would train the reader to ignore both alerts. That is also why the
// allowlist exists — see migrations/0103.
//
// Not a registered shared component: it's one banner on one screen, and nothing else
// renders it. See migrations/0102.
//
// A plain server component — it holds no state and needs no hooks.
import Link from "next/link";

export function SuspiciousVisitAlert({ count }: { count: number }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3">
      <p className="text-sm text-red-200">
        <span className="font-semibold">Suspicious visits to the site, please check.</span>{" "}
        <span className="text-red-300/80">
          {count.toLocaleString()} arrival{count === 1 ? "" : "s"} not yet reviewed.
        </span>
      </p>
      <Link
        href="/admin/security"
        className="whitespace-nowrap rounded-md border border-red-800 px-3 py-1.5 text-sm font-medium text-red-100 transition-colors hover:bg-red-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
      >
        Review site visits
      </Link>
    </div>
  );
}
