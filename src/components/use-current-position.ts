"use client";

// Reads the device's GPS position via the W3C Geolocation API.
//
// This is a browser API, so it cannot live under src/lib/ — the hook is the
// adapter, and callers hand the coordinates it returns to a `lib` use-case
// (reverse geocoding, weather) through a server action.
//
// Two things to know before using it:
//   - It needs a **secure context**: HTTPS or localhost. Over plain-HTTP LAN the
//     browser removes `navigator.geolocation` entirely, which reads as
//     "unsupported" below.
//   - Permission is per-origin and sticky. Once denied, it stays denied until
//     the user resets it in browser settings — so every caller needs a manual
//     fallback path, not just an error message.

import { useCallback, useState } from "react";

export interface DevicePosition {
  latitude: number;
  longitude: number;
  /** Accuracy radius in metres, as reported by the device. */
  accuracy: number;
}

// Long enough for a cold GPS fix on a phone, short enough that a fix which is
// never coming doesn't leave the button spinning.
const FIX_TIMEOUT_MS = 10_000;

function messageForError(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "Location permission denied. Allow location for this site, or pick a location on the map instead.";
    case error.POSITION_UNAVAILABLE:
      return "Your device couldn't get a location fix. Try again outdoors, or pick a location on the map.";
    case error.TIMEOUT:
      return "Getting your location took too long. Try again, or pick a location on the map.";
    default:
      return "Couldn't read your location. Pick a location on the map instead.";
  }
}

/** What `request()` resolves to: a position, or a message explaining why not. */
export type PositionResult =
  | { ok: true; position: DevicePosition }
  | { ok: false; error: string };

/**
 * Requests the device's current position on demand.
 *
 * `request()` never rejects — it resolves to `{ ok: true, position }` or
 * `{ ok: false, error }`, so callers branch on the result instead of wrapping
 * every call in a try. The failure message is returned rather than only stored,
 * because a caller reading `error` immediately after `await request()` would see
 * the value from the previous render, not this one. `error` is still exposed for
 * views that want to render the last failure declaratively.
 */
export function useCurrentPosition() {
  const [isLocating, setIsLocating] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const request = useCallback(async (): Promise<PositionResult> => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      const message =
        "This device or browser can't share a location. (Location needs an HTTPS connection.)";
      setError(message);
      return { ok: false, error: message };
    }

    setIsLocating(true);
    setError(undefined);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: FIX_TIMEOUT_MS,
          maximumAge: 0, // where you are now, not where you were
        });
      });
      return {
        ok: true,
        position: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        },
      };
    } catch (cause) {
      const message = messageForError(cause as GeolocationPositionError);
      setError(message);
      return { ok: false, error: message };
    } finally {
      setIsLocating(false);
    }
  }, []);

  return { request, isLocating, error };
}
