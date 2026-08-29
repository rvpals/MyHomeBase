"use client";

// The Dashboard Widgets list: a checkbox and a pair of arrows per home screen card.
//
// Route-local rather than a registered component: it's one admin control bound to this
// screen's action, and `components.md` keeps page-specific UI out of the registry.
//
// Reorder is up/down buttons rather than drag-and-drop — five rows don't need a drag
// library, and buttons are keyboard-operable and screen-reader-legible for free. The
// arrow markup matches Configuration -> Module Configuration, its nearest neighbour in
// this section, rather than the Stocks module's slightly different hand-roll.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import {
  HOME_WIDGET_INFO,
  defaultHomeWidgets,
  moveHomeWidget,
  toggleHomeWidget,
  type HomeWidgetPreference,
} from "@/lib/home-dashboard";
import { saveHomeWidgetsAction } from "./actions";

export function DashboardWidgetsView({ widgets }: { widgets: HomeWidgetPreference[] }) {
  const router = useRouter();
  // Local until saved, so reordering five rows is one write, not five.
  const [draft, setDraft] = useState(widgets);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(widgets);
  const hiddenCount = draft.filter((widget) => !widget.visible).length;

  function update(next: HomeWidgetPreference[]) {
    setDraft(next);
    setMessage(undefined);
    setError(undefined);
  }

  async function handleSave() {
    setIsSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await saveHomeWidgetsAction(draft);
      if (!result.ok) {
        setError(result.error ?? "Failed to save the layout.");
        return;
      }
      setMessage("Home screen layout saved.");
      // The home screen is a different route, so refresh rather than trusting this
      // page's own cache to carry the change.
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <CollapsibleCard className="mt-8" title="Home screen cards">
      <p className="text-sm text-muted">
        Untick a card to keep it off the home screen, and use the arrows to set the order
        they appear in. Hiding a card changes only what the home screen draws — nothing
        stops being recorded, and every card is still reachable from its own module.
      </p>
      <p className="mt-2 text-sm text-muted">
        A ticked card still has to have something to show. Stock Daily Glance needs
        positions and access to the Stocks &amp; ETFs module, and Daily Quote needs at
        least one quote — ticking either can&apos;t conjure data that isn&apos;t there.
      </p>

      <ul className="mt-4 flex flex-col gap-2">
        {draft.map((widget, index) => {
          const info = HOME_WIDGET_INFO[widget.id];
          return (
            <li
              key={widget.id}
              className={`flex items-start gap-3 rounded-md border border-line p-3 ${
                widget.visible ? "" : "opacity-60"
              }`}
            >
              <span className="mt-0.5 flex shrink-0 flex-col gap-1">
                <button
                  type="button"
                  onClick={() => update(moveHomeWidget(draft, widget.id, "up"))}
                  disabled={index === 0}
                  aria-label={`Move ${info.label} up`}
                  className="h-7 w-7 rounded border border-line text-xs text-brass-dark hover:bg-paper-raised disabled:opacity-30"
                >
                  &uarr;
                </button>
                <button
                  type="button"
                  onClick={() => update(moveHomeWidget(draft, widget.id, "down"))}
                  disabled={index === draft.length - 1}
                  aria-label={`Move ${info.label} down`}
                  className="h-7 w-7 rounded border border-line text-xs text-brass-dark hover:bg-paper-raised disabled:opacity-30"
                >
                  &darr;
                </button>
              </span>

              <span className="mt-1.5 shrink-0 font-mono text-xs text-muted">{index + 1}</span>

              <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={widget.visible}
                  onChange={() => update(toggleHomeWidget(draft, widget.id))}
                  className="mt-1"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{info.label}</span>
                  <span className="block text-xs text-muted">{info.description}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {hiddenCount === draft.length && (
        <p className="mt-3 text-sm text-brass-dark">
          Every card is hidden — the home screen will show only the header and the module
          rail. Both still navigate, so this isn&apos;t a dead end.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {!error && message && <p className="mt-3 text-sm text-brass">{message}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={handleSave} disabled={isSaving || !isDirty}>
          {isSaving ? "Saving…" : "Save layout"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => update(defaultHomeWidgets())}
          disabled={isSaving}
        >
          Reset to default
        </Button>
      </div>
    </CollapsibleCard>
  );
}
