import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkSlot } from "@/lib/domain/availability";
import { optimizeRoute, pairKey, sameCoords, travelCost, type LatLng, type RouteStop } from "@/lib/domain/travel";
import { addDays, zonedToUtc } from "@/lib/domain/time";
import { listAppointments, listCustomerNames, listExceptions, listItems, listRules, toBlocks, type Appointment } from "@/server/repositories/agenda";
import { defaultVehicle, listEstimates, type VehicleRow } from "@/server/repositories/travel";
import { ensureLegs } from "@/server/travel/service";
import { round6 } from "@/server/travel/signing";
import { loadProTravel, type ProTravel } from "./pro-travel";
import type { BusinessContext } from "./business-context";

/**
 * Tournée d'une journée : arrêts dans l'ordre chronologique, trajets réels
 * (cache + fournisseur), indicateurs, et proposition d'optimisation.
 * Un trajet non calculable reste « non calculé » : jamais de valeur inventée.
 */

export interface TourLeg {
  distanceM: number;
  durationS: number;
  geometry: [number, number][] | null;
  costCents: number | null;
}

export interface TourStop {
  id: string;
  startsAt: string;
  endsAt: string;
  place: "home" | "salon";
  status: string;
  source: string;
  customer: string;
  service: string;
  city: string | null;
  coords: LatLng | null;
  feeCents: number;
  legBefore: TourLeg | null;
  legUnknown: boolean;
}

export interface DayTour {
  enabled: boolean;
  start: LatLng | null;
  end: LatLng | null;
  stops: TourStop[];
  returnLeg: TourLeg | null;
  totals: {
    distanceM: number;
    travelMinutes: number;
    costCents: number | null;
    feesCents: number;
    workMinutes: number;
    idleMinutes: number;
    unknownLegs: number;
  };
  vehicle: VehicleRow | null;
  providerError: boolean;
}

function coordsOf(a: Appointment, t: ProTravel): LatLng | null {
  if (a.place === "salon") return t.salon;
  return a.latitude != null && a.longitude != null ? { lat: Number(a.latitude), lng: Number(a.longitude) } : null;
}

async function legsFor(supabase: SupabaseClient, businessId: string, pairs: { from: LatLng; to: LatLng }[]) {
  const cached = await listEstimates(supabase, businessId);
  const map = new Map<string, { distanceM: number; durationS: number; geometry: [number, number][] | null }>();
  for (const e of cached) map.set(pairKey({ lat: e.from_lat, lng: e.from_lng }, { lat: e.to_lat, lng: e.to_lng }), { distanceM: e.distance_m, durationS: e.duration_s, geometry: e.geometry });
  const missing = pairs.filter((p) => !sameCoords(p.from, p.to) && !map.has(pairKey(round6(p.from), round6(p.to))));
  let providerError = false;
  if (missing.length) {
    try {
      const got = await ensureLegs(supabase, businessId, missing);
      for (const [k, r] of got) map.set(k, r);
    } catch (e) {
      console.error("[tournées] trajets", e instanceof Error ? e.message : e);
      providerError = true;
    }
  }
  return { get: (a: LatLng, b: LatLng) => map.get(pairKey(round6(a), round6(b))) ?? null, providerError };
}

export async function loadDayTour(supabase: SupabaseClient, ctx: BusinessContext, day: string): Promise<DayTour> {
  const tz = ctx.settings?.timezone ?? "Europe/Paris";
  const travel = await loadProTravel(supabase, ctx.business.id);
  const empty = { distanceM: 0, travelMinutes: 0, costCents: null, feesCents: 0, workMinutes: 0, idleMinutes: 0, unknownLegs: 0 };
  if (!travel) return { enabled: false, start: null, end: null, stops: [], returnLeg: null, totals: empty, vehicle: null, providerError: false };

  const from = zonedToUtc(day, 0, tz);
  const to = zonedToUtc(addDays(day, 1), 0, tz);
  const appts = (await listAppointments(supabase, ctx.business.id, from, to))
    .filter((a) => a.status !== "cancelled" && new Date(a.starts_at) >= from && new Date(a.starts_at) < to)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const [items, names, vehicle] = await Promise.all([
    listItems(supabase, ctx.business.id, appts.map((a) => a.id)),
    listCustomerNames(supabase, ctx.business.id, [...new Set(appts.map((a) => a.customer_id))]),
    defaultVehicle(supabase, ctx.business.id),
  ]);
  const end = travel.settings.return_point === "none" ? null : travel.settings.return_point === "salon" ? travel.salon : travel.start;
  const points = appts.map((a) => coordsOf(a, travel));
  const chain = [travel.start, ...points, end];
  const pairs: { from: LatLng; to: LatLng }[] = [];
  let prev: LatLng | null = travel.start;
  for (const p of points) {
    if (prev && p) pairs.push({ from: prev, to: p });
    if (p) prev = p;
  }
  if (prev && end) pairs.push({ from: prev, to: end });
  const legs = await legsFor(supabase, ctx.business.id, pairs);
  void chain;

  const leg = (a: LatLng | null, b: LatLng | null): { leg: TourLeg | null; unknown: boolean } => {
    if (!a || !b) return { leg: null, unknown: Boolean(a) !== Boolean(b) || (!a && !b) };
    if (sameCoords(a, b)) return { leg: { distanceM: 0, durationS: 0, geometry: null, costCents: 0 }, unknown: false };
    const l = legs.get(a, b);
    if (!l) return { leg: null, unknown: true };
    return { leg: { ...l, costCents: travelCost(vehicle, l.distanceM, l.durationS)?.totalCents ?? null }, unknown: false };
  };

  const stops: TourStop[] = [];
  let last: LatLng | null = travel.start;
  for (const a of appts) {
    const c = coordsOf(a, travel);
    const l = leg(last, c);
    const its = items.filter((i) => i.appointment_id === a.id);
    stops.push({
      id: a.id,
      startsAt: a.starts_at,
      endsAt: a.ends_at,
      place: a.place,
      status: a.status,
      source: a.source,
      customer: names.get(a.customer_id) ?? "Cliente",
      service: its.filter((i) => i.kind !== "travel_fee").map((i) => i.service_name).join(", ") || "Rendez-vous",
      city: a.city,
      coords: c,
      feeCents: its.filter((i) => i.kind === "travel_fee").reduce((s, i) => s + i.unit_price_cents, 0),
      legBefore: l.leg,
      legUnknown: l.unknown,
    });
    if (c) last = c;
  }
  const ret = end && last && stops.length ? leg(last, end) : { leg: null, unknown: false };
  const allLegs = [...stops.map((s) => s.legBefore), ret.leg].filter((l): l is TourLeg => Boolean(l));
  const travelMinutes = Math.round(allLegs.reduce((s, l) => s + l.durationS, 0) / 60);
  const costKnown = allLegs.every((l) => l.costCents != null) && vehicle != null;
  const workMinutes = appts.reduce((s, a) => s + a.prep_minutes + a.duration_minutes + a.cleanup_minutes, 0);
  let idle = 0;
  for (let i = 1; i < appts.length; i++) {
    const gap = (new Date(appts[i].starts_at).getTime() - appts[i].prep_minutes * 60_000 - (new Date(appts[i - 1].ends_at).getTime() + appts[i - 1].cleanup_minutes * 60_000)) / 60_000;
    idle += Math.max(0, gap - (stops[i].legBefore ? stops[i].legBefore!.durationS / 60 : 0));
  }
  return {
    enabled: true,
    start: travel.start,
    end,
    stops,
    returnLeg: ret.leg,
    vehicle,
    providerError: legs.providerError,
    totals: {
      distanceM: allLegs.reduce((s, l) => s + l.distanceM, 0),
      travelMinutes,
      costCents: costKnown ? allLegs.reduce((s, l) => s + (l.costCents ?? 0), 0) : null,
      feesCents: stops.reduce((s, x) => s + x.feeCents, 0),
      workMinutes,
      idleMinutes: Math.round(idle),
      unknownLegs: stops.filter((s) => s.legUnknown).length + (ret.unknown ? 1 : 0),
    },
  };
}

export interface TourProposal {
  planId: string | null;
  message: string | null;
  current: { order: string[]; distanceM: number; durationS: number; costCents: number | null } | null;
  proposed: { order: string[]; starts: Record<string, string>; distanceM: number; durationS: number; costCents: number | null } | null;
  /** Rendez-vous dont l'horaire changerait (accord de la cliente nécessaire). */
  moved: { id: string; customer: string; from: string; to: string; online: boolean }[];
}

/** Propose un meilleur ordre pour les rendez-vous à domicile de la journée. Rien n'est modifié. */
export async function proposeTour(supabase: SupabaseClient, ctx: BusinessContext, day: string): Promise<TourProposal> {
  const tz = ctx.settings?.timezone ?? "Europe/Paris";
  const travel = await loadProTravel(supabase, ctx.business.id);
  if (!travel) return { planId: null, message: "Activez les déplacements pour optimiser vos tournées.", current: null, proposed: null, moved: [] };
  const from = zonedToUtc(day, 0, tz);
  const to = zonedToUtc(addDays(day, 1), 0, tz);
  const appts = (await listAppointments(supabase, ctx.business.id, from, to, { activeOnly: true })).filter((a) => new Date(a.starts_at) >= from && new Date(a.starts_at) < to);
  const homes = appts.filter((a) => a.place === "home" && a.latitude != null && new Date(a.starts_at) > new Date());
  if (homes.length < 2) return { planId: null, message: "Il faut au moins deux rendez-vous à domicile à venir, avec une adresse localisée.", current: null, proposed: null, moved: [] };
  if (homes.length > 7) return { planId: null, message: "Plus de 7 rendez-vous à domicile : l'optimisation automatique est limitée à 7 arrêts.", current: null, proposed: null, moved: [] };

  const stops: RouteStop[] = homes.map((a) => ({
    id: a.id,
    blockedMinutes: a.prep_minutes + a.duration_minutes + a.cleanup_minutes + a.buffer_minutes,
    prepMinutes: a.prep_minutes,
    coords: { lat: Number(a.latitude), lng: Number(a.longitude) },
    currentStart: new Date(a.starts_at),
  }));
  const end = travel.settings.return_point === "none" ? null : travel.settings.return_point === "salon" ? travel.salon : travel.start;
  const pts = [travel.start, end, ...stops.map((s) => s.coords)].filter((p): p is LatLng => Boolean(p));
  const pairs = pts.flatMap((a) => pts.filter((b) => !sameCoords(a, b)).map((b) => ({ from: a, to: b })));
  const legs = await legsFor(supabase, ctx.business.id, pairs);
  if (legs.providerError) return { planId: null, message: "Le service de calcul des trajets est momentanément indisponible : réessayez plus tard.", current: null, proposed: null, moved: [] };

  const [rules, exceptions] = await Promise.all([listRules(supabase, ctx.business.id), listExceptions(supabase, ctx.business.id, from, to)]);
  const fixed = appts.filter((a) => !homes.some((h) => h.id === a.id)).map((a) => ({
    id: a.id,
    start: new Date(new Date(a.starts_at).getTime() - a.prep_minutes * 60_000),
    end: new Date(new Date(a.ends_at).getTime() + (a.cleanup_minutes + a.buffer_minutes) * 60_000),
  }));
  const fits = (s: Date, e: Date) =>
    checkSlot(
      { startsAt: s, durationMinutes: (e.getTime() - s.getTime()) / 60_000, prepMinutes: 0, cleanupMinutes: 0, bufferMinutes: 0, place: "home" },
      { timeZone: tz, rules, blocks: toBlocks(exceptions), busy: fixed },
    ).ok;
  const vehicle = await defaultVehicle(supabase, ctx.business.id);
  const res = optimizeRoute(stops, { start: travel.start, end, legs: (a, b) => legs.get(a, b), margin: travel.settings, fits });
  const cost = (d: number, s: number) => travelCost(vehicle, d, s)?.totalCents ?? null;
  const current = res.current ? { order: res.current.order, distanceM: res.current.distanceM, durationS: res.current.durationS, costCents: cost(res.current.distanceM, res.current.durationS) } : null;
  if (!res.best || !current || res.best.distanceM >= current.distanceM) {
    return { planId: null, message: "Votre tournée est déjà la plus courte possible avec vos horaires.", current, proposed: null, moved: [] };
  }
  const best = res.best;
  const names = await listCustomerNames(supabase, ctx.business.id, homes.map((h) => h.customer_id));
  const moved = homes
    .filter((h) => best.starts[h.id].getTime() !== new Date(h.starts_at).getTime())
    .map((h) => ({ id: h.id, customer: names.get(h.customer_id) ?? "Cliente", from: h.starts_at, to: best.starts[h.id].toISOString(), online: h.source === "online" }));

  // Proposition enregistrée (statut « proposée ») : rien n'est appliqué sans validation.
  const { data: plan, error } = await supabase
    .from("route_plans")
    .insert({
      business_id: ctx.business.id,
      day,
      current_distance_m: current.distanceM,
      current_duration_s: current.durationS,
      current_cost_cents: current.costCents,
      proposed_distance_m: best.distanceM,
      proposed_duration_s: best.durationS,
      proposed_cost_cents: cost(best.distanceM, best.durationS),
      settings_version: travel.settings.version,
    })
    .select("id")
    .single();
  if (error || !plan) throw new Error(`Proposition de tournée : ${error?.message}`);
  const { error: stopsErr } = await supabase.from("route_plan_stops").insert(
    best.order.map((id, i) => {
      const h = homes.find((x) => x.id === id)!;
      return { business_id: ctx.business.id, route_plan_id: plan.id, appointment_id: id, position: i + 1, current_starts_at: h.starts_at, proposed_starts_at: best.starts[id].toISOString() };
    }),
  );
  if (stopsErr) throw new Error(`Proposition de tournée : ${stopsErr.message}`);
  return {
    planId: plan.id,
    message: null,
    current,
    proposed: { order: best.order, starts: Object.fromEntries(Object.entries(best.starts).map(([k, v]) => [k, v.toISOString()])), distanceM: best.distanceM, durationS: best.durationS, costCents: cost(best.distanceM, best.durationS) },
    moved,
  };
}
