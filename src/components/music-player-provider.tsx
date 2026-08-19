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
// formats or ranges -- the server does that.

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
  /** The queue, so "next" works from a list without the list staying mounted. */
  queue: PlayableTrack[];
  isPlaying: boolean;
  /** Seconds. Driven by the audio element's timeupdate, not a timer. */
  position: number;
  /** Seconds. From the element's metadata, which is more reliable than the tag. */
  duration: number;
  /** 0-1. */
  volume: number;
  /** A message for the listener when a track will not play. */
  error?: string;
  play: (track: PlayableTrack, queue?: PlayableTrack[]) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
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

export function MusicPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [current, setCurrent] = useState<PlayableTrack | undefined>(undefined);
  const [queue, setQueue] = useState<PlayableTrack[]>([]);
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

  const play = useCallback((track: PlayableTrack, nextQueue?: PlayableTrack[]) => {
    const audio = audioRef.current;
    if (audio === null) return;

    setError(undefined);
    setCurrent(track);
    if (nextQueue !== undefined) setQueue(nextQueue);
    setPosition(0);

    audio.src = trackStreamUrl(track.id);
    // A rejected play() is normally an autoplay-policy refusal, which is not an error
    // worth showing -- the listener pressed a button, so it will succeed. The error
    // event above covers the cases that actually matter.
    void audio.play().catch(() => undefined);
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (audio === null || current === undefined) return;
    if (audio.paused) void audio.play().catch(() => undefined);
    else audio.pause();
  }, [current]);

  const step = useCallback(
    (offset: number) => {
      if (current === undefined || queue.length === 0) return;
      const index = queue.findIndex((entry) => entry.id === current.id);
      if (index === -1) return;
      const target = queue[index + offset];
      if (target !== undefined) play(target);
    },
    [current, queue, play],
  );

  const next = useCallback(() => step(1), [step]);
  const previous = useCallback(() => step(-1), [step]);

  // Auto-advance at the end of a track, so a folder plays through.
  useEffect(() => {
    const audio = audioRef.current;
    if (audio === null) return;
    const onEnded = () => next();
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, [next]);

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

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio !== null) {
      audio.pause();
      audio.src = "";
    }
    setCurrent(undefined);
    setQueue([]);
    setIsPlaying(false);
    setPosition(0);
    setDuration(0);
  }, []);

  const value = useMemo<MusicPlayerState>(
    () => ({
      current,
      queue,
      isPlaying,
      position,
      duration,
      volume,
      error,
      play,
      toggle,
      next,
      previous,
      seek,
      setVolume,
      stop,
    }),
    [current, queue, isPlaying, position, duration, volume, error, play, toggle, next, previous, seek, setVolume, stop],
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
