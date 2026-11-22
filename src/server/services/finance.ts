import "server-only";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { requireBusinessContext } from "@/server/services/business-context";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import {
  customerStats,
  goalProgress,
  periodFor,
  rankServices,
  revenueSeries,
  serviceProfitability,
  simulateAdditional,
  summarize,
  itemHt,
  itemTtc,
  type Period,
  type PeriodKey,
} from "@/lib/domain/finance";
import {
  getFinancialSettings,
  getGoals,
  listExpenses,
  listFinAppointments,
  listLedger,
  serviceCategories,
  toFinSettings,
} from "@/server/repositories/finance";

/** Finances : réservées à la propriétaire (contrôle ici + RLS en base). */
export async function requireFinanceOwner() {
  const ctx = await requireBusinessContext();
  if (ctx.role !== "business_owner") notFound();
  return { ctx, supabase: await createSupabaseServerClient(), zone: ctx.settings?.timezone ?? "Europe/Paris" };
}

const PERIOD_KEYS: PeriodKey[] = ["today", "week", "month", "quarter", "year", "custom"];
export function readPeriod(sp: Record<string, string | string[] | undefined>, zone: string, now = new Date()) {
  const key = PERIOD_KEYS.includes(sp.periode as PeriodKey) ? (sp.periode as PeriodKey) : "month";
  const from = typeof sp.du === "string" ? sp.du : "";
  const to = typeof sp.au === "string" ? sp.au : "";
  const period = periodFor(key, now, zone, key === "custom" && from && to ? { from, to } : undefined);
  return { key, period, from, to };
}

export function periodLabel(p: Period, zone: string) {
  const f = DateTime.fromJSDate(p.from, { zone }).setLocale("fr");
  const t = DateTime.fromJSDate(new Date(p.to.getTime() - 1), { zone }).setLocale("fr");
  return f.hasSame(t, "day") ? f.toFormat("d LLLL yyyy") : `${f.toFormat("d LLL yyyy")} – ${t.toFormat("d LLL yyyy")}`;
}

async function base(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, businessId: string) {
  const [settingsRow, ledger, expenses, categories, goals] = await Promise.all([
    getFinancialSettings(supabase, businessId),
    listLedger(supabase, businessId),
    listExpenses(supabase, businessId),
    serviceCategories(supabase, businessId),
    getGoals(supabase, businessId),
  ]);
  return { settingsRow, settings: toFinSettings(settingsRow), ledger, expenses, categories, goals };
}

export async function loadDashboard(sp: Record<string, string | string[] | undefined>) {
  const { ctx, supabase, zone } = await requireFinanceOwner();
  const now = new Date();
  const sel = readPeriod(sp, zone, now);
  const b = await base(supabase, ctx.business.id);
  const appointments = await listFinAppointments(supabase, ctx.business.id, sel.period);
  const input = { period: sel.period, now, zone, settings: b.settings, appointments, ...b.ledger, expenses: b.expenses, categories: b.categories };
  return { ctx, sel, label: periodLabel(sel.period, zone), summary: summarize(input), series: revenueSeries(input), settingsRow: b.settingsRow, goals: b.goals };
}

export async function loadGoals() {
  const { ctx, supabase, zone } = await requireFinanceOwner();
  const now = new Date();
  const month = periodFor("month", now, zone);
  const b = await base(supabase, ctx.business.id);
  const [appointments, history] = await Promise.all([
    listFinAppointments(supabase, ctx.business.id, month),
    listFinAppointments(supabase, ctx.business.id, { from: new Date(now.getTime() - 90 * 86_400_000), to: now }),
  ]);
  const summary = summarize({ period: month, now, zone, settings: b.settings, appointments, ...b.ledger, expenses: b.expenses, categories: b.categories });
  const lines = goalProgress(b.goals, summary);
  const sim = simulateAdditional(b.goals.monthlyRevenueCents, summary.revenue.realized.ht + summary.revenue.forecast.ht, history, b.settings.vatStatus);
  return { ctx, goals: b.goals, lines, sim, summary, monthLabel: periodLabel(month, zone) };
}

export async function loadProfitability(sp: Record<string, string | string[] | undefined>) {
  const { ctx, supabase, zone } = await requireFinanceOwner();
  const sel = readPeriod({ periode: "year", ...sp }, zone);
  const b = await base(supabase, ctx.business.id);
  const appointments = await listFinAppointments(supabase, ctx.business.id, sel.period);
  const list = serviceProfitability(appointments, b.ledger.payments, b.settings.vatStatus);
  return { ctx, sel, label: periodLabel(sel.period, zone), list, rankings: rankServices(list) };
}

export async function loadCustomerFinance(customerId: string) {
  const ctx = await requireBusinessContext();
  if (ctx.role !== "business_owner") return null;
  const supabase = await createSupabaseServerClient();
  const settings = toFinSettings(await getFinancialSettings(supabase, ctx.business.id));
  const all = await listFinAppointments(supabase, ctx.business.id, { from: new Date("2000-01-01"), to: new Date("2100-01-01") }, customerId);
  return customerStats(all, settings.vatStatus, new Date());
}

// ─── Exports CSV ────────────────────────────────────────────────────
export const EXPORT_KINDS = ["prestations", "encaissements", "remboursements", "charges", "deplacements", "synthese"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

const METHOD: Record<string, string> = { card_online: "Carte en ligne (Stripe)", card_terminal: "Carte (terminal)", cash: "Espèces", transfer: "Virement", check: "Chèque", other: "Autre" };
const STATUS: Record<string, string> = { pending: "À valider", succeeded: "Encaissé", cancelled: "Annulé", failed: "Échoué", requested: "Demandé", canceled: "Annulé" };
const euros = (c: number) => (c / 100).toFixed(2).replace(".", ",");
const pct = (bps: number) => `${(bps / 100).toString().replace(".", ",")} %`;

/** Cellule CSV : séparateur « ; », guillemets doublés, neutralisation des formules (=, +, -, @). */
export function csvCell(v: string | number | null | undefined): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(,\d+)?$/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (rows: (string | number | null)[][]) => "﻿" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n") + "\r\n";

export async function buildExport(kind: ExportKind, sp: Record<string, string | string[] | undefined>): Promise<{ filename: string; csv: string }> {
  const { ctx, supabase, zone } = await requireFinanceOwner();
  const sel = readPeriod(sp, zone);
  const p = sel.period;
  const d = (iso: string | null) => (iso ? DateTime.fromISO(iso, { zone }).toFormat("dd/MM/yyyy") : "");
  const stamp = `${DateTime.fromJSDate(p.from, { zone }).toISODate()}_${DateTime.fromJSDate(new Date(p.to.getTime() - 1), { zone }).toISODate()}`;
  const b = await base(supabase, ctx.business.id);
  const vat = b.settings.vatStatus;
  const ref = (id: string | null) => (id ? id.slice(0, 8).toUpperCase() : "");
  const header = ["Date", "Cliente ou référence", "Prestation", "Montant (€)", "TVA applicable", "Moyen de paiement", "Statut", "Identifiant de transaction"];

  if (kind === "prestations" || kind === "deplacements" || kind === "synthese") {
    const appts = await listFinAppointments(supabase, ctx.business.id, p);
    const { data: customers } = await supabase.from("customers").select("id, first_name, last_name").eq("business_id", ctx.business.id);
    const name = new Map((customers ?? []).map((c) => [c.id, `${c.first_name} ${c.last_name ?? ""}`.trim()]));
    if (kind === "prestations") {
      const rows = appts
        .filter((a) => a.status === "completed")
        .flatMap((a) =>
          a.items.map((i) => [d(a.startsAt), name.get(a.customerId ?? "") || ref(a.id), i.serviceName, euros(itemTtc(i)), vat === "franchise" ? "TVA non applicable (franchise)" : pct(i.vatRateBps), "", "Terminé", `RDV-${ref(a.id)}`, euros(itemHt(i, vat))]),
        );
      return { filename: `prestations_${stamp}.csv`, csv: toCsv([[...header.map((h) => (h === "Montant (€)" ? "Montant TTC (€)" : h)), "Montant HT (€)"], ...rows]) };
    }
    if (kind === "deplacements") {
      const rows = appts
        .filter((a) => a.status === "completed" && a.place === "home")
        .map((a) => {
          const fee = a.items.filter((i) => i.kind === "travel_fee").reduce((s, i) => s + itemTtc(i), 0);
          const t = a.travel;
          return [d(a.startsAt), name.get(a.customerId ?? "") || ref(a.id), "Frais de déplacement", euros(fee), vat === "franchise" ? "TVA non applicable (franchise)" : "", "", "Terminé", `RDV-${ref(a.id)}`, t ? (t.distanceMeters / 1000).toFixed(1).replace(".", ",") : "", t ? t.durationMinutes : "", t ? euros((t.energyCostCents ?? 0) + (t.otherCostCents ?? 0)) : "", t ? euros(t.wearCostCents ?? 0) : ""];
        });
      return { filename: `frais-deplacement_${stamp}.csv`, csv: toCsv([[...header, "Distance (km)", "Durée (min)", "Coût décaissé estimé (€)", "Usure estimée (€)"], ...rows]) };
    }
    // Synthèse mensuelle
    const rows: (string | number)[][] = [];
    let cur = DateTime.fromJSDate(p.from, { zone }).startOf("month");
    const end = DateTime.fromJSDate(p.to, { zone });
    while (cur < end) {
      const mp = { from: cur.toJSDate(), to: cur.plus({ months: 1 }).toJSDate() };
      const monthAppts = appts.filter((a) => new Date(a.startsAt) >= mp.from && new Date(a.startsAt) < mp.to);
      const s = summarize({ period: mp, now: new Date(), zone, settings: b.settings, appointments: monthAppts, ...b.ledger, expenses: b.expenses, categories: b.categories });
      rows.push([cur.setLocale("fr").toFormat("LLLL yyyy"), s.revenue.realizedCount, euros(s.revenue.realized.ht), euros(s.revenue.realized.vat), euros(s.revenue.realized.ttc), euros(s.collections.net), euros(s.collections.refunds), euros(s.collections.stripeFees), euros(s.costs.cashTotal), euros(s.costs.vehicleWearEstimated), euros(s.costs.fixed), euros(s.results.contributionMargin), euros(s.results.operatingResult), euros(s.results.contributions), euros(s.results.disposableIncome)]);
      cur = cur.plus({ months: 1 });
    }
    return {
      filename: `synthese-mensuelle_${stamp}.csv`,
      csv: toCsv([["Mois", "RDV réalisés", "CA HT réalisé", "TVA collectée", "CA TTC réalisé", "Encaissé net", "Remboursements", "Frais Stripe", "Charges variables décaissées", "Usure véhicule (estimée)", "Charges fixes (proratisées)", "Marge contributive (estimée)", "Résultat d'exploitation (estimé)", "Cotisations (estimées)", "Revenu disponible (estimé)"], ...rows]),
    };
  }

  if (kind === "charges") {
    const rows = b.expenses.map((e) => [d(e.startsOn), "", e.label, euros(e.amountCents), "", "", e.archivedAt ? "Archivée" : "Active", ""]);
    return { filename: `charges-fixes_${stamp}.csv`, csv: toCsv([[...header, "Fréquence", "Fin"], ...rows.map((r, k) => [...r, b.expenses[k].frequency === "monthly" ? "Mensuelle" : b.expenses[k].frequency === "quarterly" ? "Trimestrielle" : "Annuelle", d(b.expenses[k].endsOn)])]) };
  }

  // Encaissements / remboursements : registre, avec cliente et prestation.
  const { data, error } = await supabase
    .from("payments")
    .select("id, kind, method, status, amount_cents, fee_cents, received_at, stripe_payment_intent_id, appointment_id, appointments(customers(first_name, last_name), appointment_items(service_name, kind, vat_rate_bps)), refunds(id, amount_cents, status, reason, stripe_refund_id, processed_at, created_at)")
    .eq("business_id", ctx.business.id)
    .order("received_at");
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list = (data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const who = (x: any) => (x.appointments?.customers ? `${x.appointments.customers.first_name} ${x.appointments.customers.last_name ?? ""}`.trim() : ref(x.appointment_id ?? x.id));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const what = (x: any) => (x.appointments?.appointment_items ?? []).filter((i: any) => i.kind === "service").map((i: any) => i.service_name).join(" + ");
  const inP = (iso: string | null) => Boolean(iso) && new Date(iso!) >= p.from && new Date(iso!) < p.to;
  if (kind === "encaissements") {
    const rows = list
      .filter((x) => inP(x.received_at))
      .map((x) => [d(x.received_at), who(x), what(x), euros(x.amount_cents), vat === "franchise" ? "TVA non applicable (franchise)" : "Selon prestation", METHOD[x.method] ?? x.method, STATUS[x.status] ?? x.status, x.stripe_payment_intent_id ?? `PAY-${ref(x.id)}`, x.kind === "deposit" ? "Arrhes / acompte" : x.kind === "balance" ? "Solde" : "Autre", x.fee_cents != null ? euros(x.fee_cents) : ""]);
    return { filename: `encaissements_${stamp}.csv`, csv: toCsv([[...header, "Type", "Frais Stripe (€)"], ...rows]) };
  }
  const rows = list.flatMap((x) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (x.refunds ?? []).filter((r: any) => inP(r.processed_at ?? r.created_at)).map((r: any) => [d(r.processed_at ?? r.created_at), who(x), what(x), euros(r.amount_cents), "", METHOD[x.method] ?? x.method, STATUS[r.status] ?? r.status, r.stripe_refund_id ?? `REM-${ref(r.id)}`, r.reason]),
  );
  return { filename: `remboursements_${stamp}.csv`, csv: toCsv([[...header, "Motif"], ...rows]) };
}

/** Montant HT d'une ligne (utilisé par les exports et les fiches). */
export { itemHt };
