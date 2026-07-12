import type { ReactNode } from "react";
import { listModules } from "@/lib/modules";
import { listSettings } from "@/lib/settings";
import { deps } from "@/lib/wiring";
import { AdminShell } from "./admin-shell";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const modules = listModules(deps.moduleRepo, { includeHidden: true });
  const settings = listSettings(deps.settingsRepo);

  return (
    <AdminShell initialModules={modules} initialSettings={settings}>
      {children}
    </AdminShell>
  );
}
