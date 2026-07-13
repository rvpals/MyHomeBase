import type { ReactNode } from "react";
import { listAllModuleSettings } from "@/lib/module-settings";
import { listModules } from "@/lib/modules";
import { listSettings } from "@/lib/settings";
import { deps } from "@/lib/wiring";
import { AdminShell } from "./admin-shell";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const modules = listModules(deps.moduleRepo, { includeHidden: true });
  const settings = listSettings(deps.settingsRepo);
  const moduleSettings = listAllModuleSettings(deps.moduleSettingsRepo);

  return (
    <AdminShell
      initialModules={modules}
      initialSettings={settings}
      initialModuleSettings={moduleSettings}
    >
      {children}
    </AdminShell>
  );
}
