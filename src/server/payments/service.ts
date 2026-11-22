import "server-only";
import type Stripe from "stripe";
import { createSupabasePublicClient } from "@/server/integrations/supabase/public";
import { travelSecret } from "@/server/travel/service";
import { decryptToken, signedPaymentOp, type PaymentOp } from "@/server/payments/signing";
import { readStripeConfig, stripeClient } from "@/server/payments/stripe";
import { dispatchNotifications, type QueuedNotification } from "@/server/services/public-booking";
import { sendEmail } from "@/server/notifications/mailer";
import { formatEuros } from "@/lib/domain/pricing";

/**
 * Orchestration Stripe Connect (paiement direct sur le compte de la professionnelle).
 * Toute écriture dans le registre passe par public.server_payment_op, signée avec
 * la clé serveur : la base refuse toute opération non signée.
 * Un paiement n'est JAMAIS confirmé depuis le retour du navigateur : uniquement
 * depuis un événement Stripe vérifié (webhook) ou une lecture directe de l'API
 * Stripe par le serveur (réconciliation).
 */

export class PaymentError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}

export async function paymentOp<T = Record<string, unknown>>(op: PaymentOp, payload: Record<string, unknown>): Promise<T> {
  const secret = travelSecret();
  const supabase = createSupabasePublicClient();
  if (!secret || !supabase) throw new PaymentError("NOT_CONFIGURED");
  const { data, error } = await supabase.rpc("server_payment_op", signedPaymentOp(op, payload, secret));
  if (error) throw new PaymentError(error.message?.match(/MOKA_[A-Z_]+/)?.[0] ?? "DB_ERROR", error.message);
  return data as T;
}

const epoch = (d?: number | null) => (typeof d === "number" ? d : null);

function stripeOrThrow() {
  const s = stripeClient();
  if (!s) throw new PaymentError("NOT_CONFIGURED");
  return s;
}

// ─── Onboarding du compte de la professionnelle ─────────────────────
export async function createOnboardingLink(input: { businessId: string; businessName: string; email: string | null; existingAccountId: string | null; origin: string }): Promise<string> {
  const stripe = stripeOrThrow();
  let accountId = input.existingAccountId;
  if (!accountId) {
    // Compte « propriétaire » : la professionnelle vend, paie les frais Stripe,
    // dispose du tableau de bord Stripe complet ; Stripe porte les pertes.
    const account = await stripe.accounts.create(
      {
        country: "FR",
        email: input.email ?? undefined,
        controller: {
          fees: { payer: "account" },
          losses: { payments: "stripe" },
          stripe_dashboard: { type: "full" },
          requirement_collection: "stripe",
        },
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        business_profile: { name: input.businessName.slice(0, 100) },
        metadata: { moka_business_id: input.businessId },
      },
      { idempotencyKey: `moka-account-${input.businessId}` },
    );
    accountId = account.id;
    await paymentOp("account_link", { business_id: input.businessId, stripe_account_id: accountId, livemode: readStripeConfig()?.livemode ?? false });
    await syncAccount(account);
  }
  const link = await stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${input.origin}/parametres/paiements?stripe=relancer`,
    return_url: `${input.origin}/parametres/paiements?stripe=retour`,
  });
  return link.url;
}

export async function syncAccount(account: Stripe.Account, eventAt?: number) {
  return paymentOp("account_sync", {
    stripe_account_id: account.id,
    charges_enabled: account.charges_enabled ?? false,
    payouts_enabled: account.payouts_enabled ?? false,
    details_submitted: account.details_submitted ?? false,
    requirements_due: [...(account.requirements?.currently_due ?? []), ...(account.requirements?.past_due ?? [])].slice(0, 30),
    disabled_reason: account.requirements?.disabled_reason ?? null,
    country: account.country ?? null,
    default_currency: account.default_currency ?? null,
    event_at: eventAt ?? null,
  });
}

export async function refreshAccount(accountId: string) {
  const account = await stripeOrThrow().accounts.retrieve(accountId);
  await syncAccount(account);
  return account;
}

export async function dashboardLoginLink(accountId: string): Promise<string | null> {
  try {
    return (await stripeOrThrow().accounts.createLoginLink(accountId)).url;
  } catch {
    return null; // comptes au tableau de bord complet : connexion directe sur dashboard.stripe.com
  }
}

// ─── Paiement des arrhes (Stripe Checkout) ──────────────────────────
export interface HoldResult {
  hold_id: string;
  deposit_cents: number;
  total_cents: number;
  service_name: string;
  stripe_account_id: string;
  deposit_kind: "arrhes" | "acompte";
  customer_email: string;
  checkout_session_id: string | null;
  expires_at: string;
}

export const DEPOSIT_LABEL = { arrhes: "Arrhes", acompte: "Acompte" } as const;

export async function createDepositCheckout(hold: HoldResult, input: { slug: string; origin: string; businessName: string }): Promise<string> {
  const stripe = stripeOrThrow();
  const back = `${input.origin}/reserver/${encodeURIComponent(input.slug)}/paiement/${hold.hold_id}`;
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      locale: "fr",
      allowed_payment_method_types: ["card"],
      customer_email: hold.customer_email,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: hold.deposit_cents,
            product_data: { name: `${DEPOSIT_LABEL[hold.deposit_kind]} — ${hold.service_name}`.slice(0, 250), description: `Total de la prestation : ${formatEuros(hold.total_cents)}. ${input.businessName}`.slice(0, 500) },
          },
        },
      ],
      metadata: { moka_hold_id: hold.hold_id },
      payment_intent_data: { metadata: { moka_hold_id: hold.hold_id }, description: `${DEPOSIT_LABEL[hold.deposit_kind]} ${hold.service_name}`.slice(0, 200) },
      success_url: `${back}?retour=ok`,
      cancel_url: `${back}?retour=annule`,
    },
    { stripeAccount: hold.stripe_account_id, idempotencyKey: `moka-hold-${hold.hold_id}` },
  );
  const attached = await paymentOp<{ ok: boolean }>("checkout_attach", { hold_id: hold.hold_id, session_id: session.id });
  if (!attached.ok) throw new PaymentError("HOLD_CLOSED");
  if (!session.url) throw new PaymentError("NO_URL");
  return session.url;
}

/** Reprise d'un paiement interrompu : même session Stripe tant qu'elle est ouverte. */
export async function resumeCheckoutUrl(sessionId: string, accountId: string): Promise<string | null> {
  const s = await stripeOrThrow().checkout.sessions.retrieve(sessionId, {}, { stripeAccount: accountId });
  return s.status === "open" ? s.url : null;
}

/** Abandon volontaire : la session Stripe est expirée AVANT de libérer le créneau. */
export async function abandonCheckout(holdId: string, sessionId: string | null, accountId: string | null): Promise<boolean> {
  if (sessionId && accountId) {
    try {
      const s = await stripeOrThrow().checkout.sessions.expire(sessionId, {}, { stripeAccount: accountId });
      if (s.status !== "expired") return false;
    } catch (e) {
      const s = await stripeOrThrow().checkout.sessions.retrieve(sessionId, {}, { stripeAccount: accountId }).catch(() => null);
      if (!s || s.status !== "expired") {
        console.error("[paiement] expiration de session impossible", { code: (e as { code?: string }).code });
        return false;
      }
    }
  }
  return Boolean((await paymentOp<{ ok: boolean }>("hold_cancel", { hold_id: holdId })).ok);
}

// ─── Traitement d'une session payée (webhook ou réconciliation) ─────
async function feeOf(paymentIntentId: string, accountId: string) {
  try {
    const pi = await stripeOrThrow().paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge.balance_transaction"] }, { stripeAccount: accountId });
    const charge = pi.latest_charge as Stripe.Charge | null;
    const bt = charge?.balance_transaction as Stripe.BalanceTransaction | null;
    return { charge_id: charge?.id ?? null, fee_cents: bt?.fee ?? null, balance_transaction_id: bt?.id ?? null, available_on: bt?.available_on ?? null };
  } catch {
    return { charge_id: null, fee_cents: null, balance_transaction_id: null, available_on: null };
  }
}

export interface CompletedOutcome {
  outcome: "confirmed" | "already" | "refund_required" | "ignored";
  appointment_id?: string;
  notifications?: QueuedNotification[];
  enc_token?: string;
  token_hash?: string;
  refund_id?: string;
  amount_cents?: number;
  payment_intent_id?: string;
  stripe_account_id?: string;
  customer_email?: string | null;
  error?: string;
}

export async function processPaidSession(session: Stripe.Checkout.Session, accountId: string, livemode: boolean): Promise<CompletedOutcome> {
  if (session.payment_status !== "paid" || session.mode !== "payment") return { outcome: "ignored" };
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!pi) return { outcome: "ignored" };
  const fee = await feeOf(pi, accountId);
  const r = await paymentOp<CompletedOutcome>("checkout_completed", {
    session_id: session.id,
    payment_intent_id: pi,
    amount_cents: session.amount_total,
    currency: session.currency,
    account: accountId,
    livemode,
    paid_epoch: session.created,
    ...fee,
  });
  if (r.outcome === "confirmed" && r.notifications?.length && r.token_hash) {
    const token = decryptToken(r.enc_token, travelSecret() ?? "");
    const supabase = createSupabasePublicClient();
    if (token && supabase) await dispatchNotifications(supabase, token, r.token_hash, r.notifications).catch((e) => console.error("[paiement] emails", e));
  }
  if (r.outcome === "refund_required" && r.refund_id) {
    await executeRefund({ refundId: r.refund_id, paymentIntentId: pi, accountId, amountCents: r.amount_cents ?? session.amount_total ?? 0, reason: "slot_unavailable" });
    if (r.customer_email) {
      await sendEmail({
        to: r.customer_email,
        subject: "Votre réservation n'a pas pu être confirmée — remboursement en cours",
        text: `Bonjour,\n\nLe créneau choisi n'était plus disponible au moment de la confirmation de votre paiement. Aucun rendez-vous n'a été créé et la totalité de votre paiement (${formatEuros(r.amount_cents ?? 0)}) est en cours de remboursement sur votre carte. Le délai d'apparition dépend de votre banque (souvent 5 à 10 jours).\n\nVous pouvez choisir un autre créneau sur la page de réservation.\n`,
        html: `<p>Bonjour,</p><p>Le créneau choisi n'était plus disponible au moment de la confirmation de votre paiement. <strong>Aucun rendez-vous n'a été créé</strong> et la totalité de votre paiement (${formatEuros(r.amount_cents ?? 0)}) est en cours de remboursement sur votre carte. Le délai d'apparition dépend de votre banque (souvent 5 à 10 jours).</p><p>Vous pouvez choisir un autre créneau sur la page de réservation.</p>`,
      }).catch(() => null);
    }
  }
  return r;
}

// ─── Remboursements ─────────────────────────────────────────────────
const STRIPE_REASON: Record<string, Stripe.RefundCreateParams.Reason | undefined> = { duplicate: "duplicate", customer_request: "requested_by_customer", cancellation: "requested_by_customer" };

export async function executeRefund(r: { refundId: string; paymentIntentId: string; accountId: string; amountCents: number; reason: string }) {
  try {
    const refund = await stripeOrThrow().refunds.create(
      { payment_intent: r.paymentIntentId, amount: r.amountCents, reason: STRIPE_REASON[r.reason], metadata: { moka_refund_id: r.refundId } },
      { stripeAccount: r.accountId, idempotencyKey: `moka-refund-${r.refundId}` },
    );
    await paymentOp("refund_sync", { refund_row_id: r.refundId, stripe_refund_id: refund.id, payment_intent_id: r.paymentIntentId, amount_cents: refund.amount, status: refund.status, failure_reason: refund.failure_reason ?? null });
    return { ok: true as const, status: refund.status };
  } catch (e) {
    const msg = (e as { message?: string }).message?.slice(0, 180) ?? "Erreur Stripe";
    console.error("[paiement] remboursement", { code: (e as { code?: string }).code });
    // La demande reste « demandée » : elle sera retentée par la réconciliation.
    return { ok: false as const, error: msg };
  }
}

// ─── Webhook ────────────────────────────────────────────────────────
export function verifyWebhook(rawBody: string, signature: string | null): Stripe.Event {
  const cfg = readStripeConfig();
  const stripe = stripeClient(cfg);
  if (!cfg || !stripe || !cfg.webhookSecret) throw new PaymentError("NOT_CONFIGURED");
  if (!signature) throw new PaymentError("BAD_SIGNATURE");
  try {
    return stripe.webhooks.constructEvent(rawBody, signature, cfg.webhookSecret);
  } catch {
    throw new PaymentError("BAD_SIGNATURE");
  }
}

const HANDLED = new Set([
  "checkout.session.completed",
  "checkout.session.expired",
  "checkout.session.async_payment_succeeded",
  "account.updated",
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "payout.created",
  "payout.updated",
  "payout.paid",
  "payout.failed",
  "payout.canceled",
]);

/** Traite un événement vérifié. Renvoie le résultat ; lève une erreur pour que Stripe réessaie. */
export async function handleEvent(event: Stripe.Event): Promise<string> {
  const account = event.account ?? null;
  const begin = await paymentOp<{ duplicate: boolean }>("event_begin", { id: event.id, type: event.type, account, livemode: event.livemode, created: event.created });
  if (begin.duplicate) return "duplicate";
  if (!HANDLED.has(event.type) || !account) {
    await paymentOp("event_finish", { id: event.id, status: "ignored", outcome: "type non traité" });
    return "ignored";
  }
  try {
    const outcome = await route(event, account);
    await paymentOp("event_finish", { id: event.id, status: "processed", outcome });
    return outcome;
  } catch (e) {
    const code = e instanceof PaymentError ? e.code : "ERROR";
    await paymentOp("event_finish", { id: event.id, status: "failed", error: code }).catch(() => null);
    throw e;
  }
}

async function route(event: Stripe.Event, account: string): Promise<string> {
  const at = event.created;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return (await processPaidSession(event.data.object as Stripe.Checkout.Session, account, event.livemode)).outcome;
    case "checkout.session.expired": {
      const r = await paymentOp<{ released: boolean }>("checkout_expired", { session_id: (event.data.object as Stripe.Checkout.Session).id });
      return r.released ? "hold_released" : "noop";
    }
    case "account.updated":
      await syncAccount(event.data.object as Stripe.Account, at);
      return "account_synced";
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const refunds = await stripeOrThrow().refunds.list({ charge: charge.id, limit: 100 }, { stripeAccount: account });
      for (const rf of refunds.data) await syncRefund(rf, at);
      return "refunds_synced";
    }
    case "refund.created":
    case "refund.updated":
      await syncRefund(event.data.object as Stripe.Refund, at);
      return "refund_synced";
    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed": {
      const d = event.data.object as Stripe.Dispute;
      await paymentOp("dispute_sync", {
        dispute_id: d.id,
        payment_intent_id: typeof d.payment_intent === "string" ? d.payment_intent : d.payment_intent?.id,
        amount_cents: d.amount,
        status: d.status,
        reason: d.reason,
        evidence_due_by: epoch(d.evidence_details?.due_by),
        event_at: at,
      });
      return "dispute_synced";
    }
    default: {
      const p = event.data.object as Stripe.Payout;
      await paymentOp("payout_sync", { payout_id: p.id, stripe_account_id: account, amount_cents: p.amount, currency: p.currency, status: p.status, arrival_epoch: epoch(p.arrival_date), event_at: at });
      return "payout_synced";
    }
  }
}

async function syncRefund(rf: Stripe.Refund, at?: number) {
  const pi = typeof rf.payment_intent === "string" ? rf.payment_intent : rf.payment_intent?.id;
  return paymentOp("refund_sync", {
    refund_row_id: typeof rf.metadata?.moka_refund_id === "string" && /^[0-9a-f-]{36}$/.test(rf.metadata.moka_refund_id) ? rf.metadata.moka_refund_id : null,
    stripe_refund_id: rf.id,
    payment_intent_id: pi,
    amount_cents: rf.amount,
    status: rf.status,
    failure_reason: rf.failure_reason ?? null,
    event_at: at ?? rf.created,
  });
}

// ─── Réconciliation (rattrapage d'un webhook perdu) ─────────────────
export interface ReconcileReport {
  sessionsChecked: number;
  confirmed: number;
  refunds: number;
  errors: number;
}

/**
 * Relit chez Stripe les sessions des dernières 48 h du compte et traite celles
 * qui sont payées (idempotent : une session déjà enregistrée est ignorée).
 */
export async function reconcileAccount(accountId: string, livemode: boolean): Promise<ReconcileReport> {
  const stripe = stripeOrThrow();
  const report: ReconcileReport = { sessionsChecked: 0, confirmed: 0, refunds: 0, errors: 0 };
  const since = Math.floor(Date.now() / 1000) - 48 * 3600;
  for await (const s of stripe.checkout.sessions.list({ created: { gte: since }, limit: 100 }, { stripeAccount: accountId })) {
    report.sessionsChecked++;
    if (report.sessionsChecked > 500) break;
    try {
      if (s.status === "expired") {
        await paymentOp("checkout_expired", { session_id: s.id });
      } else if (s.status === "complete" && s.payment_status === "paid") {
        const r = await processPaidSession(s, accountId, livemode);
        if (r.outcome === "confirmed") report.confirmed++;
        if (r.outcome === "refund_required") report.refunds++;
      }
    } catch {
      report.errors++;
    }
  }
  return report;
}

/** Réconciliation complète : comptes actifs (ou un seul) + remboursements demandés en attente. */
export async function reconcileAll(onlyAccount?: string): Promise<ReconcileReport & { accounts: number; refundsRetried: number }> {
  const t = await paymentOp<{ accounts: { stripe_account_id: string; livemode: boolean }[]; refunds: { id: string; payment_intent_id: string; stripe_account_id: string; amount_cents: number; reason: string }[] }>(
    "reconcile_targets",
    onlyAccount ? { stripe_account_id: onlyAccount } : {},
  );
  const total = { sessionsChecked: 0, confirmed: 0, refunds: 0, errors: 0, accounts: t.accounts.length, refundsRetried: 0 };
  for (const a of t.accounts.slice(0, 200)) {
    try {
      const r = await reconcileAccount(a.stripe_account_id, a.livemode);
      total.sessionsChecked += r.sessionsChecked;
      total.confirmed += r.confirmed;
      total.refunds += r.refunds;
      total.errors += r.errors;
    } catch {
      total.errors++;
    }
  }
  for (const r of t.refunds.slice(0, 200)) {
    const res = await executeRefund({ refundId: r.id, paymentIntentId: r.payment_intent_id, accountId: r.stripe_account_id, amountCents: r.amount_cents, reason: r.reason });
    if (res.ok) total.refundsRetried++;
    else total.errors++;
  }
  return total;
}
