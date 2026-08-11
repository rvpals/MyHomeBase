"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { TreeNav, type TreeNavState } from "@/components/tree-nav";
import { useIsCompact } from "@/components/viewport-context";
import type { ModuleSetting } from "@/lib/module-settings";
import type { Module } from "@/lib/modules";
import { DEFAULT_COLOR_THEME_ID, DEFAULT_ICON_SET_ID, type Setting } from "@/lib/settings";
import { adminNav } from "./nav";
import { resetAdminSettingsAction, saveAdminSettingsAction } from "./actions";

export interface ModuleDraft {
  id: number;
  slug: string;
  shortName: string;
  longName: string;
  description?: string;
  isVisible: boolean;
  /**
   * Read-only here. The carousel image is saved the moment it's picked rather
   * than through this form's Save button, so it isn't an editable draft field —
   * it's carried only so the control can show the current state on first render.
   */
  hasCarouselImage: boolean;
}

export interface ModuleSettingDraft {
  key: string;
  value: string;
  description?: string;
}

interface AdminContextValue {
  modules: ModuleDraft[];
  applicationName: string;
  colorThemeId: string;
  iconSetId: string;
  moduleSettings: Record<string, ModuleSettingDraft[]>;
  isDirty: boolean;
  isSaving: boolean;
  updateModuleField: (slug: string, field: keyof ModuleDraft, value: string | boolean) => void;
  moveModule: (slug: string, direction: "up" | "down") => void;
  setApplicationName: (value: string) => void;
  setColorThemeId: (id: string) => void;
  setIconSetId: (id: string) => void;
  addModuleSetting: (slug: string) => void;
  updateModuleSetting: (
    slug: string,
    index: number,
    field: keyof ModuleSettingDraft,
    value: string,
  ) => void;
  removeModuleSetting: (slug: string, index: number) => void;
  save: () => Promise<void>;
  reset: () => Promise<void>;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdminSettings(): AdminContextValue {
  const context = useContext(AdminContext);
  if (!context) {
    throw new Error("useAdminSettings must be used within the administration section");
  }
  return context;
}

function toDraft(module: Module): ModuleDraft {
  return {
    id: module.id,
    slug: module.slug,
    shortName: module.shortName,
    longName: module.longName,
    description: module.description,
    isVisible: module.isVisible,
    hasCarouselImage: module.hasCarouselImage,
  };
}

function toSettingDraft(setting: ModuleSetting): ModuleSettingDraft {
  return { key: setting.key, value: setting.value, description: setting.description };
}

function groupSettingsBySlug(
  modules: Module[],
  settings: ModuleSetting[],
): Record<string, ModuleSettingDraft[]> {
  const grouped: Record<string, ModuleSettingDraft[]> = {};
  for (const appModule of modules) {
    grouped[appModule.slug] = settings
      .filter((setting) => setting.moduleId === appModule.id)
      .map(toSettingDraft);
  }
  return grouped;
}

export function AdminShell({
  children,
  initialModules,
  initialSettings,
  initialModuleSettings,
}: {
  children: ReactNode;
  initialModules: Module[];
  initialSettings: Setting[];
  initialModuleSettings: ModuleSetting[];
}) {
  const router = useRouter();
  // The shell has to stack, not just restyle: a full-width bar left as a flex
  // *row* item gets squashed against the content beside it. `useIsCompact`
  // rather than `max-lg:` because the layout can be pinned — a 1400px window
  // can legitimately be in compact, and a media query would still lay it out
  // side by side.
  const isCompact = useIsCompact();
  // The nav is a bar in `full` and a column in `rail`/`strip`, so which way
  // this shell lays out follows the nav's state rather than the viewport
  // alone. `useCallback` because TreeNav raises this from an effect keyed on
  // the callback — a fresh function each render would loop.
  const [navState, setNavState] = useState<TreeNavState>("full");
  const handleNavStateChange = useCallback((state: TreeNavState) => setNavState(state), []);
  const isNavStacked = isCompact || navState === "full";
  const [modules, setModules] = useState<ModuleDraft[]>(() => initialModules.map(toDraft));
  const [applicationName, setApplicationNameState] = useState(
    () => initialSettings.find((setting) => setting.key === "application_name")?.value ?? "",
  );
  const [colorThemeId, setColorThemeIdState] = useState(
    () => initialSettings.find((setting) => setting.key === "color_theme")?.value ?? DEFAULT_COLOR_THEME_ID,
  );
  const [iconSetId, setIconSetIdState] = useState(
    () => initialSettings.find((setting) => setting.key === "icon_set")?.value ?? DEFAULT_ICON_SET_ID,
  );
  const [moduleSettings, setModuleSettings] = useState<Record<string, ModuleSettingDraft[]>>(() =>
    groupSettingsBySlug(initialModules, initialModuleSettings),
  );
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  function updateModuleField(slug: string, field: keyof ModuleDraft, value: string | boolean) {
    setModules((current) =>
      current.map((module) => (module.slug === slug ? { ...module, [field]: value } : module)),
    );
    setIsDirty(true);
  }

  function moveModule(slug: string, direction: "up" | "down") {
    setModules((current) => {
      const index = current.findIndex((module) => module.slug === slug);
      const swapWith = direction === "up" ? index - 1 : index + 1;
      if (index === -1 || swapWith < 0 || swapWith >= current.length) return current;
      const next = [...current];
      [next[index], next[swapWith]] = [next[swapWith], next[index]];
      return next;
    });
    setIsDirty(true);
  }

  function setApplicationName(value: string) {
    setApplicationNameState(value);
    setIsDirty(true);
  }

  function setColorThemeId(id: string) {
    setColorThemeIdState(id);
    setIsDirty(true);
  }

  function setIconSetId(id: string) {
    setIconSetIdState(id);
    setIsDirty(true);
  }

  function addModuleSetting(slug: string) {
    setModuleSettings((current) => ({
      ...current,
      [slug]: [...(current[slug] ?? []), { key: "", value: "" }],
    }));
    setIsDirty(true);
  }

  function updateModuleSetting(
    slug: string,
    index: number,
    field: keyof ModuleSettingDraft,
    value: string,
  ) {
    setModuleSettings((current) => ({
      ...current,
      [slug]: (current[slug] ?? []).map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry,
      ),
    }));
    setIsDirty(true);
  }

  function removeModuleSetting(slug: string, index: number) {
    setModuleSettings((current) => ({
      ...current,
      [slug]: (current[slug] ?? []).filter((_, entryIndex) => entryIndex !== index),
    }));
    setIsDirty(true);
  }

  async function save() {
    setIsSaving(true);
    try {
      const moduleSettingsPayload = modules.map((module) => ({
        moduleId: module.id,
        entries: (moduleSettings[module.slug] ?? []).filter(
          (entry) => entry.key.trim() !== "" && entry.value.trim() !== "",
        ),
      }));
      await saveAdminSettingsAction({
        modules,
        applicationName,
        colorThemeId,
        iconSetId,
        moduleSettings: moduleSettingsPayload,
      });
      setIsDirty(false);
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  async function reset() {
    const confirmed = window.confirm(
      "Reset all administration settings to their default seeded values? This cannot be undone.",
    );
    if (!confirmed) return;

    setIsSaving(true);
    try {
      const result = await resetAdminSettingsAction();
      setModules(result.modules.map(toDraft));
      setApplicationNameState(
        result.settings.find((setting) => setting.key === "application_name")?.value ?? "",
      );
      setColorThemeIdState(
        result.settings.find((setting) => setting.key === "color_theme")?.value ??
          DEFAULT_COLOR_THEME_ID,
      );
      setIconSetIdState(
        result.settings.find((setting) => setting.key === "icon_set")?.value ?? DEFAULT_ICON_SET_ID,
      );
      // Module settings are left alone by design (no seeded default to revert
      // to) — just re-key the draft against any new module ids from the reset.
      setModuleSettings((current) => {
        const bySlug: Record<string, ModuleSettingDraft[]> = {};
        for (const appModule of result.modules) {
          bySlug[appModule.slug] = current[appModule.slug] ?? [];
        }
        return bySlug;
      });
      setIsDirty(false);
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AdminContext.Provider
      value={{
        modules,
        applicationName,
        colorThemeId,
        iconSetId,
        moduleSettings,
        isDirty,
        isSaving,
        updateModuleField,
        moveModule,
        setApplicationName,
        setColorThemeId,
        setIconSetId,
        addModuleSetting,
        updateModuleSetting,
        removeModuleSetting,
        save,
        reset,
      }}
    >
      <div className={`flex min-h-screen ${isNavStacked ? "flex-col" : ""}`}>
        {/* The sticky lives on this wrapper, not on TreeNav — a sticky element
            only travels inside its parent's box, and a wrapper sized to the nav
            would give it nowhere to go. */}
        <div className="tree-nav-sticky shrink-0">
          <TreeNav
            nodes={adminNav}
            collapsible
            onStateChange={handleNavStateChange}
            // Only reaches the rail and strip — TreeNav drops the caller's
            // surface for either bar, where a right border spanning the full
            // width would read as a stray line. `min-h-screen` is what makes
            // the rail's border run the height of the page.
            className="min-h-screen border-r border-line bg-paper-raised"
          />
        </div>
        <div className="relative flex-1 overflow-y-auto p-8 pb-24 max-lg:p-4 max-lg:pb-24">{children}</div>
      </div>
      <div className="fixed bottom-6 right-6 z-20 flex gap-3">
        <Button variant="secondary" onClick={reset} disabled={isSaving}>
          Reset to Default
        </Button>
        <Button variant="primary" onClick={save} disabled={isSaving || !isDirty}>
          {isSaving ? "Saving…" : "Save Settings"}
        </Button>
      </div>
    </AdminContext.Provider>
  );
}
