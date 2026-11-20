/**
 * Déplacements — règles métier pures, IDENTIQUES aux fonctions SQL du
 * Sprint 5 (private.travel_cost, private.travel_fee_cents,
 * private.resolve_area, contrôle des trajets du déclencheur).
 *
 * Politique d'arrondi (documentée) :
 *  • prix unitaires fins en millièmes d'euro (« millis »), forfaits en centimes ;
 *  • chaque poste de coût est arrondi au centime (demi vers le haut) ;
 *  • le total est la somme des postes arrondis (le détail affiché = le total).
 * Aucune distance ni durée n'est jamais estimée ici : elles viennent du
 * fournisseur d'itinéraires.
 */

export type VehicleKind = "car_fuel" | "car_electric" | "car_hybrid" | "two_wheeler" | "bike" | "other";

export const VEHICLE_KIND_LABELS: Record<VehicleKind, string> = {
  car_fuel: "Voiture thermique",
  car_electric: "Voiture électrique",
  car_hybrid: "Voiture hybride",
  two_wheeler: "Deux-roues motorisé",
  bike: "Vélo",
  other: "Autre moyen",
};

export interface Vehicle {
  id?: string;
  label: string;
  kind: VehicleKind;
  consumption_per_100km: number | null;
  energy_unit: "l" | "kwh" | null;
  energy_price_millis: number | null;
  wear_cost_per_km_millis: number;
  all_in_cost_per_km_millis: number | null;
  fixed_cost_per_trip_cents: number;
  parking_tolls_per_trip_cents: number;
  hourly_time_cost_cents: number;
}

/**
 * Valeurs proposées par défaut : ce sont des ESTIMATIONS indicatives à
 * ajuster (affichées comme telles dans l'interface).
 */
export const VEHICLE_PRESETS: Record<VehicleKind, Omit<Vehicle, "label" | "kind" | "hourly_time_cost_cents">> = {
  car_fuel: { consumption_per_100km: 6.5, energy_unit: "l", energy_price_millis: 1800, wear_cost_per_km_millis: 120, all_in_cost_per_km_millis: null, fixed_cost_per_trip_cents: 0, parking_tolls_per_trip_cents: 0 },
  car_electric: { consumption_per_100km: 17, energy_unit: "kwh", energy_price_millis: 250, wear_cost_per_km_millis: 100, all_in_cost_per_km_millis: null, fixed_cost_per_trip_cents: 0, parking_tolls_per_trip_cents: 0 },
  car_hybrid: { consumption_per_100km: 4.5, energy_unit: "l", energy_price_millis: 1800, wear_cost_per_km_millis: 120, all_in_cost_per_km_millis: null, fixed_cost_per_trip_cents: 0, parking_tolls_per_trip_cents: 0 },
  two_wheeler: { consumption_per_100km: 3, energy_unit: "l", energy_price_millis: 1800, wear_cost_per_km_millis: 60, all_in_cost_per_km_millis: null, fixed_cost_per_trip_cents: 0, parking_tolls_per_trip_cents: 0 },
  bike: { consumption_per_100km: null, energy_unit: null, energy_price_millis: null, wear_cost_per_km_millis: 20, all_in_cost_per_km_millis: null, fixed_cost_per_trip_cents: 0, parking_tolls_per_trip_cents: 0 },
  other: { consumption_per_100km: null, energy_unit: null, energy_price_millis: null, wear_cost_per_km_millis: 0, all_in_cost_per_km_millis: null, fixed_cost_per_trip_cents: 0, parking_tolls_per_trip_cents: 0 },
};

export interface TravelCost {
  energyCents: number;
  wearCents: number;
  timeCents: number;
  otherCents: number;
  /** Coût économique total estimé (inclut le coût du temps). */
  totalCents: number;
  /** Dépense estimée hors temps (énergie + usure + autres) : ce que le trajet « coûte » en argent. */
  cashCents: number;
  /** Un coût kilométrique global remplace énergie et usure (pas de double compte). */
  allIn: boolean;
}

const r = (x: number) => Math.round(x); // demi vers le haut pour les valeurs positives, comme round() PostgreSQL

export function travelCost(v: Vehicle | null, distanceM: number, durationS: number): TravelCost | null {
  if (!v) return null;
  const km = distanceM / 1000;
  let energy = 0;
  let wear: number;
  if (v.all_in_cost_per_km_millis != null) {
    wear = r((km * v.all_in_cost_per_km_millis) / 10);
  } else {
    if (v.consumption_per_100km != null && v.energy_price_millis != null) {
      energy = r((((km * v.consumption_per_100km) / 100) * v.energy_price_millis) / 10);
    }
    wear = r((km * v.wear_cost_per_km_millis) / 10);
  }
  const time = r((durationS / 3600) * v.hourly_time_cost_cents);
  const other = v.fixed_cost_per_trip_cents + v.parking_tolls_per_trip_cents;
  return { energyCents: energy, wearCents: wear, timeCents: time, otherCents: other, totalCents: energy + wear + time + other, cashCents: energy + wear + other, allIn: v.all_in_cost_per_km_millis != null };
}

// ─── Frais facturés ─────────────────────────────────────────────────

export type PricingMode = "free" | "fixed" | "per_km" | "zone" | "free_above";

export const PRICING_MODE_LABELS: Record<PricingMode, string> = {
  free: "Déplacement offert",
  fixed: "Montant fixe",
  per_km: "Tarif au kilomètre",
  zone: "Tarif par zone",
  free_above: "Offert au-delà d'un montant de prestation",
};

export interface FeeSettings {
  pricing_mode: PricingMode;
  fixed_fee_cents: number;
  per_km_cents: number;
  included_km: number;
  min_fee_cents: number;
  max_fee_cents: number | null;
  free_above_cents: number | null;
}

export interface FeeBreakdown {
  feeCents: number;
  baseCents: number;
  surchargeCents: number;
  /** Explication lisible du calcul. */
  steps: string[];
}

const eur = (c: number) => `${(c / 100).toFixed(2).replace(".", ",")} €`;

/**
 * Règles (identiques à private.travel_fee_cents) :
 *  • offert → 0 ; offert au-delà du seuil atteint → 0 ;
 *  • fixe → forfait ; au km → (distance − km inclus) × tarif ;
 *    « offert au-delà » non atteint → tarif au km s'il est défini, sinon forfait ;
 *  • si le montant de base est > 0 : minimum puis maximum appliqués ;
 *  • le supplément de zone s'ajoute ensuite (modes zone, fixe, au km, offert au-delà non atteint).
 */
export function travelFee(s: FeeSettings, distanceM: number, serviceCents: number, surchargeCents = 0): FeeBreakdown {
  const steps: string[] = [];
  if (s.pricing_mode === "free") return { feeCents: 0, baseCents: 0, surchargeCents: 0, steps: ["Déplacement offert."] };
  if (s.pricing_mode === "free_above" && serviceCents >= (s.free_above_cents ?? 0)) {
    return { feeCents: 0, baseCents: 0, surchargeCents: 0, steps: [`Déplacement offert : prestation d'au moins ${eur(s.free_above_cents ?? 0)}.`] };
  }
  let base = 0;
  if (s.pricing_mode === "fixed" || (s.pricing_mode === "free_above" && s.per_km_cents === 0)) {
    base = s.fixed_fee_cents;
    steps.push(`Forfait : ${eur(base)}.`);
  } else if (s.pricing_mode === "per_km" || s.pricing_mode === "free_above") {
    const billableM = Math.max(0, distanceM - s.included_km * 1000);
    base = r((billableM * s.per_km_cents) / 1000);
    steps.push(`${(distanceM / 1000).toFixed(1).replace(".", ",")} km − ${String(s.included_km).replace(".", ",")} km inclus = ${(billableM / 1000).toFixed(1).replace(".", ",")} km × ${eur(s.per_km_cents)} = ${eur(base)}.`);
  }
  if (base > 0) {
    if (base < s.min_fee_cents) {
      base = s.min_fee_cents;
      steps.push(`Minimum de facturation : ${eur(base)}.`);
    }
    if (s.max_fee_cents != null && base > s.max_fee_cents) {
      base = s.max_fee_cents;
      steps.push(`Plafond : ${eur(base)}.`);
    }
  }
  if (surchargeCents > 0) steps.push(`Supplément de zone : ${eur(surchargeCents)}.`);
  return { feeCents: base + surchargeCents, baseCents: base, surchargeCents, steps };
}

// ─── Zones d'intervention ───────────────────────────────────────────

export interface ServiceArea {
  id: string;
  name: string;
  kind: "radius" | "postcodes";
  max_km: number | null;
  postcodes: string[] | null;
  excluded: boolean;
  surcharge_cents: number;
  min_order_cents: number;
  weekdays: number[] | null;
  position?: number;
}

export type AreaResult =
  | { ok: true; zoneId: string | null; zoneName: string | null; surchargeCents: number }
  | { ok: false; reason: "excluded" | "out_of_area" | "wrong_day" | "below_minimum"; zoneName?: string; minOrderCents?: number };

export const AREA_REFUSAL_MESSAGES = {
  excluded: "Cette adresse n'est pas desservie à domicile.",
  out_of_area: "Cette adresse est en dehors de la zone d'intervention à domicile.",
  wrong_day: "Ce secteur n'est desservi que certains jours : choisissez un autre jour.",
  below_minimum: "Un montant minimum de prestation est demandé pour ce secteur.",
} as const;

function matches(z: ServiceArea, postcode: string | null, roadKm: number) {
  return z.kind === "postcodes" ? postcode != null && (z.postcodes ?? []).includes(postcode) : z.max_km != null && roadKm <= z.max_km;
}

/** Zones actives triées par position. Même ordre de règles que private.resolve_area. */
export function resolveArea(
  areas: ServiceArea[],
  q: { postcode: string | null; roadKm: number; weekday: number | null; orderCents: number },
  serviceRadiusKm: number | null,
): AreaResult {
  if (areas.some((z) => z.excluded && matches(z, q.postcode, q.roadKm))) return { ok: false, reason: "excluded" };
  const included = areas.filter((z) => !z.excluded);
  if (included.length === 0) {
    if (serviceRadiusKm != null && q.roadKm > serviceRadiusKm) return { ok: false, reason: "out_of_area" };
    return { ok: true, zoneId: null, zoneName: null, surchargeCents: 0 };
  }
  const zone = included.find((z) => matches(z, q.postcode, q.roadKm));
  if (!zone) return { ok: false, reason: "out_of_area" };
  if (q.weekday != null && zone.weekdays && !zone.weekdays.includes(q.weekday)) return { ok: false, reason: "wrong_day", zoneName: zone.name };
  if (q.orderCents < zone.min_order_cents) return { ok: false, reason: "below_minimum", zoneName: zone.name, minOrderCents: zone.min_order_cents };
  return { ok: true, zoneId: zone.id, zoneName: zone.name, surchargeCents: zone.surcharge_cents };
}

// ─── Enchaînement des rendez-vous ───────────────────────────────────

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Margin {
  safety_margin_pct: number;
  safety_margin_minutes: number;
}

/** Temps à prévoir entre deux arrêts (même formule que le déclencheur SQL). */
export function requiredTravelMinutes(durationS: number, m: Margin): number {
  return Math.ceil((durationS / 60) * (1 + m.safety_margin_pct / 100)) + m.safety_margin_minutes;
}

export const sameCoords = (a: LatLng, b: LatLng) => a.lat.toFixed(6) === b.lat.toFixed(6) && a.lng.toFixed(6) === b.lng.toFixed(6);
export const pairKey = (a: LatLng, b: LatLng) => `${a.lat.toFixed(6)},${a.lng.toFixed(6)}>${b.lat.toFixed(6)},${b.lng.toFixed(6)}`;

export interface Stop {
  /** Temps bloqué (préparation → tampon). */
  start: Date;
  end: Date;
  coords: LatLng | null;
}

/** Durée connue d'un trajet (secondes), ou null si non calculée. */
export type TravelLookup = (from: LatLng, to: LatLng) => number | null;

export type TravelCheck = { ok: true } | { ok: false; reason: "unknown" | "too_short"; requiredMinutes?: number; availableMinutes?: number };

const TWELVE_HOURS = 12 * 3_600_000;

/** Rendez-vous voisins (précédent et suivant, à moins de 12 h), comme le déclencheur SQL. */
export function neighbours(candidate: { start: Date; end: Date }, stops: Stop[]) {
  let prev: Stop | null = null;
  let next: Stop | null = null;
  for (const s of stops) {
    if (s.end <= candidate.start && s.end.getTime() > candidate.start.getTime() - TWELVE_HOURS && (!prev || s.end > prev.end)) prev = s;
    if (s.start >= candidate.end && s.start.getTime() < candidate.end.getTime() + TWELVE_HOURS && (!next || s.start < next.start)) next = s;
  }
  return { prev, next };
}

/**
 * Le créneau est-il compatible avec les trajets depuis le rendez-vous
 * précédent ET vers le suivant ? Un trajet inconnu est un refus (jamais
 * de durée inventée). Un voisin sans adresse localisée est aussi un refus.
 */
export function checkTravel(candidate: { start: Date; end: Date; coords: LatLng }, stops: Stop[], lookup: TravelLookup, m: Margin): TravelCheck {
  const { prev, next } = neighbours(candidate, stops);
  for (const [n, side] of [[prev, "prev"], [next, "next"]] as const) {
    if (!n) continue;
    if (!n.coords) return { ok: false, reason: "unknown" };
    if (sameCoords(n.coords, candidate.coords)) continue;
    const dur = side === "prev" ? lookup(n.coords, candidate.coords) : lookup(candidate.coords, n.coords);
    if (dur == null) return { ok: false, reason: "unknown" };
    const required = requiredTravelMinutes(dur, m);
    const gap = side === "prev" ? (candidate.start.getTime() - n.end.getTime()) / 60_000 : (n.start.getTime() - candidate.end.getTime()) / 60_000;
    if (gap < required) return { ok: false, reason: "too_short", requiredMinutes: required, availableMinutes: Math.floor(gap) };
  }
  return { ok: true };
}

// ─── Rentabilité indicative d'un rendez-vous ────────────────────────

export interface ProfitabilityInput {
  serviceHtCents: number;
  feeHtCents: number;
  consumablesCents: number;
  otherDirectCents: number;
  travel: TravelCost | null;
  travelMinutes: number;
  /** Préparation + prestation + nettoyage (le tampon n'est pas du travail). */
  workMinutes: number;
}

export interface Profitability {
  revenueHtCents: number;
  directCostsCents: number;
  /** Marge financière estimée AVANT charges fixes et cotisations (le temps n'y est pas déduit). */
  financialMarginCents: number;
  /** Coût économique du temps de trajet (valorisation, pas une dépense). */
  timeCostCents: number;
  /** Marge après valorisation du temps de trajet. */
  economicMarginCents: number;
  totalMinutes: number;
  /** Marge financière par heure mobilisée (travail + trajet). null si durée nulle. */
  hourlyCents: number | null;
}

export function profitability(i: ProfitabilityInput): Profitability {
  const travelCash = i.travel ? i.travel.cashCents : 0;
  const timeCost = i.travel ? i.travel.timeCents : 0;
  const revenue = i.serviceHtCents + i.feeHtCents;
  const direct = i.consumablesCents + i.otherDirectCents + travelCash;
  const financial = revenue - direct;
  const total = i.workMinutes + i.travelMinutes;
  return {
    revenueHtCents: revenue,
    directCostsCents: direct,
    financialMarginCents: financial,
    timeCostCents: timeCost,
    economicMarginCents: financial - timeCost,
    totalMinutes: total,
    hourlyCents: total > 0 ? Math.round((financial * 60) / total) : null,
  };
}

// ─── Optimisation d'une tournée ─────────────────────────────────────

export interface RouteStop {
  id: string;
  /** Temps bloqué total (préparation + prestation + nettoyage + tampon), en minutes. */
  blockedMinutes: number;
  /** Préparation : le rendez-vous commence `prepMinutes` après le début du temps bloqué. */
  prepMinutes: number;
  coords: LatLng;
  currentStart: Date; // début du rendez-vous (pas du temps bloqué)
}

export interface Leg {
  distanceM: number;
  durationS: number;
}

export type LegLookup = (from: LatLng, to: LatLng) => Leg | null;

export interface RouteEvaluation {
  order: string[];
  starts: Record<string, Date>;
  distanceM: number;
  durationS: number;
  feasible: boolean;
}

/** Distance et durée totales d'un ordre donné (départ → arrêts → retour éventuel). null si un trajet est inconnu. */
export function routeTotals(order: RouteStop[], start: LatLng | null, end: LatLng | null, legs: LegLookup): { distanceM: number; durationS: number } | null {
  const points = [...(start ? [start] : []), ...order.map((s) => s.coords), ...(end ? [end] : [])];
  let distanceM = 0;
  let durationS = 0;
  for (let i = 1; i < points.length; i++) {
    if (sameCoords(points[i - 1], points[i])) continue;
    const l = legs(points[i - 1], points[i]);
    if (!l) return null;
    distanceM += l.distanceM;
    durationS += l.durationS;
  }
  return { distanceM, durationS };
}

/**
 * Propose un ordre plus court pour les rendez-vous à domicile d'une
 * journée. Recherche exhaustive (≤ 7 arrêts). Chaque ordre est replanifié à
 * partir de l'heure du premier rendez-vous actuel, en respectant les trajets
 * (avec marge, arrondis à 5 min) et le contrôle `fits` (horaires, pauses,
 * rendez-vous fixes en institut). Rien n'est appliqué ici.
 */
export function optimizeRoute(
  stops: RouteStop[],
  opts: { start: LatLng | null; end: LatLng | null; legs: LegLookup; margin: Margin; fits: (startBlocked: Date, endBlocked: Date) => boolean },
): { current: RouteEvaluation | null; best: RouteEvaluation | null; tooMany: boolean } {
  const sorted = [...stops].sort((a, b) => a.currentStart.getTime() - b.currentStart.getTime());
  const curTotals = routeTotals(sorted, opts.start, opts.end, opts.legs);
  const current = curTotals
    ? { order: sorted.map((s) => s.id), starts: Object.fromEntries(sorted.map((s) => [s.id, s.currentStart])), ...curTotals, feasible: true }
    : null;
  if (sorted.length < 2 || sorted.length > 7) return { current, best: null, tooMany: sorted.length > 7 };
  const firstBlocked = new Date(sorted[0].currentStart.getTime() - sorted[0].prepMinutes * 60_000);

  let best: RouteEvaluation | null = null;
  const permute = (arr: RouteStop[], k: number) => {
    if (k === arr.length) {
      const totals = routeTotals(arr, opts.start, opts.end, opts.legs);
      if (!totals || (best && totals.distanceM >= best.distanceM)) return;
      const starts: Record<string, Date> = {};
      let cursor = firstBlocked;
      for (let i = 0; i < arr.length; i++) {
        if (i > 0 && !sameCoords(arr[i - 1].coords, arr[i].coords)) {
          const leg = opts.legs(arr[i - 1].coords, arr[i].coords);
          if (!leg) return;
          const need = requiredTravelMinutes(leg.durationS, opts.margin);
          cursor = new Date(Math.ceil((cursor.getTime() + need * 60_000) / 300_000) * 300_000);
        }
        const blockedEnd = new Date(cursor.getTime() + arr[i].blockedMinutes * 60_000);
        if (!opts.fits(cursor, blockedEnd)) return;
        starts[arr[i].id] = new Date(cursor.getTime() + arr[i].prepMinutes * 60_000);
        cursor = blockedEnd;
      }
      best = { order: arr.map((s) => s.id), starts, ...totals, feasible: true };
      return;
    }
    for (let i = k; i < arr.length; i++) {
      [arr[k], arr[i]] = [arr[i], arr[k]];
      permute(arr, k + 1);
      [arr[k], arr[i]] = [arr[i], arr[k]];
    }
  };
  permute([...sorted], 0);
  return { current, best, tooMany: false };
}
