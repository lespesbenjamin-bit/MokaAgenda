import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkTravel, pairKey, resolveArea, travelFee, AREA_REFUSAL_MESSAGES, type LatLng, type Stop } from "@/lib/domain/travel";
import type { PublicPage, PublicService } from "@/lib/domain/public-booking";
import { priceFor } from "@/lib/domain/public-booking";
import { isoWeekdayOf, localDate } from "@/lib/domain/time";
import { formatEuros, type Place } from "@/lib/domain/pricing";
import { ProviderError } from "@/server/travel/provider";
import {
  ensureLegs,
  geocodeAddress,
  makeGeoToken,
  readGeoToken,
  serverTravelContext,
  travelSecret,
  TRAVEL_NOT_CONFIGURED,
  TRAVEL_UNAVAILABLE,
  type GeoToken,
} from "@/server/travel/service";
import { round6 } from "@/server/travel/signing";

/**
 * Déplacements dans la réservation publique : adresse vérifiée, zone,
 * frais, créneaux compatibles avec les trajets. En cas de doute (service
 * indisponible, trajet inconnu) : aucun tarif, aucun créneau proposé.
 */

export const MANUAL_REQUEST = "Vous pouvez aussi contacter directement la professionnelle pour demander un rendez-vous.";

export const travelEnabled = (page: PublicPage) => Boolean(page.travel?.enabled);

export interface AddressCheck {
  ok: true;
  geo: GeoToken;
  label: string;
  precise: boolean;
  postcode: string;
  city: string | null;
  serviceCents: number;
  feeCents: number;
  feeSteps: string[];
  zoneName: string | null;
  zoneWeekdays: number[] | null;
  distanceKm: number;
}

export type AddressCheckResult =
  | AddressCheck
  | { ok: false; kind: "ambiguous"; message: string; candidates: { label: string; line1: string; postcode: string | null; city: string | null }[] }
  | { ok: false; kind: "refused" | "unavailable" | "not_found"; message: string };

export async function checkHomeAddress(
  supabase: SupabaseClient,
  page: PublicPage,
  service: PublicService,
  address: { line1: string; postalCode: string; city: string },
): Promise<AddressCheckResult> {
  const secret = travelSecret();
  if (!secret) return { ok: false, kind: "unavailable", message: `${TRAVEL_NOT_CONFIGURED} ${MANUAL_REQUEST}` };
  const g = await geocodeAddress(address);
  if (g.status === "unavailable") return { ok: false, kind: "unavailable", message: `${g.message} ${MANUAL_REQUEST}` };
  if (g.status === "not_found") return { ok: false, kind: "not_found", message: "Adresse introuvable. Vérifiez le numéro, la rue, le code postal et la ville." };
  if (g.status === "ambiguous") {
    return {
      ok: false,
      kind: "ambiguous",
      message: "Plusieurs adresses correspondent : choisissez la vôtre.",
      candidates: g.candidates.map((c) => ({ label: c.label, line1: c.label.replace(new RegExp(`\\s*${c.postcode ?? ""}\\s*${c.city ?? ""}$`), "").trim(), postcode: c.postcode, city: c.city })),
    };
  }
  const result = g.result;
  if (!result.postcode) return { ok: false, kind: "not_found", message: "Adresse incomplète : indiquez le code postal." };

  let ctx;
  try {
    ctx = await serverTravelContext(supabase, page.business.slug, new Date(), new Date(Date.now() + 60_000));
  } catch {
    return { ok: false, kind: "unavailable", message: `${TRAVEL_UNAVAILABLE} ${MANUAL_REQUEST}` };
  }
  if (!ctx?.start) return { ok: false, kind: "unavailable", message: `La réservation à domicile en ligne n'est pas encore disponible. ${MANUAL_REQUEST}` };

  const customer = round6(result);
  let leg;
  try {
    const legs = await ensureLegs(supabase, ctx.business_id, [{ from: ctx.start, to: customer }]);
    leg = legs.get(pairKey(round6(ctx.start), customer));
  } catch (e) {
    console.error("[déplacements] trajet depuis le point de départ", e instanceof Error ? e.message : e);
    return { ok: false, kind: "unavailable", message: `${TRAVEL_UNAVAILABLE} ${MANUAL_REQUEST}` };
  }
  if (!leg) return { ok: false, kind: "unavailable", message: `${TRAVEL_UNAVAILABLE} ${MANUAL_REQUEST}` };

  const travel = page.travel!;
  const serviceCents = priceFor(service, "home") ?? 0;
  const area = resolveArea(travel.areas, { postcode: result.postcode, roadKm: leg.distanceM / 1000, weekday: null, orderCents: serviceCents }, travel.service_radius_km);
  if (!area.ok) {
    const msg = area.reason === "below_minimum" ? `${AREA_REFUSAL_MESSAGES.below_minimum} (${formatEuros(area.minOrderCents ?? 0)}).` : AREA_REFUSAL_MESSAGES[area.reason];
    return { ok: false, kind: "refused", message: `${msg} ${MANUAL_REQUEST}` };
  }
  const zone = travel.areas.find((z) => z.id === area.zoneId) ?? null;
  const fee = travelFee(travel, leg.distanceM, serviceCents, area.surchargeCents);
  return {
    ok: true,
    geo: makeGeoToken(secret, ctx.business_id, result),
    label: result.label,
    precise: result.precision === "housenumber",
    postcode: result.postcode,
    city: result.city,
    serviceCents,
    feeCents: fee.feeCents,
    feeSteps: fee.steps,
    zoneName: area.zoneName,
    zoneWeekdays: zone?.weekdays ?? null,
    distanceKm: Math.round(leg.distanceM / 100) / 10,
  };
}

/** Coordonnées de l'arrêt demandé : adresse vérifiée (domicile) ou institut. */
export function stopCoords(place: Place, geo: GeoToken | null, salon: LatLng | null): LatLng | null {
  return place === "home" ? (geo ? { lat: geo.lat, lng: geo.lng } : null) : salon;
}

export function verifyGeo(businessId: string, raw: unknown): GeoToken | null {
  const secret = travelSecret();
  return secret ? readGeoToken(secret, businessId, raw) : null;
}

/**
 * Prépare le filtre « trajets » pour une période : récupère les rendez-vous
 * voisins (coordonnées privées, côté serveur uniquement), calcule et
 * enregistre les trajets nécessaires, puis renvoie une fonction de contrôle.
 */
export async function buildTravelFilter(
  supabase: SupabaseClient,
  page: PublicPage,
  service: Pick<PublicService, "prep_minutes" | "duration_minutes" | "cleanup_minutes" | "buffer_minutes">,
  place: Place,
  input: { geo?: unknown; coords?: LatLng | null },
  from: Date,
  to: Date,
): Promise<{ ok: true; accept: (startsAt: Date) => boolean; businessId: string; coords: LatLng } | { ok: false; message: string }> {
  let ctx;
  try {
    ctx = await serverTravelContext(supabase, page.business.slug, from, to);
  } catch {
    return { ok: false, message: `${TRAVEL_UNAVAILABLE} ${MANUAL_REQUEST}` };
  }
  if (!ctx) return { ok: false, message: "La réservation en ligne n'est pas ouverte pour le moment." };
  const geo = input.geo !== undefined ? verifyGeo(ctx.business_id, input.geo) : null;
  const coords = input.coords ?? stopCoords(place, geo, ctx.salon);
  if (!coords) {
    return { ok: false, message: place === "home" ? "Votre adresse doit être vérifiée avant de voir les créneaux." : `Réservation en ligne momentanément indisponible. ${MANUAL_REQUEST}` };
  }
  const stops: Stop[] = ctx.stops.map((s) => ({ start: new Date(s.start), end: new Date(s.end), coords: s.lat != null && s.lng != null ? { lat: Number(s.lat), lng: Number(s.lng) } : null }));
  const me = round6(coords);
  const pairs: { from: LatLng; to: LatLng }[] = [];
  if (place === "home" && ctx.start) pairs.push({ from: ctx.start, to: me });
  for (const s of stops) {
    if (!s.coords) continue;
    pairs.push({ from: s.coords, to: me }, { from: me, to: s.coords });
  }
  let legs;
  try {
    legs = await ensureLegs(supabase, ctx.business_id, pairs);
  } catch (e) {
    console.error("[déplacements] trajets entre rendez-vous", e instanceof ProviderError ? e.kind : e);
    return { ok: false, message: `${TRAVEL_UNAVAILABLE} ${MANUAL_REQUEST}` };
  }
  const margin = { safety_margin_pct: page.travel!.safety_margin_pct, safety_margin_minutes: page.travel!.safety_margin_minutes };
  const lookup = (a: LatLng, b: LatLng) => legs.get(pairKey(round6(a), round6(b)))?.durationS ?? null;
  let zone: number[] | null = null;
  if (place === "home" && geo && ctx.start) {
    const startLeg = legs.get(pairKey(round6(ctx.start), me));
    const t = page.travel!;
    const area = startLeg ? resolveArea(t.areas, { postcode: geo.postcode, roadKm: startLeg.distanceM / 1000, weekday: null, orderCents: Number.MAX_SAFE_INTEGER }, t.service_radius_km) : null;
    if (area?.ok && area.zoneId) zone = t.areas.find((z) => z.id === area.zoneId)?.weekdays ?? null;
  }
  const tz = page.settings.timezone;
  return {
    ok: true,
    businessId: ctx.business_id,
    coords: me,
    accept(startsAt: Date) {
      if (zone && !zone.includes(isoWeekdayOf(localDate(startsAt, tz)))) return false;
      const start = new Date(startsAt.getTime() - service.prep_minutes * 60_000);
      const end = new Date(startsAt.getTime() + (service.duration_minutes + service.cleanup_minutes + service.buffer_minutes) * 60_000);
      return checkTravel({ start, end, coords: me }, stops, lookup, margin).ok;
    },
  };
}
