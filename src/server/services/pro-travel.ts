import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkTravel, pairKey, resolveArea, travelCost, travelFee, type LatLng, type Stop } from "@/lib/domain/travel";
import { excludingVatCents } from "@/lib/domain/pricing";
import { isoWeekdayOf, localDate } from "@/lib/domain/time";
import { listAppointments, type Appointment } from "@/server/repositories/agenda";
import {
  defaultVehicle,
  getCustomerAddressCoords,
  getTravelSettings,
  listAreas,
  listGeoLocations,
  setCustomerAddressCoords,
  upsertAppointmentTravel,
  type TravelSettings,
} from "@/server/repositories/travel";
import { ProviderError } from "@/server/travel/provider";
import { ensureLegs, geocodeAddress, travelProvider, TRAVEL_UNAVAILABLE } from "@/server/travel/service";
import { round6 } from "@/server/travel/signing";
import type { BusinessContext } from "./business-context";

/**
 * Déplacements dans l'agenda de la professionnelle (client de l'utilisatrice, RLS).
 * Pré-contrôle avec messages clairs ; la base refait le contrôle des trajets.
 */

export interface ProTravel {
  settings: TravelSettings;
  start: LatLng | null;
  salon: LatLng | null;
}

export async function loadProTravel(supabase: SupabaseClient, businessId: string): Promise<ProTravel | null> {
  const settings = await getTravelSettings(supabase, businessId);
  if (!settings?.enabled) return null;
  const locs = await listGeoLocations(supabase, businessId);
  const at = (k: "salon" | "travel_base") => {
    const l = locs.find((x) => x.kind === k);
    return l && l.latitude != null && l.longitude != null ? { lat: l.latitude, lng: l.longitude } : null;
  };
  const startKind = settings.start_point === "salon" ? "salon" : "travel_base";
  return { settings, start: at(startKind) ?? at("travel_base") ?? at("salon"), salon: at("salon") };
}

/** Coordonnées d'une adresse d'intervention : fiche cliente déjà localisée, sinon géocodage (et mémorisation). */
export async function resolveHomeCoords(
  supabase: SupabaseClient,
  businessId: string,
  a: { addressId: string | null; line1: string; postalCode: string | null; city: string },
): Promise<{ ok: true; coords: LatLng; label: string | null } | { ok: false; message: string; unavailable: boolean }> {
  if (a.addressId) {
    const known = await getCustomerAddressCoords(supabase, businessId, a.addressId);
    if (known) return { ok: true, coords: known, label: null };
  }
  const g = await geocodeAddress({ line1: a.line1, postalCode: a.postalCode, city: a.city });
  if (g.status === "unavailable") return { ok: false, message: g.message, unavailable: true };
  if (g.status === "not_found") return { ok: false, message: "Adresse introuvable par le service d'adresses : vérifiez-la.", unavailable: false };
  if (g.status === "ambiguous") return { ok: false, message: `Adresse ambiguë. Précisez-la, par exemple : ${g.candidates.slice(0, 2).map((c) => c.label).join(" ou ")}.`, unavailable: false };
  const coords = round6(g.result);
  if (a.addressId) await setCustomerAddressCoords(supabase, businessId, a.addressId, coords);
  return { ok: true, coords, label: g.result.label };
}

function stopOf(a: Appointment, salon: LatLng | null): Stop {
  const start = new Date(new Date(a.starts_at).getTime() - a.prep_minutes * 60_000);
  const end = new Date(new Date(a.ends_at).getTime() + (a.cleanup_minutes + a.buffer_minutes) * 60_000);
  const coords = a.place === "salon" ? salon : a.latitude != null && a.longitude != null ? { lat: Number(a.latitude), lng: Number(a.longitude) } : null;
  return { start, end, coords };
}

/**
 * Le créneau tient-il compte des trajets depuis le rendez-vous précédent
 * et vers le suivant ? Calcule et enregistre les trajets nécessaires.
 */
export async function checkProTravel(
  supabase: SupabaseClient,
  businessId: string,
  t: ProTravel,
  q: { coords: LatLng; start: Date; end: Date; excludeId?: string },
): Promise<{ ok: true } | { ok: false; message: string; unavailable: boolean }> {
  const around = await listAppointments(supabase, businessId, new Date(q.start.getTime() - 13 * 3_600_000), new Date(q.end.getTime() + 13 * 3_600_000), { activeOnly: true });
  const stops = around.filter((a) => a.id !== q.excludeId).map((a) => stopOf(a, t.salon));
  const me = round6(q.coords);
  const pairs = stops.filter((s) => s.coords).flatMap((s) => [{ from: s.coords!, to: me }, { from: me, to: s.coords! }]);
  let legs;
  try {
    legs = await ensureLegs(supabase, businessId, pairs);
  } catch (e) {
    return { ok: false, message: e instanceof ProviderError ? e.message : TRAVEL_UNAVAILABLE, unavailable: true };
  }
  const lookup = (a: LatLng, b: LatLng) => legs.get(pairKey(round6(a), round6(b)))?.durationS ?? null;
  // Voisins sans adresse localisée : non bloquants pour la professionnelle (la base les tolère aussi)
  const known = stops.filter((s) => s.coords);
  const res = checkTravel({ start: q.start, end: q.end, coords: me }, known, lookup, t.settings);
  if (res.ok) return res;
  if (res.reason === "too_short") {
    return { ok: false, unavailable: false, message: `Trajet trop court avec un rendez-vous voisin : il faut ${res.requiredMinutes} min (marge de sécurité comprise), seulement ${res.availableMinutes} min disponibles.` };
  }
  return { ok: false, unavailable: true, message: TRAVEL_UNAVAILABLE };
}

/** Frais de déplacement à facturer (même calcul que la réservation en ligne). */
export async function quoteHomeFee(
  supabase: SupabaseClient,
  businessId: string,
  t: ProTravel,
  q: { coords: LatLng; postcode: string | null; serviceCents: number; startsAt: Date; timeZone: string; serviceRadiusKm: number | null },
) {
  if (!t.start) return null;
  const legs = await ensureLegs(supabase, businessId, [{ from: t.start, to: q.coords }]);
  const leg = legs.get(pairKey(round6(t.start), round6(q.coords)));
  if (!leg) return null;
  const areas = (await listAreas(supabase, businessId)).filter((z) => z.is_active);
  const area = resolveArea(areas, { postcode: q.postcode, roadKm: leg.distanceM / 1000, weekday: isoWeekdayOf(localDate(q.startsAt, q.timeZone)), orderCents: q.serviceCents }, q.serviceRadiusKm);
  const fee = travelFee(t.settings, leg.distanceM, q.serviceCents, area.ok ? area.surchargeCents : 0);
  return { leg, area, fee };
}

export function travelFeeItem(feeCents: number, vatBps: number) {
  return {
    service_id: "",
    kind: "travel_fee",
    service_name: "Frais de déplacement",
    duration_minutes: 5,
    catalog_price_cents: feeCents,
    unit_price_cents: feeCents,
    extra_fee_cents: 0,
    vat_rate_bps: vatBps,
    price_ht_cents: excludingVatCents(feeCents, vatBps),
    deposit_type: "none",
    deposit_amount_cents: 0,
  };
}

/** Instantané du trajet de référence (point de départ → cliente) et de son coût. */
export async function saveTravelSnapshot(
  supabase: SupabaseClient,
  ctx: BusinessContext,
  t: ProTravel,
  appointmentId: string,
  q: { distanceM: number; durationS: number; feeCents: number; zoneName: string | null },
) {
  const v = await defaultVehicle(supabase, ctx.business.id);
  const cost = travelCost(v, q.distanceM, q.durationS);
  await upsertAppointmentTravel(supabase, ctx.business.id, {
    appointment_id: appointmentId,
    distance_meters: q.distanceM,
    duration_minutes: Math.ceil(q.durationS / 60),
    fee_cents: q.feeCents,
    origin: t.settings.start_point === "salon" ? "salon" : "travel_base",
    zone_name: q.zoneName,
    energy_cost_cents: cost?.energyCents ?? null,
    wear_cost_cents: cost?.wearCents ?? null,
    time_cost_cents: cost?.timeCents ?? null,
    other_cost_cents: cost?.otherCents ?? null,
    economic_cost_cents: cost?.totalCents ?? null,
    settings_version: t.settings.version,
    vehicle_id: v?.id ?? null,
    vehicle_snapshot: v,
    source: travelProvider().name,
    fee_vat_rate_bps: t.settings.fee_vat_rate_bps,
    computed_at: new Date().toISOString(),
  });
}
