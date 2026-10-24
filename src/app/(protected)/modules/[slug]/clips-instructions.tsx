// Per-section guidance. Each section gets only its own text: the whole document
// above every screen is noise.

import type { ClipsSection } from "./clips-sections";

export function ClipsInstructions({ section }: { section: ClipsSection }) {
  if (section === "main") {
    return (
      <p className="text-sm text-muted">
        Clips are notes that stand on their own — paste an email, keep a reference,
        jot something down. A clip can be attached to a journal entry to hold the
        supporting material that entry refers to, and it stays here whether or not
        that entry survives.
      </p>
    );
  }

  if (section === "all") {
    return (
      <div className="space-y-2 text-sm text-muted">
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
          <strong className="text-ink">Deleting</strong> a clip cannot be undone.
          There is no recycle bin here.
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

  return (
    <p className="text-sm text-muted">
      How Clips behaves. Nothing is configurable yet.
    </p>
  );
}
