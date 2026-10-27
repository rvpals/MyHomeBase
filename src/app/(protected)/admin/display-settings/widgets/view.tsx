"use client";

// The Dashboard Widgets list: a checkbox and a pair of arrows per home screen card.
//
// Route-local rather than a registered component: it's one admin control bound to this
// screen's action, and `components.md` keeps page-specific UI out of the registry.
//
// The row list is the registered `DesktopWidgetsConfig` (drag the handle to reorder,
// arrow keys on the focused handle for the keyboard); this view owns only the draft,
// the save, and the copy around it.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DesktopWidgetsConfig } from "@/components/desktop-widgets-config";
import {
  HOME_WIDGET_INFO,
  defaultHomeWidgets,
  reorderHomeWidget,
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
        Untick a card to keep it off the home screen, and drag a card&rsquo;s handle to set
        the order they appear in. Hiding a card changes only what the home screen draws — nothing
        stops being recorded, and every card is still reachable from its own module.
      </p>
      <p className="mt-2 text-sm text-muted">
        A ticked card still has to have something to show. Stock Daily Glance needs
        positions and access to the Stocks &amp; ETFs module, and Daily Quote needs at
        least one quote — ticking either can&apos;t conjure data that isn&apos;t there.
      </p>

      <DesktopWidgetsConfig
        className="mt-4"
        disabled={isSaving}
        widgets={draft.map((widget) => ({
          id: widget.id,
          label: HOME_WIDGET_INFO[widget.id].label,
          description: HOME_WIDGET_INFO[widget.id].description,
          visible: widget.visible,
        }))}
        onReorder={(id, targetId) => update(reorderHomeWidget(draft, id, targetId))}
        onToggle={(id) => update(toggleHomeWidget(draft, id))}
      />

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
