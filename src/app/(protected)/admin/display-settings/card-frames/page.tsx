// Administration -> Display Settings -> Card Frames.
//
// A server component: it reads the frame library and the current selection so
// the gallery starts on the real values with no fetch-then-populate flicker,
// and hands them to the client control below.
//
// Neither read touches a BLOB -- `listFrames` and `getSelection` both derive
// `hasImage` in SQL and leave the bytes to `/api/card-frame`. See
// migrations/0133_create_card_frames.md.
//
// No auth check here: the `/admin` layout redirects a non-admin before this
// renders, and every mutating action gates itself with `requireAdmin()` on its
// first line -- an action is its own POST endpoint, so the layout protects the
// screen but never the action.

import { getCardFrameSelection, listCardFrames } from "@/lib/card-frame";
import { deps } from "@/lib/wiring";
import { PAGE_CONTAINER } from "../../../page-container";
import { CardFrameControl } from "./card-frame-control";

export default function CardFramesPage() {
  const frames = listCardFrames(deps.cardFrameRepo);
  const selection = getCardFrameSelection(deps.cardFrameRepo);

  return (
    <div className={PAGE_CONTAINER}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Display Settings
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Card Frames</h1>
      <p className="mt-2 text-sm text-muted">
        Upload a picture to use as a card&apos;s border and background. The four{" "}
        <em>slice</em> values cut it into nine pieces: the corners are placed untouched at
        the card&apos;s corners, the four edges run along its sides, and the middle fills
        behind the content. This is one choice for the whole application, not per person.
      </p>

      <CardFrameControl frames={frames} selectedId={selection.frame?.id} />
    </div>
  );
}
