"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBusinessContext } from "@/server/services/business-context";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import { archiveExpense, getPaymentAccount, saveExpense, updateFinancialSettings, updateGoals } from "@/server/repositories/finance";
import { createOnboardingLink, dashboardLoginLink, executeRefund, reconcileAll, refreshAccount } from "@/server/payments/service";
import { readStripeConfig, requestOrigin } from "@/server/payments/stripe";
import { travelSecret } from "@/server/travel/service";
import { parseAdjustment, parseExpense, parseFinancialSettings, parseGoals, parseManualPayment, parseRefund } from "@/lib/validation/finance";
import { withValues, type FormState } from "@/lib/validation/auth";

/**
 * Actions financières : propriétaire uniquement (contrôle ici, RLS et fonctions
 * sécurisées en base). Le registre des paiements n'est jamais écrit directement.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_OWNER = "Seule la propriétaire du compte peut gérer les finances.";

function form(fd: FormData): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") o[k] = v;
  return o;
}

async function owner() {
  const ctx = await requireBusinessContext();
  if (ctx.role !== "business_owner") return null;
  return { ctx, supabase: await createSupabaseServerClient() };
}

const refresh = (extra?: string) => {
  revalidatePath("/finances", "layout");
  revalidatePath("/parametres", "layout");
  if (extra) revalidatePath(extra);
};

const DB_MESSAGES: Record<string, string> = {
  MOKA_AMOUNT_TOO_HIGH: "Le montant dépasse le reste à encaisser pour ce rendez-vous.",
  MOKA_REFUND_TOO_HIGH: "Le montant dépasse ce qui reste remboursable sur ce paiement.",
  MOKA_PAYMENT_NOT_PENDING: "Ce règlement n'est plus en attente de validation.",
  MOKA_PAYMENT_NOT_REFUNDABLE: "Ce paiement ne peut pas être remboursé.",
  MOKA_APPOINTMENT_CANCELLED: "Rendez-vous annulé : enregistrez plutôt un règlement de type « autre ».",
  MOKA_NOT_FOUND: "Élément introuvable.",
  MOKA_INVALID_INPUT: "Certaines informations sont invalides.",
};
const dbMessage = (e: { message?: string } | null) => DB_MESSAGES[e?.message?.match(/MOKA_[A-Z_]+/)?.[0] ?? ""] ?? "Enregistrement impossible. Réessayez dans un instant.";

export async function saveFinancialSettingsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const o = await owner();
  if (!o) return { error: NOT_OWNER };
  const parsed = parseFinancialSettings(form(fd));
  if (!parsed.ok) return withValues({ error: "Certains champs sont à corriger.", fieldErrors: parsed.errors }, fd);
  try {
    await updateFinancialSettings(o.supabase, o.ctx.business.id, parsed.data);
  } catch (e) {
    console.error("[finances] paramètres", e);
    return withValues({ error: "Enregistrement impossible. Réessayez dans un instant." }, fd);
  }
  refresh();
  return { success: "Paramètres financiers enregistrés." };
}

export async function saveGoalsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const o = await owner();
  if (!o) return { error: NOT_OWNER };
  const parsed = parseGoals(form(fd));
  if (!parsed.ok) return withValues({ error: "Certains champs sont à corriger.", fieldErrors: parsed.errors }, fd);
  try {
    await updateGoals(o.supabase, o.ctx.business.id, parsed.data);
  } catch (e) {
    console.error("[finances] objectifs", e);
    return withValues({ error: "Enregistrement impossible." }, fd);
  }
  refresh();
  return { success: "Objectifs enregistrés." };
}

export async function saveExpenseAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const o = await owner();
  if (!o) return { error: NOT_OWNER };
  const id = (fd.get("id") as string) || null;
  if (id && !UUID.test(id)) return { error: "Charge introuvable." };
  const parsed = parseExpense(form(fd));
  if (!parsed.ok) return withValues({ error: "Certains champs sont à corriger.", fieldErrors: parsed.errors }, fd);
  try {
    await saveExpense(o.supabase, o.ctx.business.id, id, parsed.data);
  } catch (e) {
    console.error("[finances] charge", e);
    return withValues({ error: "Enregistrement impossible." }, fd);
  }
  refresh();
  return { success: id ? "Charge modifiée." : "Charge ajoutée." };
}

export async function archiveExpenseAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const o = await owner();
  const id = fd.get("id") as string;
  if (!o) return { error: NOT_OWNER };
  if (!UUID.test(id)) return { error: "Charge introuvable." };
  await archiveExpense(o.supabase, o.ctx.business.id, id);
  refresh();
  return { success: "Charge arrêtée : elle reste comptée sur les périodes passées." };
}

// ─── Règlements ─────────────────────────────────────────────────────
export async function recordManualPaymentAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const o = await owner();
  if (!o) return { error: NOT_OWNER };
  const parsed = parseManualPayment(form(fd));
  if (!parsed.ok) return withValues({ error: parsed.errors.form ?? "Certains champs sont à corriger.", fieldErrors: parsed.errors }, fd);
  const { error } = await o.supabase.rpc("record_manual_payment", { p: parsed.data });
  if (error) return withValues({ error: dbMessage(error) }, fd);
  refresh(`/agenda/${parsed.data.appointment_id}`);
  return { success: parsed.data.confirmed ? "Règlement enregistré comme encaissé." : "Règlement enregistré : à valider quand vous l'aurez reçu." };
}

export async function validatePaymentAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const o = await owner();
  if (!o) return { error: NOT_OWNER };
  const id = fd.get("payment_id") as string;
  const validate = fd.get("decision") === "validate";
  if (!UUID.test(id)) return { error: "Règlement introuvable." };
  const { error } = await o.supabase.rpc("validate_manual_payment", { p_id: id, p_validate: validate, p_reason: validate ? null : "Annulé par la professionnelle" });
  if (error) return { error: dbMessage(error) };
  refresh(typeof fd.get("appointment_id") === "string" ? `/agenda/${fd.get("appointment_id")}` : undefined);
  return { success: validate ? "Encaissement validé." : "Règlement annulé." };
}

export async function refundAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const o = await owner();
  if (!o) return { error: NOT_OWNER };
  const parsed = parseRefund(form(fd));
  if (!parsed.ok) return withValues({ error: parsed.errors.confirm ?? parsed.errors.form ?? "Certains champs sont à corriger.", fieldErrors: parsed.errors }, fd);
  const { data, error } = await o.supabase.rpc("request_refund", { p_payment: parsed.data.payment_id, p_amount: parsed.data.amount_cents, p_reason: parsed.data.reason, p_note: parsed.data.note || null });
  if (error) return withValues({ error: dbMessage(error) }, fd);
  const r = data as { refund_id: string; online: boolean; payment_intent_id: string | null; stripe_account_id: string | null; amount_cents: number };
  refresh(typeof fd.get("appointment_id") === "string" ? `/agenda/${fd.get("appointment_id")}` : undefined);
  if (!r.online) return { success: "Remboursement enregistré (hors Stripe)." };
  if (!r.payment_intent_id || !r.stripe_account_id) return { error: "Paiement Stripe incomplet : remboursement à faire depuis Stripe." };
  const res = await executeRefund({ refundId: r.refund_id, paymentIntentId: r.payment_intent_id, accountId: r.stripe_account_id, amountCents: r.amount_cents, reason: parsed.data.reason });
  if (!res.ok) return { error: `Stripe n'a pas accepté le remboursement pour l'instant (${res.error}). La demande est conservée et sera relancée automatiquement.` };
  return { success: res.status === "succeeded" ? "Remboursement effectué par Stripe." : "Remboursement transmis à Stripe : il apparaîtra comme effectué dès sa confirmation." };
}

export async function addAdjustmentAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const o = await owner();
  if (!o) return { error: NOT_OWNER };
  const parsed = parseAdjustment(form(fd));
  if (!parsed.ok) return withValues({ error: "Certains champs sont à corriger.", fieldErrors: parsed.errors }, fd);
  const { error } = await o.supabase.from("financial_adjustments").insert({ business_id: o.ctx.business.id, created_by: o.ctx.userId, ...parsed.data });
  if (error) return withValues({ error: "Enregistrement impossible." }, fd);
  refresh();
  return { success: "Écriture d'ajustement enregistrée (elle ne peut plus être modifiée : pour l'annuler, saisissez l'écriture inverse)." };
}

// ─── Stripe Connect ─────────────────────────────────────────────────
export async function connectStripeAction(): Promise<FormState> {
  const o = await owner();
  if (!o) return { error: NOT_OWNER };
  if (!readStripeConfig()) return { error: "Le paiement en ligne n'est pas encore configuré sur le serveur (clé Stripe manquante, voir le guide d'installation)." };
  if (!travelSecret()) return { error: "La clé de signature serveur (TRAVEL_SIGNING_SECRET) est manquante." };
  let url: string;
  try {
    const account = await getPaymentAccount(o.supabase, o.ctx.business.id);
    url = await createOnboardingLink({ businessId: o.ctx.business.id, businessName: o.ctx.business.name, email: o.ctx.userEmail, existingAccountId: account?.stripe_account_id ?? null, origin: await requestOrigin() });
  } catch (e) {
    console.error("[stripe] onboarding", { message: (e as Error).message?.slice(0, 160) });
    return { error: "Stripe n'a pas pu ouvrir l'inscription. Réessayez dans quelques minutes." };
  }
  redirect(url);
}

export async function refreshStripeAction(): Promise<FormState> {
  const o = await owner();
  if (!o) return { error: NOT_OWNER };
  const account = await getPaymentAccount(o.supabase, o.ctx.business.id);
  if (!account) return { error: "Aucun compte Stripe relié." };
  try {
    await refreshAccount(account.stripe_account_id);
    const r = await reconcileAll(account.stripe_account_id);
    refresh();
    return { success: `Statut mis à jour. ${r.sessionsChecked} paiement(s) vérifié(s) chez Stripe${r.confirmed ? `, ${r.confirmed} confirmé(s)` : ""}${r.refundsRetried ? `, ${r.refundsRetried} remboursement(s) relancé(s)` : ""}.` };
  } catch (e) {
    console.error("[stripe] actualisation", { message: (e as Error).message?.slice(0, 160) });
    return { error: "Stripe est momentanément injoignable. Réessayez plus tard." };
  }
}

export async function stripeDashboardAction(): Promise<FormState> {
  const o = await owner();
  if (!o) return { error: NOT_OWNER };
  const account = await getPaymentAccount(o.supabase, o.ctx.business.id);
  if (!account) return { error: "Aucun compte Stripe relié." };
  const url = (await dashboardLoginLink(account.stripe_account_id)) ?? "https://dashboard.stripe.com/";
  redirect(url);
}
