import { parseEurosToCents } from "@/lib/domain/pricing";

/** Formulaires financiers : lecture stricte, montants en centimes, taux en points de base (1 % = 100). */

type Form = Record<string, string | undefined>;
type Result<T> = { ok: true; data: T } | { ok: false; errors: Record<string, string> };

const t = (f: Form, k: string) => (f[k] ?? "").trim();
const one = <T extends string>(v: string, allowed: readonly T[]): T | null => (allowed.includes(v as T) ? (v as T) : null);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** « 21,2 » → 2120 points de base. Vide → 0. */
export function parsePercentToBps(v: string): number {
  const s = v.trim().replace(",", ".").replace("%", "").trim();
  if (!s) return 0;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return Number.NaN;
  const n = Math.round(Number(s) * 100);
  return n > 10000 ? Number.NaN : n;
}
export const bpsToInput = (bps: number) => (bps / 100).toString().replace(".", ",");

function money(v: string, { min = 0, max = 100_000_000, required = false } = {}): number | null {
  const c = v ? parseEurosToCents(v) : null;
  if (c === null) return required ? Number.NaN : null;
  return Number.isNaN(c) || c < min || c > max ? Number.NaN : c;
}

export const REGIMES = ["not_set", "micro_bic_services", "micro_bnc", "micro_bic_sales", "ei_real", "company", "other"] as const;
export const VAT_STATUSES = ["not_set", "franchise", "liable"] as const;
export const BASES = ["revenue", "profit"] as const;
export const DEPOSIT_KINDS = ["arrhes", "acompte"] as const;
export const EXPENSE_CATEGORIES = ["rent", "insurance", "software", "phone", "subscription", "bank", "other"] as const;
export const FREQUENCIES = ["monthly", "quarterly", "yearly"] as const;
export const MANUAL_METHODS = ["cash", "card_terminal", "transfer", "check", "other"] as const;
export const REFUND_REASONS = ["customer_request", "cancellation", "duplicate", "other"] as const;
export const ADJUSTMENT_KINDS = ["revenue", "collection", "expense", "fee"] as const;

export interface FinancialSettingsInput {
  activity_regime: (typeof REGIMES)[number];
  vat_status: (typeof VAT_STATUSES)[number];
  contribution_rate_bps: number;
  contribution_base: (typeof BASES)[number];
  tax_provision_rate_bps: number;
  tax_provision_base: (typeof BASES)[number];
  deposit_kind: (typeof DEPOSIT_KINDS)[number];
  deposit_terms: string | null;
}

export function parseFinancialSettings(f: Form): Result<FinancialSettingsInput> {
  const errors: Record<string, string> = {};
  const regime = one(t(f, "activity_regime"), REGIMES);
  const vat = one(t(f, "vat_status"), VAT_STATUSES);
  const cb = one(t(f, "contribution_base"), BASES);
  const tb = one(t(f, "tax_provision_base"), BASES);
  const dk = one(t(f, "deposit_kind"), DEPOSIT_KINDS);
  const cr = parsePercentToBps(t(f, "contribution_rate"));
  const tr = parsePercentToBps(t(f, "tax_provision_rate"));
  const terms = t(f, "deposit_terms");
  if (!regime) errors.activity_regime = "Choisissez un régime.";
  if (!vat) errors.vat_status = "Choisissez un statut de TVA.";
  if (!cb) errors.contribution_base = "Choisissez une base.";
  if (!tb) errors.tax_provision_base = "Choisissez une base.";
  if (!dk) errors.deposit_kind = "Choisissez arrhes ou acompte.";
  if (Number.isNaN(cr)) errors.contribution_rate = "Taux entre 0 et 100 %, deux décimales au plus.";
  if (Number.isNaN(tr)) errors.tax_provision_rate = "Taux entre 0 et 100 %, deux décimales au plus.";
  if (terms.length > 2000) errors.deposit_terms = "2 000 caractères au plus.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    data: { activity_regime: regime!, vat_status: vat!, contribution_rate_bps: cr, contribution_base: cb!, tax_provision_rate_bps: tr, tax_provision_base: tb!, deposit_kind: dk!, deposit_terms: terms || null },
  };
}

export interface ExpenseInput {
  label: string;
  category: (typeof EXPENSE_CATEGORIES)[number];
  amount_cents: number;
  frequency: (typeof FREQUENCIES)[number];
  starts_on: string;
  ends_on: string | null;
}

export function parseExpense(f: Form): Result<ExpenseInput> {
  const errors: Record<string, string> = {};
  const label = t(f, "label");
  const category = one(t(f, "category"), EXPENSE_CATEGORIES);
  const frequency = one(t(f, "frequency"), FREQUENCIES);
  const amount = money(t(f, "amount"), { min: 1, max: 10_000_000, required: true });
  const starts = t(f, "starts_on");
  const ends = t(f, "ends_on");
  if (label.length < 1 || label.length > 80) errors.label = "Nom de 1 à 80 caractères.";
  if (!category) errors.category = "Choisissez une catégorie.";
  if (!frequency) errors.frequency = "Choisissez une fréquence.";
  if (amount === null || Number.isNaN(amount)) errors.amount = "Montant entre 0,01 € et 100 000 €.";
  if (!DATE.test(starts)) errors.starts_on = "Date de début requise.";
  if (ends && (!DATE.test(ends) || ends < starts)) errors.ends_on = "La date de fin doit suivre la date de début.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, data: { label, category: category!, amount_cents: amount!, frequency: frequency!, starts_on: starts, ends_on: ends || null } };
}

export interface GoalsInput {
  monthly_revenue_cents: number | null;
  monthly_disposable_income_cents: number | null;
  monthly_appointments: number | null;
  hourly_margin_cents: number | null;
}

export function parseGoals(f: Form): Result<GoalsInput> {
  const errors: Record<string, string> = {};
  const rev = money(t(f, "monthly_revenue"));
  const disp = money(t(f, "monthly_disposable_income"));
  const hourly = money(t(f, "hourly_margin"), { max: 1_000_000 });
  const apptRaw = t(f, "monthly_appointments");
  const appt = apptRaw ? (/^\d{1,5}$/.test(apptRaw) && Number(apptRaw) <= 10000 ? Number(apptRaw) : Number.NaN) : null;
  if (Number.isNaN(rev)) errors.monthly_revenue = "Montant invalide.";
  if (Number.isNaN(disp)) errors.monthly_disposable_income = "Montant invalide.";
  if (Number.isNaN(hourly)) errors.hourly_margin = "Montant invalide.";
  if (Number.isNaN(appt)) errors.monthly_appointments = "Nombre entier entre 0 et 10 000.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, data: { monthly_revenue_cents: rev, monthly_disposable_income_cents: disp, monthly_appointments: appt, hourly_margin_cents: hourly } };
}

export interface ManualPaymentInput {
  appointment_id: string;
  amount_cents: number;
  method: (typeof MANUAL_METHODS)[number];
  kind: "deposit" | "balance" | "other";
  received_at: string;
  note: string;
  confirmed: boolean;
  idempotency_key: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseManualPayment(f: Form): Result<ManualPaymentInput> {
  const errors: Record<string, string> = {};
  const amount = money(t(f, "amount"), { min: 1, required: true });
  const method = one(t(f, "method"), MANUAL_METHODS);
  const kind = one(t(f, "kind") || "balance", ["deposit", "balance", "other"] as const);
  const received = t(f, "received_on");
  if (!UUID.test(t(f, "appointment_id")) || !UUID.test(t(f, "idempotency_key"))) errors.form = "Formulaire invalide.";
  if (amount === null || Number.isNaN(amount)) errors.amount = "Montant invalide.";
  if (!method) errors.method = "Choisissez un moyen de paiement.";
  if (!kind) errors.kind = "Type invalide.";
  if (!DATE.test(received)) errors.received_on = "Date requise.";
  if (t(f, "note").length > 500) errors.note = "500 caractères au plus.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    data: {
      appointment_id: t(f, "appointment_id"),
      amount_cents: amount!,
      method: method!,
      kind: kind!,
      received_at: `${received}T12:00:00`,
      note: t(f, "note"),
      confirmed: f.confirmed === "on",
      idempotency_key: t(f, "idempotency_key"),
    },
  };
}

export function parseRefund(f: Form): Result<{ payment_id: string; amount_cents: number; reason: (typeof REFUND_REASONS)[number]; note: string }> {
  const errors: Record<string, string> = {};
  const amount = money(t(f, "amount"), { min: 1, required: true });
  const reason = one(t(f, "reason"), REFUND_REASONS);
  if (!UUID.test(t(f, "payment_id"))) errors.form = "Formulaire invalide.";
  if (amount === null || Number.isNaN(amount)) errors.amount = "Montant invalide.";
  if (!reason) errors.reason = "Choisissez un motif.";
  if (f.confirm !== "on") errors.confirm = "Cochez la case pour confirmer le remboursement.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, data: { payment_id: t(f, "payment_id"), amount_cents: amount!, reason: reason!, note: t(f, "note").slice(0, 500) } };
}

export function parseAdjustment(f: Form): Result<{ kind: (typeof ADJUSTMENT_KINDS)[number]; amount_cents: number; occurred_on: string; reason: string; payment_id: string | null; appointment_id: string | null }> {
  const errors: Record<string, string> = {};
  const kind = one(t(f, "kind"), ADJUSTMENT_KINDS);
  const raw = t(f, "amount");
  const amount = raw ? parseEurosToCents(raw) : null;
  const reason = t(f, "reason");
  const date = t(f, "occurred_on");
  if (!kind) errors.kind = "Choisissez un type.";
  if (amount === null || Number.isNaN(amount) || amount === 0 || Math.abs(amount) > 100_000_000) errors.amount = "Montant non nul (négatif pour une diminution).";
  if (reason.length < 3 || reason.length > 500) errors.reason = "Motif de 3 à 500 caractères (obligatoire pour la traçabilité).";
  if (!DATE.test(date)) errors.occurred_on = "Date requise.";
  const pid = t(f, "payment_id");
  const aid = t(f, "appointment_id");
  if ((pid && !UUID.test(pid)) || (aid && !UUID.test(aid))) errors.form = "Formulaire invalide.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, data: { kind: kind!, amount_cents: amount!, occurred_on: date, reason, payment_id: pid || null, appointment_id: aid || null } };
}
