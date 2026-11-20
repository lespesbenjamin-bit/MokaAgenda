import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signature serveur des données de déplacement (HMAC-SHA256).
 * La base n'accepte un trajet, une adresse géocodée ou une lecture des
 * arrêts privés que si le message est signé avec la clé partagée
 * (private.app_secrets côté base, TRAVEL_SIGNING_SECRET côté Vercel).
 * Les formats DOIVENT rester identiques à ceux de la migration Sprint 5.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** 6 décimales, comme round(x, 6)::text en PostgreSQL. */
export function coord(n: number): string {
  const s = n.toFixed(6);
  return s === "-0.000000" ? "0.000000" : s;
}

export function round6(p: LatLng): LatLng {
  return { lat: Number(coord(p.lat)), lng: Number(coord(p.lng)) };
}

export function routeMessage(e: { businessId: string; from: LatLng; to: LatLng; distanceM: number; durationS: number; provider: string; computedEpoch: number }) {
  return ["route", "v1", e.businessId, coord(e.from.lat), coord(e.from.lng), coord(e.to.lat), coord(e.to.lng), String(e.distanceM), String(e.durationS), e.provider, String(e.computedEpoch)].join("|");
}

export function geoMessage(g: { businessId: string; lat: number; lng: number; postcode: string | null; expiresEpoch: number }) {
  return ["geo", "v1", g.businessId, coord(g.lat), coord(g.lng), g.postcode ?? "", String(g.expiresEpoch)].join("|");
}

export function contextMessage(c: { slug: string; fromEpoch: number; toEpoch: number; ts: number }) {
  return ["busy", "v1", c.slug.trim().toLowerCase(), String(c.fromEpoch), String(c.toEpoch), String(c.ts)].join("|");
}

export function sign(message: string, secret: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

export function verify(message: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(sign(message, secret), "hex");
  const given = Buffer.from(/^[0-9a-f]{64}$/.test(signature) ? signature : "", "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
