import type { DocumentsSection } from "./documents-sections";

// Per-section guidance for the Document Library. Each section gets only its own text —
// the whole document above every screen is noise.

export function DocumentsInstructions({ section }: { section: DocumentsSection }) {
  if (section === "main") {
    return (
      <div className="flex flex-col gap-2 text-sm text-muted">
        <p>
          Every document the household has filed. Use <strong className="text-ink">File a
          document</strong> to add one: give it a title, file it under a category and any
          tags, and attach the files.
        </p>
        <p>
          A document can hold several files. Each one stays a separate file, so you can
          open any of them on its own — <strong className="text-ink">Download all</strong>{" "}
          packs them into one zip when you want the lot.
        </p>
        <p>
          Deleting a document asks whether to delete its files too. Answer no and the
          files stay on the server untouched; answer yes and they are{" "}
          <strong className="text-ink">moved to a <code>_deleted</code> folder</strong>,
          not erased — so a mistake is recoverable from the NAS.
        </p>
      </div>
    );
  }

  if (section === "tree") {
    return (
      <div className="flex flex-col gap-2 text-sm text-muted">
        <p>
          The same documents as the Home screen, reached by browsing instead of
          searching. The tree on the left lists every{" "}
          <strong className="text-ink">category</strong>; clicking one shows what is
          filed under it.
        </p>
        <p>
          Expanding a category reveals the{" "}
          <strong className="text-ink">tags actually used by its documents</strong> —
          not the whole tag list, so every tag you see is one that will find something.
          Clicking a tag narrows the list further; clicking it again lets it go.
        </p>
        <p>
          Clicking a document shows its details and its files underneath the list. That
          pane is <strong className="text-ink">read-only</strong> — use{" "}
          <strong className="text-ink">Edit</strong> there to change anything, and the
          Home screen for deleting or editing several at once.
        </p>
      </div>
    );
  }

  if (section === "keywords") {
    return (
      <div className="flex flex-col gap-2 text-sm text-muted">
        <p>
          The words your documents actually contain, ranked — the way in when you do
          not know what you are looking for. Counted across every{" "}
          <strong className="text-ink">title, description</strong> and any{" "}
          <strong className="text-ink">text read out of the files</strong>.
        </p>
        <p>
          <strong className="text-ink">Documents</strong> is how many documents use the
          word at all, and is what the list is sorted by.{" "}
          <strong className="text-ink">Uses</strong> counts every repeat, so a word with
          many uses but few documents is usually a letterhead rather than a subject.
          Clicking a keyword lists the documents it appears in.
        </p>
        <p>
          Common words, anything under three letters and bare numbers are left out, so
          the list stays words you might search for. A document only contributes its
          file contents once that file has been read — use{" "}
          <strong className="text-ink">OCR</strong> on the Home screen, or leave the
          indexing job armed, and more words appear here.
        </p>
        <p>
          The <strong className="text-ink">✕</strong> beside a keyword stops it being
          ranked — for a letterhead, a surname or a scanner footer that appears on
          everything. Ignored words are listed under{" "}
          <strong className="text-ink">Ignored words</strong> above the list, where the
          same ✕ brings one back. This only changes what is ranked here:{" "}
          <strong className="text-ink">searching still finds the word</strong>, so
          nothing becomes unfindable.
        </p>
      </div>
    );
  }

  if (section === "metadata") {
    return (
      <div className="flex flex-col gap-2 text-sm text-muted">
        <p>
          The two lists a document is filed under. A{" "}
          <strong className="text-ink">category</strong> says what kind of thing it is —
          Insurance, Warranty, Tax. A <strong className="text-ink">tag</strong> says what
          it is about — the car, the house, 2026.
        </p>
        <p>
          Either can also be created while filing a document, just by typing it. This
          screen is where you give one a description or an icon, or tidy the list up.
        </p>
        <p>
          Deleting a category or tag never deletes a document — the documents filed
          under it simply stop being filed under it.
        </p>
      </div>
    );
  }

  if (section === "templates") {
    return (
      <div className="flex flex-col gap-2 text-sm text-muted">
        <p>
          A <strong className="text-ink">prefill template</strong> is a named set of field
          values a new document can start from. Most documents of a kind are filed the same
          way — every utility bill carries the same category and tags, and only the file is
          new — so a template saves retyping them.
        </p>
        <p>
          Build one by picking a field and the value it should start with. Anything you
          leave out is simply not filled. Then, on the{" "}
          <strong className="text-ink">New Document</strong> screen, choose the template
          from the picker at the top of the form.
        </p>
        <p>
          Applying a template <strong className="text-ink">only fills what is blank</strong>.
          A title you have already typed, or categories you have already chosen, are left
          exactly as they are — so picking the wrong template can never lose work.
        </p>
        <p>
          <strong className="text-ink">Disable</strong> a template you are done with for now
          — a closed claim, last year&apos;s taxes. It drops out of the New Document picker but
          stays here, with its values, ready to enable again.
        </p>
      </div>
    );
  }

  if (section === "recycled") {
    return (
      <div className="flex flex-col gap-2 text-sm text-muted">
        <p>
          Deleting a document moves it here instead of destroying it. Tick what you want
          and <strong className="text-ink">Restore</strong> puts it back — its filing, its
          files and, wherever possible, the same document number it had before.
        </p>
        <p>
          <strong className="text-ink">Remove from bin</strong> drops the record: the
          title, the filing, and the note of which stored file was which. It does{" "}
          <strong className="text-ink">not</strong> delete the files themselves — those
          have been sitting in the <code>_deleted</code> folder on the server since the
          document was deleted, and only you can clear them, on the NAS.
        </p>
        <p>
          If a document&apos;s old number has been taken by something filed since, it
          comes back under a new one and its files move to match. The message after a
          restore says so when it happens.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 text-sm text-muted">
      <p>
        Where the files are kept, and how large they may be. Until a folder is set,
        documents can be filed but no file can be attached.
      </p>
      <p>
        The folder is a path on the <strong className="text-ink">server</strong>, not on
        your phone or laptop — so Browse lists the server&apos;s own folders. Each
        document gets its own folder inside it, named <code>doc_&lt;id&gt;</code>.
      </p>
      <p>
        Changing the folder does <strong className="text-ink">not</strong> move any
        existing file. Files are recorded relative to the folder, so pointing this at a
        copy keeps every document working, and pointing it somewhere empty leaves them
        unreachable until the files are copied across.
      </p>
    </div>
  );
}
