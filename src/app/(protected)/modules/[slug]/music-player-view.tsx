"use client";

// The player screen: big artwork, the transport, and the lyrics panel.
//
// Distinct from the persistent bar at the bottom of every page. The bar is "what is
// playing"; this screen is where you go to look at a song -- read the words, see the
// cover at a size worth seeing, scrub with a real target.
//
// Narrow screens stack the same pieces in one column via `max-lg:` variants rather
// than switching component, because the arrangement genuinely is the same one: cover,
// then metadata, then transport, then lyrics. Only the bar needed a different shape.

import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/button";
import {
  albumCoverUrl,
  formatPlayerTime,
  useMusicPlayer,
} from "@/components/music-player-provider";
import {
  fetchLyricsAction,
  getAutoFetchLyricsAction,
  getLyricsAction,
  type LyricsActionResult,
} from "./music-actions";

export function MusicPlayerView() {
  const player = useMusicPlayer();
  const [isFetching, startFetching] = useTransition();
  // Keyed by track id rather than reset in an effect: storing which track a result
  // belongs to means a track change invalidates it derivationally, with no cascading
  // setState. `undefined` id = nothing loaded yet.
  const [loaded, setLoaded] = useState<{
    trackId: number;
    lyrics: LyricsActionResult | undefined;
  }>();

  const currentId = player?.current?.id;
  // A result from a previous track is simply not this track's result.
  const isLoadedForCurrent = loaded !== undefined && loaded.trackId === currentId;
  const lyrics = isLoadedForCurrent ? loaded.lyrics : undefined;

  // The "auto-retrieve lyrics" setting, read once per mount. Not per track change: it
  // only changes when someone edits the configuration screen, and this screen is not
  // where that happens.
  const [autoFetch, setAutoFetch] = useState(false);
  const [isAutoFetching, setIsAutoFetching] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void getAutoFetchLyricsAction().then((enabled) => {
      if (!cancelled) setAutoFetch(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Show anything already cached when the track changes. A fetch normally waits for the
  // button -- see migrations/0054_create_music_track_lyrics.md -- but the configuration
  // setting above is the owner opting into the automatic version, which is the one
  // objection that document raises.
  //
  // `getLyricsAction` first either way: the cache is what makes this safe to automate, so
  // a track that has already been asked about never generates a second request.
  useEffect(() => {
    if (currentId === undefined) return;

    let cancelled = false;
    void getLyricsAction(currentId).then(async (cached) => {
      if (cancelled) return;
      setLoaded({ trackId: currentId, lyrics: cached });

      // Only a track nobody has asked about yet (`undefined` -- no cached row at all).
      // Every stored status is left alone, including the retryable ones: `not_found` and
      // `failed` are worth another try eventually, but doing it on every play would mean
      // an outbound request per play for exactly the tracks that never resolve. Those
      // stay on the button, where "Try again" already lives.
      if (!autoFetch || cached !== undefined) return;

      // Tracked separately from `isFetching`: `useTransition`'s pending flag only
      // covers work started inside `startTransition`, and without a flag here the
      // panel would advertise the "Get lyrics" button while a lookup was already
      // running.
      setIsAutoFetching(true);
      try {
        const result = await fetchLyricsAction({ trackId: currentId });
        if (!cancelled) setLoaded({ trackId: currentId, lyrics: result });
      } finally {
        // `finally`, so a thrown action (an offline NAS) can't strand the panel on
        // "Looking up..." forever.
        if (!cancelled) setIsAutoFetching(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentId, autoFetch]);

  const onFetchLyrics = useCallback(
    (force: boolean) => {
      if (currentId === undefined) return;
      startFetching(async () => {
        const result = await fetchLyricsAction({ trackId: currentId, force });
        setLoaded({ trackId: currentId, lyrics: result });
      });
    },
    [currentId],
  );

  if (player === undefined) {
    return <p className="text-muted">The player is not available on this page.</p>;
  }

  if (player.current === undefined) {
    return (
      <div className="rounded-xl border border-line p-8 text-center">
        <p className="font-display text-lg text-ink">Nothing is playing</p>
        <p className="mt-2 text-sm text-muted">
          Pick a track from the library and it will appear here.
        </p>
      </div>
    );
  }

  const { current, isPlaying, position, duration, volume } = player;
  const total = duration > 0 ? duration : (current.durationSeconds ?? 0);
  const coverUrl = albumCoverUrl(current.albumId);

  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
      {/* Cover + transport */}
      <div>
        {coverUrl === undefined ? (
          <div
            className="aspect-square w-full rounded-xl border border-line bg-paper-raised"
            aria-hidden="true"
          />
        ) : (
          <img
            src={coverUrl}
            alt={`Cover art for ${current.title}`}
            className="aspect-square w-full rounded-xl border border-line object-cover"
          />
        )}

        <h2 className="mt-4 font-display text-xl text-ink">{current.title}</h2>
        <p className="text-sm text-muted">{current.artist || "Unknown artist"}</p>
        {current.album !== "" && <p className="text-xs text-muted">{current.album}</p>}

        <div className="mt-4 flex items-center gap-2">
          <span className="font-mono text-xs text-muted">{formatPlayerTime(position)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(total, 1)}
            step={1}
            value={Math.min(position, total)}
            onChange={(event) => player.seek(Number(event.target.value))}
            aria-label="Seek"
            className="h-1 flex-1 accent-brass"
          />
          <span className="font-mono text-xs text-muted">{formatPlayerTime(total)}</span>
        </div>

        {/* flex-wrap, because four buttons do not fit a 375px column in one line. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={player.previous}>
            Previous
          </Button>
          <Button onClick={player.toggle}>{isPlaying ? "Pause" : "Play"}</Button>
          <Button variant="secondary" onClick={player.next}>
            Next
          </Button>
          {/* Stops the audio and hides the bar but keeps the queue -- see `stop` in
              music-player-provider.tsx. "Clear the queue" is the Queue screen's job. */}
          <Button variant="secondary" onClick={player.stop}>
            Close player
          </Button>
        </div>

        <label className="mt-4 flex items-center gap-2 text-xs text-muted">
          Volume
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(event) => player.setVolume(Number(event.target.value))}
            className="h-1 flex-1 accent-brass"
          />
        </label>

        {player.error !== undefined && (
          <p className="mt-3 rounded border border-line bg-paper-raised p-2 text-xs text-muted">
            {player.error}
          </p>
        )}
      </div>

      {/* Lyrics */}
      <section className="rounded-xl border border-line p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-lg text-ink">Lyrics</h3>
          <div className="flex items-center gap-2">
            {/* One button, three jobs: fetch, retry a miss, refresh a hit. The label
                changes so the listener knows which they are getting. */}
            <Button
              onClick={() => onFetchLyrics(lyrics?.status === "found")}
              disabled={isFetching || isAutoFetching}
            >
              {isFetching || isAutoFetching
                ? "Searching..."
                : lyrics === undefined
                  ? "Get lyrics"
                  : lyrics.status === "found"
                    ? "Refresh"
                    : "Try again"}
            </Button>
          </div>
        </div>

        <LyricsPanel
          lyrics={lyrics}
          isFetching={isFetching || isAutoFetching}
          hasLoadedCache={isLoadedForCurrent}
          trackTitle={current.title}
        />
      </section>
    </div>
  );
}

function LyricsPanel({
  lyrics,
  isFetching,
  hasLoadedCache,
  trackTitle,
}: {
  lyrics: LyricsActionResult | undefined;
  isFetching: boolean;
  hasLoadedCache: boolean;
  trackTitle: string;
}) {
  if (isFetching) {
    return <p className="mt-4 text-sm text-muted">Looking up lyrics for {trackTitle}...</p>;
  }

  if (lyrics === undefined) {
    return (
      <p className="mt-4 text-sm text-muted">
        {hasLoadedCache
          ? "No lyrics saved for this track yet. Press \u201cGet lyrics\u201d to look them up."
          : "Checking for saved lyrics..."}
      </p>
    );
  }

  if (lyrics.status === "found") {
    return (
      <>
        {/* whitespace-pre-wrap, because line breaks ARE the formatting of a lyric. */}
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-ink">
          {lyrics.lyrics}
        </p>
        {lyrics.searchedFor !== undefined && (
          <p className="mt-4 border-t border-line pt-2 text-xs text-muted">
            Matched on {lyrics.searchedFor} - from lrclib.net
          </p>
        )}
      </>
    );
  }

  return (
    <div className="mt-4">
      <p className="text-sm text-muted">{lyrics.message}</p>
      {lyrics.searchedFor !== undefined && (
        <p className="mt-2 text-xs text-muted">Searched for: {lyrics.searchedFor}</p>
      )}
      {lyrics.status === "unsearchable" && (
        <p className="mt-2 text-xs text-muted">
          Tagging the file with a title and artist would let this work.
        </p>
      )}
    </div>
  );
}
