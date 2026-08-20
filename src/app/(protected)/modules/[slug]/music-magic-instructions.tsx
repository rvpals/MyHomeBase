// Guidance for the Magic Playlist screen.
//
// One section, so no switch: unlike attendance-instructions.tsx this covers a single
// screen. It explains the two things that are genuinely surprising -- how the AND/OR
// combination works, and why a saved list replays rather than reshuffles -- and nothing
// that the buttons already say for themselves.

export function MagicInstructions() {
  return (
    <div className="flex flex-col gap-2 text-sm text-muted">
      <p>
        Pick any mix of <strong className="text-ink">genres</strong>,{" "}
        <strong className="text-ink">artists</strong> and{" "}
        <strong className="text-ink">albums</strong>, choose how long you want the playlist to
        run, and press <strong className="text-ink">Generate</strong>. The whole library gets
        shuffled and filled toward that length — approximately, since it stops on a whole track.
      </p>
      <p>
        Within one box the choices are <strong className="text-ink">OR</strong>, and the boxes are
        combined with <strong className="text-ink">AND</strong>. Picking Rock and Pop, plus Michael
        Jackson and Luther Vandross, means{" "}
        <em>(Rock or Pop) and (Michael Jackson or Luther Vandross)</em> — so a Vandross track
        tagged R&amp;B will <em>not</em> appear. If a selection comes back thinner than expected,
        that overlap is usually why; the match count above the pickers shows how many tracks are
        eligible before you generate, and{" "}
        <strong className="text-ink">Match any criteria</strong> loosens it to OR throughout.
        Leaving a box empty places no restriction at all.
      </p>
      <p>
        Tracks whose length is unknown are skipped, since they cannot be counted toward a target,
        and so are formats no browser can play. That is why a genre&rsquo;s count here can be lower
        than in the Genres view.
      </p>
      <p>
        <strong className="text-ink">Save</strong> keeps the criteria <em>and</em> the tracks just
        generated, so loading the list later plays the same set —{" "}
        <strong className="text-ink">Regenerate</strong> is how you ask for a new draw from the
        same criteria. Editing a loaded list&rsquo;s criteria and saving updates it in place;
        deleting one removes the list only, never a track or a file.
      </p>
    </div>
  );
}
