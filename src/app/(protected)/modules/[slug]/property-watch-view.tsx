"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { Tabs, type TabItem } from "@/components/tabs";
import type { PropertyDetails, PropertySnapshot, WatchedProperty } from "@/lib/property-watch";
import { formatCents } from "@/lib/shared/money";
import {
  addToWatchlistAction,
  lookupPropertyAction,
  refreshWatchlistAction,
  removeFromWatchlistAction,
} from "./property-watch-actions";

export interface WatchlistEntry {
  watchedProperty: WatchedProperty;
  history: PropertySnapshot[];
}

function fallback(value: string | number | undefined): string {
  return value === undefined || value === "" ? "—" : String(value);
}

function OverviewTab({ details }: { details: PropertyDetails }) {
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-xs uppercase tracking-wide text-muted">Type</dt>
        <dd className="text-ink">{fallback(details.propertyType)}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-muted">Beds / Baths</dt>
        <dd className="text-ink">
          {fallback(details.bedrooms)} / {fallback(details.bathrooms)}
        </dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-muted">Square Footage</dt>
        <dd className="text-ink">{fallback(details.squareFootage)}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-muted">Year Built</dt>
        <dd className="text-ink">{fallback(details.yearBuilt)}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-muted">Lot Size (sqft)</dt>
        <dd className="text-ink">{fallback(details.lotSize)}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-muted">County</dt>
        <dd className="text-ink">{fallback(details.county)}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-muted">Subdivision</dt>
        <dd className="text-ink">{fallback(details.subdivision)}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-muted">Zoning</dt>
        <dd className="text-ink">{fallback(details.zoning)}</dd>
      </div>
    </dl>
  );
}

function TaxAndValuationTab({ details }: { details: PropertyDetails }) {
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-xs uppercase tracking-wide text-muted">Tax Assessment</dt>
        <dd className="text-ink">
          {details.latestTaxAssessment
            ? `${formatCents(details.latestTaxAssessment.valueCents)} (${details.latestTaxAssessment.year})`
            : "—"}
        </dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-muted">Land / Improvements</dt>
        <dd className="text-ink">
          {details.latestTaxAssessment?.landCents !== undefined
            ? formatCents(details.latestTaxAssessment.landCents)
            : "—"}{" "}
          /{" "}
          {details.latestTaxAssessment?.improvementsCents !== undefined
            ? formatCents(details.latestTaxAssessment.improvementsCents)
            : "—"}
        </dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-muted">Annual Tax</dt>
        <dd className="text-ink">
          {details.latestAnnualTax
            ? `${formatCents(details.latestAnnualTax.amountCents)} (${details.latestAnnualTax.year})`
            : "—"}
        </dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-muted">HOA Fee</dt>
        <dd className="text-ink">
          {details.hoaFeeCents !== undefined ? `${formatCents(details.hoaFeeCents)}/mo` : "—"}
        </dd>
      </div>
    </dl>
  );
}

function SaleHistoryTab({ details }: { details: PropertyDetails }) {
  return (
    <div className="text-sm">
      <p className="mb-3">
        <span className="text-xs uppercase tracking-wide text-muted">Last Sale: </span>
        <span className="text-ink">
          {details.lastSaleDate
            ? `${details.lastSaleDate}${
                details.lastSalePriceCents !== undefined ? ` for ${formatCents(details.lastSalePriceCents)}` : ""
              }`
            : "—"}
        </span>
      </p>
      {details.saleHistory.length === 0 ? (
        <p className="text-muted">No sale history available.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {details.saleHistory.map((event, index) => (
            <li key={`${event.date}-${index}`} className="text-ink">
              {event.date} — {event.event}
              {event.priceCents !== undefined ? ` — ${formatCents(event.priceCents)}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OwnerTab({ details }: { details: PropertyDetails }) {
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-xs uppercase tracking-wide text-muted">Owner</dt>
        <dd className="text-ink">
          {details.ownerNames.length > 0 ? details.ownerNames.join(", ") : "—"}
        </dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-muted">Owner Type</dt>
        <dd className="text-ink">{fallback(details.ownerType)}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wide text-muted">Owner Occupied</dt>
        <dd className="text-ink">
          {details.ownerOccupied === undefined ? "—" : details.ownerOccupied ? "Yes" : "No"}
        </dd>
      </div>
    </dl>
  );
}

export function PropertyDetailsTabs({ details }: { details: PropertyDetails }) {
  const items: TabItem[] = [
    { key: "overview", label: "Overview", content: <OverviewTab details={details} /> },
    { key: "tax", label: "Tax & Valuation", content: <TaxAndValuationTab details={details} /> },
    { key: "sales", label: "Sale History", content: <SaleHistoryTab details={details} /> },
    { key: "owner", label: "Owner", content: <OwnerTab details={details} /> },
  ];
  return <Tabs items={items} />;
}

function PropertyLookup({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [details, setDetails] = useState<PropertyDetails | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [addedMessage, setAddedMessage] = useState<string | undefined>(undefined);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError(undefined);
    setAddedMessage(undefined);
    try {
      const result = await lookupPropertyAction(address);
      if (!result.ok || !result.details) {
        setError(result.error ?? "Failed to look up property.");
        setDetails(undefined);
        return;
      }
      setDetails(result.details);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleAddToWatchlist() {
    if (!details) return;
    setIsSaving(true);
    try {
      const result = await addToWatchlistAction(address, details);
      if (!result.ok) {
        setError(result.error ?? "Failed to add property to watch list.");
        return;
      }
      setAddedMessage(`Added "${details.address}" to your watch list.`);
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  if (!enabled) {
    return (
      <p className="text-sm text-muted">
        Property lookup isn&apos;t configured. Set <code>RENTCAST_API_KEY</code> to enable it.
      </p>
    );
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="123 Main St, Anytown, ST 12345"
          className="flex-1 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
        <Button type="submit" disabled={isLoading || address.trim() === ""}>
          {isLoading ? "Looking up…" : "Look up"}
        </Button>
      </form>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      {addedMessage && <p className="mt-2 text-sm text-emerald-400">{addedMessage}</p>}
      {details && (
        <div className="mt-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-lg text-ink">{details.address}</h3>
            <Button size="sm" variant="secondary" disabled={isSaving} onClick={handleAddToWatchlist}>
              {isSaving ? "Adding…" : "Add to Watch List"}
            </Button>
          </div>
          <PropertyDetailsTabs details={details} />
        </div>
      )}
    </div>
  );
}

function WatchlistHistoryTable({ history }: { history: PropertySnapshot[] }) {
  const columns: DataGridColumn<PropertySnapshot>[] = [
    { key: "fetchedAt", header: "Fetched", render: (snapshot) => snapshot.fetchedAt },
    { key: "sqft", header: "Sqft", render: (snapshot) => fallback(snapshot.squareFootage) },
    {
      key: "taxAssessment",
      header: "Tax Assessment",
      render: (snapshot) =>
        snapshot.taxAssessedValueCents !== undefined ? formatCents(snapshot.taxAssessedValueCents) : "—",
    },
    {
      key: "lastSale",
      header: "Last Sale",
      render: (snapshot) =>
        snapshot.lastSalePriceCents !== undefined
          ? `${formatCents(snapshot.lastSalePriceCents)} (${snapshot.lastSaleDate})`
          : "—",
    },
  ];

  return (
    <DataGrid
      columns={columns}
      rows={history}
      getRowKey={(snapshot) => snapshot.id}
      emptyMessage="No snapshots yet."
      className="mt-2"
    />
  );
}

export function PropertyWatchView({
  watchlist,
  propertyLookupEnabled,
}: {
  watchlist: WatchlistEntry[];
  propertyLookupEnabled: boolean;
}) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<number | undefined>(undefined);
  const [busyId, setBusyId] = useState<number | undefined>(undefined);

  async function handleRefresh(watchedPropertyId: number) {
    setBusyId(watchedPropertyId);
    try {
      const result = await refreshWatchlistAction(watchedPropertyId);
      if (!result.ok) window.alert(result.error);
      else router.refresh();
    } finally {
      setBusyId(undefined);
    }
  }

  async function handleRemove(entry: WatchlistEntry) {
    if (!window.confirm(`Remove "${entry.watchedProperty.address}" from the watch list?`)) return;
    setBusyId(entry.watchedProperty.id);
    try {
      const result = await removeFromWatchlistAction(entry.watchedProperty.id);
      if (!result.ok) window.alert(result.error);
      else router.refresh();
    } finally {
      setBusyId(undefined);
    }
  }

  const columns: DataGridColumn<WatchlistEntry>[] = [
    { key: "address", header: "Address", render: (entry) => entry.watchedProperty.address },
    {
      key: "sqft",
      header: "Sqft",
      render: (entry) => fallback(entry.history[0]?.squareFootage),
    },
    {
      key: "taxAssessment",
      header: "Tax Assessment",
      render: (entry) =>
        entry.history[0]?.taxAssessedValueCents !== undefined
          ? formatCents(entry.history[0].taxAssessedValueCents)
          : "—",
    },
    {
      key: "lastFetched",
      header: "Last Updated",
      render: (entry) => fallback(entry.history[0]?.fetchedAt),
    },
    {
      key: "actions",
      header: "Actions",
      render: (entry) => (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busyId === entry.watchedProperty.id || !propertyLookupEnabled}
            onClick={() => handleRefresh(entry.watchedProperty.id)}
            className="text-xs font-medium text-brass-dark hover:underline disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() =>
              setExpandedId((current) => (current === entry.watchedProperty.id ? undefined : entry.watchedProperty.id))
            }
            className="text-xs font-medium text-brass-dark hover:underline"
          >
            {expandedId === entry.watchedProperty.id ? "Hide History" : "History"}
          </button>
          <button
            type="button"
            disabled={busyId === entry.watchedProperty.id}
            onClick={() => handleRemove(entry)}
            className="text-xs font-medium text-red-400 hover:underline disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      ),
    },
  ];

  const expandedEntry = watchlist.find((entry) => entry.watchedProperty.id === expandedId);

  return (
    <div>
      <CollapsibleCard title="Property Lookup" defaultOpen>
        <PropertyLookup enabled={propertyLookupEnabled} />
      </CollapsibleCard>

      <div className="mt-6">
        <h2 className="font-display text-xl text-ink">Watch List</h2>
        <div className="mt-3">
          <DataGrid
            columns={columns}
            rows={watchlist}
            getRowKey={(entry) => entry.watchedProperty.id}
            emptyMessage="Nothing on your watch list yet."
          />
        </div>
        {expandedEntry && (
          <div className="mt-2">
            <p className="text-sm font-medium text-ink">History for {expandedEntry.watchedProperty.address}</p>
            <WatchlistHistoryTable history={expandedEntry.history} />
          </div>
        )}
      </div>
    </div>
  );
}
