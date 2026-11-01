import { redirect } from "next/navigation";

/**
 * `/admin/system-log` moved into Administration → System Messages as its System Log
 * tab. Kept as a redirect for the same reason as its two siblings — see
 * `admin/security/page.tsx` for the full note.
 *
 * `revalidatePath` in `configuration/application/system-log-actions.ts` was repointed
 * at `/admin/system-messages`: revalidating this path would refresh a redirect.
 */
export default async function SystemLogRedirectPage() {
  redirect("/admin/system-messages?tab=system-log");
}
