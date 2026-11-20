import { describe, expect, it } from "vitest";
import {
  checkTravel,
  optimizeRoute,
  profitability,
  requiredTravelMinutes,
  resolveArea,
  routeTotals,
  travelCost,
  travelFee,
  VEHICLE_PRESETS,
  type FeeSettings,
  type LatLng,
  type ServiceArea,
  type Vehicle,
} from "@/lib/domain/travel";
import { contextMessage, coord, geoMessage, routeMessage, sign, verify } from "@/server/travel/signing";

// Mêmes valeurs que tests/db/sprint5.test.ts : la base et l'application doivent donner les mêmes montants.
const car: Vehicle = { label: "Citadine", kind: "car_fuel", consumption_per_100km: 6.5, energy_unit: "l", energy_price_millis: 1859, wear_cost_per_km_millis: 120, all_in_cost_per_km_millis: null, fixed_cost_per_trip_cents: 0, parking_tolls_per_trip_cents: 0, hourly_time_cost_cents: 2000 };
const perKm: FeeSettings = { pricing_mode: "per_km", fixed_fee_cents: 0, per_km_cents: 50, included_km: 5, min_fee_cents: 500, max_fee_cents: null, free_above_cents: null };

describe("coût réel estimé d'un trajet", () => {
  it("détaille énergie, usure, temps et autres frais (arrondi au centime par poste)", () => {
    expect(travelCost(car, 12400, 1200)).toEqual({ energyCents: 150, wearCents: 149, timeCents: 667, otherCents: 0, totalCents: 966, cashCents: 299, allIn: false });
  });
  it("voiture électrique : kWh × prix du kWh", () => {
    const ev = { ...car, kind: "car_electric" as const, consumption_per_100km: 17, energy_unit: "kwh" as const, energy_price_millis: 250 };
    expect(travelCost(ev, 20000, 1800)?.energyCents).toBe(85); // 20 km × 17/100 × 0,25 € = 0,85 €
  });
  it("coût kilométrique global : remplace énergie et usure (aucun double compte)", () => {
    const allIn = { ...car, all_in_cost_per_km_millis: 600, parking_tolls_per_trip_cents: 300 };
    expect(travelCost(allIn, 10000, 900)).toEqual({ energyCents: 0, wearCents: 600, timeCents: 500, otherCents: 300, totalCents: 1400, cashCents: 900, allIn: true });
  });
  it("vélo : ni énergie ni temps facturé si non renseignés ; aucun véhicule → pas de coût inventé", () => {
    const bike = { ...car, kind: "bike" as const, ...VEHICLE_PRESETS.bike, hourly_time_cost_cents: 0 };
    expect(travelCost(bike, 3000, 900)).toMatchObject({ energyCents: 0, wearCents: 6, timeCents: 0, totalCents: 6 });
    expect(travelCost(null, 3000, 900)).toBeNull();
  });
});

describe("frais de déplacement facturés", () => {
  it("au kilomètre avec distance incluse et minimum", () => {
    const f = travelFee(perKm, 12400, 5000);
    expect(f.feeCents).toBe(500);
    expect(f.steps.join(" ")).toContain("7,4 km");
    expect(travelFee(perKm, 30000, 5000).feeCents).toBe(1250);
    expect(travelFee(perKm, 4000, 5000).feeCents).toBe(0); // dans la distance incluse : pas de minimum
  });
  it("plafond, forfait, offert, zone et supplément", () => {
    expect(travelFee({ ...perKm, max_fee_cents: 1000 }, 40000, 5000).feeCents).toBe(1000);
    expect(travelFee({ ...perKm, pricing_mode: "fixed", fixed_fee_cents: 800 }, 1, 5000, 200).feeCents).toBe(1000);
    expect(travelFee({ ...perKm, pricing_mode: "free" }, 40000, 5000, 200).feeCents).toBe(0);
    expect(travelFee({ ...perKm, pricing_mode: "zone" }, 40000, 5000, 300).feeCents).toBe(300);
  });
  it("offert au-delà d'un montant de prestation", () => {
    const s = { ...perKm, pricing_mode: "free_above" as const, free_above_cents: 4000 };
    expect(travelFee(s, 20000, 4000).feeCents).toBe(0);
    expect(travelFee(s, 20000, 3999, 200).feeCents).toBe(950);
    expect(travelFee({ ...s, per_km_cents: 0, fixed_fee_cents: 600 }, 20000, 1000).feeCents).toBe(600);
  });
  it("coût réel ≠ frais facturés : la part non couverte est visible", () => {
    const cost = travelCost(car, 12400, 1200)!.totalCents;
    const fee = travelFee(perKm, 12400, 5000).feeCents;
    expect(cost - fee).toBe(466);
  });
});

describe("zones d'intervention", () => {
  const areas: ServiceArea[] = [
    { id: "x", name: "Exclue", kind: "postcodes", max_km: null, postcodes: ["31999"], excluded: true, surcharge_cents: 0, min_order_cents: 0, weekdays: null },
    { id: "a", name: "Centre", kind: "radius", max_km: 10, postcodes: null, excluded: false, surcharge_cents: 0, min_order_cents: 0, weekdays: null },
    { id: "b", name: "Sud", kind: "radius", max_km: 25, postcodes: null, excluded: false, surcharge_cents: 200, min_order_cents: 3000, weekdays: [2, 4] },
  ];
  const q = (o: Partial<{ postcode: string; roadKm: number; weekday: number; orderCents: number }>) => ({ postcode: "31000", roadKm: 5, weekday: 2, orderCents: 5000, ...o });
  it("exclusion prioritaire, première zone correspondante, jours, minimum", () => {
    expect(resolveArea(areas, q({ postcode: "31999" }), null)).toEqual({ ok: false, reason: "excluded" });
    expect(resolveArea(areas, q({}), null)).toMatchObject({ ok: true, zoneName: "Centre", surchargeCents: 0 });
    expect(resolveArea(areas, q({ roadKm: 20 }), null)).toMatchObject({ ok: true, zoneName: "Sud", surchargeCents: 200 });
    expect(resolveArea(areas, q({ roadKm: 20, weekday: 3 }), null)).toMatchObject({ ok: false, reason: "wrong_day" });
    expect(resolveArea(areas, q({ roadKm: 20, orderCents: 1500 }), null)).toMatchObject({ ok: false, reason: "below_minimum", minOrderCents: 3000 });
    expect(resolveArea(areas, q({ roadKm: 40 }), null)).toEqual({ ok: false, reason: "out_of_area" });
  });
  it("sans zone définie : rayon routier général facultatif", () => {
    expect(resolveArea([], q({ roadKm: 30 }), 20)).toEqual({ ok: false, reason: "out_of_area" });
    expect(resolveArea([], q({ roadKm: 30 }), null)).toMatchObject({ ok: true });
  });
});

describe("enchaînement des rendez-vous", () => {
  const A: LatLng = { lat: 43.62, lng: 1.42 };
  const B: LatLng = { lat: 43.65, lng: 1.38 };
  const C: LatLng = { lat: 43.58, lng: 1.36 };
  const t = (h: number, m = 0) => new Date(Date.UTC(2027, 0, 4, h - 1, m));
  const margin = { safety_margin_pct: 20, safety_margin_minutes: 5 };
  const durations = new Map([["A>B", 1500], ["B>C", 900], ["C>B", 900]]);
  const name = (p: LatLng) => (p === A ? "A" : p === B ? "B" : "C");
  const lookup = (f: LatLng, to: LatLng) => durations.get(`${name(f)}>${name(to)}`) ?? null;
  const stops = [
    { start: t(9), end: t(10), coords: A },
    { start: t(14), end: t(15), coords: C },
  ];
  it("marge de sécurité : 25 min → 35 min à prévoir", () => {
    expect(requiredTravelMinutes(1500, margin)).toBe(35);
  });
  it("exemple du cahier des charges : la cliente B doit tenir compte du trajet depuis A", () => {
    expect(checkTravel({ start: t(10, 30), end: t(11, 30), coords: B }, stops, lookup, margin)).toMatchObject({ ok: false, reason: "too_short", requiredMinutes: 35, availableMinutes: 30 });
    expect(checkTravel({ start: t(10, 35), end: t(11, 35), coords: B }, stops, lookup, margin)).toEqual({ ok: true });
  });
  it("vérifie aussi le rendez-vous suivant", () => {
    expect(checkTravel({ start: t(12, 50), end: t(13, 50), coords: B }, stops, lookup, margin)).toMatchObject({ ok: false, reason: "too_short" });
    expect(checkTravel({ start: t(12, 30), end: t(13, 30), coords: B }, stops, lookup, margin)).toEqual({ ok: true });
  });
  it("trajet inconnu ou voisin non localisé : refus, jamais de durée inventée", () => {
    expect(checkTravel({ start: t(11), end: t(12), coords: C }, stops, lookup, margin)).toEqual({ ok: false, reason: "unknown" });
    expect(checkTravel({ start: t(11), end: t(12), coords: B }, [{ start: t(9), end: t(10), coords: null }], lookup, margin)).toEqual({ ok: false, reason: "unknown" });
  });
});

describe("rentabilité indicative", () => {
  it("sépare marge financière, coût du temps et rentabilité horaire, sans double compte", () => {
    const p = profitability({ serviceHtCents: 5000, feeHtCents: 500, consumablesCents: 300, otherDirectCents: 0, travel: travelCost(car, 12400, 1200), travelMinutes: 20, workMinutes: 60 });
    expect(p).toEqual({ revenueHtCents: 5500, directCostsCents: 599, financialMarginCents: 4901, timeCostCents: 667, economicMarginCents: 4234, totalMinutes: 80, hourlyCents: 3676 });
  });
});

describe("optimisation de tournée", () => {
  const H: LatLng = { lat: 43.6, lng: 1.4 };
  const P = [{ lat: 43.61, lng: 1.4 }, { lat: 43.7, lng: 1.4 }, { lat: 43.62, lng: 1.4 }];
  // distance ∝ écart de latitude (valeurs de test)
  const legs = (a: LatLng, b: LatLng) => {
    const d = Math.round(Math.abs(a.lat - b.lat) * 100000);
    return { distanceM: d, durationS: Math.round(d / 10) };
  };
  const day = (h: number) => new Date(Date.UTC(2027, 0, 4, h - 1));
  const stops = P.map((coords, i) => ({ id: `s${i}`, blockedMinutes: 60, prepMinutes: 0, coords, currentStart: day(9 + i * 2) }));
  it("propose un ordre plus court sans rien appliquer, et calcule l'économie estimée", () => {
    const res = optimizeRoute(stops, { start: H, end: null, legs, margin: { safety_margin_pct: 0, safety_margin_minutes: 0 }, fits: () => true });
    expect(res.current?.order).toEqual(["s0", "s1", "s2"]);
    expect(res.best?.order).toEqual(["s0", "s2", "s1"]);
    expect(res.best!.distanceM).toBeLessThan(res.current!.distanceM);
    expect(res.best!.starts.s0.getTime()).toBe(day(9).getTime());
    // Ordre actuel inchangé dans les données d'entrée
    expect(stops[1].currentStart.getTime()).toBe(day(11).getTime());
  });
  it("respecte les contraintes horaires (aucune proposition impossible)", () => {
    const res = optimizeRoute(stops, { start: H, end: H, legs, margin: { safety_margin_pct: 0, safety_margin_minutes: 0 }, fits: () => false });
    expect(res.best).toBeNull();
  });
  it("trajet inconnu : pas de total inventé", () => {
    expect(routeTotals(stops, H, null, () => null)).toBeNull();
  });
});

describe("signatures (formats identiques à la base)", () => {
  it("coordonnées à 6 décimales et messages stables", () => {
    expect(coord(43.6)).toBe("43.600000");
    expect(coord(-0.0000001)).toBe("0.000000");
    expect(routeMessage({ businessId: "b", from: { lat: 1, lng: 2 }, to: { lat: 3, lng: 4.5 }, distanceM: 10, durationS: 20, provider: "ign", computedEpoch: 99 })).toBe("route|v1|b|1.000000|2.000000|3.000000|4.500000|10|20|ign|99");
    expect(geoMessage({ businessId: "b", lat: 43.6, lng: 1.4, postcode: null, expiresEpoch: 5 })).toBe("geo|v1|b|43.600000|1.400000||5");
    expect(contextMessage({ slug: " Mon-Slug ", fromEpoch: 1, toEpoch: 2, ts: 3 })).toBe("busy|v1|mon-slug|1|2|3");
  });
  it("vérification à temps constant ; une signature modifiée est refusée", () => {
    const s = sign("m", "k");
    expect(verify("m", s, "k")).toBe(true);
    expect(verify("m2", s, "k")).toBe(false);
    expect(verify("m", "zz", "k")).toBe(false);
  });
});
