"use client";

// The Floating Components list: one checkbox per registered floating component.
//
// Route-local rather than a registered component, for the reason components.md gives:
// it's one admin control bound to this screen's action. Modelled directly on the
// Dashboard Widgets view next door — same card, same draft-then-save shape, same
// message placement — because an admin moving between the two screens should not have
// to learn a second idiom. No reorder arrows: pucks stack in registry order, which
// `resolvePuckSlots` owns and an admin has no reason to rearrange.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import type { FloatingComponentInfo, FloatingId } from "@/lib/floating";
import { saveFloatingEnabledAction } from "./actions";

export function FloatingComponentsView({
  components,
  enabled,
}: {
  components: readonly FloatingComponentInfo[];
  enabled: readonly FloatingId[];
}) {
  const router = useRouter();
  // Local until saved, so ticking several rows is one write rather than one each.
  const [draft, setDraft] = useState<FloatingId[]>([...enabled]);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  // Compared as sorted sets: the stored value is registry-ordered, so a plain
  // `JSON.stringify` of the draft would read as dirty purely from tick order.
  const isDirty =
    JSON.stringify([...draft].sort()) !== JSON.stringify([...enabled].sort());

  function toggle(id: FloatingId) {
    setDraft((current) =>
      current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id],
    );
    setMessage(undefined);
    setError(undefined);
  }

  async function handleSave() {
    setIsSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await saveFloatingEnabledAction(draft);
      if (!result.ok) {
        setError(result.error ?? "Failed to save.");
        return;
      }
      setMessage("Floating components saved.");
      // Every page hosts the floating layer, so refresh rather than trusting this
      // page's own cache to carry the change.
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <CollapsibleCard className="mt-8" title="Available floating components">
      <p className="text-sm text-muted">
        Tick a component to make it available. Each person then opens it from their own
        Account page — ticking it here does not put it on anyone&apos;s screen.
      </p>
      <p className="mt-2 text-sm text-muted">
        Unticking one takes it off every screen immediately, including for anyone who has
        it open. Nothing is forgotten: if you tick it again, each person gets back the
        window or the corner image they last had.
      </p>

      <ul className="mt-4 flex flex-col gap-2">
        {components.map((component) => {
          const isTicked = draft.includes(component.id);
          return (
            <li
              key={component.id}
              className={`rounded-md border border-line p-3 ${isTicked ? "" : "opacity-60"}`}
            >
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={isTicked}
                  onChange={() => toggle(component.id)}
                  className="mt-1"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{component.label}</span>
                  <span className="block text-xs text-muted">{component.description}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {draft.length === 0 && (
        <p className="mt-3 text-sm text-brass-dark">
          Nothing is available — no floating components will appear anywhere, and the
          Floating Components panel on each person&apos;s Account page will say so.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {!error && message && <p className="mt-3 text-sm text-brass">{message}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={handleSave} disabled={isSaving || !isDirty}>
          {isSaving ? "Saving…" : "Save"}
        </Button>
      </div>
    </CollapsibleCard>
  );
}
