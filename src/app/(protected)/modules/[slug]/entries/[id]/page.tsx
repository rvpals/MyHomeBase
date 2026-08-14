import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getEntry, getEntryNeighbors } from "@/lib/journal";
import { getModuleBySlug } from "@/lib/modules";
import { userHasModuleAccess } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { JournalEntryScreen } from "./entry-screen";
import { PAGE_CONTAINER } from "../../../../page-container";

const JOURNAL_MODULE_SLUG = "journal";

export default async function JournalEntryPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  // Entries only exist for the journal module; this route sits under the generic
  // [slug] segment so /modules/journal itself keeps resolving to the module page.
  if (slug !== JOURNAL_MODULE_SLUG) notFound();

  const appModule = getModuleBySlug(deps.moduleRepo, slug);
  if (!appModule) notFound();

  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  // Same guard as the module page — an entry must not be readable by someone who
  // hasn't been granted the journal module.
  if (!currentUser || !userHasModuleAccess(currentUser, appModule.id, deps.userRepo)) notFound();

  const entryId = Number(id);
  if (!Number.isInteger(entryId) || entryId <= 0) notFound();

  const entry = getEntry(deps.journalRepo, entryId);
  if (!entry) notFound();

  return (
    <div className={PAGE_CONTAINER}>
      <JournalEntryScreen entry={entry} neighbors={getEntryNeighbors(deps.journalRepo, entryId)} />
    </div>
  );
}
