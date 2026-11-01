import { redirect } from "next/navigation";

/**
 * `/admin/security` moved into Administration → System Messages as its Security tab.
 *
 * Kept as a redirect rather than deleted: this URL is in the wild. The home screen's
 * bad-login alert linked here, Background Tasks links here, and — the reason that
 * outlives both — a personal toolbar row saved against the `admin_section_security`
 * menu item points at it. Deleting the route would break those rows silently, with
 * nothing on screen to explain where the screen went.
 *
 * `redirect` is a 307 here. The in-app links were repointed at the tab URL directly,
 * so in practice only an old bookmark or a saved toolbar row lands on this.
 */
export default async function SecurityRedirectPage() {
  redirect("/admin/system-messages?tab=security");
}
