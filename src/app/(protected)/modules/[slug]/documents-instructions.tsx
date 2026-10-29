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
