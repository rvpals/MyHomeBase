"use client";

// Configuration -> Home screen layout: which cards the Journal home screen draws, and in
// what order. Route-local — it is this module's one screen bound to its one action; the
// list itself is the registered `DesktopWidgetsConfig`.
//
// Edits a local draft and writes once on Save, so reordering six rows is one write.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DesktopWidgetsConfig } from "@/components/desktop-widgets-config";
import {
  JOURNAL_HOME_WIDGET_INFO,
  defaultJournalHomeWidgets,
  reorderJournalHomeWidget,
  toggleJournalHomeWidget,
  type JournalHomeWidgetPreference,
} from "@/lib/journal";
import { saveJournalHomeWidgetsAction } from "./journal-home-screen-actions";

export function JournalHomeScreenView({ widgets }: { widgets: JournalHomeWidgetPreference[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState(widgets);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(widgets);
  const allHidden = draft.every((widget) => !widget.visible);

  function update(next: JournalHomeWidgetPreference[]) {
    setDraft(next);
    setMessage(undefined);
    setError(undefined);
  }

  async function handleSave() {
    setIsSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await saveJournalHomeWidgetsAction(draft);
      if (!result.ok) {
        setError(result.error ?? "Failed to save the layout.");
        return;
      }
      setMessage("Home screen layout saved.");
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <CollapsibleCard title="Home screen cards" defaultOpen>
      <p className="text-sm text-muted">
        Untick a card to keep it off your Journal home screen, and drag a card&apos;s handle to
        set the order. This is your own layout — it doesn&apos;t change what anyone else sees. Hiding a
        card changes only what the home screen draws; nothing stops being recorded.
      </p>

      <DesktopWidgetsConfig
        className="mt-4"
        disabled={isSaving}
        widgets={draft.map((widget) => ({
          id: widget.id,
          label: JOURNAL_HOME_WIDGET_INFO[widget.id].label,
          description: JOURNAL_HOME_WIDGET_INFO[widget.id].description,
          visible: widget.visible,
        }))}
        onReorder={(id, targetId) => update(reorderJournalHomeWidget(draft, id, targetId))}
        onToggle={(id) => update(toggleJournalHomeWidget(draft, id))}
      />

      {allHidden && (
        <p className="mt-3 text-sm text-brass-dark">
          Every card is hidden — the home screen will show only its header and search. The
          section panel still navigates, so this isn&apos;t a dead end.
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
          onClick={() => update(defaultJournalHomeWidgets())}
          disabled={isSaving}
        >
          Reset to default
        </Button>
      </div>
    </CollapsibleCard>
  );
}
