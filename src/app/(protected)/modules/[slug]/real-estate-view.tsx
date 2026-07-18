"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { summarizePortfolio, type Property } from "@/lib/real-estate";
import { centsToDollars, formatCents } from "@/lib/shared/money";
import {
  createPropertyAction,
  deletePropertyAction,
  updatePropertyAction,
  type PropertyFormInput,
} from "./real-estate-actions";

const EMPTY_FORM: PropertyFormInput = {
  address: "",
  purchasePrice: "",
  purchaseDate: "",
  currentValue: "",
  mortgageBalance: "",
  notes: "",
};

function toFormInput(property: Property): PropertyFormInput {
  return {
    address: property.address,
    purchasePrice: centsToDollars(property.purchasePriceCents).toFixed(2),
    purchaseDate: property.purchaseDate,
    currentValue: centsToDollars(property.currentValueCents).toFixed(2),
    mortgageBalance: centsToDollars(property.mortgageBalanceCents).toFixed(2),
    notes: property.notes ?? "",
  };
}

function PropertyForm({
  title,
  initialValue,
  onSave,
  onCancel,
}: {
  title: string;
  initialValue: PropertyFormInput;
  onSave: (input: PropertyFormInput) => Promise<string | undefined>;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState(initialValue);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(undefined);
    try {
      const failure = await onSave(form);
      if (failure) {
        setError(failure);
        return;
      }
      setForm(EMPTY_FORM);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="block text-sm sm:col-span-2">
        <span className="mb-1 block font-medium text-ink">Address</span>
        <input
          value={form.address}
          onChange={(event) => setForm({ ...form, address: event.target.value })}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Purchase price ($)</span>
        <input
          value={form.purchasePrice}
          onChange={(event) => setForm({ ...form, purchasePrice: event.target.value })}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Purchase date</span>
        <input
          type="date"
          value={form.purchaseDate}
          onChange={(event) => setForm({ ...form, purchaseDate: event.target.value })}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Current value ($)</span>
        <input
          value={form.currentValue}
          onChange={(event) => setForm({ ...form, currentValue: event.target.value })}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Mortgage balance ($)</span>
        <input
          value={form.mortgageBalance}
          onChange={(event) => setForm({ ...form, mortgageBalance: event.target.value })}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      <label className="block text-sm sm:col-span-2">
        <span className="mb-1 block font-medium text-ink">Notes</span>
        <input
          value={form.notes}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <button
          type="submit"
          disabled={isSaving}
          className="rounded-full bg-brass px-4 py-2 text-sm font-medium text-white hover:bg-brass-dark disabled:opacity-50"
        >
          {isSaving ? "Saving…" : title}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-line px-4 py-2 text-sm font-medium text-muted hover:text-ink"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export function RealEstateView({ properties }: { properties: Property[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<number | undefined>(undefined);

  const summary = summarizePortfolio(properties);

  async function handleCreate(input: PropertyFormInput) {
    const result = await createPropertyAction(input);
    if (!result.ok) return result.error ?? "Failed to add property.";
    router.refresh();
    return undefined;
  }

  async function handleUpdate(propertyId: number, input: PropertyFormInput) {
    const result = await updatePropertyAction(propertyId, input);
    if (!result.ok) return result.error ?? "Failed to update property.";
    setEditingId(undefined);
    router.refresh();
    return undefined;
  }

  async function handleDelete(property: Property) {
    if (!window.confirm(`Delete "${property.address}"? This cannot be undone.`)) return;
    const result = await deletePropertyAction(property.id);
    if (result.ok) router.refresh();
    else window.alert(result.error);
  }

  const columns: DataGridColumn<Property>[] = [
    { key: "address", header: "Address", render: (property) => property.address },
    { key: "purchaseDate", header: "Purchase Date", render: (property) => property.purchaseDate },
    {
      key: "purchasePrice",
      header: "Purchase Price",
      render: (property) => formatCents(property.purchasePriceCents),
    },
    {
      key: "currentValue",
      header: "Current Value",
      render: (property) => formatCents(property.currentValueCents),
    },
    {
      key: "mortgageBalance",
      header: "Mortgage",
      render: (property) => formatCents(property.mortgageBalanceCents),
    },
    {
      key: "equity",
      header: "Equity",
      render: (property) => formatCents(property.currentValueCents - property.mortgageBalanceCents),
    },
    {
      key: "notes",
      header: "Notes",
      render: (property) => <span className="text-muted">{property.notes ?? "—"}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      render: (property) => (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditingId(property.id)}
            className="text-xs font-medium text-brass-dark hover:underline"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => handleDelete(property)}
            className="text-xs font-medium text-red-600 hover:underline"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  const editingProperty = properties.find((property) => property.id === editingId);

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-line p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Properties</p>
          <p className="mt-1 font-display text-xl text-ink">{summary.propertyCount}</p>
        </div>
        <div className="rounded-xl border border-line p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Total Value</p>
          <p className="mt-1 font-display text-xl text-ink">
            {formatCents(summary.totalCurrentValueCents)}
          </p>
        </div>
        <div className="rounded-xl border border-line p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Total Mortgage</p>
          <p className="mt-1 font-display text-xl text-ink">
            {formatCents(summary.totalMortgageBalanceCents)}
          </p>
        </div>
        <div className="rounded-xl border border-line p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Total Equity</p>
          <p className="mt-1 font-display text-xl text-ink">
            {formatCents(summary.totalEquityCents)}
          </p>
        </div>
      </div>

      <div className="mt-6">
        <CollapsibleCard title="Add Property">
          <PropertyForm title="Add property" initialValue={EMPTY_FORM} onSave={handleCreate} />
        </CollapsibleCard>
      </div>

      {editingProperty && (
        <div className="mt-6">
          <CollapsibleCard title={`Edit: ${editingProperty.address}`} defaultOpen>
            <PropertyForm
              title="Save changes"
              initialValue={toFormInput(editingProperty)}
              onSave={(input) => handleUpdate(editingProperty.id, input)}
              onCancel={() => setEditingId(undefined)}
            />
          </CollapsibleCard>
        </div>
      )}

      <div className="mt-6">
        <DataGrid
          columns={columns}
          rows={properties}
          getRowKey={(property) => property.id}
          emptyMessage="No properties yet."
        />
      </div>
    </div>
  );
}
