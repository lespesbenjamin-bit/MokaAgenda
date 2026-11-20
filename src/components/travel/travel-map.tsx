"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

/**
 * Carte (fond « Plan IGN » de la Géoplateforme, gratuit). Les tracés sont
 * ceux renvoyés par le calculateur d'itinéraires ; un cercle de zone n'est
 * qu'un repère visuel (les zones réelles utilisent la distance routière).
 */
export interface MapMarker {
  lat: number;
  lng: number;
  label: string;
  kind: "start" | "home" | "salon" | "proposed";
  order?: number;
}

export interface MapCircle {
  lat: number;
  lng: number;
  radiusKm: number;
  label: string;
  excluded?: boolean;
}

const IGN_TILES =
  "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}";

const COLORS = { start: "#18181b", home: "#cc4a0c", salon: "#2563eb", proposed: "#15803d" } as const;

export function TravelMap({ markers, lines = [], circles = [], height = 320 }: { markers: MapMarker[]; lines?: [number, number][][]; circles?: MapCircle[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let map: import("leaflet").Map | null = null;
    (async () => {
      const L = await import("leaflet");
      if (disposed || !ref.current) return;
      map = L.map(ref.current, { scrollWheelZoom: false, attributionControl: true });
      L.tileLayer(IGN_TILES, { maxZoom: 18, attribution: "© IGN – Géoplateforme" }).addTo(map);
      const bounds = L.latLngBounds([]);
      for (const c of circles) {
        L.circle([c.lat, c.lng], { radius: c.radiusKm * 1000, color: c.excluded ? "#dc2626" : "#cc4a0c", weight: 1.5, fillOpacity: 0.06, dashArray: "6 6" }).bindTooltip(c.label).addTo(map);
        bounds.extend(L.latLng(c.lat, c.lng).toBounds(c.radiusKm * 2000));
      }
      for (const line of lines) {
        const pts = line.map(([lng, lat]) => L.latLng(lat, lng));
        L.polyline(pts, { color: "#cc4a0c", weight: 4, opacity: 0.75 }).addTo(map);
        pts.forEach((p) => bounds.extend(p));
      }
      for (const m of markers) {
        const marker = L.circleMarker([m.lat, m.lng], { radius: m.kind === "start" ? 8 : 10, color: "#fff", weight: 2, fillColor: COLORS[m.kind], fillOpacity: 1 });
        marker.bindTooltip(m.order != null ? `${m.order}. ${m.label}` : m.label, { permanent: m.order != null, direction: "top", offset: [0, -8] });
        marker.addTo(map);
        bounds.extend([m.lat, m.lng]);
      }
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
      else map.setView([46.6, 2.4], 5);
    })();
    return () => {
      disposed = true;
      map?.remove();
    };
  }, [markers, lines, circles]);

  return <div ref={ref} style={{ height }} className="w-full overflow-hidden rounded-2xl border border-border bg-secondary" role="img" aria-label="Carte des déplacements" />;
}
