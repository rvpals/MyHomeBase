"use client";

// The app's single <audio> element, and the state around it.
//
// It lives in a provider mounted by the protected layout rather than inside the
// music module's pages, for one reason: an <audio> element unmounts when you navigate
// away, and an unmounted element stops playing. Keeping exactly one instance above the
// page means music survives moving between modules. That is an architectural choice
// which is painful to retrofit, so it is made here up front.
//
// Presentation only. It knows how to play a URL and report where it is; it does not
// know what a track is beyond the fields it displays, and it decides nothing about
// formats, ranges, or what plays next -- the server does that.
//
// THE QUEUE LIVES IN THE DATABASE (migrations/0059), not here. This provider holds a
// copy for rendering and calls a server action for every change. The rules about what
// plays next are in src/lib/music/queue.ts, where they can be tested; before 0059 they
// were four lines in a `useCallback` here, and they were subtly wrong for a track that
// appeared in the queue twice.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/** How the queue behaves when a track ends. Mirrors `RepeatMode` in src/lib/music. */
export type RepeatMode = "off" | "all" | "one";

/**
 * One row of the queue, as the player renders it.
 *
 * Declared here rather than imported from the server action that produces it: this is a
 * registered shared component, and components.md's rule is props in, events out -- a
 * component under src/components importing from src/app would invert the dependency the
 * whole layering rests on. The action's return type is checked against this where the
 * two meet, in the protected layout.
 */
export interface QueueRow {
  /** Identifies the ENTRY, not the track -- a queue may hold one track twice. */
  entryId: number;
  trackId: number;
  displayTitle: string;
  artist: string;
  album: string;
  albumId?: number;
  durationSeconds?: number;
  extension: string;
  isStreamable: boolean;
}

/** The whole queue plus its modes, as one server round trip returns it. */
export interface QueueViewModel {
  rows: QueueRow[];
  currentEntryId?: number;
  repeatMode: RepeatMode;
  isShuffled: boolean;
  totalSeconds: number;
  remainingSeconds: number;
}

/**
 * The server actions the queue needs, injected by whoever mounts the provider.
 *
 * Injected rather than imported for the layering reason above, and it buys the same
 * thing every port in src/lib buys: this component can be rendered in a test with a
 * fake, no database required.
 */
export interface MusicQueueActions {
  getQueue: () => Promise<QueueViewModel>;
  setQueue: (input: { trackIds: number[]; startIndex?: number }) => Promise<QueueViewModel>;
  enqueueTracks: (input: { trackIds: number[] }) => Promise<QueueViewModel>;
  playQueueEntry: (entryId: number) => Promise<QueueViewModel>;
  advanceQueue: (
    isManual: boolean,
  ) => Promise<{ queue: QueueViewModel; playingEntryId?: number }>;
  rewindQueue: () => Promise<{ queue: QueueViewModel; playingEntryId?: number }>;
  shuffleQueue: () => Promise<QueueViewModel>;
  removeQueueEntry: (entryId: number) => Promise<QueueViewModel>;
  clearQueue: () => Promise<QueueViewModel>;
  /** Drops the cursor, keeping the entries -- what `stop` persists. */
  closeQueue: () => Promise<QueueViewModel>;
  setRepeatMode: (mode: RepeatMode) => Promise<QueueViewModel>;
}

/** The minimum a player needs to show and stream a track. */
export interface PlayableTrack {
  id: number;
  title: string;
  artist: string;
  album: string;
  albumId?: number;
  durationSeconds?: number;
}

interface MusicPlayerState {
  current?: PlayableTrack;
  /**
   * The queue, as rows carrying their entry id.
   *
   * Entry ids, not track ids: the queue may hold the same track twice, and every
   * operation addresses an entry so "the second copy of this song" is a place you can
   * be. See migrations/0059.
   */
  queue: QueueRow[];
  /** Which queue ENTRY is playing. */
  currentEntryId?: number;
  repeatMode: RepeatMode;
  isShuffled: boolean;
  /** Seconds of queue still to come after the current track. */
  remainingSeconds: number;
  isPlaying: boolean;
  /** True until the persisted queue has been read back on first mount. */
  isQueueLoading: boolean;
  /** Seconds. Driven by the audio element's timeupdate, not a timer. */
  position: number;
  /** Seconds. From the element's metadata, which is more reliable than the tag. */
  duration: number;
  /** 0-1. */
  volume: number;
  /** A message for the listener when a track will not play. */
  error?: string;
  /** Plays a track, replacing the queue with the list it came from. */
  play: (track: PlayableTrack, queue?: PlayableTrack[]) => void;
  /** Adds to the end of the queue without disturbing what is playing. */
  enqueue: (tracks: PlayableTrack[]) => void;
  /** Jumps to a queue entry -- clicking a row on the Queue screen. */
  playEntry: (entryId: number) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  shuffleQueue: () => void;
  removeFromQueue: (entryId: number) => void;
  clearQueue: () => void;
  setRepeatMode: (mode: RepeatMode) => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  stop: () => void;
}

const MusicPlayerContext = createContext<MusicPlayerState | undefined>(undefined);

/** The streaming URL for a track. One place, so the route path is not spread around. */
export function trackStreamUrl(trackId: number): string {
  return `/api/music/tracks/${trackId}/stream`;
}

/** The cover URL for an album, or undefined when it has no artwork. */
export function albumCoverUrl(albumId: number | undefined): string | undefined {
  return albumId === undefined ? undefined : `/api/music/albums/${albumId}/cover`;
}

/** A queue row as the player needs it. */
function toPlayable(row: QueueRow): PlayableTrack {
  return {
    id: row.trackId,
    title: row.displayTitle,
    artist: row.artist,
    album: row.album,
    albumId: row.albumId,
    durationSeconds: row.durationSeconds,
  };
}

export function MusicPlayerProvider({
  children,
  actions,
}: {
  children: ReactNode;
  actions: MusicQueueActions;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Held in a ref, not read from the closure, so every callback below keeps a stable
  // identity across renders. A server action's function identity is not guaranteed
  // stable, and putting `actions` in the dependency arrays would rebuild `step` on every
  // render -- which detaches and reattaches the `ended` listener each time, the kind of
  // churn that drops an auto-advance if the track ends mid-swap.
  //
  // Synced in an effect rather than assigned during render: writing a ref while
  // rendering is what react-hooks/refs forbids, and the initial value already covers
  // the first paint.
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);
  const [current, setCurrent] = useState<PlayableTrack | undefined>(undefined);
  const [queue, setQueue] = useState<QueueViewModel | undefined>(undefined);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [error, setError] = useState<string | undefined>(undefined);

  // Created imperatively rather than rendered as JSX: nothing should be able to
  // unmount it by re-rendering, and it needs no DOM position.
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audioRef.current = audio;

    const onTimeUpdate = () => setPosition(audio.currentTime);
    const onLoaded = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onError = () =>
      setError("This track could not be played. It may have moved, or the NAS may be asleep.");

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("error", onError);
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    };
  }, []);

  /**
   * Reads the persisted queue back on first mount.
   *
   * The current track is restored into the UI but deliberately NOT started: a page that
   * begins playing music on load is hostile, and browsers block it anyway. So you come
   * back to your queue paused at the track you left, and press play.
   */
  useEffect(() => {
    let cancelled = false;
    void actionsRef.current.getQueue()
      .then((loaded) => {
        if (cancelled) return;
        setQueue(loaded);
        const row = loaded.rows.find((entry) => entry.entryId === loaded.currentEntryId);
        if (row !== undefined) {
          setCurrent(toPlayable(row));
          const audio = audioRef.current;
          // The src is primed so the scrubber has a duration and pressing play is
          // instant; without a play() call this loads metadata only.
          if (audio !== null) audio.src = trackStreamUrl(row.trackId);
        }
      })
      // A queue that will not load must not take the player down with it -- an empty
      // queue is a working player.
      .catch(() => (cancelled ? undefined : setQueue(undefined)));

    return () => {
      cancelled = true;
    };
  }, []);

  /** Points the element at a track and plays it. The one place that touches `src`. */
  const startTrack = useCallback((track: PlayableTrack) => {
    const audio = audioRef.current;
    if (audio === null) return;

    setError(undefined);
    setCurrent(track);
    setPosition(0);
    audio.src = trackStreamUrl(track.id);
    // A rejected play() is normally an autoplay-policy refusal, which is not an error
    // worth showing -- the listener pressed a button, so it will succeed. The error
    // event above covers the cases that actually matter.
    void audio.play().catch(() => undefined);
  }, []);

  const play = useCallback(
    (track: PlayableTrack, nextQueue?: PlayableTrack[]) => {
      // Played immediately rather than after the server responds: a click on a song must
      // not wait on a database write to make a sound.
      startTrack(track);

      const list = nextQueue ?? [track];
      const startIndex = Math.max(
        list.findIndex((entry) => entry.id === track.id),
        0,
      );
      void actionsRef.current.setQueue({ trackIds: list.map((entry) => entry.id), startIndex })
        .then(setQueue)
        .catch(() => undefined);
    },
    [startTrack],
  );

  const enqueue = useCallback((tracks: PlayableTrack[]) => {
    if (tracks.length === 0) return;
    void actionsRef.current.enqueueTracks({ trackIds: tracks.map((entry) => entry.id) })
      .then(setQueue)
      .catch(() => undefined);
  }, []);

  const playEntry = useCallback(
    (entryId: number) => {
      const row = queue?.rows.find((entry) => entry.entryId === entryId);
      if (row === undefined || !row.isStreamable) return;

      startTrack(toPlayable(row));
      void actionsRef.current.playQueueEntry(entryId).then(setQueue).catch(() => undefined);
    },
    [queue, startTrack],
  );

  /**
   * Play/pause -- and the way back in after the bar has been dismissed.
   *
   * With no current track the queue may still hold entries (`closeQueue` drops the
   * cursor and keeps the rows), so pressing play starts the first one rather than doing
   * nothing. That matches a freshly loaded queue, where the first entry is also where
   * play begins.
   */
  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (audio === null) return;

    if (current === undefined) {
      const first = queue?.rows.find((row) => row.isStreamable);
      if (first !== undefined) playEntry(first.entryId);
      return;
    }

    if (audio.paused) void audio.play().catch(() => undefined);
    else audio.pause();
  }, [current, playEntry, queue]);

  /**
   * Steps the queue. The SERVER decides where to -- it owns the repeat mode and the
   * order, so asking it is what keeps the two in agreement.
   *
   * `isManual` separates pressing Next from a track ending, which differ under repeat
   * one. A step that returns no entry means the queue has run out: the audio is paused
   * rather than cleared, so the last track stays on screen and can be replayed.
   */
  const step = useCallback(
    (direction: "next" | "previous", isManual: boolean) => {
      const request =
        direction === "next"
          ? actionsRef.current.advanceQueue(isManual)
          : actionsRef.current.rewindQueue();

      void request
        .then((result) => {
          setQueue(result.queue);
          const row = result.queue.rows.find(
            (entry) => entry.entryId === result.playingEntryId,
          );
          if (row === undefined) {
            audioRef.current?.pause();
            return;
          }
          startTrack(toPlayable(row));
        })
        .catch(() => undefined);
    },
    [startTrack],
  );

  const next = useCallback(() => step("next", true), [step]);
  const previous = useCallback(() => step("previous", true), [step]);

  // Auto-advance at the end of a track, so a queue plays through. `isManual: false`, so
  // repeat-one replays instead of moving on.
  useEffect(() => {
    const audio = audioRef.current;
    if (audio === null) return;
    const onEnded = () => step("next", false);
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, [step]);

  const shuffleQueue = useCallback(() => {
    void actionsRef.current.shuffleQueue().then(setQueue).catch(() => undefined);
  }, []);

  /**
   * Removes an entry. When it is the one playing, the server moves the cursor to what
   * followed and this starts that track -- otherwise the audio would keep playing
   * something no longer in the queue.
   */
  const removeFromQueue = useCallback(
    (entryId: number) => {
      const wasCurrent = queue?.currentEntryId === entryId;
      void actionsRef.current.removeQueueEntry(entryId)
        .then((updated) => {
          setQueue(updated);
          if (!wasCurrent) return;

          const row = updated.rows.find((entry) => entry.entryId === updated.currentEntryId);
          if (row === undefined) {
            audioRef.current?.pause();
            setCurrent(undefined);
            return;
          }
          startTrack(toPlayable(row));
        })
        .catch(() => undefined);
    },
    [queue, startTrack],
  );

  const clearQueue = useCallback(() => {
    const audio = audioRef.current;
    if (audio !== null) {
      audio.pause();
      audio.src = "";
    }
    setCurrent(undefined);
    setIsPlaying(false);
    setPosition(0);
    setDuration(0);
    void actionsRef.current.clearQueue().then(setQueue).catch(() => undefined);
  }, []);

  const setRepeatMode = useCallback((mode: RepeatMode) => {
    void actionsRef.current.setRepeatMode(mode).then(setQueue).catch(() => undefined);
  }, []);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (audio === null) return;
    audio.currentTime = Math.max(0, seconds);
    setPosition(audio.currentTime);
  }, []);

  const setVolume = useCallback((value: number) => {
    const audio = audioRef.current;
    const clamped = Math.min(Math.max(value, 0), 1);
    setVolumeState(clamped);
    if (audio !== null) audio.volume = clamped;
  }, []);

  /**
   * Closes the player.
   *
   * Stops the audio and hides the bar, but LEAVES the stored queue alone -- "close the
   * bar" and "throw away my 60-track queue" are different intentions, and now that the
   * queue is persistent, conflating them would destroy real work. Emptying it is
   * `clearQueue`, which the Queue screen offers explicitly.
   */
  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio !== null) {
      audio.pause();
      audio.src = "";
    }
    setCurrent(undefined);
    setIsPlaying(false);
    setPosition(0);
    setDuration(0);
    // Persisted, not just dropped from state: the mount effect above restores whatever
    // `currentEntryId` points at, so without this the bar came back on the next page
    // load and the dismissal looked like it had been ignored.
    void actionsRef.current.closeQueue().then(setQueue).catch(() => undefined);
  }, []);

  const value = useMemo<MusicPlayerState>(
    () => ({
      current,
      queue: queue?.rows ?? [],
      currentEntryId: queue?.currentEntryId,
      repeatMode: queue?.repeatMode ?? "off",
      isShuffled: queue?.isShuffled ?? false,
      remainingSeconds: queue?.remainingSeconds ?? 0,
      isPlaying,
      isQueueLoading: queue === undefined,
      position,
      duration,
      volume,
      error,
      play,
      enqueue,
      playEntry,
      toggle,
      next,
      previous,
      shuffleQueue,
      removeFromQueue,
      clearQueue,
      setRepeatMode,
      seek,
      setVolume,
      stop,
    }),
    [
      current,
      queue,
      isPlaying,
      position,
      duration,
      volume,
      error,
      play,
      enqueue,
      playEntry,
      toggle,
      next,
      previous,
      shuffleQueue,
      removeFromQueue,
      clearQueue,
      setRepeatMode,
      seek,
      setVolume,
      stop,
    ],
  );

  return <MusicPlayerContext.Provider value={value}>{children}</MusicPlayerContext.Provider>;
}

/**
 * The player state.
 *
 * Returns `undefined` outside the provider rather than throwing, so a component can
 * be rendered in isolation (a test, a storybook page) without the whole layout.
 */
export function useMusicPlayer(): MusicPlayerState | undefined {
  return useContext(MusicPlayerContext);
}

/** mm:ss for a number of seconds. Shared by the bar and the player screen. */
export function formatPlayerTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
