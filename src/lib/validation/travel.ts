import { parseEurosToCents } from "@/lib/domain/pricing";
import type { PricingMode, ServiceArea, Vehicle, VehicleKind } from "@/lib/domain/travel";

/** Formulaires des déplacements : lecture stricte, montants en centimes / millièmes d'euro. */

type Form = Record<string, string | undefined>;
type Result<T> = { ok: true; data: T } | { ok: false; errors: Record<string, string> };

const t = (f: Form, k: string) => (f[k] ?? "").trim();

/** « 1,859 » → 1859 millièmes d'euro. Vide → null. */
export function parseEurosToMillis(v: string): number | null | typeof NaN {
  const s = v.trim().replace(/\s/g, "").replace(",", ".");
  if (!s) return null;
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 1000);
}

function num(v: string, { min, max, decimals = 0 }: { min: number; max: number; decimals?: number }): number | null | typeof NaN {
  const s = v.trim().replace(",", ".");
  if (!s) return null;
  const re = decimals ? new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`) : /^\d+$/;
  if (!re.test(s)) return NaN;
  const n = Number(s);
  return n < min || n > max ? NaN : n;
}

const money = (v: string, max = 100000) => {
  const c = v.trim() ? parseEurosToCents(v) : null;
  return c === null ? null : Number.isNaN(c) || c < 0 || c > max ? NaN : c;
};

export interface TravelSettingsInput {
  enabled: boolean;
  start_point: "travel_base" | "salon";
  return_point: "none" | "travel_base" | "salon";
  safety_margin_pct: number;
  safety_margin_minutes: number;
  pricing_mode: PricingMode;
  fixed_fee_cents: number;
  per_km_cents: number;
  included_km: number;
  min_fee_cents: number;
  max_fee_cents: number | null;
  free_above_cents: number | null;
  fee_vat_rate_bps: number;
}

export function parseTravelSettings(f: Form): Result<TravelSettingsInput> {
  const e: Record<string, string> = {};
  const mode = t(f, "pricing_mode") as PricingMode;
  if (!["free", "fixed", "per_km", "zone", "free_above"].includes(mode)) e.pricing_mode = "Choisissez un mode de facturation.";
  const start = t(f, "start_point");
  const ret = t(f, "return_point") || "none";
  const pct = num(t(f, "safety_margin_pct"), { min: 0, max: 100 });
  const mins = num(t(f, "safety_margin_minutes"), { min: 0, max: 60 });
  const fixed = money(t(f, "fixed_fee"));
  const perKm = money(t(f, "per_km"), 1000);
  const included = num(t(f, "included_km"), { min: 0, max: 500, decimals: 1 });
  const min = money(t(f, "min_fee"));
  const max = money(t(f, "max_fee"));
  const freeAbove = money(t(f, "free_above"), 10_000_000);
  const vat = Number(t(f, "fee_vat_rate_bps") || "0");
  if (start !== "travel_base" && start !== "salon") e.start_point = "Choisissez un point de départ.";
  if (!["none", "travel_base", "salon"].includes(ret)) e.return_point = "Point de retour invalide.";
  if (pct === null || Number.isNaN(pct)) e.safety_margin_pct = "Entre 0 et 100 %.";
  if (mins === null || Number.isNaN(mins)) e.safety_margin_minutes = "Entre 0 et 60 minutes.";
  if (Number.isNaN(fixed)) e.fixed_fee = "Montant invalide.";
  if (Number.isNaN(perKm)) e.per_km = "Montant invalide (10 € maximum par km).";
  if (Number.isNaN(included)) e.included_km = "Entre 0 et 500 km.";
  if (Number.isNaN(min)) e.min_fee = "Montant invalide.";
  if (Number.isNaN(max)) e.max_fee = "Montant invalide.";
  if (Number.isNaN(freeAbove)) e.free_above = "Montant invalide.";
  if (mode === "fixed" && !fixed) e.fixed_fee = "Indiquez le forfait.";
  if (mode === "per_km" && !perKm) e.per_km = "Indiquez le tarif par kilomètre.";
  if (mode === "free_above" && (freeAbove === null || Number.isNaN(freeAbove))) e.free_above = "Indiquez le montant à partir duquel le déplacement est offert.";
  if (max != null && min != null && !Number.isNaN(max) && !Number.isNaN(min) && max < min) e.max_fee = "Le maximum doit être supérieur au minimum.";
  if (![0, 550, 1000, 2000].includes(vat)) e.fee_vat_rate_bps = "Taux invalide.";
  if (Object.keys(e).length) return { ok: false, errors: e };
  return {
    ok: true,
    data: {
      enabled: f.enabled === "on",
      start_point: start as "travel_base" | "salon",
      return_point: ret as "none" | "travel_base" | "salon",
      safety_margin_pct: pct as number,
      safety_margin_minutes: mins as number,
      pricing_mode: mode,
      fixed_fee_cents: (fixed as number | null) ?? 0,
      per_km_cents: (perKm as number | null) ?? 0,
      included_km: (included as number | null) ?? 0,
      min_fee_cents: (min as number | null) ?? 0,
      max_fee_cents: max as number | null,
      free_above_cents: freeAbove as number | null,
      fee_vat_rate_bps: vat,
    },
  };
}

export function parseVehicle(f: Form): Result<Vehicle & { is_default: boolean }> {
  const e: Record<string, string> = {};
  const kind = t(f, "kind") as VehicleKind;
  if (!["car_fuel", "car_electric", "car_hybrid", "two_wheeler", "bike", "other"].includes(kind)) e.kind = "Choisissez un type de véhicule.";
  const label = t(f, "label") || "Mon véhicule";
  const consumption = num(t(f, "consumption"), { min: 0, max: 100, decimals: 2 });
  const energyPrice = parseEurosToMillis(t(f, "energy_price"));
  const wear = parseEurosToMillis(t(f, "wear_per_km"));
  const allIn = parseEurosToMillis(t(f, "all_in_per_km"));
  const fixed = money(t(f, "fixed_per_trip"));
  const parking = money(t(f, "parking_per_trip"));
  const hourly = money(t(f, "hourly_cost"));
  const unit = kind === "car_electric" ? "kwh" : "l";
  if (Number.isNaN(consumption)) e.consumption = "Consommation invalide (0 à 100).";
  if (Number.isNaN(energyPrice) || (energyPrice ?? 0) > 10000) e.energy_price = "Prix invalide (3 décimales maximum).";
  if (Number.isNaN(wear) || (wear ?? 0) > 5000) e.wear_per_km = "Coût invalide.";
  if (Number.isNaN(allIn) || (allIn ?? 0) > 5000) e.all_in_per_km = "Coût invalide.";
  if (Number.isNaN(fixed)) e.fixed_per_trip = "Montant invalide.";
  if (Number.isNaN(parking)) e.parking_per_trip = "Montant invalide.";
  if (Number.isNaN(hourly)) e.hourly_cost = "Montant invalide.";
  if ((consumption != null) !== (energyPrice != null) && !e.consumption && !e.energy_price) e.energy_price = "Renseignez la consommation ET le prix de l'énergie, ou aucun des deux.";
  if (label.length > 60) e.label = "60 caractères maximum.";
  if (Object.keys(e).length) return { ok: false, errors: e };
  return {
    ok: true,
    data: {
      label,
      kind,
      consumption_per_100km: consumption as number | null,
      energy_unit: consumption != null ? unit : null,
      energy_price_millis: energyPrice as number | null,
      wear_cost_per_km_millis: (wear as number | null) ?? 0,
      all_in_cost_per_km_millis: allIn as number | null,
      fixed_cost_per_trip_cents: (fixed as number | null) ?? 0,
      parking_tolls_per_trip_cents: (parking as number | null) ?? 0,
      hourly_time_cost_cents: (hourly as number | null) ?? 0,
      is_default: f.is_default === "on",
    },
  };
}

export function parseArea(f: Form): Result<Omit<ServiceArea, "id"> & { is_active: boolean }> {
  const e: Record<string, string> = {};
  const name = t(f, "name");
  const kind = t(f, "kind");
  if (!name || name.length > 60) e.name = "Nom de 1 à 60 caractères.";
  if (kind !== "radius" && kind !== "postcodes") e.kind = "Choisissez un type de zone.";
  const maxKm = num(t(f, "max_km"), { min: 0, max: 500, decimals: 1 });
  const postcodes = t(f, "postcodes").split(/[\s,;]+/).filter(Boolean);
  if (kind === "radius" && (maxKm === null || Number.isNaN(maxKm))) e.max_km = "Distance routière maximale (0 à 500 km).";
  if (kind === "postcodes" && (postcodes.length === 0 || postcodes.some((p) => !/^\d{5}$/.test(p)))) e.postcodes = "Codes postaux à 5 chiffres, séparés par des virgules.";
  if (postcodes.length > 200) e.postcodes = "200 codes postaux maximum.";
  const surcharge = money(t(f, "surcharge"));
  const minOrder = money(t(f, "min_order"), 10_000_000);
  if (Number.isNaN(surcharge)) e.surcharge = "Montant invalide.";
  if (Number.isNaN(minOrder)) e.min_order = "Montant invalide.";
  const weekdays = [1, 2, 3, 4, 5, 6, 7].filter((d) => f[`day_${d}`] === "on");
  if (Object.keys(e).length) return { ok: false, errors: e };
  return {
    ok: true,
    data: {
      name,
      kind: kind as "radius" | "postcodes",
      max_km: kind === "radius" ? (maxKm as number) : null,
      postcodes: kind === "postcodes" ? [...new Set(postcodes)] : null,
      excluded: f.excluded === "on",
      surcharge_cents: (surcharge as number | null) ?? 0,
      min_order_cents: (minOrder as number | null) ?? 0,
      weekdays: weekdays.length === 0 || weekdays.length === 7 ? null : weekdays,
      position: Number(t(f, "position") || "0") || 0,
      is_active: f.is_active !== "off",
    },
  };
}
