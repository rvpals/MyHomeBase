import { loadAttachmentSourceRoot, loadBackupSettings, loadLastBackupRun } from "@/lib/backup";
import { BackupDataView } from "./view";

/**
 * Administration → Configuration → Backup Data: where attachment files and database
 * archives are copied to, how often, and how many archives are kept.
 *
 * The settings live in `sys_app_settings` rather than on a module, because the Data
 * backup job belongs to no module — see migrations/0134.
 *
 * Admin-only. The route layout redirects non-admins, and every action on this screen
 * re-checks on its own first line, because an action is its own endpoint.
 */
export default async function BackupDataPage() {
  const settings = loadBackupSettings();

  return (
    <BackupDataView
      settings={settings}
      // Shown read-only: the folder the attachments are copied *from* is the
      // Household module's receipt root, not a setting of this screen. Displaying it
      // here is what stops a reader configuring a backup and wondering why nothing
      // is copied when that root was never set.
      attachmentSourceRoot={loadAttachmentSourceRoot()}
      lastRun={loadLastBackupRun()}
    />
  );
}
