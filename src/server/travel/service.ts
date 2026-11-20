import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pairKey, type LatLng } from "@/lib/domain/travel";
import { createIgnProvider } from "./ign";
import { TtlCache } from "./limiter";
import { ProviderError, type GeocodeCandidate, type RouteResult, type TravelProvider } from "./provider";
import { contextMessage, geoMessage, round6, routeMessage, sign, verify } from "./signing";

/**
 * Services de déplacement côté serveur : géocodage validé, trajets routiers
 * (cache), signature des résultats pour la base. Aucun appel depuis le
 * navigateur ; aucune valeur inventée en cas d'échec.
 */

let providerOverride: TravelProvider | null = null;
let defaultProvider: TravelProvider | null = null;

export function travelProvider(): TravelProvider {
  if (providerOverride) return providerOverride;
  defaultProvider ??= createIgnProvider();
  return defaultProvider;
}

/** Tests uniquement : remplace le fournisseur (aucun appel réseau). */
export function setTravelProviderForTests(p: TravelProvider | null) {
  providerOverride = p;
}

/** Clé partagée avec la base (private.app_secrets). null = déplacements non configurés côté serveur. */
export function travelSecret(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.TRAVEL_SIGNING_SECRET?.trim();
  return s && /^[0-9a-f]{64}$/.test(s) ? s : null;
}

export const TRAVEL_NOT_CONFIGURED = "Le calcul des trajets n'est pas encore configuré (clé TRAVEL_SIGNING_SECRET manquante sur le serveur).";
export const TRAVEL_UNAVAILABLE = "Le service de calcul des trajets est momentanément indisponible.";

// ─── Géocodage ──────────────────────────────────────────────────────

export type GeocodeOutcome =
  | { status: "ok"; result: GeocodeCandidate; precise: boolean }
  | { status: "ambiguous"; candidates: GeocodeCandidate[] }
  | { status: "not_found" }
  | { status: "unavailable"; message: string };

const geocodeCache = new TtlCache<GeocodeCandidate[]>(2000, 24 * 3_600_000);

/**
 * Valide une adresse : résultat unique et suffisamment sûr, sinon demande
 * de précision (plusieurs propositions) ou adresse introuvable.
 */
export async function geocodeAddress(a: { line1: string; postalCode?: string | null; city?: string | null }): Promise<GeocodeOutcome> {
  const query = [a.line1, a.postalCode, a.city].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (query.length < 5) return { status: "not_found" };
  const key = `${query.toLowerCase()}|${a.postalCode ?? ""}`;
  let candidates = geocodeCache.get(key);
  if (!candidates) {
    try {
      candidates = await travelProvider().geocode(query, { postcode: a.postalCode && /^\d{5}$/.test(a.postalCode) ? a.postalCode : undefined });
    } catch (e) {
      return { status: "unavailable", message: e instanceof ProviderError && e.kind === "quota" ? "Trop de demandes au service d'adresses : réessayez dans un instant." : TRAVEL_UNAVAILABLE };
    }
    geocodeCache.set(key, candidates);
  }
  return classifyGeocode(candidates);
}

export function classifyGeocode(all: GeocodeCandidate[]): GeocodeOutcome {
  const usable = all.filter((c) => c.precision !== "other" && c.score >= 0.5).sort((x, y) => y.score - x.score);
  if (usable.length === 0) return { status: "not_found" };
  const [best, second] = usable;
  if (second && second.label !== best.label && second.score >= best.score - 0.03) return { status: "ambiguous", candidates: usable.slice(0, 4) };
  if (best.score < 0.65) return { status: "ambiguous", candidates: usable.slice(0, 4) };
  return { status: "ok", result: best, precise: best.precision === "housenumber" };
}

// ─── Trajets ────────────────────────────────────────────────────────

const routeCache = new TtlCache<RouteResult>(5000, 7 * 24 * 3_600_000);

export async function routeLeg(from: LatLng, to: LatLng): Promise<RouteResult> {
  const a = round6(from);
  const b = round6(to);
  const key = pairKey(a, b);
  const cached = routeCache.get(key);
  if (cached) return cached;
  const r = await travelProvider().route(a, b, "car");
  routeCache.set(key, r);
  return r;
}

export interface SignedLeg {
  from: LatLng;
  to: LatLng;
  distanceM: number;
  durationS: number;
  provider: string;
  computedEpoch: number;
  signature: string;
  geometry: [number, number][] | null;
}

export function signLeg(secret: string, businessId: string, from: LatLng, to: LatLng, r: RouteResult, provider = travelProvider().name): SignedLeg {
  const f = round6(from);
  const t = round6(to);
  const computedEpoch = Math.floor(Date.now() / 1000);
  const signature = sign(routeMessage({ businessId, from: f, to: t, distanceM: r.distanceM, durationS: r.durationS, provider, computedEpoch }), secret);
  return { from: f, to: t, distanceM: r.distanceM, durationS: r.durationS, provider, computedEpoch, signature, geometry: r.geometry };
}

export async function recordLeg(supabase: SupabaseClient, businessId: string, l: SignedLeg) {
  const { error } = await supabase.rpc("record_travel_estimate", {
    p: {
      business_id: businessId,
      from_lat: l.from.lat,
      from_lng: l.from.lng,
      to_lat: l.to.lat,
      to_lng: l.to.lng,
      distance_m: l.distanceM,
      duration_s: l.durationS,
      provider: l.provider,
      computed_epoch: l.computedEpoch,
      signature: l.signature,
      geometry: l.geometry,
    },
  });
  if (error) throw new Error(`Enregistrement du trajet : ${error.message}`);
}

/**
 * Calcule (fournisseur + cache) puis enregistre en base les trajets demandés.
 * Renvoie la durée/distance de chacun. Lève une ProviderError si un trajet
 * ne peut pas être calculé : l'appelant ne doit alors rien confirmer.
 */
export async function ensureLegs(
  supabase: SupabaseClient,
  businessId: string,
  pairs: { from: LatLng; to: LatLng }[],
): Promise<Map<string, RouteResult>> {
  const secret = travelSecret();
  if (!secret) throw new ProviderError("unavailable", TRAVEL_NOT_CONFIGURED);
  const unique = new Map<string, { from: LatLng; to: LatLng }>();
  for (const p of pairs) {
    const k = pairKey(round6(p.from), round6(p.to));
    if (p.from.lat.toFixed(6) === p.to.lat.toFixed(6) && p.from.lng.toFixed(6) === p.to.lng.toFixed(6)) continue;
    unique.set(k, { from: round6(p.from), to: round6(p.to) });
  }
  const out = new Map<string, RouteResult>();
  await Promise.all(
    [...unique.entries()].map(async ([k, p]) => {
      const r = await routeLeg(p.from, p.to);
      await recordLeg(supabase, businessId, signLeg(secret, businessId, p.from, p.to, r));
      out.set(k, r);
    }),
  );
  return out;
}

// ─── Adresse vérifiée (jeton signé) ─────────────────────────────────

export interface GeoToken {
  lat: number;
  lng: number;
  postcode: string;
  label: string;
  expires_epoch: number;
  signature: string;
}

export function makeGeoToken(secret: string, businessId: string, c: GeocodeCandidate, ttlSeconds = 2 * 3600): GeoToken {
  const p = round6(c);
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const postcode = c.postcode ?? "";
  return { lat: p.lat, lng: p.lng, postcode, label: c.label, expires_epoch: expires, signature: sign(geoMessage({ businessId, lat: p.lat, lng: p.lng, postcode, expiresEpoch: expires }), secret) };
}

export function readGeoToken(secret: string, businessId: string, raw: unknown): GeoToken | null {
  const t = raw as Partial<GeoToken> | null;
  if (!t || typeof t.lat !== "number" || typeof t.lng !== "number" || typeof t.expires_epoch !== "number" || typeof t.signature !== "string") return null;
  if (t.expires_epoch < Date.now() / 1000) return null;
  const ok = verify(geoMessage({ businessId, lat: t.lat, lng: t.lng, postcode: t.postcode ?? "", expiresEpoch: t.expires_epoch }), t.signature, secret);
  return ok ? (t as GeoToken) : null;
}

// ─── Contexte privé (arrêts, point de départ) pour le serveur ───────

export interface TravelContext {
  business_id: string;
  start: LatLng | null;
  salon: LatLng | null;
  stops: { start: string; end: string; place: "home" | "salon"; lat: number | null; lng: number | null }[];
}

export async function serverTravelContext(supabase: SupabaseClient, slug: string, from: Date, to: Date): Promise<TravelContext | null> {
  const secret = travelSecret();
  if (!secret) throw new ProviderError("unavailable", TRAVEL_NOT_CONFIGURED);
  const fromEpoch = Math.floor(from.getTime() / 1000);
  const toEpoch = Math.floor(to.getTime() / 1000);
  const ts = Math.floor(Date.now() / 1000);
  const { data, error } = await supabase.rpc("server_travel_context", {
    p_slug: slug,
    p_from: new Date(fromEpoch * 1000).toISOString(),
    p_to: new Date(toEpoch * 1000).toISOString(),
    p_ts: ts,
    p_signature: sign(contextMessage({ slug, fromEpoch, toEpoch, ts }), secret),
  });
  if (error) throw new Error(`Contexte des trajets : ${error.message}`);
  return (data as TravelContext | null) ?? null;
}
