import { describe, expect, it } from "vitest";
import {
  customerStats,
  goalProgress,
  overlapDays,
  periodFor,
  proratedExpenseCents,
  rankServices,
  revenueSeries,
  serviceProfitability,
  simulateAdditional,
  summarize,
  type FinAppointment,
  type FinItem,
  type FinanceInput,
  type FinPayment,
} from "@/lib/domain/finance";

const Z = "Europe/Paris";
const NOW = new Date("2026-11-15T12:00:00+01:00");
const NOV = { from: new Date("2026-11-01T00:00:00+01:00"), to: new Date("2026-12-01T00:00:00+01:00") };

function item(over: Partial<FinItem> = {}): FinItem {
  return { serviceId: "s1", serviceName: "Soin visage", kind: "service", unitPriceCents: 6000, extraFeeCents: 0, vatRateBps: 2000, durationMinutes: 60, consumablesCents: 500, productsCents: 300, otherCostsCents: 0, ...over };
}
let n = 0;
function appt(over: Partial<FinAppointment> = {}): FinAppointment {
  return { id: `a${++n}`, startsAt: "2026-11-10T10:00:00+01:00", status: "completed", place: "salon", customerId: "c1", durationMinutes: 60, prepMinutes: 10, cleanupMinutes: 10, bufferMinutes: 0, priceTotalCents: 6000, items: [item()], travel: null, ...over };
}
function input(over: Partial<FinanceInput> = {}): FinanceInput {
  return {
    period: NOV, now: NOW, zone: Z,
    settings: { vatStatus: "liable", contributionRateBps: 0, contributionBase: "revenue", taxProvisionRateBps: 0, taxProvisionBase: "revenue" },
    appointments: [], payments: [], refunds: [], payouts: [], expenses: [], adjustments: [], categories: { s1: "Visage" },
    ...over,
  };
}
const pay = (over: Partial<FinPayment> = {}): FinPayment => ({ id: `p${++n}`, appointmentId: null, kind: "balance", method: "cash", status: "succeeded", amountCents: 1000, feeCents: null, receivedAt: "2026-11-10T10:00:00+01:00", ...over });

describe("chiffre d'affaires", () => {
  it("réalisé = rendez-vous terminés uniquement ; une réservation future est du prévisionnel", () => {
    const s = summarize(input({ appointments: [appt(), appt({ status: "confirmed", startsAt: "2026-11-20T10:00:00+01:00" })] }));
    expect(s.revenue.realized).toEqual({ ttc: 6000, ht: 5000, vat: 1000 });
    expect(s.revenue.realizedCount).toBe(1);
    expect(s.revenue.forecast.ttc).toBe(6000);
    expect(s.revenue.forecastCount).toBe(1);
  });

  it("un rendez-vous passé non clôturé n'est ni réalisé ni prévisionnel", () => {
    const s = summarize(input({ appointments: [appt({ status: "confirmed", startsAt: "2026-11-05T10:00:00+01:00" })] }));
    expect(s.revenue.realized.ttc).toBe(0);
    expect(s.revenue.forecast.ttc).toBe(0);
    expect(s.revenue.toCloseCount).toBe(1);
    expect(s.warnings.join()).toContain("à clôturer");
  });

  it("TVA : 20 % séparée du HT ; en franchise, HT = TTC et aucune TVA collectée", () => {
    const liable = summarize(input({ appointments: [appt({ items: [item({ unitPriceCents: 4999 })] })] }));
    expect(liable.revenue.realized).toEqual({ ttc: 4999, ht: 4166, vat: 833 }); // 4999 / 1,2 = 4165,83 → 4166
    const franchise = summarize(input({ settings: { ...input().settings, vatStatus: "franchise" }, appointments: [appt()] }));
    expect(franchise.revenue.realized).toEqual({ ttc: 6000, ht: 6000, vat: 0 });
  });

  it("domicile, institut, catégories, prestations et frais de déplacement séparés", () => {
    const home = appt({ place: "home", priceTotalCents: 6900, items: [item(), item({ serviceId: null, serviceName: "Frais de déplacement", kind: "travel_fee", unitPriceCents: 900, vatRateBps: 0, consumablesCents: 0, productsCents: 0 })] });
    const s = summarize(input({ appointments: [home, appt()] }));
    expect(s.revenue.home.ttc).toBe(6900);
    expect(s.revenue.salon.ttc).toBe(6000);
    expect(s.revenue.realizedTravelFees.ttc).toBe(900);
    expect(s.revenue.byCategory.find((c) => c.name === "Visage")).toMatchObject({ ht: 10000, count: 2 });
    expect(s.revenue.byService).toEqual([{ name: "Soin visage", ht: 10000, count: 2 }]);
  });

  it("annulations comptées à part ; arrhes conservées ajoutées au réalisé", () => {
    const a = appt({ status: "cancelled" });
    const s = summarize(input({ appointments: [a], payments: [pay({ appointmentId: a.id, kind: "deposit", amountCents: 1800 })] }));
    expect(s.revenue.cancelledCount).toBe(1);
    expect(s.revenue.retainedDeposits).toBe(1800);
    expect(s.revenue.realized.ttc).toBe(1800);
    // Remboursées : plus rien de conservé.
    const p = pay({ appointmentId: a.id, kind: "deposit", amountCents: 1800 });
    const s2 = summarize(input({ appointments: [a], payments: [p], refunds: [{ paymentId: p.id, amountCents: 1800, status: "succeeded", processedAt: "2026-11-11T10:00:00Z", createdAt: "2026-11-11T10:00:00Z" }] }));
    expect(s2.revenue.retainedDeposits).toBe(0);
    expect(s2.collections.refunds).toBe(1800);
  });
});

describe("encaissements", () => {
  it("sépare arrhes, soldes, remboursements, frais Stripe ; un règlement non validé n'est pas encaissé", () => {
    const a = appt();
    const dep = pay({ appointmentId: a.id, kind: "deposit", method: "card_online", amountCents: 1800, feeCents: 52 });
    const s = summarize(input({
      appointments: [a],
      payments: [dep, pay({ appointmentId: a.id, amountCents: 3000 }), pay({ appointmentId: a.id, amountCents: 1200, status: "pending" })],
      refunds: [{ paymentId: dep.id, amountCents: 300, status: "succeeded", processedAt: "2026-11-12T10:00:00Z", createdAt: "2026-11-12T10:00:00Z" }],
      payouts: [{ amountCents: 1448, status: "paid", arrivalDate: "2026-11-13T00:00:00Z" }, { amountCents: 999, status: "in_transit", arrivalDate: "2026-11-14T00:00:00Z" }],
    }));
    expect(s.collections).toMatchObject({ total: 4800, deposits: 1800, balances: 3000, online: 1800, refunds: 300, net: 4500, stripeFees: 52, pendingValidation: 1200, pendingValidationCount: 1, payouts: 1448 });
    expect(s.collections.outstanding).toBe(6000 - (1800 - 300) - 3000);
  });
});

describe("charges, marges et résultats", () => {
  const home = appt({
    place: "home",
    priceTotalCents: 6900,
    items: [item(), item({ serviceId: null, serviceName: "Frais", kind: "travel_fee", unitPriceCents: 900, vatRateBps: 0, consumablesCents: 0, productsCents: 0, durationMinutes: 5 })],
    travel: { durationMinutes: 20, distanceMeters: 12000, energyCostCents: 145, wearCostCents: 144, timeCostCents: 667, otherCostCents: 200, allIn: false },
  });

  it("dépenses décaissées et coûts estimés séparés ; la valorisation du temps n'entre pas dans la marge", () => {
    const c = summarize(input({ appointments: [home] })).costs;
    expect(c).toMatchObject({ consumables: 500, products: 300, travelEnergy: 145, travelOther: 200, cashTotal: 1145, vehicleWearEstimated: 144, timeValuationEstimated: 667 });
  });

  it("marge, taux, résultat, cotisations paramétrables, revenu disponible, rentabilité horaire", () => {
    const s = summarize(input({
      appointments: [home],
      settings: { vatStatus: "liable", contributionRateBps: 2120, contributionBase: "revenue", taxProvisionRateBps: 100, taxProvisionBase: "revenue" },
      expenses: [{ id: "e1", label: "Loyer", category: "rent", amountCents: 36500, frequency: "monthly", startsOn: "2026-01-01", endsOn: null, archivedAt: null }],
    }));
    const ht = 5000 + 900;
    expect(s.revenue.realized.ht).toBe(ht);
    expect(s.results.contributionMargin).toBe(ht - 1145 - 144);
    expect(s.results.marginRate).toBeCloseTo((ht - 1289) / ht, 6);
    expect(s.costs.fixed).toBe(Math.round((36500 * 12 * 30) / 365)); // 30 jours de novembre
    expect(s.results.operatingResult).toBe(ht - 1289 - s.costs.fixed);
    expect(s.results.contributions).toBe(Math.round((ht * 2120) / 10000));
    expect(s.results.taxProvision).toBe(59);
    expect(s.results.disposableIncome).toBe(s.results.operatingResult - s.results.contributions - 59);
    expect(s.results.mobilizedMinutes).toBe(10 + 60 + 10 + 20);
    expect(s.results.hourlyMargin).toBe(Math.round(((ht - 1289) * 60) / 100));
  });

  it("cotisations sur le bénéfice : jamais négatives", () => {
    const s = summarize(input({
      appointments: [home],
      settings: { vatStatus: "liable", contributionRateBps: 4500, contributionBase: "profit", taxProvisionRateBps: 0, taxProvisionBase: "profit" },
      expenses: [{ id: "e1", label: "Loyer", category: "rent", amountCents: 900000, frequency: "monthly", startsOn: "2026-01-01", endsOn: null, archivedAt: null }],
    }));
    expect(s.results.operatingResult).toBeLessThan(0);
    expect(s.results.contributions).toBe(0);
  });

  it("aucune division par zéro sans activité", () => {
    const s = summarize(input());
    expect(s.results.marginRate).toBeNull();
    expect(s.results.hourlyMargin).toBeNull();
  });
});

describe("charges fixes : proratisation", () => {
  const e = (over = {}) => ({ id: "e", label: "X", category: "software", amountCents: 1200, frequency: "monthly" as const, startsOn: "2026-01-01", endsOn: null, archivedAt: null, ...over });
  it("compte les jours communs à la période et à la charge (fuseau de l'entreprise)", () => {
    expect(overlapDays(NOV, "2026-01-01", null, Z)).toBe(30);
    expect(overlapDays(NOV, "2026-11-21", null, Z)).toBe(10);
    expect(overlapDays(NOV, "2026-01-01", "2026-11-05", Z)).toBe(5);
    expect(overlapDays(NOV, "2026-12-01", null, Z)).toBe(0);
  });
  it("mensuelle, trimestrielle, annuelle : montant annuel × jours / 365", () => {
    expect(proratedExpenseCents(e(), NOV, Z)).toBe(Math.round((1200 * 12 * 30) / 365));
    expect(proratedExpenseCents(e({ frequency: "quarterly", amountCents: 9000 }), NOV, Z)).toBe(Math.round((9000 * 4 * 30) / 365));
    expect(proratedExpenseCents(e({ frequency: "yearly", amountCents: 36500 }), NOV, Z)).toBe(3000);
    expect(proratedExpenseCents(e({ archivedAt: "2026-11-10T08:00:00Z" }), NOV, Z)).toBe(Math.round((1200 * 12 * 10) / 365));
  });
  it("une année complète vaut le montant annuel (année non bissextile)", () => {
    const y = periodFor("year", NOW, Z);
    expect(proratedExpenseCents(e({ frequency: "monthly", amountCents: 5000 }), y, Z)).toBe(60000);
  });
});

describe("rentabilité par prestation, fiche cliente, objectifs", () => {
  const many = (k: number, over: Partial<FinAppointment> = {}) => Array.from({ length: k }, () => appt(over));

  it("classements seulement à partir de 5 réalisations", () => {
    const list = serviceProfitability([...many(5), ...many(2, { items: [item({ serviceId: "s2", serviceName: "Épilation", unitPriceCents: 2400, durationMinutes: 20 })] })], [], "liable");
    expect(list.find((s) => s.name === "Soin visage")).toMatchObject({ count: 5, revenueHt: 25000, avgPriceTtc: 6000, avgConsumables: 800, enoughData: true });
    expect(list.find((s) => s.name === "Épilation")!.enoughData).toBe(false);
    const r = rankServices(list);
    expect(r.mostProfitable.map((s) => s.name)).toEqual(["Soin visage"]);
  });

  it("frais de paiement répartis sur les prestations du rendez-vous", () => {
    const a = appt();
    const list = serviceProfitability([a], [pay({ appointmentId: a.id, method: "card_online", feeCents: 52 })], "liable");
    expect(list[0]).toMatchObject({ avgPaymentFees: 52, margin: 5000 - 800 - 52 });
  });

  it("fiche cliente : les arrhes ne comptent pas comme une prestation supplémentaire", () => {
    const st = customerStats([appt({ startsAt: "2026-10-01T10:00:00Z" }), appt({ startsAt: "2026-10-31T10:00:00Z" }), appt({ status: "confirmed", startsAt: "2026-12-01T10:00:00Z" })], "liable", NOW);
    expect(st).toMatchObject({ completedCount: 2, revenueTtc: 12000, avgBasketTtc: 6000, avgDaysBetweenVisits: 30, upcomingCount: 1, estimatedMargin: 2 * (5000 - 800) });
  });

  it("objectifs : réalisé, prévisionnel, écart ; simulation avec hypothèses explicites", () => {
    const s = summarize(input({ appointments: [appt(), appt({ status: "confirmed", startsAt: "2026-11-25T10:00:00+01:00" })] }));
    const g = goalProgress({ monthlyRevenueCents: 20000, monthlyDisposableIncomeCents: null, monthlyAppointments: 4, hourlyMarginCents: null }, s);
    expect(g.find((l) => l.key === "revenue")).toMatchObject({ target: 20000, realized: 5000, projected: 10000, gap: -10000, progress: 0.25 });
    expect(g.find((l) => l.key === "appointments")).toMatchObject({ realized: 1, projected: 2 });
    expect(simulateAdditional(20000, 10000, many(4), "liable")).toMatchObject({ ok: false, reason: "not_enough_data" });
    expect(simulateAdditional(20000, 10000, many(6), "liable")).toMatchObject({ ok: true, remainingCents: 10000, avgRevenueHt: 5000, additionalAppointments: 2 });
    expect(simulateAdditional(20000, 25000, many(6), "liable")).toMatchObject({ ok: false, reason: "reached" });
  });

  it("évolution : réalisé et prévisionnel par jour sur un mois", () => {
    const pts = revenueSeries({ ...input(), appointments: [appt(), appt({ status: "confirmed", startsAt: "2026-11-25T10:00:00+01:00" })] });
    expect(pts).toHaveLength(30);
    expect(pts.find((p) => p.key === "2026-11-10")!.realizedHt).toBe(5000);
    expect(pts.find((p) => p.key === "2026-11-25")!.forecastHt).toBe(5000);
  });

  it("périodes : semaine du lundi, trimestre, période personnalisée invalide → mois", () => {
    expect(periodFor("week", NOW, Z).from.toISOString()).toBe("2026-11-08T23:00:00.000Z");
    expect(periodFor("quarter", NOW, Z).from.toISOString()).toBe("2026-09-30T22:00:00.000Z");
    const c = periodFor("custom", NOW, Z, { from: "2026-11-10", to: "2026-11-01" });
    expect(c.from.toISOString()).toBe("2026-10-31T23:00:00.000Z");
  });
});
