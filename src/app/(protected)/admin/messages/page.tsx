import { redirect } from "next/navigation";

/**
 * `/admin/messages` moved into Administration → System Messages as its Message Queue
 * tab. Kept as a redirect for the same reason as its two siblings — see
 * `admin/security/page.tsx` for the full note.
 *
 * Not to be confused with the header bell (`message-queue.tsx`), which is the
 * reader's inbox and never pointed here.
 */
export default async function MessagesRedirectPage() {
  redirect("/admin/system-messages?tab=messages");
}
