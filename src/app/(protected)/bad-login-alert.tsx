// Admin-only home-screen warning that failed sign-ins are waiting to be reviewed.
//
// A banner rather than a modal (which is what StartupMessage uses): this one persists
// until the failures are actually reviewed, so a dialog would block the home screen on
// every visit until then. It also isn't driven by a dismissible message — it queries
// `reviewed_at IS NULL`, so no user can clear it for anyone else and it returns the
// moment a new failure lands.
//
// Not a registered shared component: it's one banner on one screen, and nothing else
// renders it. See migrations/0045.
//
// A plain server component — it holds no state and needs no hooks.
import Link from "next/link";

export function BadLoginAlert({ count }: { count: number }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3">
      <p className="text-sm text-red-200">
        <span className="font-semibold">There is bad login attempt, please check.</span>{" "}
        <span className="text-red-300/80">
          {count.toLocaleString()} failed attempt{count === 1 ? "" : "s"} not yet reviewed.
        </span>
      </p>
      <Link
        href="/admin/security"
        className="whitespace-nowrap rounded-md border border-red-800 px-3 py-1.5 text-sm font-medium text-red-100 transition-colors hover:bg-red-900/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
      >
        Review sign-in log
      </Link>
    </div>
  );
}
