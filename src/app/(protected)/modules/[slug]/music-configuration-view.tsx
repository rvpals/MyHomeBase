"use client";

// Configuration: which file formats a scan should catalog, and how the module looks.
//
// The allowlist is applied BEFORE a file is opened, so narrowing it genuinely speeds a
// scan up rather than just hiding rows -- reading tags is the expensive part.

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/button";
import { MUSIC_EXTENSIONS, MUSIC_FORMATS } from "@/lib/music";
import { getMusicSettingsAction, saveMusicSettingsAction } from "./music-actions";
import { MusicTextureControl } from "./music-texture-control";

export function MusicConfigurationView() {
  const [extensions, setExtensions] = useState<string[]>([]);
  const [skipUnstreamable, setSkipUnstreamable] = useState(true);
  const [autoFetchLyrics, setAutoFetchLyrics] = useState(false);
  const [trackCount, setTrackCount] = useState(0);
  const [rootConfigured, setRootConfigured] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [isSaving, startSaving] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void getMusicSettingsAction().then((settings) => {
      if (cancelled) return;
      setExtensions(settings.scanExtensions);
      setSkipUnstreamable(settings.skipUnstreamable);
      setAutoFetchLyrics(settings.autoFetchLyrics);
      setTrackCount(settings.trackCount);
      setRootConfigured(settings.musicRootConfigured);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (extension: string) => {
    setExtensions((current) =>
      current.includes(extension)
        ? current.filter((entry) => entry !== extension)
        : [...current, extension],
    );
  };

  const onSave = () => {
    setMessage(undefined);
    startSaving(async () => {
      const result = await saveMusicSettingsAction({
        scanExtensions: extensions,
        skipUnstreamable,
        autoFetchLyrics,
      });
      setMessage("error" in result ? result.error : "Saved.");
    });
  };

  if (!loaded) return <p className="text-sm text-muted">Loading settings...</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl border border-line p-4">
        <h2 className="font-display text-lg text-ink">File formats to include</h2>
        <p className="mt-1 text-sm text-muted">
          Anything unticked is ignored during a scan, before the file is even opened.
        </p>

        <ul className="mt-3 space-y-1">
          {MUSIC_EXTENSIONS.map((extension) => {
            const format = MUSIC_FORMATS[extension];
            return (
              <li key={extension}>
                <label className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-brass-soft">
                  <input
                    type="checkbox"
                    checked={extensions.includes(extension)}
                    onChange={() => toggle(extension)}
                    className="accent-brass"
                  />
                  <span className="text-sm text-ink">{format.label}</span>
                  <span className="font-mono text-xs uppercase text-muted">.{extension}</span>
                  {!format.isStreamable && (
                    <span className="ml-auto text-xs text-muted">not playable in a browser</span>
                  )}
                  {format.isLossless && format.isStreamable && (
                    <span className="ml-auto text-xs text-muted">lossless</span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>

        {extensions.length === 0 && (
          <p className="mt-2 text-xs text-muted">
            Pick at least one format - an empty list would make every scan do nothing.
          </p>
        )}

        <label className="mt-4 flex items-start gap-2 border-t border-line pt-3">
          <input
            type="checkbox"
            checked={skipUnstreamable}
            onChange={(event) => setSkipUnstreamable(event.target.checked)}
            className="mt-0.5 accent-brass"
          />
          <span className="text-sm text-ink">
            Skip files a browser cannot play
            <span className="mt-0.5 block text-xs text-muted">
              APE and WMA have no browser decoder. Leave this on for a library you can listen
              to; turn it off to catalog everything for reference.
            </span>
          </span>
        </label>

        <label className="mt-3 flex items-start gap-2 border-t border-line pt-3">
          <input
            type="checkbox"
            checked={autoFetchLyrics}
            onChange={(event) => setAutoFetchLyrics(event.target.checked)}
            className="mt-0.5 accent-brass"
          />
          <span className="text-sm text-ink">
            Auto-retrieve lyrics from the web when none are saved
            <span className="mt-0.5 block text-xs text-muted">
              Off by default: with this on, opening the player for a track with no saved
              lyrics sends a lookup to lrclib.net by itself, instead of waiting for the
              &ldquo;Get lyrics&rdquo; button. Each answer is cached, so a track is only ever
              asked about once — and a miss is not retried automatically.
            </span>
          </span>
        </label>

        <div className="mt-4 flex items-center gap-2">
          <Button onClick={onSave} disabled={isSaving || extensions.length === 0}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
          {message !== undefined && <span className="text-xs text-muted">{message}</span>}
        </div>
      </section>

      <section className="rounded-xl border border-line p-4">
        <h2 className="font-display text-lg text-ink">Library</h2>
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Tracks catalogued</dt>
            <dd className="font-mono text-ink">{trackCount.toLocaleString()}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Music folder</dt>
            <dd className="text-ink">{rootConfigured ? "Configured" : "Not set"}</dd>
          </div>
        </dl>

        {!rootConfigured && (
          <p className="mt-3 text-xs text-muted">
            Set <span className="font-mono text-ink">MYHOMEBASE_MUSIC_ROOT</span> to the folder
            holding your music - <span className="font-mono">/volume1/MEDIA/AUDIO</span> on the
            NAS.
          </p>
        )}

        <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
          Nothing in this module ever writes to your music files. It reads them to build the
          catalog and streams them to play; album art and lyrics are stored in the database, not
          alongside the audio.
        </p>
      </section>

      {/* The module's own background picture (migrations/0064). Its own section
          rather than a row in the scan card above: it has nothing to do with
          scanning, and it owns its own Save. */}
      <section className="rounded-xl border border-line bg-paper-raised p-4">
        <h2 className="font-display text-lg text-ink">Appearance</h2>
        <p className="mt-1 text-sm text-muted">
          An optional picture behind every Music Library screen. This card keeps its own
          solid background so it stays readable while you tune the setting.
        </p>
        <div className="mt-4">
          <MusicTextureControl />
        </div>
      </section>
    </div>
  );
}
