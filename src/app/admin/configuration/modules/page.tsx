"use client";

import { CollapsibleCard } from "@/components/collapsible-card";
import { useAdminSettings } from "../../admin-shell";

export default function ModuleConfigurationPage() {
  const {
    modules,
    updateModuleField,
    moveModule,
    moduleSettings,
    addModuleSetting,
    updateModuleSetting,
    removeModuleSetting,
  } = useAdminSettings();

  return (
    <div className="mx-auto max-w-4xl">
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Configuration
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Module Configuration</h1>
      <p className="mt-2 text-sm text-muted">
        Edit how each module is labeled, described, and ordered across the sidebar and home
        screen.
      </p>

      <div className="mt-8 space-y-4">
        {modules.map((module, index) => (
          <div key={module.slug} className="rounded-xl border border-line bg-paper-raised p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="grid flex-1 gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-ink">Short name</span>
                  <input
                    value={module.shortName}
                    onChange={(event) =>
                      updateModuleField(module.slug, "shortName", event.target.value)
                    }
                    className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-ink">Long name</span>
                  <input
                    value={module.longName}
                    onChange={(event) =>
                      updateModuleField(module.slug, "longName", event.target.value)
                    }
                    className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                  />
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="mb-1 block font-medium text-ink">Description</span>
                  <input
                    value={module.description ?? ""}
                    onChange={(event) =>
                      updateModuleField(module.slug, "description", event.target.value)
                    }
                    placeholder="Shown on the home screen card and as a sidebar hint"
                    className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                  />
                </label>
              </div>
              <div className="flex shrink-0 flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={() => moveModule(module.slug, "up")}
                  disabled={index === 0}
                  aria-label={`Move ${module.shortName} up`}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink disabled:opacity-30"
                >
                  &uarr;
                </button>
                <button
                  type="button"
                  onClick={() => moveModule(module.slug, "down")}
                  disabled={index === modules.length - 1}
                  aria-label={`Move ${module.shortName} down`}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink disabled:opacity-30"
                >
                  &darr;
                </button>
              </div>
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={module.isVisible}
                onChange={(event) =>
                  updateModuleField(module.slug, "isVisible", event.target.checked)
                }
                className="h-4 w-4 rounded border-line text-brass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
              />
              <span className="text-ink">Visible in sidebar and home screen</span>
            </label>

            <CollapsibleCard title={`Module Settings — ${module.longName}`} className="mt-4">
              <div className="space-y-3">
                {(moduleSettings[module.slug] ?? []).map((setting, settingIndex) => (
                  <div
                    key={settingIndex}
                    className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
                  >
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-ink">Key</span>
                      <input
                        value={setting.key}
                        onChange={(event) =>
                          updateModuleSetting(module.slug, settingIndex, "key", event.target.value)
                        }
                        placeholder="e.g. api_key"
                        className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-ink">Value</span>
                      <input
                        value={setting.value}
                        onChange={(event) =>
                          updateModuleSetting(
                            module.slug,
                            settingIndex,
                            "value",
                            event.target.value,
                          )
                        }
                        className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-ink">Description</span>
                      <input
                        value={setting.description ?? ""}
                        onChange={(event) =>
                          updateModuleSetting(
                            module.slug,
                            settingIndex,
                            "description",
                            event.target.value,
                          )
                        }
                        className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeModuleSetting(module.slug, settingIndex)}
                      aria-label={`Remove ${setting.key || "this setting"}`}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line text-ink hover:border-brass hover:text-brass-dark"
                    >
                      &times;
                    </button>
                  </div>
                ))}
                {(moduleSettings[module.slug] ?? []).length === 0 && (
                  <p className="text-sm text-muted">No custom settings for this module yet.</p>
                )}
                <button
                  type="button"
                  onClick={() => addModuleSetting(module.slug)}
                  className="rounded-md border border-dashed border-line px-3 py-1.5 text-sm text-muted hover:border-brass hover:text-brass-dark"
                >
                  + Add setting
                </button>
              </div>
            </CollapsibleCard>
          </div>
        ))}
      </div>
    </div>
  );
}
