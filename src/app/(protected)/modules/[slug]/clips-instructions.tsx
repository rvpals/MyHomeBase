// Per-section guidance. Each section gets only its own text: the whole document
// above every screen is noise.

import type { ClipsSection } from "./clips-sections";

export function ClipsInstructions({ section }: { section: ClipsSection }) {
  if (section === "main") {
    return (
      <div className="space-y-2 text-sm text-muted">
        <p>
          Clips are notes that stand on their own — paste an email, keep a reference,
          jot something down. A clip can be attached to a journal entry to hold the
          supporting material that entry refers to, and it stays here whether or not
          that entry survives.
        </p>
        <p>
          <strong className="text-ink">Two tabs.</strong> Most Recent is the glance —
          the newest few. All clips is everything. The search box and the category and
          tag chips sit above both and narrow them together, so a filter also trims
          what Most Recent shows.
        </p>
        <p>
          <strong className="text-ink">Pasting.</strong> Paste an email and its
          headings, lists and tables come across. The sender&rsquo;s fonts, colours
          and widths are dropped so the clip reads in this app&rsquo;s theme — the
          editor says what it removed. Pasted images are stored separately and
          resized; a few emails reference images that are not on the clipboard at
          all, and those cannot be captured.
        </p>
        <p>
          <strong className="text-ink">Encrypting.</strong> A clip can be sealed
          behind a password, with a hint. Clips are shared, so anyone with the
          password can open it — and <strong className="text-ink">there is no
          recovery</strong>: forgetting it loses that clip for everyone. Categories
          and tags stay readable so a sealed clip is still findable; its text is not
          searchable while sealed.
        </p>
        <p>
          <strong className="text-ink">Board or list.</strong> The same clips, two
          shapes — the board puts cards in balanced columns, the list gives one per
          row. Your choice is remembered on this device.
        </p>
        <p>
          <strong className="text-ink">Pinning and colour.</strong> A pinned clip
          sits in its own band at the top of both shapes. A colour is a label, not
          decoration — it is mixed into whichever theme you are running, so a card
          stays recognisable when the theme changes.
        </p>
        <p>
          <strong className="text-ink">Checklists.</strong> A clip can hold tickable
          lines beside its body. Ticking one keeps it — the completed lines collapse
          into a group you can open rather than disappearing. How much of a
          clip&rsquo;s text a card shows is set under Configuration.
        </p>
        <p>
          <strong className="text-ink">Deleting</strong> a clip moves it to Recycled
          Clips rather than destroying it. It keeps everything it was carrying —
          its categories and tags, its images, its checklist and its links — and
          restoring puts it back as it was. A clip is only gone for good once you
          delete it from the bin.
        </p>
      </div>
    );
  }

  if (section === "metadata") {
    return (
      <p className="text-sm text-muted">
        Two lists, like the Journal&rsquo;s. A <strong className="text-ink">category</strong>{" "}
        says what kind of thing a clip is — correspondence, a receipt, a reference. A{" "}
        <strong className="text-ink">tag</strong> says what it is about. Both can also
        be created while writing a clip. Deleting a name removes it from every clip
        carrying it; the clips themselves are untouched.
      </p>
    );
  }

  if (section === "recycled") {
    return (
      <div className="space-y-2 text-sm text-muted">
        <p>
          Deleted clips wait here until you remove them. Nothing is purged on a
          schedule and nothing expires — the bin holds what it holds until you
          empty it.
        </p>
        <p>
          <strong className="text-ink">Restoring</strong> puts a clip back with
          everything it was carrying. It returns to its original place in the list
          wherever possible, which is what keeps a journal entry&rsquo;s attached-clip
          badge pointing at the right clip across a delete and a restore. If another
          clip has taken that place since, it comes back alongside rather than
          overwriting anything, and its links may need re-attaching.
        </p>
        <p>
          <strong className="text-ink">Delete forever</strong> and{" "}
          <strong className="text-ink">Empty the bin</strong> are the only
          irreversible actions in this module. A sealed clip is binned sealed and
          comes back sealed — the bin is not a way around its password, and its
          title reads &ldquo;(encrypted)&rdquo; here as everywhere else.
        </p>
      </div>
    );
  }

  return (
    <p className="text-sm text-muted">
      How Clips behaves. The card excerpt length applies to everyone — it is a module
      setting, not a personal one — so only an administrator can change it.
    </p>
  );
}
