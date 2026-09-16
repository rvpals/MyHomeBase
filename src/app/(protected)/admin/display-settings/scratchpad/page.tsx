// Administration -> Display Settings -> Scratchpad Categories.
//
// A server component, mirroring the Floating Components screen beside it: it reads the
// stored categories so the list starts on the real values with no fetch-then-populate
// flicker.
//
// This screen decides which **tabs** the Scratchpad has for the household. It
// deliberately does not show, count or touch anyone's notes — the one thing it learns
// about them is a *number*, and only when a delete is refused because a category still
// has notes in it. That asymmetry is the feature's central rule: the tab strip is shared
// structure an admin arranges, and the notes inside it are private working-out belonging
// to whoever typed them (migration 0096).

import { listCategories } from "@/lib/scratchpad";
import { deps } from "@/lib/wiring";
import { PAGE_CONTAINER } from "../../../page-container";
import { ScratchpadCategoriesView } from "./view";

export default function ScratchpadCategoriesPage() {
  const categories = listCategories(deps.noteCategoryRepo);

  return (
    <div className={PAGE_CONTAINER}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Display Settings
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">
        Scratchpad Categories
      </h1>
      <p className="mt-2 text-sm text-muted">
        The tabs in the Scratchpad&rsquo;s window. One list for the whole application, not
        per person — everyone files notes under the same categories, and the notes
        themselves stay private to whoever wrote them. Turn the Scratchpad itself on or
        off in <strong>Floating Components</strong>.
      </p>

      <ScratchpadCategoriesView categories={categories} />
    </div>
  );
}
