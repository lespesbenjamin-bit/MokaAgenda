import "server-only";
import type { LatLng } from "@/lib/domain/travel";

/**
 * Adaptateur de fournisseur cartographique. Changer de fournisseur
 * (Google Routes, HERE…) = écrire une autre implémentation de cette interface.
 */

export interface GeocodeCandidate {
  label: string;
  lat: number;
  lng: number;
  postcode: string | null;
  city: string | null;
  score: number;
  /** housenumber = numéro précis ; street = rue sans numéro ; autres = trop imprécis. */
  precision: "housenumber" | "street" | "other";
}

export interface RouteResult {
  distanceM: number;
  durationS: number;
  /** Tracé simplifié [lng, lat][] pour la carte (facultatif). */
  geometry: [number, number][] | null;
}

export type ProviderErrorKind = "unavailable" | "quota" | "invalid" | "not_found";

export class ProviderError extends Error {
  constructor(public kind: ProviderErrorKind, message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface TravelProvider {
  name: string;
  /** Le fournisseur fournit-il le trafic en temps réel ? (IGN : non) */
  liveTraffic: boolean;
  geocode(query: string, opts?: { postcode?: string }): Promise<GeocodeCandidate[]>;
  route(from: LatLng, to: LatLng, profile: "car" | "pedestrian"): Promise<RouteResult>;
}
