"use client";

// The player screen: big artwork, the transport, and the words-and-story panel.
//
// Distinct from the persistent bar at the bottom of every page. The bar is "what is
// playing"; this screen is where you go to look at a song -- read the words, see the
// cover at a size worth seeing, scrub with a real target.
//
// Narrow screens stack the same pieces in one column via `max-lg:` variants rather
// than switching component, because the arrangement genuinely is the same one: cover,
// then metadata, then transport, then lyrics. Only the bar needed a different shape.

import { useCallback, useEffect, useState, useTransition } from "react";
import { AudioSpectrum } from "@/components/audio-spectrum";
import { Button } from "@/components/button";
import { Tabs, type TabItem } from "@/components/tabs";
import {
  albumCoverUrl,
  formatPlayerTime,
  useMusicPlayer,
  type SpectrumKind,
} from "@/components/music-player-provider";
// `inlineModeFor` / `isInlineMode` are deliberately not imported any more: the
// visualizer now lives in the Visual tab, which has room for every mode, so there is
// no 64px strip to degrade a circular or particle mode down to.
import { DEFAULT_VISUALIZER_MODE, type VisualizerMode } from "@/lib/music";
import { FullscreenStage, canGoFullscreen } from "@/components/fullscreen-stage";
import { VideoPanel } from "./music-video-panel";
import {
  fetchLyricsAction,
  fetchStoryAction,
  getAutoFetchLyricsAction,
  getLyricsAction,
  getVisualizerModeAction,
  setVisualizerModeAction,
  type LyricsActionResult,
  type StoryActionResult,
} from "./music-actions";

/**
 * The visualizer choices, in the order they read.
 *
 * Module-level rather than rebuilt per render: it is a constant, and a fresh array
 * every render would be new identity for no reason.
 */
const VISUALIZER_OPTIONS: readonly { key: VisualizerMode; label: string }[] = [
  { key: "bars", label: "Bars" },
  { key: "fire", label: "Fire" },
  { key: "wave", label: "Wave" },
  { key: "circular", label: "Circular spectrum" },
  { key: "galaxy", label: "Particle galaxy" },
];

/** The shared field styling every other `<select>` in the app uses. */
const SELECT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

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

  // The story behind the song, fetched when the track starts playing rather than when
  // the Story tab is opened -- so it is already there when you switch to it.
  //
  // Keyed by track id like `loaded` above, and for the same reason. Nothing is stored
  // server-side (there is no story table), so this state IS the only copy: switching
  // away and back re-fetches.
  const [story, setStory] = useState<{ trackId: number; result: StoryActionResult }>();

  // "Still looking" is derived, not a flag: a story belonging to another track is not
  // this track's story, so the absence of a result for `currentId` already means the
  // lookup is in flight. Deriving it also keeps the effect free of a synchronous
  // setState, which would cost a cascading render on every track change.
  const storyResult = story !== undefined && story.trackId === currentId ? story.result : undefined;
  const isStoryFetching = currentId !== undefined && storyResult === undefined;

  useEffect(() => {
    if (currentId === undefined) return;

    let cancelled = false;
    void fetchStoryAction({ trackId: currentId })
      .then((result) => {
        if (!cancelled) setStory({ trackId: currentId, result });
      })
      .catch(() => {
        // A thrown action still has to land somewhere, or the panel sits on
        // "Looking..." forever.
        if (!cancelled) {
          setStory({
            trackId: currentId,
            result: { status: "failed", facts: [], message: "Could not reach Songfacts." },
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentId]);

  // Which visualizer to draw. Read once per mount like the lyrics setting above, and
  // for the same reason: it only changes when someone presses the button below.
  const [visualizerMode, setVisualizerMode] = useState<VisualizerMode>(
    DEFAULT_VISUALIZER_MODE,
  );
  useEffect(() => {
    let cancelled = false;
    void getVisualizerModeAction().then((stored) => {
      if (!cancelled) setVisualizerMode(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Switches the visualizer, optimistically.
   *
   * The canvas changes on the click and the write happens behind it -- a display
   * choice that waits on a database round trip feels broken, and the worst case of a
   * failed write is that the choice does not survive a reload.
   */
  const onPickVisualizer = useCallback((next: VisualizerMode) => {
    setVisualizerMode(next);
    void setVisualizerModeAction(next).catch(() => undefined);
  }, []);

  // Whether the stage is up. Mounting `FullscreenStage` is what requests fullscreen,
  // so this must only ever be set from a click -- the browser rejects the request
  // outside a user gesture.
  const [isFullscreen, setIsFullscreen] = useState(false);
  const onExitFullscreen = useCallback(() => setIsFullscreen(false), []);

  /**
   * Stops the music so a YouTube video can be heard.
   *
   * `toggle` rather than a dedicated pause, because the provider exposes no `pause`
   * and the Video panel only calls this while the music is playing -- it checks
   * `isPlaying` first, so toggle cannot start a paused track here.
   */
  const onPauseForVideo = useCallback(() => {
    // Optional-chained because this sits above the `player.current === undefined`
    // guard, where the provider may not have mounted yet.
    if (player?.isPlaying === true) player.toggle();
  }, [player]);

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

      {/* Words, story and the visualizer picker, one panel with three tabs.
          Uncontrolled: nothing outside the strip needs to switch tabs, so Tabs owns
          its own active key. */}
      <section className="rounded-xl border border-line p-4">
        <Tabs
          items={[
            {
              key: "lyrics",
              label: "Lyrics",
              content: (
                <div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {/* One button, three jobs: fetch, retry a miss, refresh a hit. The
                        label changes so the listener knows which they are getting. */}
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
                  <LyricsPanel
                    lyrics={lyrics}
                    isFetching={isFetching || isAutoFetching}
                    hasLoadedCache={isLoadedForCurrent}
                    trackTitle={current.title}
                  />
                </div>
              ),
            },
            {
              key: "story",
              label: "Story",
              content: (
                <StoryPanel
                  story={storyResult}
                  isFetching={isStoryFetching}
                  trackTitle={current.title}
                />
              ),
            },
            {
              key: "video",
              label: "Video",
              content: (
                <VideoPanel
                  trackId={current.id}
                  trackTitle={current.title}
                  isPlaying={isPlaying}
                  onPauseMusic={onPauseForVideo}
                />
              ),
            },
            {
              key: "visual",
              label: "Visual",
              content: (
                <VisualPanel
                  mode={visualizerMode}
                  onPick={onPickVisualizer}
                  hasSpectrum={player.spectrumSize > 0}
                  onOpenFullscreen={() => setIsFullscreen(true)}
                  readSpectrum={player.readSpectrum}
                  spectrumSize={player.spectrumSize}
                  isPlaying={isPlaying}
                />
              ),
            },
          ] satisfies TabItem[]}
          defaultActiveKey="lyrics"
        />
      </section>

      {/* The stage. Rendered last and only while open -- mounting it is what requests
          fullscreen, and unmounting it is what leaves. The audio is untouched by any
          of this: it lives in `MusicPlayerProvider` above this screen, so the track
          keeps playing and the analyser keeps reading while the stage is up. */}
      {isFullscreen && (
        <FullscreenStage onExit={onExitFullscreen} label="Music visualizer">
          <AudioSpectrum
            readSpectrum={player.readSpectrum}
            spectrumSize={player.spectrumSize}
            mode={visualizerMode}
            isPlaying={isPlaying}
            fill
          />
        </FullscreenStage>
      )}
    </div>
  );
}

/**
 * The Visual tab: the visualizer itself, and the picker for which one it draws.
 *
 * The canvas lives **here**, inside the tab container, rather than as a strip under
 * the cover art. Two things follow from that, and both are why it is worth doing:
 *
 *   - **It gets real room.** The strip was 64px tall, which is too little for a
 *     circular spectrum or a particle field, so those modes used to fall back to bars
 *     inline and only appear for real on the fullscreen stage. In the panel they draw
 *     as themselves, and `inlineModeFor` is no longer needed on this screen.
 *   - **It only animates while the tab is open.** `Tabs` renders one panel at a time,
 *     so switching to Lyrics unmounts the canvas and stops the frame loop. That is a
 *     feature rather than a cost: nothing is drawing sixty times a second behind a
 *     panel of song lyrics. The audio is untouched either way -- it lives in
 *     `MusicPlayerProvider`, well above this component.
 *
 * A plain `<select>` rather than `ViewModeSwitch`: the segmented control is a *wide*
 * control that degrades to a dropdown, and what is wanted here is a dropdown at every
 * width. This is the same field markup the rest of the app's selects use.
 */
function VisualPanel({
  mode,
  onPick,
  hasSpectrum,
  onOpenFullscreen,
  readSpectrum,
  spectrumSize,
  isPlaying,
}: {
  mode: VisualizerMode;
  onPick: (next: VisualizerMode) => void;
  hasSpectrum: boolean;
  onOpenFullscreen: () => void;
  readSpectrum: (into: Uint8Array<ArrayBuffer>, kind: SpectrumKind) => boolean;
  spectrumSize: number;
  isPlaying: boolean;
}) {
  // Read on the client only: `document.fullscreenEnabled` does not exist on the
  // server, and iOS Safari on iPhone has no element fullscreen at all. A control that
  // cannot work should not be offered.
  const [canFullscreen, setCanFullscreen] = useState(false);
  useEffect(() => setCanFullscreen(canGoFullscreen()), []);

  return (
    <div>
      {/* The visualizer. Renders only once the audio graph exists -- `spectrumSize`
          is 0 until the first track plays, and stays 0 if the graph could not be
          built, in which case the panel shows the note below instead of an empty box.

          `fill` with a fixed-height box, as on the fullscreen stage: the canvas takes
          the space it is given rather than a hardcoded strip height. `aspect-video`
          would be squarer than these modes want on a desktop panel, so the height is
          set directly and scales down narrow. */}
      {hasSpectrum && (
        <div className="mb-4 h-56 w-full overflow-hidden rounded-lg border border-line bg-paper-raised max-lg:h-40">
          <AudioSpectrum
            readSpectrum={readSpectrum}
            spectrumSize={spectrumSize}
            // The true mode, not `inlineModeFor(mode)`: the panel is tall enough for
            // every visualizer, which is the point of moving it here.
            mode={mode}
            isPlaying={isPlaying}
            fill
          />
        </div>
      )}
      {/* Capped rather than full-bleed: a three-option picker stretched across a
          desktop panel reads as a form field someone forgot to size. */}
      <label className="block max-w-xs text-sm">
        <span className="mb-1 block font-medium text-muted">Visualizer</span>
        <select
          value={mode}
          onChange={(event) => onPick(event.target.value as VisualizerMode)}
          className={SELECT_CLASS}
        >
          {VISUALIZER_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {canFullscreen && (
        <div className="mt-3">
          <Button variant="secondary" onClick={onOpenFullscreen} disabled={!hasSpectrum}>
            Fullscreen
          </Button>
        </div>
      )}

      {/* No "this one only works fullscreen" note any more: the panel is tall enough
          for every mode, so what the picker selects is what draws above. Fullscreen is
          now purely about size, not about which visualizers are available. */}

      {/* The choice is still worth making and worth saving with no analyser -- it is
          what the next track will use -- so the picker stays live and this only
          explains the missing canvas. */}
      {!hasSpectrum && (
        <p className="mt-3 text-xs text-muted">
          The visualizer appears once a track is playing.
        </p>
      )}
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

/**
 * The story behind the song, from songfacts.com.
 *
 * Every unhappy state gets its own words, because they call for different things from
 * the listener. A miss especially: Songfacts is addressed by a slug we *derive* from
 * the tags, and their robots.txt disallows searching, so a miss is often our guess
 * being wrong rather than an absent story. The search link is how that gets settled.
 */
function StoryPanel({
  story,
  isFetching,
  trackTitle,
}: {
  story: StoryActionResult | undefined;
  isFetching: boolean;
  trackTitle: string;
}) {
  if (isFetching || story === undefined) {
    return <p className="text-sm text-muted">Looking up the story behind {trackTitle}...</p>;
  }

  if (story.status === "found") {
    return (
      <div>
        {/* One paragraph block per fact -- Songfacts publishes them as separate items
            and running them together would lose that. */}
        <div className="space-y-4">
          {story.facts.map((fact, index) => (
            <p
              key={index}
              className="whitespace-pre-wrap text-sm leading-relaxed text-ink"
            >
              {fact}
            </p>
          ))}
        </div>
        <p className="mt-4 border-t border-line pt-2 text-xs text-muted">
          {story.matchedFor !== undefined && <>Matched {story.matchedFor} - </>}
          from{" "}
          <a
            href={story.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-ink"
          >
            songfacts.com
          </a>
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-muted">{story.message}</p>
      {story.searchUrl !== undefined && (
        <p className="mt-2 text-xs text-muted">
          It is looked up by name, so a different spelling in the tags can miss.{" "}
          <a
            href={story.searchUrl}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-ink"
          >
            Search Songfacts for it
          </a>
          .
        </p>
      )}
      {story.status === "unsearchable" && (
        <p className="mt-2 text-xs text-muted">
          Tagging the file with a title and artist would let this work.
        </p>
      )}
    </div>
  );
}
