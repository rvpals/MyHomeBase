"use client";

// The Dashboard Widget Configuration card: settings that belong to one home-screen
// widget rather than to the layout. Today it holds one group box, the MyHomeBase
// Control Center's per-system counts; a future widget's settings get a sibling box.
//
// Route-local, like `view.tsx` beside it: one admin form bound to this screen's action.
// The controls are the registered `NumberField` and `ToggleSwitch`. Bounds and defaults
// come from `CONTROL_CENTER_COUNTS` in lib, so this file holds no numbers of its own.
//
// Narrow (< 1024px): the system blocks stack in one column; wide: a two/three-column
// grid. Each control is a full-width row, so nothing needs a different component.

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { NumberField } from "@/components/number-field";
import { ToggleSwitch } from "@/components/toggle-switch";
import {
  CONTROL_CENTER_COUNTS,
  defaultControlCenterConfig,
  type ControlCenterConfig,
  type ControlCenterCountKey,
} from "@/lib/home-dashboard";
import { saveControlCenterConfigAction } from "./actions";

/** One system's block inside the group box. */
function SystemBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-paper p-3">
      <h4 className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        {title}
      </h4>
      <div className="mt-2 space-y-3">{children}</div>
    </div>
  );
}

export function ControlCenterConfigView({ config }: { config: ControlCenterConfig }) {
  const router = useRouter();
  const [draft, setDraft] = useState(config);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(config);

  function update(next: ControlCenterConfig) {
    setDraft(next);
    setMessage(undefined);
    setError(undefined);
  }

  function countField(key: ControlCenterCountKey, label: string) {
    const info = CONTROL_CENTER_COUNTS[key];
    return (
      <NumberField
        label={label}
        description={`${info.min}–${info.max}, default ${info.defaultValue}`}
        min={info.min}
        max={info.max}
        value={draft[key]}
        disabled={isSaving}
        onChange={(value) => update({ ...draft, [key]: value })}
      />
    );
  }

  async function handleSave() {
    setIsSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await saveControlCenterConfigAction(draft);
      if (!result.ok) {
        setError(result.error ?? "Failed to save the settings.");
        return;
      }
      setMessage("Control Center settings saved.");
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <CollapsibleCard className="mt-8" title="Dashboard Widget Configuration">
      <p className="text-sm text-muted">
        Settings that belong to one home screen card. Like the layout above, these apply to
        everyone.
      </p>

      <fieldset className="mt-4 rounded-xl border border-line p-4 max-lg:p-3">
        <legend className="px-2 text-sm font-semibold text-ink">
          MyHomeBase Control Center
        </legend>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3 max-lg:grid-cols-1">
          <SystemBlock title="Money">
            {countField("moneyMovers", "# of gainers and losers to display")}
          </SystemBlock>
          <SystemBlock title="Journal & Notes">
            {countField("journalEntries", "# of recent journal entries to display")}
          </SystemBlock>
          <SystemBlock title="Household">
            {countField("householdRecipes", "# of recipes to try")}
          </SystemBlock>
          <SystemBlock title="Media">
            {countField("mediaTopTracks", "# of most played songs to display")}
            <ToggleSwitch
              label="Display random pictures"
              description="The “From the archive” photo"
              checked={draft.mediaRandomPhoto}
              disabled={isSaving}
              onChange={(checked) => update({ ...draft, mediaRandomPhoto: checked })}
            />
          </SystemBlock>
          <SystemBlock title="Classroom">
            {countField("classroomClasses", "# of classes to display")}
          </SystemBlock>
          <SystemBlock title="Misc">
            <p className="text-sm text-muted">
              Workbench and Everything else list their modules only — no settings yet.
            </p>
          </SystemBlock>
        </div>
      </fieldset>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {!error && message && <p className="mt-3 text-sm text-brass">{message}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={handleSave} disabled={isSaving || !isDirty}>
          {isSaving ? "Saving…" : "Save settings"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => update(defaultControlCenterConfig())}
          disabled={isSaving}
        >
          Reset to default
        </Button>
      </div>
    </CollapsibleCard>
  );
}
