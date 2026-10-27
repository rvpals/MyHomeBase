"use client";

// Configuration: how much of a clip a card shows.
//
// The setting lives in `sys_module_settings` as a key/value row under the Clips
// module — the same storage the Journal's `photo_root` uses — so adding it needed no
// migration. See `src/lib/clips/settings.ts`.

import { useState } from "react";
import { Button } from "@/components/button";
import { MAX_CLIP_EXCERPT_CHARS, MIN_CLIP_EXCERPT_CHARS } from "@/lib/clips";
import { setClipExcerptCharsAction } from "./clips-actions";

export interface ClipsConfigurationViewProps {
  /** The stored value, already clamped by the resolver. */
  excerptChars: number;
  /** Whether this reader may change it — the setting is module-wide. */
  canEdit: boolean;
}

export function ClipsConfigurationView({ excerptChars, canEdit }: ClipsConfigurationViewProps) {
  const [value, setValue] = useState(String(excerptChars));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError("");
    setSaved(false);

    const result = await setClipExcerptCharsAction(Number(value));

    setSaving(false);
    if (result.ok) setSaved(true);
    else setError(result.error ?? "Could not save that setting.");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-paper-raised p-4">
        <label htmlFor="clip-excerpt" className="mb-1 block text-sm font-medium text-ink">
          Card excerpt length
        </label>
        <p className="mb-2 text-xs text-muted">
          How much of a clip a card shows on the board and in the list, before it is cut
          on a word boundary. Between {MIN_CLIP_EXCERPT_CHARS} and {MAX_CLIP_EXCERPT_CHARS}{" "}
          characters. This applies to everyone — it is a module setting, not a personal one.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <input
            id="clip-excerpt"
            type="number"
            min={MIN_CLIP_EXCERPT_CHARS}
            max={MAX_CLIP_EXCERPT_CHARS}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={!canEdit}
            className="w-32 rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass disabled:opacity-50"
          />
          {canEdit && (
            <Button variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          )}
        </div>

        {/* A value outside the range is clamped rather than refused — a reader who
            typed 5000 meant "as much as possible". Said here so the number changing
            under them after a save is not a surprise. */}
        <p className="mt-2 text-xs text-muted">
          A value outside the range is adjusted to the nearest end rather than rejected.
        </p>

        {!canEdit && (
          <p className="mt-2 text-xs text-muted">
            Only an administrator can change this.
          </p>
        )}

        {/* `text-red-400`, not `text-danger`: there is no `danger` colour token, so
            that class resolves to nothing. design.md keeps semantic red literal. */}
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        {saved && <p className="mt-2 text-sm text-muted">Saved.</p>}
      </div>

      <div className="rounded-xl border border-line bg-paper-raised p-4">
        <p className="text-sm text-muted">
          Image limits (5&nbsp;MB each, 20 per clip) and the list of modules a clip can be
          attached to are fixed in code for now — they move here if either needs to vary.
        </p>
      </div>
    </div>
  );
}
