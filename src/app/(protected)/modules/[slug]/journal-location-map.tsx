"use client";

import { useEffect } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** A pin that carries its position in a numbered list, so the map agrees with a table. */
export interface NumberedLatLng extends LatLng {
  /** Shown inside the pin. 1-based, to match a "#1, #2…" listing. */
  number: number;
}

// A divIcon (inline SVG) avoids Leaflet's default PNG marker, whose image paths
// break under bundlers. `currentColor` picks up the wrapper's color, so the pin
// uses the theme's brass accent rather than a hardcoded hex.
const pinIcon = L.divIcon({
  className: "",
  html:
    '<div style="color:var(--brass);transform:translate(-50%,-100%)">' +
    '<svg width="26" height="38" viewBox="0 0 26 38" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M13 0C5.82 0 0 5.82 0 13c0 9.25 13 25 13 25s13-15.75 13-25C26 5.82 20.18 0 13 0z" fill="currentColor" stroke="rgba(0,0,0,0.3)"/>' +
    '<circle cx="13" cy="13" r="5" fill="#fff"/></svg></div>',
  iconSize: [0, 0],
  iconAnchor: [0, 0],
});

/**
 * The same pin with its number drawn in the white circle. Built per marker
 * rather than once, because the label differs. The number sits in a `<text>`
 * inside the SVG so it scales and positions with the pin instead of needing a
 * second absolutely-positioned element.
 */
function numberedPinIcon(number: number): L.DivIcon {
  return L.divIcon({
    className: "",
    html:
      '<div style="color:var(--brass);transform:translate(-50%,-100%)">' +
      '<svg width="30" height="44" viewBox="0 0 26 38" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M13 0C5.82 0 0 5.82 0 13c0 9.25 13 25 13 25s13-15.75 13-25C26 5.82 20.18 0 13 0z" fill="currentColor" stroke="rgba(0,0,0,0.3)"/>' +
      '<circle cx="13" cy="13" r="8.5" fill="#fff"/>' +
      '<text x="13" y="13" text-anchor="middle" dominant-baseline="central" ' +
      'font-family="ui-monospace, monospace" font-size="11" font-weight="700" fill="currentColor">' +
      String(number) +
      "</text></svg></div>",
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

const DEFAULT_CENTER: [number, number] = [40.3399, -74.4619]; // Princeton, NJ
const DEFAULT_ZOOM = 4;
const PICK_ZOOM = 14;
// Keeps the outermost pins off the map's edge when fitting several at once.
const FIT_PADDING: [number, number] = [40, 40];
// A single point has zero-area bounds, so fitBounds would zoom to max. Cap it.
const FIT_MAX_ZOOM = 15;

function ClickCapture({ onPick }: { onPick: (latitude: number, longitude: number) => void }) {
  useMapEvents({
    click(event) {
      onPick(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

// Recenters the map when a search result / external center change comes in.
function Recenter({ center }: { center: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView([center.latitude, center.longitude], PICK_ZOOM);
  }, [center, map]);
  return null;
}

/**
 * Zooms out to whatever window holds every numbered pin. Runs after mount
 * because the container has no size until then and `fitBounds` needs one.
 */
function FitToMarkers({ markers }: { markers: readonly NumberedLatLng[] }) {
  const map = useMap();
  // Depend on the coordinates, not the array identity, so a re-render with an
  // equivalent list doesn't yank the view back from where the user panned to.
  const bounds = markers.map((point) => `${point.latitude},${point.longitude}`).join("|");
  useEffect(() => {
    if (markers.length === 0) return;
    map.fitBounds(
      markers.map((point) => [point.latitude, point.longitude] as [number, number]),
      { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on `bounds`, see above
  }, [bounds, map]);
  return null;
}

export function JournalLocationMap({
  marker,
  markers,
  center,
  onPick,
  heightClassName = "h-64",
}: {
  marker: LatLng | null;
  /**
   * Several pins at once, each labelled with its number. The map fits its view
   * to all of them. Takes precedence over `marker`/`center` when non-empty.
   */
  markers?: readonly NumberedLatLng[];
  center: LatLng | null;
  /** Omit for a read-only map (e.g. viewing an entry's saved location). */
  onPick?: (latitude: number, longitude: number) => void;
  /** Tailwind height for the map box. Taller reads better with many pins. */
  heightClassName?: string;
}) {
  const hasMany = markers !== undefined && markers.length > 0;

  const initialCenter: [number, number] = hasMany
    ? [markers[0].latitude, markers[0].longitude]
    : marker
      ? [marker.latitude, marker.longitude]
      : center
        ? [center.latitude, center.longitude]
        : DEFAULT_CENTER;

  return (
    <div className={`${heightClassName} overflow-hidden rounded-md border border-line`}>
      <MapContainer
        center={initialCenter}
        zoom={hasMany || marker || center ? PICK_ZOOM : DEFAULT_ZOOM}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {onPick && <ClickCapture onPick={onPick} />}
        {hasMany ? (
          <>
            <FitToMarkers markers={markers} />
            {markers.map((point) => (
              <Marker
                key={`${point.number}-${point.latitude}-${point.longitude}`}
                position={[point.latitude, point.longitude]}
                icon={numberedPinIcon(point.number)}
                title={`#${point.number}`}
              />
            ))}
          </>
        ) : (
          <>
            <Recenter center={center} />
            {marker && <Marker position={[marker.latitude, marker.longitude]} icon={pinIcon} />}
          </>
        )}
      </MapContainer>
    </div>
  );
}
