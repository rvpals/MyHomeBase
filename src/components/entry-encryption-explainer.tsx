// The one explanation of how per-entry encryption works (migration 0131).
//
// Written once and rendered in three places — the New Entry screen's chip, the
// entry viewer's chip, and inside the encrypt dialog itself — so the account the
// reader gets cannot differ depending on where they asked. This is the file to
// edit if the behaviour changes; nothing else restates it.
//
// Pure presentation, no props: it is prose, not a view of anything.

import type { ReactNode } from "react";

/** One labelled paragraph of the explanation. */
function Part({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <p>
      <span className="font-medium text-ink">{heading}</span> {children}
    </p>
  );
}

/**
 * The full explanation, as flowing paragraphs.
 *
 * Pass it to `Comments` as `content`, or render it directly inside a panel. It
 * carries no width, padding or background of its own so it sits in whatever the
 * caller provides.
 */
export function EntryEncryptionExplainer() {
  return (
    <>
      <Part heading="What is sealed.">
        Only the entry&rsquo;s title and its body. The date, time, place, weather,
        categories, tags, locations and any attached photos stay readable — those are what
        the Entries list, the Calendar and the filters are built from, so the entry still
        appears in all of them. What is hidden is what you wrote.
      </Part>

      <Part heading="How it is sealed.">
        Your password is put through <span className="font-mono">scrypt</span> together
        with 16 random bytes to derive a key, and the text is encrypted with AES-256-GCM.
        Fresh randomness is drawn every single time, so saving the same words twice
        produces completely different stored text. The title and the body are encrypted
        separately.
      </Part>

      <Part heading="Where the password goes.">
        Nowhere. It is not saved, not written to the database, and no hash of it is kept.
        When you unlock the entry, the password you type either reproduces the key or it
        does not — that is the whole check. It is held in the page only while the entry is
        open, and is gone when you navigate away or close it.
      </Part>

      <Part heading="If you forget it.">
        The entry is gone. There is no reset, no administrator override and no back door —
        not because one was left out, but because anything that could recover the text
        without the password would also let someone else read it.
      </Part>

      <Part heading="The hint.">
        Stored in plain text, because it has to be readable before anything is decrypted.
        Anyone who opens this entry sees it. Write something that reminds you, never the
        password itself.
      </Part>

      <Part heading="Editing an encrypted entry.">
        Unlock it, then edit and save as normal — it is re-sealed with the same password,
        using fresh randomness each time. Close it, or navigate away, and it locks again.
      </Part>

      <Part heading="What changes elsewhere.">
        An encrypted entry is left out of search, the Top&nbsp;10 Words list and duplicate
        detection, and a CSV or calendar re-import can never overwrite it. Merging it with
        other entries is refused. Everywhere its title would normally appear, you will see{" "}
        <span className="font-mono">(encrypted)</span> instead.
      </Part>

      <Part heading="What this does not protect against.">
        The encryption happens on the server, so your password travels there to be used.
        Attached photos are <span className="font-medium text-ink">not</span> encrypted.
        This protects the words in the entry from anyone reading the database file — it is
        not protection against someone who already controls this machine.
      </Part>
    </>
  );
}

/** The heading to use wherever this explanation is offered, so all three agree. */
export const ENTRY_ENCRYPTION_EXPLAINER_TITLE = "How encrypting an entry works";
