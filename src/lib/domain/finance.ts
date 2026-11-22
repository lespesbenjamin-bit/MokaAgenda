import { DateTime } from "luxon";
import { excludingVatCents } from "./pricing";

/**
 * Calculs financiers de Moka (Sprint 6). Fonctions pures, montants en centimes.
 * Les formules sont documentées dans docs/ARCHITECTURE.md (« Formules financières »).
 *
 * Natures :
 *  - RÉALISÉ : rendez-vous « terminés » (jamais une réservation future) ;
 *  - PRÉVISIONNEL : rendez-vous confirmés ou en attente, à venir ;
 *  - ESTIMÉ : coûts économiques (usure, temps), cotisations, provision, revenu disponible.
 * Le résultat est une estimation de gestion, pas une donnée comptable certifiée.
 */

export type AppointmentStatus = "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
export type Place = "home" | "salon";
export type VatStatus = "not_set" | "franchise" | "liable";
export type Frequency = "monthly" | "quarterly" | "yearly";

export interface FinItem {
  serviceId: string | null;
  serviceName: string;
  kind: "service" | "travel_fee";
  unitPriceCents: number;
  extraFeeCents: number;
  vatRateBps: number;
  durationMinutes: number;
  consumablesCents: number;
  productsCents: number;
  otherCostsCents: number;
}

export interface FinTravel {
  durationMinutes: number;
  distanceMeters: number;
  energyCostCents: number | null;
  wearCostCents: number | null;
  timeCostCents: number | null;
  otherCostCents: number | null;
  allIn: boolean;
}

export interface FinAppointment {
  id: string;
  startsAt: string;
  status: AppointmentStatus;
  place: Place;
  customerId: string | null;
  durationMinutes: number;
  prepMinutes: number;
  cleanupMinutes: number;
  bufferMinutes: number;
  priceTotalCents: number;
  items: FinItem[];
  travel: FinTravel | null;
}

export interface FinPayment {
  id: string;
  appointmentId: string | null;
  kind: "deposit" | "balance" | "other";
  method: string;
  status: "pending" | "succeeded" | "cancelled" | "failed";
  amountCents: number;
  feeCents: number | null;
  receivedAt: string;
}

export interface FinRefund {
  paymentId: string;
  amountCents: number;
  status: string;
  processedAt: string | null;
  createdAt: string;
}

export interface FinPayout {
  amountCents: number;
  status: string;
  arrivalDate: string | null;
}

export interface FixedExpense {
  id: string;
  label: string;
  category: string;
  amountCents: number;
  frequency: Frequency;
  startsOn: string;
  endsOn: string | null;
  archivedAt: string | null;
}

export interface FinAdjustment {
  kind: "revenue" | "collection" | "expense" | "fee";
  amountCents: number;
  occurredOn: string;
}

export interface FinSettings {
  vatStatus: VatStatus;
  contributionRateBps: number;
  contributionBase: "revenue" | "profit";
  taxProvisionRateBps: number;
  taxProvisionBase: "revenue" | "profit";
}

export interface Period {
  /** Début inclus (instant). */
  from: Date;
  /** Fin exclue (instant). */
  to: Date;
}

const within = (iso: string | null | undefined, p: Period) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= p.from.getTime() && t < p.to.getTime();
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

/** Montant TTC d'une ligne (prix appliqué + supplément). */
export const itemTtc = (i: FinItem) => i.unitPriceCents + i.extraFeeCents;

/** HT d'une ligne : en franchise de TVA, HT = TTC (aucune TVA collectée). */
export function itemHt(i: FinItem, vat: VatStatus): number {
  return vat === "franchise" ? itemTtc(i) : excludingVatCents(itemTtc(i), i.vatRateBps);
}

export interface Revenue {
  ttc: number;
  ht: number;
  vat: number;
}
function revenueOf(items: FinItem[], vat: VatStatus): Revenue {
  const ttc = sum(items.map(itemTtc));
  const ht = sum(items.map((i) => itemHt(i, vat)));
  return { ttc, ht, vat: ttc - ht };
}
const addRev = (a: Revenue, b: Revenue): Revenue => ({ ttc: a.ttc + b.ttc, ht: a.ht + b.ht, vat: a.vat + b.vat });
const ZERO: Revenue = { ttc: 0, ht: 0, vat: 0 };

/** Minutes mobilisées : préparation + prestation + nettoyage + tampon + trajet aller. */
export function mobilizedMinutes(a: FinAppointment): number {
  return a.prepMinutes + a.durationMinutes + a.cleanupMinutes + a.bufferMinutes + (a.travel?.durationMinutes ?? 0);
}

// ─── Charges fixes : proratisation ──────────────────────────────────
const PER_YEAR: Record<Frequency, number> = { monthly: 12, quarterly: 4, yearly: 1 };

/** Nombre de jours calendaires (fuseau de l'entreprise) communs à la période et à la charge. */
export function overlapDays(p: Period, startsOn: string, endsOn: string | null, zone: string): number {
  const pFrom = DateTime.fromJSDate(p.from, { zone }).startOf("day");
  const pTo = DateTime.fromJSDate(new Date(p.to.getTime() - 1), { zone }).startOf("day").plus({ days: 1 });
  const eFrom = DateTime.fromISO(startsOn, { zone }).startOf("day");
  const eTo = endsOn ? DateTime.fromISO(endsOn, { zone }).startOf("day").plus({ days: 1 }) : null;
  const from = eFrom > pFrom ? eFrom : pFrom;
  const to = eTo && eTo < pTo ? eTo : pTo;
  return Math.max(0, Math.round(to.diff(from, "days").days));
}

/**
 * Méthode documentée : montant annuel = montant × (12 | 4 | 1) ;
 * part de la période = montant annuel × jours communs / 365, arrondie au centime.
 */
export function proratedExpenseCents(e: FixedExpense, p: Period, zone: string): number {
  const end = e.archivedAt ? (e.endsOn && e.endsOn < e.archivedAt.slice(0, 10) ? e.endsOn : e.archivedAt.slice(0, 10)) : e.endsOn;
  const days = overlapDays(p, e.startsOn, end, zone);
  return Math.round((e.amountCents * PER_YEAR[e.frequency] * days) / 365);
}

// ─── Synthèse d'une période ─────────────────────────────────────────
export interface FinanceInput {
  period: Period;
  now: Date;
  zone: string;
  settings: FinSettings;
  appointments: FinAppointment[];
  payments: FinPayment[];
  refunds: FinRefund[];
  payouts: FinPayout[];
  expenses: FixedExpense[];
  adjustments: FinAdjustment[];
  /** Catégorie de chaque prestation (id → nom de catégorie). */
  categories: Record<string, string>;
}

export interface FinanceSummary {
  revenue: {
    realized: Revenue;
    realizedServices: Revenue;
    realizedTravelFees: Revenue;
    retainedDeposits: number;
    revenueAdjustments: number;
    realizedCount: number;
    forecast: Revenue;
    forecastCount: number;
    toClose: Revenue;
    toCloseCount: number;
    cancelledCount: number;
    cancelledTtc: number;
    noShowCount: number;
    home: Revenue;
    salon: Revenue;
    byCategory: { name: string; ht: number; count: number }[];
    byService: { name: string; ht: number; count: number }[];
  };
  collections: {
    total: number;
    deposits: number;
    balances: number;
    others: number;
    online: number;
    refunds: number;
    adjustments: number;
    net: number;
    stripeFees: number;
    pendingValidation: number;
    pendingValidationCount: number;
    outstanding: number;
    payouts: number;
  };
  costs: {
    consumables: number;
    products: number;
    otherDirect: number;
    travelEnergy: number;
    travelOther: number;
    paymentFees: number;
    expenseAdjustments: number;
    cashTotal: number;
    vehicleWearEstimated: number;
    timeValuationEstimated: number;
    estimatedTotal: number;
    fixed: number;
    fixedLines: { label: string; category: string; cents: number }[];
  };
  results: {
    contributionMargin: number;
    marginRate: number | null;
    operatingResult: number;
    contributions: number;
    taxProvision: number;
    disposableIncome: number;
    mobilizedMinutes: number;
    hourlyMargin: number | null;
    hourlyRevenue: number | null;
  };
  warnings: string[];
}

/** Net encaissé par rendez-vous (paiements validés − remboursements effectués). */
export function netPaidByAppointment(payments: FinPayment[], refunds: FinRefund[]): Map<string, number> {
  const byPayment = new Map<string, number>();
  for (const r of refunds) if (r.status === "succeeded") byPayment.set(r.paymentId, (byPayment.get(r.paymentId) ?? 0) + r.amountCents);
  const out = new Map<string, number>();
  for (const p of payments) {
    if (p.status !== "succeeded" || !p.appointmentId) continue;
    out.set(p.appointmentId, (out.get(p.appointmentId) ?? 0) + p.amountCents - (byPayment.get(p.id) ?? 0));
  }
  return out;
}

export function summarize(input: FinanceInput): FinanceSummary {
  const { period, now, zone, settings: s } = input;
  const vat = s.vatStatus;
  const inPeriod = input.appointments.filter((a) => within(a.startsAt, period));
  const realized = inPeriod.filter((a) => a.status === "completed");
  const upcoming = inPeriod.filter((a) => (a.status === "confirmed" || a.status === "pending") && new Date(a.startsAt) >= now);
  const toClose = inPeriod.filter((a) => (a.status === "confirmed" || a.status === "pending") && new Date(a.startsAt) < now);
  const cancelled = inPeriod.filter((a) => a.status === "cancelled");
  const noShow = inPeriod.filter((a) => a.status === "no_show");
  const netPaid = netPaidByAppointment(input.payments, input.refunds);

  const rev = (list: FinAppointment[], pick: (i: FinItem) => boolean = () => true) =>
    list.reduce((acc, a) => addRev(acc, revenueOf(a.items.filter(pick), vat)), ZERO);

  // Arrhes / acomptes conservés sur des rendez-vous annulés ou non honorés.
  // Hypothèse : HT = TTC (traitement TVA à confirmer avec votre comptable).
  const retainedDeposits = sum([...cancelled, ...noShow].map((a) => Math.max(0, netPaid.get(a.id) ?? 0)));
  const revenueAdjustments = sum(input.adjustments.filter((x) => x.kind === "revenue" && within(`${x.occurredOn}T12:00:00Z`, period)).map((x) => x.amountCents));
  const extra = retainedDeposits + revenueAdjustments;
  const base = rev(realized);
  const realizedRev: Revenue = { ttc: base.ttc + extra, ht: base.ht + extra, vat: base.vat };

  const group = (list: FinAppointment[], key: (i: FinItem) => string | null) => {
    const m = new Map<string, { ht: number; count: number }>();
    for (const a of list) {
      const seen = new Set<string>();
      for (const i of a.items) {
        const k = key(i);
        if (!k) continue;
        const g = m.get(k) ?? { ht: 0, count: 0 };
        g.ht += itemHt(i, vat);
        if (!seen.has(k)) g.count += 1;
        seen.add(k);
        m.set(k, g);
      }
    }
    return [...m.entries()].map(([name, g]) => ({ name, ...g })).sort((x, y) => y.ht - x.ht);
  };

  // Encaissements (date de réception).
  const okPayments = input.payments.filter((p) => p.status === "succeeded" && within(p.receivedAt, period));
  const pending = input.payments.filter((p) => p.status === "pending");
  const refundsDone = input.refunds.filter((r) => r.status === "succeeded" && within(r.processedAt ?? r.createdAt, period));
  const collectionAdj = sum(input.adjustments.filter((x) => x.kind === "collection" && within(`${x.occurredOn}T12:00:00Z`, period)).map((x) => x.amountCents));
  const total = sum(okPayments.map((p) => p.amountCents));
  const refunds = sum(refundsDone.map((r) => r.amountCents));
  const stripeFees = sum(okPayments.filter((p) => p.method === "card_online").map((p) => p.feeCents ?? 0));
  const feeAdj = sum(input.adjustments.filter((x) => x.kind === "fee" && within(`${x.occurredOn}T12:00:00Z`, period)).map((x) => x.amountCents));
  const expenseAdj = sum(input.adjustments.filter((x) => x.kind === "expense" && within(`${x.occurredOn}T12:00:00Z`, period)).map((x) => x.amountCents));
  const outstanding = sum(
    [...realized, ...toClose, ...upcoming].map((a) => Math.max(0, a.priceTotalCents - (netPaid.get(a.id) ?? 0))),
  );

  // Charges variables des rendez-vous réalisés.
  const items = realized.flatMap((a) => a.items);
  const consumables = sum(items.map((i) => i.consumablesCents));
  const products = sum(items.map((i) => i.productsCents));
  const otherDirect = sum(items.map((i) => i.otherCostsCents));
  const travels = realized.map((a) => a.travel).filter((t): t is FinTravel => t !== null);
  const travelEnergy = sum(travels.map((t) => t.energyCostCents ?? 0));
  const travelOther = sum(travels.map((t) => t.otherCostCents ?? 0));
  const wear = sum(travels.map((t) => t.wearCostCents ?? 0));
  const timeVal = sum(travels.map((t) => t.timeCostCents ?? 0));
  const paymentFees = stripeFees + feeAdj;
  const cashTotal = consumables + products + otherDirect + travelEnergy + travelOther + paymentFees + expenseAdj;

  const fixedLines = input.expenses
    .map((e) => ({ label: e.label, category: e.category, cents: proratedExpenseCents(e, period, zone) }))
    .filter((l) => l.cents > 0);
  const fixed = sum(fixedLines.map((l) => l.cents));

  const contributionMargin = realizedRev.ht - cashTotal - wear;
  const operatingResult = contributionMargin - fixed;
  const baseFor = (b: "revenue" | "profit") => (b === "revenue" ? realizedRev.ht : Math.max(0, operatingResult));
  const contributions = Math.round((baseFor(s.contributionBase) * s.contributionRateBps) / 10000);
  const taxProvision = Math.round((baseFor(s.taxProvisionBase) * s.taxProvisionRateBps) / 10000);
  const minutes = sum(realized.map(mobilizedMinutes));

  const warnings: string[] = [];
  if (vat === "not_set") warnings.push("Statut de TVA non renseigné : les taux saisis sur chaque prestation sont utilisés.");
  if (s.contributionRateBps === 0) warnings.push("Taux de cotisations non renseigné : cotisations comptées à 0.");
  if (toClose.length > 0) warnings.push(`${toClose.length} rendez-vous passé(s) à clôturer : non comptés dans le réalisé.`);
  if (okPayments.some((p) => p.method === "card_online" && p.feeCents === null)) warnings.push("Frais Stripe pas encore connus pour certains paiements.");

  return {
    revenue: {
      realized: realizedRev,
      realizedServices: rev(realized, (i) => i.kind === "service"),
      realizedTravelFees: rev(realized, (i) => i.kind === "travel_fee"),
      retainedDeposits,
      revenueAdjustments,
      realizedCount: realized.length,
      forecast: rev(upcoming),
      forecastCount: upcoming.length,
      toClose: rev(toClose),
      toCloseCount: toClose.length,
      cancelledCount: cancelled.length,
      cancelledTtc: sum(cancelled.map((a) => a.priceTotalCents)),
      noShowCount: noShow.length,
      home: rev(realized.filter((a) => a.place === "home")),
      salon: rev(realized.filter((a) => a.place === "salon")),
      byCategory: group(realized, (i) => (i.kind === "service" ? (i.serviceId && input.categories[i.serviceId]) || "Sans catégorie" : "Frais de déplacement")),
      byService: group(realized, (i) => (i.kind === "service" ? i.serviceName : null)),
    },
    collections: {
      total,
      deposits: sum(okPayments.filter((p) => p.kind === "deposit").map((p) => p.amountCents)),
      balances: sum(okPayments.filter((p) => p.kind === "balance").map((p) => p.amountCents)),
      others: sum(okPayments.filter((p) => p.kind === "other").map((p) => p.amountCents)),
      online: sum(okPayments.filter((p) => p.method === "card_online").map((p) => p.amountCents)),
      refunds,
      adjustments: collectionAdj,
      net: total - refunds + collectionAdj,
      stripeFees,
      pendingValidation: sum(pending.map((p) => p.amountCents)),
      pendingValidationCount: pending.length,
      outstanding,
      payouts: sum(input.payouts.filter((p) => p.status === "paid" && within(p.arrivalDate, period)).map((p) => p.amountCents)),
    },
    costs: {
      consumables,
      products,
      otherDirect,
      travelEnergy,
      travelOther,
      paymentFees,
      expenseAdjustments: expenseAdj,
      cashTotal,
      vehicleWearEstimated: wear,
      timeValuationEstimated: timeVal,
      estimatedTotal: wear,
      fixed,
      fixedLines,
    },
    results: {
      contributionMargin,
      marginRate: ratio(contributionMargin, realizedRev.ht),
      operatingResult,
      contributions,
      taxProvision,
      disposableIncome: operatingResult - contributions - taxProvision,
      mobilizedMinutes: minutes,
      hourlyMargin: minutes > 0 ? Math.round((contributionMargin * 60) / minutes) : null,
      hourlyRevenue: minutes > 0 ? Math.round((realizedRev.ht * 60) / minutes) : null,
    },
    warnings,
  };
}

// ─── Évolution dans le temps ────────────────────────────────────────
export type Bucket = "day" | "week" | "month";
export function bucketFor(p: Period): Bucket {
  const days = (p.to.getTime() - p.from.getTime()) / 86_400_000;
  return days <= 31 ? "day" : days <= 120 ? "week" : "month";
}

export interface SeriesPoint {
  key: string;
  label: string;
  realizedHt: number;
  forecastHt: number;
}

export function revenueSeries(input: Pick<FinanceInput, "period" | "now" | "zone" | "settings" | "appointments">): SeriesPoint[] {
  const bucket = bucketFor(input.period);
  const unit = bucket === "week" ? "week" : bucket;
  const points = new Map<string, SeriesPoint>();
  const fmt = (d: DateTime) => (bucket === "month" ? d.setLocale("fr").toFormat("LLL yy") : d.setLocale("fr").toFormat("d LLL"));
  let cur = DateTime.fromJSDate(input.period.from, { zone: input.zone }).startOf(unit);
  const end = DateTime.fromJSDate(input.period.to, { zone: input.zone });
  let guard = 0;
  while (cur < end && guard++ < 400) {
    const key = cur.toISODate()!;
    points.set(key, { key, label: fmt(cur), realizedHt: 0, forecastHt: 0 });
    cur = cur.plus({ [`${unit}s`]: 1 });
  }
  for (const a of input.appointments) {
    if (!within(a.startsAt, input.period)) continue;
    const key = DateTime.fromISO(a.startsAt, { zone: input.zone }).startOf(unit).toISODate()!;
    const pt = points.get(key);
    if (!pt) continue;
    const ht = sum(a.items.map((i) => itemHt(i, input.settings.vatStatus)));
    if (a.status === "completed") pt.realizedHt += ht;
    else if ((a.status === "confirmed" || a.status === "pending") && new Date(a.startsAt) >= input.now) pt.forecastHt += ht;
  }
  return [...points.values()];
}

// ─── Rentabilité par prestation ─────────────────────────────────────
export const MIN_OBSERVATIONS = 5;

export interface ServiceProfit {
  key: string;
  name: string;
  count: number;
  revenueHt: number;
  avgPriceTtc: number;
  avgConsumables: number;
  avgTravelCost: number;
  avgPaymentFees: number;
  margin: number;
  avgMinutes: number;
  marginPerHour: number | null;
  enoughData: boolean;
}

/**
 * Chaque rendez-vous réalisé est réparti entre ses prestations au prorata de
 * leur HT (coûts de trajet et frais de paiement) et de leur durée (temps mobilisé).
 */
export function serviceProfitability(appointments: FinAppointment[], payments: FinPayment[], vat: VatStatus): ServiceProfit[] {
  const feesByAppt = new Map<string, number>();
  for (const p of payments) if (p.status === "succeeded" && p.appointmentId && p.feeCents) feesByAppt.set(p.appointmentId, (feesByAppt.get(p.appointmentId) ?? 0) + p.feeCents);
  const acc = new Map<string, { name: string; count: number; ht: number; ttc: number; cons: number; travel: number; fees: number; minutes: number }>();
  for (const a of appointments.filter((x) => x.status === "completed")) {
    const services = a.items.filter((i) => i.kind === "service");
    if (services.length === 0) continue;
    const totalHt = sum(services.map((i) => itemHt(i, vat)));
    const totalDur = sum(services.map((i) => i.durationMinutes)) || services.length;
    const t = a.travel;
    const travelCost = t ? (t.energyCostCents ?? 0) + (t.otherCostCents ?? 0) + (t.wearCostCents ?? 0) : 0;
    // Les frais de déplacement facturés réduisent le coût net du trajet.
    const travelFeeHt = sum(a.items.filter((i) => i.kind === "travel_fee").map((i) => itemHt(i, vat)));
    const fees = feesByAppt.get(a.id) ?? 0;
    const minutes = mobilizedMinutes(a);
    for (const i of services) {
      const key = i.serviceId ?? `nom:${i.serviceName}`;
      const share = totalHt > 0 ? itemHt(i, vat) / totalHt : 1 / services.length;
      const timeShare = (i.durationMinutes || 1) / totalDur;
      const g = acc.get(key) ?? { name: i.serviceName, count: 0, ht: 0, ttc: 0, cons: 0, travel: 0, fees: 0, minutes: 0 };
      g.count += 1;
      g.ht += itemHt(i, vat) + travelFeeHt * share;
      g.ttc += itemTtc(i);
      g.cons += i.consumablesCents + i.productsCents + i.otherCostsCents;
      g.travel += travelCost * share;
      g.fees += fees * share;
      g.minutes += minutes * timeShare;
      acc.set(key, g);
    }
  }
  return [...acc.entries()]
    .map(([key, g]) => {
      const margin = Math.round(g.ht - g.cons - g.travel - g.fees);
      return {
        key,
        name: g.name,
        count: g.count,
        revenueHt: Math.round(g.ht),
        avgPriceTtc: Math.round(g.ttc / g.count),
        avgConsumables: Math.round(g.cons / g.count),
        avgTravelCost: Math.round(g.travel / g.count),
        avgPaymentFees: Math.round(g.fees / g.count),
        margin,
        avgMinutes: Math.round(g.minutes / g.count),
        marginPerHour: g.minutes > 0 ? Math.round((margin * 60) / g.minutes) : null,
        enoughData: g.count >= MIN_OBSERVATIONS,
      };
    })
    .sort((a, b) => b.margin - a.margin);
}

export interface Rankings {
  mostProfitable: ServiceProfit[];
  leastProfitable: ServiceProfit[];
  mostRequested: ServiceProfit[];
  mostTimeConsuming: ServiceProfit[];
}
/** Classements fondés uniquement sur les prestations ayant au moins MIN_OBSERVATIONS réalisations. */
export function rankServices(list: ServiceProfit[], top = 3): Rankings {
  const ok = list.filter((s) => s.enoughData && s.marginPerHour !== null);
  const by = (f: (s: ServiceProfit) => number, dir: 1 | -1) => [...ok].sort((a, b) => dir * (f(b) - f(a))).slice(0, top);
  return {
    mostProfitable: by((s) => s.marginPerHour!, 1),
    leastProfitable: by((s) => s.marginPerHour!, -1),
    mostRequested: by((s) => s.count, 1),
    mostTimeConsuming: by((s) => s.avgMinutes, 1),
  };
}

// ─── Fiche cliente ──────────────────────────────────────────────────
export interface CustomerStats {
  completedCount: number;
  revenueTtc: number;
  avgBasketTtc: number | null;
  lastVisit: string | null;
  avgDaysBetweenVisits: number | null;
  estimatedMargin: number;
  upcomingCount: number;
}

/** Les arrhes payées ne sont pas des prestations : seul le prix des rendez-vous terminés compte. */
export function customerStats(appointments: FinAppointment[], vat: VatStatus, now: Date): CustomerStats {
  const done = appointments.filter((a) => a.status === "completed").sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const revenueTtc = sum(done.map((a) => sum(a.items.map(itemTtc))));
  const margin = sum(
    done.map((a) => {
      const t = a.travel;
      return (
        sum(a.items.map((i) => itemHt(i, vat) - i.consumablesCents - i.productsCents - i.otherCostsCents)) -
        (t ? (t.energyCostCents ?? 0) + (t.otherCostCents ?? 0) + (t.wearCostCents ?? 0) : 0)
      );
    }),
  );
  let gaps: number | null = null;
  if (done.length >= 2) {
    const first = new Date(done[0].startsAt).getTime();
    const last = new Date(done[done.length - 1].startsAt).getTime();
    gaps = Math.round((last - first) / 86_400_000 / (done.length - 1));
  }
  return {
    completedCount: done.length,
    revenueTtc,
    avgBasketTtc: done.length ? Math.round(revenueTtc / done.length) : null,
    lastVisit: done.length ? done[done.length - 1].startsAt : null,
    avgDaysBetweenVisits: gaps,
    estimatedMargin: margin,
    upcomingCount: appointments.filter((a) => (a.status === "confirmed" || a.status === "pending") && new Date(a.startsAt) >= now).length,
  };
}

// ─── Objectifs ──────────────────────────────────────────────────────
export interface Goals {
  monthlyRevenueCents: number | null;
  monthlyDisposableIncomeCents: number | null;
  monthlyAppointments: number | null;
  hourlyMarginCents: number | null;
}

export interface GoalLine {
  key: "revenue" | "disposable" | "appointments" | "hourly";
  target: number;
  realized: number;
  projected: number;
  gap: number;
  progress: number;
}

export function goalProgress(goals: Goals, month: FinanceSummary): GoalLine[] {
  const lines: GoalLine[] = [];
  const add = (key: GoalLine["key"], target: number | null, realized: number, projected: number) => {
    if (target === null || target <= 0) return;
    lines.push({ key, target, realized, projected, gap: projected - target, progress: Math.min(1, Math.max(0, realized / target)) });
  };
  add("revenue", goals.monthlyRevenueCents, month.revenue.realized.ht, month.revenue.realized.ht + month.revenue.forecast.ht);
  add("disposable", goals.monthlyDisposableIncomeCents, month.results.disposableIncome, month.results.disposableIncome);
  add("appointments", goals.monthlyAppointments, month.revenue.realizedCount, month.revenue.realizedCount + month.revenue.forecastCount);
  add("hourly", goals.hourlyMarginCents, month.results.hourlyMargin ?? 0, month.results.hourlyMargin ?? 0);
  return lines;
}

export interface Simulation {
  ok: boolean;
  reason?: "no_goal" | "reached" | "not_enough_data";
  remainingCents?: number;
  avgRevenueHt?: number;
  avgMargin?: number;
  observations: number;
  additionalAppointments?: number;
}

/**
 * « Combien de prestations supplémentaires pour atteindre mon objectif de CA ? »
 * Hypothèse : le CA HT moyen par rendez-vous réalisé des 90 derniers jours
 * se maintient. Résultat indicatif, aucune garantie.
 */
export function simulateAdditional(goalCents: number | null, projectedHt: number, history: FinAppointment[], vat: VatStatus): Simulation {
  const done = history.filter((a) => a.status === "completed");
  if (!goalCents || goalCents <= 0) return { ok: false, reason: "no_goal", observations: done.length };
  const remaining = goalCents - projectedHt;
  if (remaining <= 0) return { ok: false, reason: "reached", remainingCents: 0, observations: done.length };
  if (done.length < MIN_OBSERVATIONS) return { ok: false, reason: "not_enough_data", remainingCents: remaining, observations: done.length };
  const avg = Math.round(sum(done.map((a) => sum(a.items.map((i) => itemHt(i, vat))))) / done.length);
  if (avg <= 0) return { ok: false, reason: "not_enough_data", remainingCents: remaining, observations: done.length };
  return { ok: true, remainingCents: remaining, avgRevenueHt: avg, observations: done.length, additionalAppointments: Math.ceil(remaining / avg) };
}

// ─── Périodes du tableau de bord ────────────────────────────────────
export type PeriodKey = "today" | "week" | "month" | "quarter" | "year" | "custom";

export function periodFor(key: PeriodKey, now: Date, zone: string, custom?: { from: string; to: string }): Period {
  const n = DateTime.fromJSDate(now, { zone });
  const range = (a: DateTime, b: DateTime) => ({ from: a.toJSDate(), to: b.toJSDate() });
  switch (key) {
    case "today":
      return range(n.startOf("day"), n.startOf("day").plus({ days: 1 }));
    case "week":
      return range(n.startOf("week"), n.startOf("week").plus({ weeks: 1 }));
    case "quarter":
      return range(n.startOf("quarter"), n.startOf("quarter").plus({ quarters: 1 }));
    case "year":
      return range(n.startOf("year"), n.startOf("year").plus({ years: 1 }));
    case "custom": {
      const a = custom ? DateTime.fromISO(custom.from, { zone }).startOf("day") : n.startOf("month");
      const b = custom ? DateTime.fromISO(custom.to, { zone }).startOf("day").plus({ days: 1 }) : n.endOf("month");
      if (!a.isValid || !b.isValid || b <= a || b.diff(a, "days").days > 366 * 3) return range(n.startOf("month"), n.startOf("month").plus({ months: 1 }));
      return range(a, b);
    }
    default:
      return range(n.startOf("month"), n.startOf("month").plus({ months: 1 }));
  }
}
