"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import type { NavLink } from "@/components/nav-menus";
import { TwoTierShell } from "@/components/two-tier-shell";
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
   * Read-only here, for the same reason as `hasCarouselImage`: the icon picker
   * writes on pick, so this is the value to show on first render, not a field
   * this form saves. `updateModuleField` must not be pointed at it — that would
   * mark the page dirty for a change already persisted.
   */
  icon: string;
  /**
   * Read-only here. The carousel image is saved the moment it's picked rather
   * than through this form's Save button, so it isn't an editable draft field —
   * it's carried only so the control can show the current state on first render.
   */
  hasCarouselImage: boolean;
  /**
   * Read-only here too, and the carousel image's cache-buster: the serving route
   * sends `immutable`, so the upload control needs a `?v=` that changes with the
   * bytes rather than a counter local to itself.
   */
  updatedAt?: string;
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
    icon: module.icon,
    hasCarouselImage: module.hasCarouselImage,
    updatedAt: module.updatedAt,
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
  railLinks,
  currentUser,
  logoutAction,
  viewportPinned,
}: {
  children: ReactNode;
  initialModules: Module[];
  initialSettings: Setting[];
  initialModuleSettings: ModuleSetting[];
  /** Tier 1's module list, loaded by the layout — this is a client component. */
  railLinks: NavLink[];
  currentUser: { id: number; fullName: string; avatarMimeType?: string; updatedAt?: string };
  logoutAction: () => Promise<void>;
  viewportPinned: boolean;
}) {
  const router = useRouter();
  // No orientation state any more: `TwoTierShell` owns the layout, and the
  // section panel is a side column at every state rather than a bar that has to
  // stack. `adminNav` keeps its nested groups — the panel renders them as an
  // accordion on desktop and flattens them into the sheet on compact.
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
      <TwoTierShell
        links={railLinks}
        sections={adminNav}
        iconNamespace="admin"
        // Administration isn't a module — it has no row in the module table and
        // no admin-editable name — so unlike every other caller these are
        // constants rather than a lookup. `shield` is the tree-icon concept
        // `adminNav`'s own Security entry uses, and the closest match to
        // `AdminIcon` across the generated icon sets.
        module={{ name: "Administration", icon: "shield", href: "/admin" }}
        currentUser={currentUser}
        // Always true: the layout redirects a non-admin before this renders.
        showAdmin
        logoutAction={logoutAction}
        viewportPinned={viewportPinned}
      >
        <div className="relative p-8 pb-24 max-lg:p-4 max-lg:pb-24">{children}</div>
      </TwoTierShell>
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
