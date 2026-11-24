// Per-section guidance. Each section gets only its own text: the whole document
// above every screen is noise.

import type { CodeLibrarySection } from "./code-library-sections";

export function CodeLibraryInstructions({ section }: { section: CodeLibrarySection }) {
  if (section === "main") {
    return (
      <div className="space-y-2 text-sm text-muted">
        <p>
          The Code Library keeps reusable snippets — a query you work out once, a
          shell incantation you never remember, the three lines that configure a
          thing. Each one is filed under a language and searchable by its text.
        </p>
        <p>
          <strong className="text-ink">Stored exactly as you paste it.</strong> A
          snippet is plain text, not rich text, so indentation, angle brackets and
          blank lines come back out the way they went in. That is the one thing a
          clip could not do for code, and the reason this is its own module rather
          than a corner of Clips.
        </p>
        <p>
          <strong className="text-ink">Copy</strong> puts the whole snippet on the
          clipboard — all of it, exactly as stored, not the few lines the card
          shows and with no title or fencing wrapped around it. The tooltip says
          how many lines you are getting.
        </p>
        <p>
          <strong className="text-ink">Searching</strong> runs over the snippet
          itself as well as its title, so <code>List&lt;string&gt;</code> and{" "}
          <code>&amp;&amp;</code> find what you would expect.
        </p>
        <p>
          <strong className="text-ink">Three ways to narrow it.</strong> A
          language says what a snippet is written in, a category what kind of
          thing it is, and a tag what it is about. The chips and the search box
          combine, so a filter is always a real URL you can bookmark or send.
        </p>
        <p>
          <strong className="text-ink">Writing one.</strong> New snippet opens a
          plain text box — spellcheck and autocorrect are off, so nothing
          &ldquo;corrects&rdquo; a variable name while you type. Type categories
          and tags as a comma-separated list; a word you have not used before is
          added to the vocabulary as you save. Edit reopens a snippet with its
          whole body, not the few lines the card shows.
        </p>
        <p>
          <strong className="text-ink">Pinning</strong> lifts a snippet into a
          band at the top. It is shared, like the library itself — there is no
          private pin, because there is no private snippet.
        </p>
        <p>
          <strong className="text-ink">Deleting</strong> moves a snippet to
          Recycled Snippets. Nothing here destroys anything — that takes a
          second, deliberate act in the bin.
        </p>
        <p>
          <strong className="text-ink">Sealing</strong> encrypts a snippet&rsquo;s
          title and body behind a password, for the ones that are really a
          credential. Its categories, tags and language stay readable so it is
          still findable. This library is shared, so anyone with the password can
          open it — and{" "}
          <strong className="text-ink">there is no recovery</strong>: forgetting
          it loses that snippet for everyone.
        </p>
        <p>
          <strong className="text-ink">Where it came from, and notes.</strong> A
          source link answers the question you will actually have in six months —
          whether there is a newer version — and notes hold the sentence that
          does not belong in the code, so the body stays something you can paste
          straight into a terminal.
        </p>
      </div>
    );
  }

  if (section === "metadata") {
    return (
      <div className="space-y-2 text-sm text-muted">
        <p>
          The two vocabularies behind the home screen&rsquo;s chips. A{" "}
          <strong className="text-ink">category</strong> says what kind of thing a
          snippet is — Query, Shell one-liner, Config. A{" "}
          <strong className="text-ink">tag</strong> says what it is about —
          postgres, docker, the project it belongs to.
        </p>
        <p>
          You do not have to come here first: typing a new word on a snippet adds
          it to the list. This screen is for tidying up afterwards — renaming a
          word everywhere at once, describing one, or retiring one that stopped
          being useful.
        </p>
        <p>
          <strong className="text-ink">Renaming</strong> rewrites every snippet
          filed under the old word, so nothing is orphaned.{" "}
          <strong className="text-ink">Deleting</strong> removes the label from
          the snippets carrying it — the count beside each word says how many that
          is before you decide. The snippets themselves are never touched.
        </p>
      </div>
    );
  }

  if (section === "recycled") {
    return (
      <div className="space-y-2 text-sm text-muted">
        <p>
          Deleting a snippet moves it here rather than destroying it. It keeps
          its categories, tags, colour and pin, so restoring gives you back what
          you deleted and not a stripped copy of it.
        </p>
        <p>
          <strong className="text-ink">Remove</strong> and{" "}
          <strong className="text-ink">Empty the bin</strong> are the only
          irreversible actions in this module. Both ask first.
        </p>
        <p>
          A sealed snippet is binned sealed and comes back sealed — its
          ciphertext is the only copy of its content, so nothing here can show
          you a preview of it.
        </p>
      </div>
    );
  }

  return null;
}
