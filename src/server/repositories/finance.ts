import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  FinAdjustment,
  FinAppointment,
  FinPayment,
  FinPayout,
  FinRefund,
  FinSettings,
  FixedExpense,
  Goals,
  Period,
} from "@/lib/domain/finance";
import type { ExpenseInput, FinancialSettingsInput, GoalsInput } from "@/lib/validation/finance";

/**
 * Lectures financières (client de l'utilisatrice : RLS « propriétaire »
 * appliquée par la base). Aucune clé service_role.
 * Pagination par 1 000 lignes (limite PostgREST).
 */

async function all<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < 50; page++) {
    const { data, error } = await query(page * 1000, page * 1000 + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export interface FinancialSettingsRow extends FinancialSettingsInput {
  business_id: string;
  version: number;
}

export async function getFinancialSettings(supabase: SupabaseClient, businessId: string): Promise<FinancialSettingsRow | null> {
  const { data, error } = await supabase.from("financial_settings").select("*").eq("business_id", businessId).maybeSingle();
  if (error) throw error;
  return data as FinancialSettingsRow | null;
}

export const toFinSettings = (r: FinancialSettingsRow | null): FinSettings => ({
  vatStatus: r?.vat_status ?? "not_set",
  contributionRateBps: r?.contribution_rate_bps ?? 0,
  contributionBase: r?.contribution_base ?? "revenue",
  taxProvisionRateBps: r?.tax_provision_rate_bps ?? 0,
  taxProvisionBase: r?.tax_provision_base ?? "revenue",
});

export async function updateFinancialSettings(supabase: SupabaseClient, businessId: string, d: FinancialSettingsInput) {
  const { error } = await supabase.from("financial_settings").update(d).eq("business_id", businessId);
  if (error) throw error;
}

export async function getGoals(supabase: SupabaseClient, businessId: string): Promise<Goals> {
  const { data, error } = await supabase.from("financial_goals").select("*").eq("business_id", businessId).maybeSingle();
  if (error) throw error;
  return {
    monthlyRevenueCents: data?.monthly_revenue_cents ?? null,
    monthlyDisposableIncomeCents: data?.monthly_disposable_income_cents ?? null,
    monthlyAppointments: data?.monthly_appointments ?? null,
    hourlyMarginCents: data?.hourly_margin_cents ?? null,
  };
}

export async function updateGoals(supabase: SupabaseClient, businessId: string, d: GoalsInput) {
  const { error } = await supabase.from("financial_goals").update(d).eq("business_id", businessId);
  if (error) throw error;
}

export async function listExpenses(supabase: SupabaseClient, businessId: string, { includeArchived = true } = {}): Promise<FixedExpense[]> {
  let q = supabase.from("fixed_expenses").select("*").eq("business_id", businessId).order("created_at");
  if (!includeArchived) q = q.is("archived_at", null);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((e) => ({
    id: e.id,
    label: e.label,
    category: e.category,
    amountCents: e.amount_cents,
    frequency: e.frequency,
    startsOn: e.starts_on,
    endsOn: e.ends_on,
    archivedAt: e.archived_at,
  }));
}

export async function saveExpense(supabase: SupabaseClient, businessId: string, id: string | null, d: ExpenseInput) {
  const { error } = id
    ? await supabase.from("fixed_expenses").update(d).eq("business_id", businessId).eq("id", id)
    : await supabase.from("fixed_expenses").insert({ business_id: businessId, ...d });
  if (error) throw error;
}

/** Une charge passée est archivée (elle reste dans les périodes antérieures), jamais effacée. */
export async function archiveExpense(supabase: SupabaseClient, businessId: string, id: string) {
  const { error } = await supabase.from("fixed_expenses").update({ archived_at: new Date().toISOString() }).eq("business_id", businessId).eq("id", id);
  if (error) throw error;
}

// ─── Rendez-vous (instantanés figés) ────────────────────────────────
const APPT_COLUMNS =
  "id, starts_at, status, place, customer_id, duration_minutes, prep_minutes, cleanup_minutes, buffer_minutes, price_total_cents, " +
  "appointment_items(service_id, service_name, kind, unit_price_cents, extra_fee_cents, vat_rate_bps, duration_minutes, consumables_cents, products_cents, other_costs_cents, position), " +
  "appointment_travel(duration_minutes, distance_meters, energy_cost_cents, wear_cost_cents, time_cost_cents, other_cost_cents, vehicle_snapshot)";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toFinAppointment(r: any): FinAppointment {
  const t = Array.isArray(r.appointment_travel) ? r.appointment_travel[0] : r.appointment_travel;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = [...(r.appointment_items ?? [])].sort((a: any, b: any) => a.position - b.position);
  return {
    id: r.id,
    startsAt: r.starts_at,
    status: r.status,
    place: r.place,
    customerId: r.customer_id,
    durationMinutes: r.duration_minutes,
    prepMinutes: r.prep_minutes,
    cleanupMinutes: r.cleanup_minutes,
    bufferMinutes: r.buffer_minutes,
    priceTotalCents: r.price_total_cents,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items: items.map((i: any) => ({
      serviceId: i.service_id,
      serviceName: i.service_name,
      kind: i.kind ?? "service",
      unitPriceCents: i.unit_price_cents,
      extraFeeCents: i.extra_fee_cents ?? 0,
      vatRateBps: i.vat_rate_bps ?? 0,
      durationMinutes: i.duration_minutes ?? 0,
      consumablesCents: i.consumables_cents ?? 0,
      productsCents: i.products_cents ?? 0,
      otherCostsCents: i.other_costs_cents ?? 0,
    })),
    travel:
      t && t.duration_minutes != null
        ? {
            durationMinutes: t.duration_minutes,
            distanceMeters: t.distance_meters ?? 0,
            energyCostCents: t.energy_cost_cents,
            wearCostCents: t.wear_cost_cents,
            timeCostCents: t.time_cost_cents,
            otherCostCents: t.other_cost_cents,
            allIn: t.vehicle_snapshot?.all_in_cost_per_km_millis != null,
          }
        : null,
  };
}

export async function listFinAppointments(supabase: SupabaseClient, businessId: string, period: Period, customerId?: string): Promise<FinAppointment[]> {
  const rows = await all((a, b) => {
    let q = supabase.from("appointments").select(APPT_COLUMNS).eq("business_id", businessId).gte("starts_at", period.from.toISOString()).lt("starts_at", period.to.toISOString());
    if (customerId) q = q.eq("customer_id", customerId);
    return q.order("starts_at").range(a, b);
  });
  return rows.map(toFinAppointment);
}

// ─── Registre ───────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toPayment = (p: any): FinPayment => ({ id: p.id, appointmentId: p.appointment_id, kind: p.kind, method: p.method, status: p.status, amountCents: p.amount_cents, feeCents: p.fee_cents, receivedAt: p.received_at });

export async function listLedger(supabase: SupabaseClient, businessId: string) {
  const [payments, refunds, payouts, adjustments] = await Promise.all([
    all((a, b) => supabase.from("payments").select("id, appointment_id, kind, method, status, amount_cents, fee_cents, received_at").eq("business_id", businessId).order("received_at").range(a, b)),
    all((a, b) => supabase.from("refunds").select("payment_id, amount_cents, status, processed_at, created_at").eq("business_id", businessId).order("created_at").range(a, b)),
    all((a, b) => supabase.from("payouts").select("amount_cents, status, arrival_date").eq("business_id", businessId).order("created_at").range(a, b)),
    all((a, b) => supabase.from("financial_adjustments").select("kind, amount_cents, occurred_on").eq("business_id", businessId).order("occurred_on").range(a, b)),
  ]);
  return {
    payments: payments.map(toPayment),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    refunds: refunds.map((r: any): FinRefund => ({ paymentId: r.payment_id, amountCents: r.amount_cents, status: r.status, processedAt: r.processed_at, createdAt: r.created_at })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payouts: payouts.map((p: any): FinPayout => ({ amountCents: p.amount_cents, status: p.status, arrivalDate: p.arrival_date })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    adjustments: adjustments.map((x: any): FinAdjustment => ({ kind: x.kind, amountCents: x.amount_cents, occurredOn: x.occurred_on })),
  };
}

export async function serviceCategories(supabase: SupabaseClient, businessId: string): Promise<Record<string, string>> {
  const { data, error } = await supabase.from("services").select("id, service_categories(name)").eq("business_id", businessId);
  if (error) throw error;
  const out: Record<string, string> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of (data ?? []) as any[]) {
    const c = Array.isArray(s.service_categories) ? s.service_categories[0] : s.service_categories;
    if (c?.name) out[s.id] = c.name;
  }
  return out;
}

// ─── Paiements d'un rendez-vous (fiche) ─────────────────────────────
export interface PaymentRow {
  id: string;
  kind: "deposit" | "balance" | "other";
  method: string;
  status: "pending" | "succeeded" | "cancelled" | "failed";
  amount_cents: number;
  fee_cents: number | null;
  received_at: string;
  note: string | null;
  stripe_payment_intent_id: string | null;
  cancel_reason: string | null;
  refunds: { id: string; amount_cents: number; status: string; reason: string; created_at: string; failure_reason: string | null }[];
}

export async function listAppointmentPayments(supabase: SupabaseClient, businessId: string, appointmentId: string): Promise<PaymentRow[]> {
  const { data, error } = await supabase
    .from("payments")
    .select("id, kind, method, status, amount_cents, fee_cents, received_at, note, stripe_payment_intent_id, cancel_reason, refunds(id, amount_cents, status, reason, created_at, failure_reason)")
    .eq("business_id", businessId)
    .eq("appointment_id", appointmentId)
    .order("received_at");
  if (error) throw error;
  return (data ?? []) as unknown as PaymentRow[];
}

export interface PaymentHistoryRow extends PaymentRow {
  appointment_id: string | null;
  appointments: { starts_at: string; customers: { first_name: string; last_name: string } | null; appointment_items: { service_name: string; kind: string }[] } | null;
  stripe_checkout_session_id: string | null;
}

export async function listPaymentHistory(supabase: SupabaseClient, businessId: string, period: Period, limit = 200): Promise<PaymentHistoryRow[]> {
  const { data, error } = await supabase
    .from("payments")
    .select(
      "id, kind, method, status, amount_cents, fee_cents, received_at, note, stripe_payment_intent_id, stripe_checkout_session_id, cancel_reason, appointment_id, " +
        "refunds(id, amount_cents, status, reason, created_at, failure_reason), appointments(starts_at, customers(first_name, last_name), appointment_items(service_name, kind))",
    )
    .eq("business_id", businessId)
    .gte("received_at", period.from.toISOString())
    .lt("received_at", period.to.toISOString())
    .order("received_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as PaymentHistoryRow[];
}

export async function listPendingPayments(supabase: SupabaseClient, businessId: string): Promise<PaymentHistoryRow[]> {
  const { data, error } = await supabase
    .from("payments")
    .select("id, kind, method, status, amount_cents, fee_cents, received_at, note, stripe_payment_intent_id, stripe_checkout_session_id, cancel_reason, appointment_id, refunds(id, amount_cents, status, reason, created_at, failure_reason), appointments(starts_at, customers(first_name, last_name), appointment_items(service_name, kind))")
    .eq("business_id", businessId)
    .eq("status", "pending")
    .order("received_at");
  if (error) throw error;
  return (data ?? []) as unknown as PaymentHistoryRow[];
}

export interface PaymentAccount {
  stripe_account_id: string;
  livemode: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  requirements_due: string[];
  disabled_reason: string | null;
  updated_at: string;
}

export async function getPaymentAccount(supabase: SupabaseClient, businessId: string): Promise<PaymentAccount | null> {
  const { data, error } = await supabase.from("payment_accounts").select("stripe_account_id, livemode, charges_enabled, payouts_enabled, details_submitted, requirements_due, disabled_reason, updated_at").eq("business_id", businessId).maybeSingle();
  if (error) throw error;
  return data as PaymentAccount | null;
}

export async function listDisputes(supabase: SupabaseClient, businessId: string) {
  const { data, error } = await supabase.from("payment_disputes").select("id, payment_id, amount_cents, status, reason, evidence_due_by, created_at").eq("business_id", businessId).order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  return data ?? [];
}

export async function listPaymentEvents(supabase: SupabaseClient, businessId: string, limit = 30) {
  const { data, error } = await supabase.from("payment_events").select("id, type, status, outcome, attempts, last_error, received_at").eq("business_id", businessId).order("received_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function listAdjustments(supabase: SupabaseClient, businessId: string, limit = 100) {
  const { data, error } = await supabase.from("financial_adjustments").select("id, kind, amount_cents, occurred_on, reason, created_at, payment_id, appointment_id").eq("business_id", businessId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}
