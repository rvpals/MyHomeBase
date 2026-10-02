"use client";

// The player screen: big artwork, the transport, and the words-and-story panel.
//
// Distinct from the persistent bar at the bottom of every page. The bar is "what is
// playing"; this screen is where you go to look at a song -- read the words, see the
// cover at a size worth seeing, scrub with a real target.
//
// The transport is one panel across the foot of the screen, spanning both columns --
// a full-width seek bar is a far better scrub target than a 20rem one. It is a card in
// the page, not a `fixed` bar: the viewport's bottom edge already belongs to
// `MusicPlayerBar` and the compact section trigger.
//
// Narrow screens stack the same pieces in one column via `max-lg:` variants rather
// than switching component, because the arrangement genuinely is the same one: cover,
// then metadata, then lyrics, then the transport panel -- whose three clusters stack
// in turn. Only the bar needed a different shape.

import { useCallback, useEffect, useState, useTransition } from "react";
import { AudioSpectrum } from "@/components/audio-spectrum";
import { Button } from "@/components/button";
import { Tabs, type TabItem } from "@/components/tabs";
import { MusicSleepTimer } from "@/components/music-sleep-timer";
import {
  NextGlyph,
  PauseGlyph,
  PlayGlyph,
  PreviousGlyph,
} from "@/components/music-player-bar";
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

  // Which album's cover art failed to load, rather than a bare boolean.
  //
  // `albumCoverUrl` hands back a URL for any track that HAS an album, but the cover
  // route answers 404 when that album's `cover_image` is NULL -- and a queue row
  // carries `albumId` without the `hasCoverImage` flag the library grid gates on, so
  // there is nothing to check before rendering. Left alone, the browser draws its own
  // broken-image icon with the alt text beside it.
  //
  // Keyed by album id for the same reason `loaded` above is keyed by track id: a
  // track change invalidates it derivationally, so one album without art cannot
  // leave the next one blank. Must sit above this component's early returns.
  const [coverFailedFor, setCoverFailedFor] = useState<number>();

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
        {coverUrl === undefined || coverFailedFor === current.albumId ? (
          <VinylPlaceholder isPlaying={isPlaying} />
        ) : (
          <img
            src={coverUrl}
            alt={`Cover art for ${current.title}`}
            onError={() => setCoverFailedFor(current.albumId)}
            className="aspect-square w-full rounded-xl border border-line object-cover"
          />
        )}

        <h2 className="mt-4 font-display text-xl text-ink">{current.title}</h2>
        <p className="text-sm text-muted">{current.artist || "Unknown artist"}</p>
        {current.album !== "" && <p className="text-xs text-muted">{current.album}</p>}
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

      {/* The transport, as one panel across the foot of the screen.
          `lg:col-span-2`, so it spans the cover column and the tabs panel rather than
          living under the artwork -- a full-width seek bar is a far better scrub
          target than a 20rem one, which is the main reason it moved here.

          Deliberately NOT `fixed`. The viewport's bottom edge already belongs to
          `MusicPlayerBar` and, on compact, the section trigger -- design.md's
          floating layer calls that list closed, so this panel scrolls with the page
          like any other card. */}
      <section className="rounded-xl border border-line p-4 lg:col-span-2">
        {/* Seek, full width, on its own row above the rule. */}
        <div className="flex items-center gap-3">
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

        <div className="mt-4 border-t border-line pt-4">
          {/* One row on a desktop: volume left, transport centred, the two
              secondary controls right. Narrow, it becomes a column -- the three
              clusters stack in reading order, which is what the mock shows and what
              a 390px screen has room for. */}
          <div className="flex items-center gap-4 max-lg:flex-col max-lg:items-stretch max-lg:gap-3">
            {/* `flex-1` + `basis-0` on both outer clusters so the transport sits
                optically centred regardless of how wide the two ends are. */}
            {/* A div, not a label: the speaker mark is decorative and the slider
                carries its own `aria-label`, so there is no visible text to associate. */}
            <div className="flex flex-1 basis-0 items-center gap-2 text-xs text-muted max-lg:order-3 max-lg:flex-none">
              <VolumeGlyph />
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={(event) => player.setVolume(Number(event.target.value))}
                aria-label="Volume"
                className="h-1 min-w-0 flex-1 accent-brass lg:max-w-48"
              />
              <span className="w-9 shrink-0 text-right font-mono text-xs text-muted">
                {Math.round(volume * 100)}%
              </span>
            </div>

            {/* Icon pills, with Play promoted: bigger, and the primary fill. The
                glyphs come from `MusicPlayerBar` so the bar and this screen cannot
                drift into two different play triangles. Each carries an `ariaLabel`
                -- `Button` requires one when the child is only a glyph. */}
            <div className="flex shrink-0 items-center justify-center gap-3 max-lg:order-1">
              <Button
                variant="secondary"
                onClick={player.previous}
                ariaLabel="Previous track"
                title="Previous track"
                className="h-12 w-12 !px-0"
              >
                <PreviousGlyph />
              </Button>
              <Button
                onClick={player.toggle}
                ariaLabel={isPlaying ? "Pause" : "Play"}
                title={isPlaying ? "Pause" : "Play"}
                className="h-14 w-14 !px-0"
              >
                {isPlaying ? <PauseGlyph /> : <PlayGlyph />}
              </Button>
              <Button
                variant="secondary"
                onClick={player.next}
                ariaLabel="Next track"
                title="Next track"
                className="h-12 w-12 !px-0"
              >
                <NextGlyph />
              </Button>
            </div>

            <div className="flex flex-1 basis-0 items-center justify-end gap-2 max-lg:order-2 max-lg:flex-none max-lg:justify-center">
              {/* The clock-icon trigger. `bar` is already exactly that -- an icon
                  button that grows to carry the countdown once armed, with its panel
                  opening upward -- so this is a variant swap, not new markup.
                  Still the primary place to set a timer on a phone: the compact
                  player bar shows the countdown only. */}
              <MusicSleepTimer
                variant="bar"
                remainingSeconds={player.sleepRemainingSeconds}
                onStart={player.startSleepTimer}
                onCancel={player.cancelSleepTimer}
              />
              {/* Stops the audio and hides the bar but keeps the queue -- see `stop` in
                  music-player-provider.tsx. "Clear the queue" is the Queue screen's job. */}
              <Button variant="secondary" onClick={player.stop}>
                Close player
              </Button>
            </div>
          </div>
        </div>

        {player.error !== undefined && (
          <p className="mt-3 rounded border border-line bg-paper-raised p-2 text-xs text-muted">
            {player.error}
          </p>
        )}
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
 * What stands in for cover art when there isn't any: a record on a turntable, turning
 * while the track plays.
 *
 * Drawn rather than shipped as an image file so it takes the active theme -- the label
 * is `brass`, the vinyl and the sheen are built from `ink`/`line`, so it recolours with
 * every theme including the two light ones. A flat PNG would be a dark square sitting
 * in a white page on Daybreak.
 *
 * `aria-hidden`: it carries no information the screen does not already say in text. The
 * track title and artist are right beneath it, and "no cover art" is not news worth
 * announcing.
 */
function VinylPlaceholder({ isPlaying }: { isPlaying: boolean }) {
  return (
    <div
      className="grid aspect-square w-full place-items-center overflow-hidden rounded-xl border border-line bg-paper-raised"
      aria-hidden="true"
    >
      {/* 86% so the record sits inside the sleeve with a margin, the way one does. */}
      <svg viewBox="0 0 200 200" className="h-[86%] w-[86%]">
        {/* The disc. Near-black in every theme: a record is the one thing here that
            is not really a surface, so it takes `ink` at a low alpha over `paper`
            rather than a token fill -- which keeps it dark on light themes too. */}
        <circle cx="100" cy="100" r="96" fill="var(--paper)" />
        <circle cx="100" cy="100" r="96" fill="var(--ink)" opacity="0.06" />
        <circle cx="100" cy="100" r="96" fill="none" stroke="var(--line)" strokeWidth="1" />

        {/* Everything that turns, as one group: grooves, sheen and label together,
            so the whole record rotates rather than its parts sliding against each
            other. `data-spinning` pauses it in place when the music is paused. */}
        <g
          className="animate-vinyl motion-reduce:animate-none"
          data-spinning={isPlaying ? "true" : "false"}
          style={{ transformOrigin: "100px 100px" }}
        >
          {/* Grooves. Hand-listed rather than generated in a loop: seven circles are
              fewer characters than the map that would build them. */}
          <g fill="none" stroke="var(--ink)" strokeWidth="0.75" opacity="0.14">
            <circle cx="100" cy="100" r="88" />
            <circle cx="100" cy="100" r="81" />
            <circle cx="100" cy="100" r="74" />
            <circle cx="100" cy="100" r="67" />
            <circle cx="100" cy="100" r="60" />
            <circle cx="100" cy="100" r="53" />
            <circle cx="100" cy="100" r="46" />
          </g>

          {/* The glint off the surface. An arc rather than a gradient, so it reads as
              light on the vinyl and turns visibly with it -- a radial gradient would
              be rotationally symmetric and the spin would be invisible. */}
          <path
            d="M100 10 A90 90 0 0 1 176 52"
            fill="none"
            stroke="var(--ink)"
            strokeWidth="7"
            opacity="0.07"
            strokeLinecap="round"
          />

          {/* The centre label, and the spindle hole punched through it. */}
          <circle cx="100" cy="100" r="34" fill="var(--brass)" opacity="0.85" />
          <circle cx="100" cy="100" r="34" fill="none" stroke="var(--line)" strokeWidth="0.75" />
          <circle cx="100" cy="100" r="11" fill="var(--paper)" />
          <circle cx="100" cy="100" r="11" fill="none" stroke="var(--line)" strokeWidth="0.75" />

          {/* Two ticks on the label, so the rotation is legible even on a still
              frame -- a plain disc gives the eye nothing to track. */}
          <rect x="99" y="72" width="2" height="9" rx="1" fill="var(--paper)" opacity="0.5" />
          <rect x="99" y="119" width="2" height="9" rx="1" fill="var(--paper)" opacity="0.5" />
        </g>
      </svg>
    </div>
  );
}

/**
 * The speaker mark beside the volume slider.
 *
 * Local to this screen: the player bar has no volume control, so unlike the four
 * transport glyphs there is nothing to share it with. Decorative -- the slider carries
 * the accessible name.
 */
function VolumeGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-current" aria-hidden="true">
      <path d="M4 9h3l5-4v14l-5-4H4zm12.5 3a4 4 0 0 0-2-3.46v6.92A4 4 0 0 0 16.5 12z" />
    </svg>
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
        {/*
          Attribution follows the source. Words read from the file are not "matched"
          on anything -- they came with the music -- so claiming a match on them
          would be untrue, and saying lrclib.net doubly so.
        */}
        {lyrics.source === "embedded" ? (
          <p className="mt-4 border-t border-line pt-2 text-xs text-muted">
            From this file&rsquo;s own tags
          </p>
        ) : (
          lyrics.searchedFor !== undefined && (
            <p className="mt-4 border-t border-line pt-2 text-xs text-muted">
              Matched on {lyrics.searchedFor} - from lrclib.net
            </p>
          )
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
      {/*
        The last resort, after the file's tags and lrclib both came up empty. A link
        rather than a fetch -- see `googleLyricsSearchUrl` on why these words are not
        ours to scrape.
      */}
      {lyrics.searchUrl !== undefined && (
        <p className="mt-2 text-xs text-muted">
          <a
            href={lyrics.searchUrl}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-ink"
          >
            Search Google for these lyrics
          </a>
        </p>
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
