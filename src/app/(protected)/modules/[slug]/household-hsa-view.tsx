import { PAGE_CONTAINER } from "../../page-container";

// The HSA Tracker placeholder.
//
// A deliberate stub, and a server component with no props: it owns no table, no
// repository method and no action. It exists so the module's second half is a real
// destination with a real route from day one — a nav row that leads to a 404 reads
// as broken, where one that leads to "not built yet" reads as unfinished.
//
// Nothing here is load-bearing. When the HSA work lands, this file is replaced
// wholesale and the section list around it does not change.

export function HouseholdHsaView() {
  return (
    <div className={PAGE_CONTAINER}>
      <div className="rounded-xl border border-line p-4">
        <p className="text-sm text-muted">
          Not built yet. This is where the household&apos;s health savings account will
          live — contributions against the year&apos;s limit, claims and their receipts,
          and what is left to reimburse.
        </p>
        <p className="mt-2 text-sm text-muted">
          Nothing is stored for it yet, so there is nothing to lose by leaving it: the
          module&apos;s tables carry no HSA columns, and adding them later is an ordinary
          migration.
        </p>
      </div>
    </div>
  );
}
