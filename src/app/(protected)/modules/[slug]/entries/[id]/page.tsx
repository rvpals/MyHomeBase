import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getEntry, getEntryNeighbors, listCategories, listTags } from "@/lib/journal";
import { listLocationCategories, listLocationTags } from "@/lib/journal-locations";
import { getModuleBySlug } from "@/lib/modules";
import { userHasModuleAccess } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { JournalEntryScreen } from "./entry-screen";
import { JournalShell } from "../../journal-shell";
import { journalTaxonomyIconUrlsByName } from "../../journal-shared";
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

  // Fetched once and used twice: the icon maps the viewer reads, and the plain
  // name lists the edit form's category/tag pickers offer.
  const categories = listCategories(deps.journalRepo);
  const tags = listTags(deps.journalRepo);

  // Plain objects across the client boundary — JournalViewer is a client
  // component and can't be handed a Map.
  const categoryIcons = Object.fromEntries(journalTaxonomyIconUrlsByName("category", categories));
  const tagIcons = Object.fromEntries(journalTaxonomyIconUrlsByName("tag", tags));

  return (
    // The same two-tier shell every other journal screen renders (see
    // design.md, "Navigation: the two-tier shell"). Wrapped here rather than in
    // a layout because navigation in this app is placed by each module's own
    // shell, not by `(protected)/layout.tsx` — without this the entry screen
    // rendered straight into `.app-main` with no rail, no panel and no header.
    <JournalShell>
      <div className={PAGE_CONTAINER}>
        <JournalEntryScreen
          entry={entry}
          neighbors={getEntryNeighbors(deps.journalRepo, entryId)}
          categoryIcons={categoryIcons}
          tagIcons={tagIcons}
          categoryOptions={categories.map((category) => category.name)}
          tagOptions={tags.map((tag) => tag.name)}
          locationCategoryOptions={listLocationCategories(deps.savedLocationRepo).map(
            (row) => row.name,
          )}
          locationTagOptions={listLocationTags(deps.savedLocationRepo).map((row) => row.name)}
        />
      </div>
    </JournalShell>
  );
}
