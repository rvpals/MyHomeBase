"use client";

// The Video tab: the song on YouTube, if we can find it.
//
// Its own file rather than another function in music-player-view.tsx, which was
// already 616 lines before this tab existed.
//
// Two behaviours here are decisions, not details:
//
//   1. **Nothing is fetched until asked.** The tab opens on a button, not a spinner.
//      A scrape of a free service for a video the listener never asked to watch is not
//      a request worth making, and this library has 20,272 tracks.
//   2. **Playing the video pauses the music.** Otherwise the local audio and YouTube
//      play over each other -- and the local track is the one the listener can see a
//      transport for, so it is the one that yields. The thumbnail-first design means
//      merely *opening* the tab is silent; only a click starts anything.

import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/button";
import { embedUrl, watchUrl } from "@/lib/youtube";
import { fetchVideoAction, getVideoAction, type VideoActionResult } from "./music-actions";

/**
 * YouTube's thumbnail for a video id.
 *
 * `hqdefault` rather than `maxresdefault`: every video has one, whereas maxres 404s
 * for anything not uploaded in HD and would leave a broken image in the panel.
 */
function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

export function VideoPanel({
  trackId,
  trackTitle,
  isPlaying,
  onPauseMusic,
}: {
  trackId: number;
  trackTitle: string;
  /** Whether the local player is playing, so the video knows to ask it to stop. */
  isPlaying: boolean;
  /** Pauses the local audio. Called once, when the embed is opened. */
  onPauseMusic: () => void;
}) {
  const [isFetching, startFetching] = useTransition();
  // Every piece of per-track state is keyed by the track it belongs to, following the
  // pattern the player view uses for lyrics: storing WHICH track a value is for means
  // a track change invalidates it derivationally, with no cascading setState in an
  // effect. `loaded` is undefined only before the very first cache read returns.
  const [loaded, setLoaded] = useState<{
    trackId: number;
    result: VideoActionResult | undefined;
  }>();
  // Which video the iframe is showing, and for which track. Undefined means the
  // thumbnail is up and nothing has loaded -- no request to YouTube, no audio.
  const [playing, setPlaying] = useState<{ trackId: number; videoId: string }>();

  // A value from a previous track is simply not this track's value. A track change
  // therefore closes the embed and clears the result without touching state.
  const isLoadedForCurrent = loaded !== undefined && loaded.trackId === trackId;
  const result = isLoadedForCurrent ? loaded.result : undefined;
  const playingId = playing?.trackId === trackId ? playing.videoId : undefined;

  // The cached pick, on mount and whenever the track changes. Reads the database
  // only -- `getVideoAction` never touches the network.
  useEffect(() => {
    let isCurrent = true;

    void getVideoAction(trackId)
      .then((cached) => {
        if (isCurrent) setLoaded({ trackId, result: cached });
      })
      .catch(() => {
        // A failed cache read still resolves the loading state, or the panel would sit
        // on "Checking..." forever. No message: the button still works, and it is the
        // button that does the real job.
        if (isCurrent) setLoaded({ trackId, result: undefined });
      });

    return () => {
      isCurrent = false;
    };
  }, [trackId]);

  const onFind = useCallback(
    (force: boolean) => {
      startFetching(async () => {
        try {
          const found = await fetchVideoAction({ trackId, force });
          setLoaded({ trackId, result: found });
          // A fresh pick replaces whatever the iframe was showing, rather than
          // leaving the old video under a new title.
          setPlaying(undefined);
        } catch {
          setLoaded({
            trackId,
            result: {
              status: "failed",
              message: "Could not reach YouTube. Try again in a moment.",
            },
          });
        }
      });
    },
    [trackId],
  );

  const onPlay = useCallback(
    (videoId: string) => {
      // Answer to the double-audio problem: the local track yields to the video.
      if (isPlaying) onPauseMusic();
      setPlaying({ trackId, videoId });
    },
    [isPlaying, onPauseMusic, trackId],
  );

  const buttonLabel = isFetching
    ? "Searching..."
    : result === undefined
      ? "Find video"
      : result.status === "found"
        ? "Refresh"
        : "Try again";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* One button, three jobs -- fetch, retry a miss, replace a wrong pick --
            labelled so the listener knows which they are getting. The same shape the
            Lyrics tab uses. */}
        <Button onClick={() => onFind(result?.status === "found")} disabled={isFetching}>
          {buttonLabel}
        </Button>
      </div>

      <VideoBody
        result={result}
        isFetching={isFetching}
        isLoaded={isLoadedForCurrent}
        trackTitle={trackTitle}
        playingId={playingId}
        onPlay={onPlay}
      />
    </div>
  );
}

/**
 * Everything below the button.
 *
 * Split out so the states read as a list rather than as nesting: not-yet-asked,
 * searching, found, and the three distinct unhappy endings.
 */
function VideoBody({
  result,
  isFetching,
  isLoaded,
  trackTitle,
  playingId,
  onPlay,
}: {
  result: VideoActionResult | undefined;
  isFetching: boolean;
  isLoaded: boolean;
  trackTitle: string;
  playingId: string | undefined;
  onPlay: (videoId: string) => void;
}) {
  if (isFetching) {
    return <p className="mt-3 text-sm text-muted">Searching YouTube for {trackTitle}...</p>;
  }

  // Nothing cached and nothing asked for. The resting state of the tab.
  if (result === undefined) {
    return (
      <p className="mt-3 text-sm text-muted">
        {isLoaded
          ? "Press Find video to look this song up on YouTube."
          : "Checking for a saved video..."}
      </p>
    );
  }

  if (result.status === "found" && result.videoId !== undefined) {
    const { videoId } = result;
    return (
      <div className="mt-3">
        {/* 16:9 either way, so the frame does not move when the thumbnail becomes the
            player. `aspect-video` is fluid, which is all the narrow case needs -- this
            is the same component at every width, not a restyled one. */}
        <div className="aspect-video w-full overflow-hidden rounded-lg border border-line bg-paper-raised">
          {playingId === videoId ? (
            <iframe
              // The no-cookie host: no third-party tracking cookie until playback.
              src={embedUrl(videoId)}
              title={result.videoTitle ?? trackTitle}
              // `autoplay` is deliberately absent from embedUrl: the click already
              // happened, and browsers block programmatic autoplay with sound anyway.
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
              loading="lazy"
              className="h-full w-full"
            />
          ) : (
            <button
              type="button"
              onClick={() => onPlay(videoId)}
              className="group relative h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
              aria-label={`Play ${result.videoTitle ?? trackTitle} on YouTube`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a remote
                  thumbnail from i.ytimg.com; next/image would need the host in
                  next.config and buys nothing for one decorative image. */}
              <img
                src={thumbnailUrl(videoId)}
                alt=""
                className="h-full w-full object-cover transition group-hover:opacity-80"
              />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="rounded-full bg-ink/70 px-5 py-3 text-sm font-medium text-paper">
                  Play
                </span>
              </span>
            </button>
          )}
        </div>

        <p className="mt-3 text-sm text-ink">{result.videoTitle}</p>
        <p className="mt-1 text-xs text-muted">
          {result.channel !== undefined && result.channel !== "" && <>{result.channel} - </>}
          <a
            href={watchUrl(videoId)}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-ink"
          >
            watch on YouTube
          </a>
        </p>
        {/* The pick is a guess from the artist and title, so it has to be checkable.
            Saying so is what makes a wrong match obviously wrong rather than
            confusing. */}
        <p className="mt-2 border-t border-line pt-2 text-xs text-muted">
          Found by searching for the artist and title. Not the right song? Press Refresh
          for the next best match.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <p className="text-sm text-muted">{result.message}</p>
      {result.searchUrl !== undefined && (
        <p className="mt-2 text-xs text-muted">
          It is looked up by name, so a different spelling in the tags can miss.{" "}
          <a
            href={result.searchUrl}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-ink"
          >
            Search YouTube for it
          </a>
          .
        </p>
      )}
      {result.status === "unsearchable" && (
        <p className="mt-2 text-xs text-muted">
          Tagging the file with a title and artist would let this work.
        </p>
      )}
    </div>
  );
}
