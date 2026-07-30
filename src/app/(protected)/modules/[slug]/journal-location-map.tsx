"use client";

import { useEffect } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export interface LatLng {
  latitude: number;
  longitude: number;
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

const DEFAULT_CENTER: [number, number] = [40.3399, -74.4619]; // Princeton, NJ
const DEFAULT_ZOOM = 4;
const PICK_ZOOM = 14;

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

export function JournalLocationMap({
  marker,
  center,
  onPick,
}: {
  marker: LatLng | null;
  center: LatLng | null;
  /** Omit for a read-only map (e.g. viewing an entry's saved location). */
  onPick?: (latitude: number, longitude: number) => void;
}) {
  const initialCenter: [number, number] = marker
    ? [marker.latitude, marker.longitude]
    : center
      ? [center.latitude, center.longitude]
      : DEFAULT_CENTER;

  return (
    <div className="h-64 overflow-hidden rounded-md border border-line">
      <MapContainer
        center={initialCenter}
        zoom={marker || center ? PICK_ZOOM : DEFAULT_ZOOM}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {onPick && <ClickCapture onPick={onPick} />}
        <Recenter center={center} />
        {marker && <Marker position={[marker.latitude, marker.longitude]} icon={pinIcon} />}
      </MapContainer>
    </div>
  );
}
