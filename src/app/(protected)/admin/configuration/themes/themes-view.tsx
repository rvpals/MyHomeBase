"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import type { StoredColorTheme } from "@/lib/color-themes";
import { COLOR_THEMES } from "@/lib/settings";
import {
  createColorThemeAction,
  deleteColorThemeAction,
  duplicateColorThemeAction,
  resetColorThemeAction,
  saveColorThemeAction,
} from "../../actions";
import { useAdminSettings } from "../../admin-shell";
import { PAGE_CONTAINER } from "../../../page-container";
import { ThemeBuilder, type ThemeBuilderValue } from "./theme-builder";

/** A blank theme to start from, so "New theme" is not nine black swatches. */
const BLANK_THEME: ThemeBuilderValue = {
  id: "",
  name: "",
  description: "",
  tokens: {
    paper: "#12161A",
    paperRaised: "#1A1F26",
    ink: "#EEF2F3",
    line: "#2B323B",
    muted: "#8B96A1",
    mutedInverse: "#5B6470",
    brass: "#33E2B8",
    brassDark: "#1C8A71",
    brassSoft: "#15332D",
    fonts: { display: "space-grotesk", body: "manrope", mono: "jetbrains-mono" },
  },
};

type Editing =
  | { mode: "create"; value: ThemeBuilderValue }
  | { mode: "edit"; value: ThemeBuilderValue; isBuiltin: boolean };

export function ColorThemesView({
  themes,
  savedThemeId,
}: {
  themes: StoredColorTheme[];
  savedThemeId: string;
}) {
  const router = useRouter();
  // Selection stays on the admin shell's draft-then-Save path, unchanged: picking a
  // theme is one of the settings the shell's Save button writes. Creating, editing,
  // duplicating, deleting and resetting apply IMMEDIATELY through their own actions —
  // a half-built theme sitting in draft state would be invisible to the preview and
  // lost on navigation.
  const { colorThemeId, setColorThemeId } = useAdminSettings();

  const [editing, setEditing] = useState<Editing | undefined>();
  const [isSaving, setIsSaving] = useState(false);
  const [builderError, setBuilderError] = useState<string | undefined>();
  const [rowError, setRowError] = useState<string | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<StoredColorTheme | undefined>();
  const [busyId, setBusyId] = useState<string | undefined>();

  /** Every row action answers the same shape, so they are handled uniformly. */
  const run = async (
    id: string,
    action: () => Promise<{ ok: boolean; error?: string }>,
  ) => {
    setBusyId(id);
    setRowError(undefined);
    try {
      const result = await action();
      if (result.ok) router.refresh();
      else setRowError(result.error);
    } finally {
      setBusyId(undefined);
    }
  };

  const handleSaveFromBuilder = async (value: ThemeBuilderValue) => {
    setIsSaving(true);
    setBuilderError(undefined);
    try {
      const result =
        editing?.mode === "create"
          ? await createColorThemeAction(value)
          : await saveColorThemeAction(value);

      if (!result.ok) {
        setBuilderError(result.error);
        return;
      }

      // A newly created theme is selected straight away — building one and then having
      // to find and click it would be a pointless second step.
      if (editing?.mode === "create" && result.id) setColorThemeId(result.id);
      setEditing(undefined);
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={PAGE_CONTAINER}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Configuration
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Color Themes</h1>
      <p className="mt-2 text-sm text-muted">
        Pick a color theme for the whole application, or build your own. Selecting one
        takes effect when you press Save; creating and editing themes applies right away.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button
          onClick={() => {
            setBuilderError(undefined);
            setEditing({ mode: "create", value: BLANK_THEME });
          }}
        >
          New theme
        </Button>
        <span className="text-xs text-muted">
          {themes.length} theme{themes.length === 1 ? "" : "s"}
        </span>
      </div>

      {rowError && (
        <p className="mt-4 rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-sm text-red-400">
          {rowError}
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {themes.map((theme) => {
          const active = theme.id === colorThemeId;
          const isBusy = busyId === theme.id;
          // Only a built-in that still has a code definition can be reset. One seeded
          // by an older migration and since removed from `COLOR_THEMES` cannot.
          const canReset =
            theme.isBuiltin && COLOR_THEMES.some((entry) => entry.id === theme.id);

          return (
            <div
              key={theme.id}
              className={`rounded-xl border p-4 transition ${
                active ? "border-brass ring-2 ring-brass" : "border-line"
              }`}
              style={{ backgroundColor: theme.tokens.paperRaised }}
            >
              {/* The card itself selects; the buttons below act. A nested <button> is
                  invalid HTML, so this is a div with its own click target rather than
                  the whole card being one button as before. */}
              <button
                type="button"
                onClick={() => setColorThemeId(theme.id)}
                aria-pressed={active}
                className="w-full text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="flex shrink-0 -space-x-1.5">
                    <span
                      className="h-6 w-6 rounded-full border border-black/10"
                      style={{ backgroundColor: theme.tokens.paper }}
                    />
                    <span
                      className="h-6 w-6 rounded-full border border-black/10"
                      style={{ backgroundColor: theme.tokens.brass }}
                    />
                    <span
                      className="h-6 w-6 rounded-full border border-black/10"
                      style={{ backgroundColor: theme.tokens.ink }}
                    />
                  </span>
                  <span
                    className="min-w-0 truncate font-display text-base font-semibold"
                    style={{ color: theme.tokens.ink }}
                  >
                    {theme.name}
                  </span>
                  {active && (
                    <span
                      className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
                      style={{
                        backgroundColor: theme.tokens.brass,
                        color: theme.tokens.paper,
                      }}
                    >
                      Selected
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm" style={{ color: theme.tokens.muted }}>
                  {theme.description || "No description."}
                </p>
              </button>

              <div
                className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3"
                style={{ borderColor: theme.tokens.line }}
              >
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isBusy}
                  onClick={() => {
                    setBuilderError(undefined);
                    setEditing({
                      mode: "edit",
                      isBuiltin: theme.isBuiltin,
                      value: {
                        id: theme.id,
                        name: theme.name,
                        description: theme.description,
                        tokens: theme.tokens,
                      },
                    });
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isBusy}
                  onClick={() =>
                    run(theme.id, () =>
                      duplicateColorThemeAction(theme.id, `${theme.name} copy`),
                    )
                  }
                >
                  Duplicate
                </Button>
                {canReset && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={isBusy}
                    title="Restore this built-in theme's original colors and fonts"
                    onClick={() => run(theme.id, () => resetColorThemeAction(theme.id))}
                  >
                    Reset
                  </Button>
                )}
                {!theme.isBuiltin && (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={isBusy || theme.id === savedThemeId}
                    title={
                      theme.id === savedThemeId
                        ? "This theme is in use — switch to another one first"
                        : "Delete this theme"
                    }
                    onClick={() => setConfirmDelete(theme)}
                  >
                    Delete
                  </Button>
                )}
                {theme.isBuiltin && (
                  <span
                    className="ml-auto text-[10px] uppercase tracking-wider"
                    style={{ color: theme.tokens.mutedInverse }}
                  >
                    Built-in
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <ThemeBuilder
          mode={editing.mode}
          initial={editing.value}
          isBuiltin={editing.mode === "edit" && editing.isBuiltin}
          onSave={handleSaveFromBuilder}
          onClose={() => setEditing(undefined)}
          isSaving={isSaving}
          error={builderError}
        />
      )}

      {confirmDelete && (
        <Modal
          title={`Delete ${confirmDelete.name}?`}
          description="This cannot be undone."
          onClose={() => setConfirmDelete(undefined)}
          isBusy={busyId === confirmDelete.id}
          size="sm"
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setConfirmDelete(undefined)}
                disabled={busyId === confirmDelete.id}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={busyId === confirmDelete.id}
                onClick={async () => {
                  const id = confirmDelete.id;
                  setConfirmDelete(undefined);
                  await run(id, () => deleteColorThemeAction(id));
                }}
              >
                Delete theme
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">
            The theme is removed from the picker. Only a theme that is not in use can be
            deleted, so nothing on screen changes colour.
          </p>
        </Modal>
      )}
    </div>
  );
}
