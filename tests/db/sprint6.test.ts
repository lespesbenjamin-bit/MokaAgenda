/**
 * Sprint 6 — finances et arrhes Stripe : registre des paiements en lecture
 * seule, règlements validés explicitement, remboursements, réservation
 * temporaire + confirmation après paiement (webhook), doublons, retards,
 * paiement tardif, concurrence, isolation et permissions.
 *
 * Les événements Stripe sont SIMULÉS : charges utiles construites à la main
 * et signées comme le ferait le serveur après vérification Stripe.
 * Rôles réels (anon / authenticated), jamais service_role.
 */
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { as, connect, createUser } from "./helpers";
import { signedPaymentOp, type PaymentOp } from "@/server/payments/signing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

let db: Client;
let secret: string;
let ownerA: string, ownerB: string, staffA: string;
let bizA: string, bizB: string, slugA: string;
let svcDeposit: string, svcFree: string, customerA: string;
let dayStart: Date;
const ACCT = "acct_TestMokaA0001";

const one = async <T = Json>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0] as T;
const at = (hour: number, minute = 0, dayOffset = 0) => new Date(dayStart.getTime() + ((dayOffset * 24 + hour) * 60 + minute) * 60_000);
const tokenHash = () => createHash("sha256").update(randomBytes(32)).digest("hex");
const epoch = (d = new Date()) => Math.floor(d.getTime() / 1000);

async function op(name: PaymentOp, payload: Json, { signature, ts }: { signature?: string; ts?: number } = {}) {
  const s = signedPaymentOp(name, payload, secret, ts);
  return as(db, null, async () => (await db.query("select public.server_payment_op($1, $2, $3, $4) as r", [s.p_op, s.p_payload, s.p_ts, signature ?? s.p_signature])).rows[0].r as Json, { commit: true });
}

function booking(over: Json = {}) {
  return {
    slug: slugA,
    service_id: svcDeposit,
    place: "salon",
    starts_at: at(10).toISOString(),
    first_name: "Inès",
    last_name: "Test",
    email: `i.${randomUUID().slice(0, 8)}@exemple.fr`,
    phone: `06${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
    accept_terms: true,
    idempotency_key: randomUUID(),
    token_hash: tokenHash(),
    enc_token: "v1.test.test.test",
    ...over,
  };
}
const book = (p: Json, c: Client = db) => as(c, null, async () => (await c.query("select public.public_create_booking($1) as r", [JSON.stringify(p)])).rows[0].r as Json, { commit: true });
const pro = <T>(user: string, fn: () => Promise<T>) => as(db, user, fn, { commit: true });

let sessionSeq = 0;
async function holdWithSession(over: Json = {}): Promise<Json & { session: string; hold_id: string }> {
  const r = await book(booking(over));
  expect(r.payment_required).toBe(true);
  const session = `cs_test_${++sessionSeq}_${randomUUID().slice(0, 8)}`;
  expect((await op("checkout_attach", { hold_id: r.hold_id, session_id: session })).ok).toBe(true);
  return { ...r, session } as Json & { session: string; hold_id: string };
}
const completed = (session: string, amount: number, extra: Json = {}) =>
  op("checkout_completed", { session_id: session, payment_intent_id: `pi_${session}`, charge_id: `ch_${session}`, amount_cents: amount, currency: "eur", account: ACCT, livemode: false, fee_cents: 70, paid_epoch: epoch(), ...extra });

async function manualAppointment(start: Date, price = 6000) {
  const payload = {
    business_id: bizA, customer_id: customerA, place: "salon", starts_at: start.toISOString(), duration_minutes: 60,
    items: [{ service_id: svcFree, service_name: "Soin", duration_minutes: 60, catalog_price_cents: price, unit_price_cents: price, price_ht_cents: price }],
  };
  return pro(ownerA, async () => (await one<{ id: string }>("select public.create_appointment($1) as id", [JSON.stringify(payload)])).id);
}

beforeAll(async () => {
  db = await connect();
  secret = (await one<{ value: string }>("select value from private.app_secrets where name = 'travel_signing'")).value;
  ownerA = await createUser(db, "s6-a@example.fr");
  ownerB = await createUser(db, "s6-b@example.fr");
  staffA = await createUser(db, "s6-staff@example.fr");
  bizA = await as(db, ownerA, async () => (await one<{ id: string }>("select public.create_business('Institut Six', null, null, 'pro@six.fr') as id")).id, { commit: true });
  bizB = await as(db, ownerB, async () => (await one<{ id: string }>("select public.create_business('Autre Six') as id")).id, { commit: true });
  await db.query("insert into public.business_members (business_id, user_id, role) values ($1, $2, 'staff')", [bizA, staffA]);
  slugA = (await one<{ slug: string }>("select slug from public.businesses where id = $1", [bizA])).slug;
  dayStart = (await one<{ d: Date }>("select ((date_trunc('day', now() at time zone 'Europe/Paris') + interval '4 days') at time zone 'Europe/Paris') as d")).d;
  await pro(ownerA, async () => {
    await db.query("update public.business_settings set booking_enabled = true where business_id = $1", [bizA]);
    await db.query("select public.replace_availability_rules($1, $2)", [bizA, JSON.stringify([1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start_minute: 480, end_minute: 1200, place: null })))]);
    await db.query("insert into public.locations (business_id, kind, address_line1, postal_code, city) values ($1, 'salon', 'Institut', '31000', 'Toulouse')", [bizA]);
    svcDeposit = (await one<{ id: string }>("insert into public.services (business_id, name, duration_minutes, base_price_cents, deposit_type, deposit_value) values ($1, 'Soin visage', 60, 6000, 'percentage', 30) returning id", [bizA])).id;
    svcFree = (await one<{ id: string }>("insert into public.services (business_id, name, duration_minutes, base_price_cents) values ($1, 'Soin simple', 60, 6000) returning id", [bizA])).id;
    for (const s of [svcDeposit, svcFree]) await db.query("insert into public.service_locations (business_id, service_id, place) values ($1, $2, 'salon')", [bizA, s]);
    customerA = (await one<{ id: string }>("insert into public.customers (business_id, first_name) values ($1, 'Léa') returning id", [bizA])).id;
  });
});
afterAll(async () => db?.end());

describe("paramètres et permissions financières", () => {
  it("paramètres et objectifs créés automatiquement, modifiables par la propriétaire seulement", async () => {
    expect((await one("select vat_status, deposit_kind, contribution_rate_bps from public.financial_settings where business_id = $1", [bizA]))).toMatchObject({ vat_status: "not_set", deposit_kind: "arrhes", contribution_rate_bps: 0 });
    await pro(ownerA, () => db.query("update public.financial_settings set contribution_rate_bps = 2120, vat_status = 'franchise' where business_id = $1", [bizA]));
    await pro(staffA, () => db.query("update public.financial_settings set contribution_rate_bps = 1 where business_id = $1", [bizA]));
    await pro(ownerB, () => db.query("update public.financial_settings set contribution_rate_bps = 1 where business_id = $1", [bizA]));
    const s = await one("select contribution_rate_bps, version from public.financial_settings where business_id = $1", [bizA]);
    expect(s.contribution_rate_bps).toBe(2120);
    expect(s.version).toBe(2);
  });

  it("aucune donnée financière n'est lisible par une collaboratrice, une autre entreprise ou un visiteur", async () => {
    await pro(ownerA, () => db.query("insert into public.fixed_expenses (business_id, label, category, amount_cents, frequency) values ($1, 'Assurance RC Pro', 'insurance', 24000, 'yearly')", [bizA]));
    for (const t of ["financial_settings", "fixed_expenses", "financial_goals", "payments", "refunds", "payment_events", "payouts", "financial_adjustments"]) {
      expect((await as(db, staffA, () => db.query(`select 1 from public.${t} where business_id = $1`, [bizA]))).rowCount, t).toBe(0);
      expect((await as(db, ownerB, () => db.query(`select 1 from public.${t} where business_id = $1`, [bizA]))).rowCount, t).toBe(0);
      await expect(as(db, null, () => db.query(`select 1 from public.${t}`)), t).rejects.toThrow(/permission denied/);
    }
    expect((await as(db, ownerA, () => db.query("select 1 from public.fixed_expenses where business_id = $1", [bizA]))).rowCount).toBe(1);
  });

  it("l'application ne peut pas écrire directement dans le registre des paiements", async () => {
    await expect(as(db, ownerA, () => db.query("insert into public.payments (business_id, kind, method, status, amount_cents, validated_at) values ($1, 'other', 'cash', 'succeeded', 100, now())", [bizA]))).rejects.toThrow(/permission denied/);
    await expect(as(db, ownerA, () => db.query("insert into public.payment_accounts (business_id, stripe_account_id) values ($1, 'acct_fauxfaux1')", [bizA]))).rejects.toThrow(/permission denied/);
  });
});

describe("règlements saisis à la main", () => {
  let appt: string, pending: string;
  it("un règlement non validé n'est pas encaissé ; la validation explicite le compte", async () => {
    appt = await manualAppointment(at(9, 0, 1));
    pending = await pro(ownerA, async () => (await one<{ id: string }>("select public.record_manual_payment($1) as id", [JSON.stringify({ appointment_id: appt, amount_cents: 2000, method: "cash", kind: "balance" })])).id);
    expect((await one("select status, validated_at from public.payments where id = $1", [pending]))).toMatchObject({ status: "pending", validated_at: null });
    expect((await one("select payment_status from public.appointments where id = $1", [appt])).payment_status).toBe("unpaid");
    await pro(ownerA, () => db.query("select public.validate_manual_payment($1, true)", [pending]));
    expect((await one("select payment_status from public.appointments where id = $1", [appt])).payment_status).toBe("deposit_paid");
  });

  it("refuse un montant supérieur au reste dû, une autre entreprise et une collaboratrice", async () => {
    const tooMuch = { appointment_id: appt, amount_cents: 4001, method: "card_terminal" };
    await expect(pro(ownerA, () => db.query("select public.record_manual_payment($1)", [JSON.stringify(tooMuch)]))).rejects.toThrow("MOKA_AMOUNT_TOO_HIGH");
    await expect(pro(ownerB, () => db.query("select public.record_manual_payment($1)", [JSON.stringify({ ...tooMuch, amount_cents: 100 })]))).rejects.toThrow("MOKA_NOT_FOUND");
    await expect(pro(staffA, () => db.query("select public.record_manual_payment($1)", [JSON.stringify({ ...tooMuch, amount_cents: 100 })]))).rejects.toThrow("MOKA_NOT_FOUND");
    await expect(pro(ownerA, () => db.query("select public.record_manual_payment($1)", [JSON.stringify({ ...tooMuch, amount_cents: 100, method: "card_online" })]))).rejects.toThrow("MOKA_INVALID_INPUT");
  });

  it("solde réglé : statut « payé » ; la clé d'idempotence évite un double enregistrement", async () => {
    const key = randomUUID();
    const p = { appointment_id: appt, amount_cents: 4000, method: "transfer", confirmed: true, idempotency_key: key };
    const a = await pro(ownerA, async () => (await one<{ id: string }>("select public.record_manual_payment($1) as id", [JSON.stringify(p)])).id);
    const b = await pro(ownerA, async () => (await one<{ id: string }>("select public.record_manual_payment($1) as id", [JSON.stringify(p)])).id);
    expect(a).toBe(b);
    expect((await one("select payment_status from public.appointments where id = $1", [appt])).payment_status).toBe("paid");
  });

  it("un paiement passé ne peut être ni modifié ni supprimé, même par la base", async () => {
    await expect(db.query("update public.payments set amount_cents = 1 where id = $1", [pending])).rejects.toThrow("MOKA_LEDGER_IMMUTABLE");
    await expect(db.query("update public.payments set status = 'cancelled' where id = $1", [pending])).rejects.toThrow("MOKA_LEDGER_IMMUTABLE");
    await expect(db.query("delete from public.payments where id = $1", [pending])).rejects.toThrow("MOKA_LEDGER_IMMUTABLE");
    await expect(pro(ownerA, () => db.query("select public.validate_manual_payment($1, false, 'erreur')", [pending]))).rejects.toThrow("MOKA_PAYMENT_NOT_PENDING");
  });

  it("corrections par écritures d'ajustement traçables, sans modification possible", async () => {
    await pro(ownerA, () => db.query("insert into public.financial_adjustments (business_id, kind, amount_cents, occurred_on, payment_id, reason, created_by) values ($1, 'collection', -500, current_date, $2, 'Erreur de saisie corrigée', $3)", [bizA, pending, ownerA]));
    await expect(pro(ownerA, () => db.query("insert into public.financial_adjustments (business_id, kind, amount_cents, occurred_on, reason, created_by) values ($1, 'revenue', 100, current_date, 'Usurpation', $2)", [bizA, ownerB]))).rejects.toThrow(/row-level security/);
    await expect(pro(ownerA, () => db.query("update public.financial_adjustments set amount_cents = 1 where business_id = $1", [bizA]))).rejects.toThrow(/permission denied/);
    await expect(db.query("delete from public.financial_adjustments where business_id = $1", [bizA])).rejects.toThrow("MOKA_LEDGER_IMMUTABLE");
  });

  it("remboursement manuel : plafonné au montant payé, statut recalculé", async () => {
    await expect(pro(ownerA, () => db.query("select public.request_refund($1, 2001, 'customer_request')", [pending]))).rejects.toThrow("MOKA_REFUND_TOO_HIGH");
    await expect(pro(ownerB, () => db.query("select public.request_refund($1, 100, 'customer_request')", [pending]))).rejects.toThrow("MOKA_NOT_FOUND");
    const r = await pro(ownerA, async () => (await one("select public.request_refund($1, 2000, 'customer_request') as r", [pending])).r);
    expect(r.online).toBe(false);
    expect((await one("select status from public.refunds where id = $1", [r.refund_id])).status).toBe("succeeded");
    expect((await one("select payment_status from public.appointments where id = $1", [appt])).payment_status).toBe("deposit_paid");
  });
});

describe("compte Stripe connecté (opérations serveur signées)", () => {
  it("refuse une opération non signée, mal signée ou trop ancienne", async () => {
    await expect(op("account_link", { business_id: bizA, stripe_account_id: ACCT }, { signature: "0".repeat(64) })).rejects.toThrow("MOKA_BAD_SIGNATURE");
    await expect(op("account_link", { business_id: bizA, stripe_account_id: ACCT }, { ts: epoch() - 900 })).rejects.toThrow("MOKA_BAD_SIGNATURE");
  });

  it("sans compte prêt, une prestation avec arrhes ne peut pas être réservée", async () => {
    await expect(book(booking())).rejects.toThrow("MOKA_PAYMENT_UNAVAILABLE");
    await op("account_link", { business_id: bizA, stripe_account_id: ACCT, livemode: false });
    await expect(book(booking())).rejects.toThrow("MOKA_PAYMENT_UNAVAILABLE");
    await expect(op("account_link", { business_id: bizB, stripe_account_id: ACCT })).rejects.toThrow("MOKA_ACCOUNT_IN_USE");
  });

  it("met à jour le statut du compte et ignore un événement plus ancien reçu en retard", async () => {
    const now = epoch();
    expect((await op("account_sync", { stripe_account_id: ACCT, charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements_due: [], event_at: now })).business_id).toBe(bizA);
    await op("account_sync", { stripe_account_id: ACCT, charges_enabled: false, payouts_enabled: false, details_submitted: false, event_at: now - 60 });
    expect((await one("select charges_enabled from public.payment_accounts where business_id = $1", [bizA])).charges_enabled).toBe(true);
  });
});

describe("réservation avec arrhes", () => {
  it("crée une réservation temporaire avec un montant recalculé par la base (30 % de 60 €)", async () => {
    const r = await book(booking({ starts_at: at(9).toISOString(), deposit_cents: 1 }));
    expect(r).toMatchObject({ payment_required: true, deposit_cents: 1800, total_cents: 6000, deposit_kind: "arrhes", stripe_account_id: ACCT });
    expect((await one("select count(*)::int as n from public.appointments where business_id = $1 and starts_at = $2", [bizA, at(9)])).n).toBe(0);
    // Le créneau est bloqué pour les autres clientes pendant le paiement.
    await expect(book(booking({ service_id: svcFree, starts_at: at(9, 30).toISOString() }))).rejects.toThrow("MOKA_SLOT_TAKEN");
  });

  it("aucune réservation temporaire hors des heures d'ouverture (essai complet avant blocage)", async () => {
    await expect(book(booking({ starts_at: at(21).toISOString() }))).rejects.toThrow(/MOKA_OUTSIDE|MOKA_/);
    expect((await one("select count(*)::int as n from public.booking_holds where business_id = $1 and lower(occupied) = $2", [bizA, at(21)])).n).toBe(0);
    expect((await one("select count(*)::int as n from public.customers where business_id = $1", [bizA])).n).toBe(1);
  });

  it("une nouvelle tentative avec la même clé renvoie la même réservation temporaire", async () => {
    const p = booking({ starts_at: at(11).toISOString() });
    const a = await book(p);
    const b = await book(p);
    expect(b.hold_id).toBe(a.hold_id);
    expect(b.existing).toBe(true);
  });

  let confirmed: { session: string; hold_id: string; appointment?: string };
  it("paiement réussi (webhook) : rendez-vous confirmé, paiement enregistré, solde restant juste", async () => {
    const h = await holdWithSession({ starts_at: at(13).toISOString() });
    const r = await completed(h.session, 1800);
    expect(r.outcome).toBe("confirmed");
    expect(r.notifications.length).toBeGreaterThan(0);
    const a = await one("select status, source, price_total_cents, deposit_amount_cents, balance_due_cents, payment_status, conditions_snapshot from public.appointments where id = $1", [r.appointment_id]);
    expect(a).toMatchObject({ status: "confirmed", source: "online", price_total_cents: 6000, deposit_amount_cents: 1800, balance_due_cents: 4200, payment_status: "deposit_paid" });
    expect(a.conditions_snapshot).toMatchObject({ deposit_cents: 1800, deposit_kind: "arrhes" });
    expect((await one("select kind, method, status, amount_cents, fee_cents from public.payments where stripe_checkout_session_id = $1", [h.session]))).toMatchObject({ kind: "deposit", method: "card_online", status: "succeeded", amount_cents: 1800, fee_cents: 70 });
    expect((await one("select status from public.booking_holds where id = $1", [h.hold_id])).status).toBe("converted");
    confirmed = { ...h, appointment: r.appointment_id };
  });

  it("webhook en double : ni second rendez-vous, ni second paiement", async () => {
    const r = await completed(confirmed.session, 1800);
    expect(r.outcome).toBe("already");
    expect((await one("select count(*)::int as n from public.appointments where business_id = $1 and starts_at = $2", [bizA, at(13)])).n).toBe(1);
    expect((await one("select count(*)::int as n from public.payments where stripe_checkout_session_id = $1", [confirmed.session])).n).toBe(1);
    const id = `evt_${randomUUID().replace(/-/g, "")}`;
    expect((await op("event_begin", { id, type: "checkout.session.completed", account: ACCT, livemode: false, created: epoch() })).duplicate).toBe(false);
    await op("event_finish", { id, status: "processed", outcome: "confirmed" });
    expect((await op("event_begin", { id, type: "checkout.session.completed", account: ACCT, livemode: false, created: epoch() })).duplicate).toBe(true);
    expect((await as(db, ownerA, () => one("select business_id from public.payment_events where id = $1", [id]))).business_id).toBe(bizA);
  });

  it("montant payé différent : aucun rendez-vous, remboursement intégral demandé", async () => {
    const h = await holdWithSession({ starts_at: at(15).toISOString() });
    const r = await completed(h.session, 100);
    expect(r).toMatchObject({ outcome: "refund_required", error: "MOKA_AMOUNT_MISMATCH", amount_cents: 100 });
    expect((await one("select count(*)::int as n from public.appointments where business_id = $1 and starts_at = $2", [bizA, at(15)])).n).toBe(0);
  });

  it("paiement abandonné : la session expire, le créneau est libéré", async () => {
    const h = await holdWithSession({ starts_at: at(16).toISOString() });
    expect((await op("checkout_expired", { session_id: h.session })).released).toBe(true);
    const r = await book(booking({ service_id: svcFree, starts_at: at(16).toISOString() }));
    expect(r.appointment_id).toBeTruthy();
  });

  it("paiement tardif après expiration, créneau repris entre-temps : remboursement, jamais de double réservation", async () => {
    const h = await holdWithSession({ starts_at: at(17).toISOString() });
    await db.query("update public.booking_holds set expires_at = now() - interval '1 minute' where id = $1", [h.hold_id]);
    await book(booking({ service_id: svcFree, starts_at: at(17).toISOString() }));
    const r = await completed(h.session, 1800);
    expect(r.outcome).toBe("refund_required");
    expect(r.error).toBe("MOKA_SLOT_TAKEN");
    expect((await one("select count(*)::int as n from public.appointments where business_id = $1 and starts_at = $2 and status = 'confirmed'", [bizA, at(17)])).n).toBe(1);
    const refund = await one("select id, status, reason, amount_cents from public.refunds where id = $1", [r.refund_id]);
    expect(refund).toMatchObject({ status: "requested", reason: "slot_unavailable", amount_cents: 1800 });
    // Le serveur exécute le remboursement chez Stripe puis enregistre le résultat.
    await op("refund_sync", { refund_row_id: r.refund_id, stripe_refund_id: "re_late_1", payment_intent_id: `pi_${h.session}`, amount_cents: 1800, status: "succeeded", event_at: epoch() });
    expect((await one("select status from public.refunds where id = $1", [r.refund_id])).status).toBe("succeeded");
    expect((await one("select status from public.booking_holds where id = $1", [h.hold_id])).status).toBe("refund_required");
  });

  it("paiement tardif après expiration, créneau toujours libre : réservation confirmée", async () => {
    const h = await holdWithSession({ starts_at: at(18).toISOString() });
    await db.query("update public.booking_holds set expires_at = now() - interval '1 minute' where id = $1", [h.hold_id]);
    expect((await completed(h.session, 1800)).outcome).toBe("confirmed");
  });

  it("réservations concurrentes sur le même créneau : une seule réservation temporaire", async () => {
    const other = await connect();
    try {
      const p1 = booking({ starts_at: at(12, 0, 1).toISOString() });
      const p2 = booking({ starts_at: at(12, 0, 1).toISOString() });
      const results = await Promise.allSettled([book(p1), book(p2, other)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(String(failed.reason)).toMatch("MOKA_SLOT_TAKEN");
    } finally {
      await other.end();
    }
  });

  it("événements dans le désordre : un remboursement d'un paiement encore inconnu est refusé (Stripe réessaiera)", async () => {
    await expect(op("refund_sync", { stripe_refund_id: "re_unknown", payment_intent_id: "pi_inconnu", amount_cents: 100, status: "succeeded" })).rejects.toThrow("MOKA_PAYMENT_UNKNOWN");
  });

  it("remboursement partiel demandé par la professionnelle puis confirmé par Stripe", async () => {
    const pay = await one<{ id: string }>("select id from public.payments where stripe_checkout_session_id = $1", [confirmed.session]);
    await expect(pro(ownerA, () => db.query("select public.request_refund($1, 1801, 'cancellation')", [pay.id]))).rejects.toThrow("MOKA_REFUND_TOO_HIGH");
    const r = await pro(ownerA, async () => (await one("select public.request_refund($1, 800, 'cancellation') as r", [pay.id])).r);
    expect(r).toMatchObject({ online: true, payment_intent_id: `pi_${confirmed.session}`, stripe_account_id: ACCT });
    // Événement Stripe arrivé avant la réponse de l'API : rattaché à la demande existante.
    await op("refund_sync", { stripe_refund_id: "re_part_1", payment_intent_id: `pi_${confirmed.session}`, amount_cents: 800, status: "succeeded", event_at: epoch() });
    expect((await one("select status, stripe_refund_id from public.refunds where id = $1", [r.refund_id]))).toMatchObject({ status: "succeeded", stripe_refund_id: "re_part_1" });
    // Un événement plus ancien (« pending ») ne fait pas revenir en arrière.
    await op("refund_sync", { stripe_refund_id: "re_part_1", payment_intent_id: `pi_${confirmed.session}`, amount_cents: 800, status: "pending", event_at: epoch() - 30 });
    expect((await one("select status from public.refunds where id = $1", [r.refund_id])).status).toBe("succeeded");
    // Remboursement fait depuis le tableau de bord Stripe : ajouté au registre.
    expect((await op("refund_sync", { stripe_refund_id: "re_dash_1", payment_intent_id: `pi_${confirmed.session}`, amount_cents: 200, status: "succeeded", event_at: epoch() })).created).toBe(true);
    expect((await one("select coalesce(sum(amount_cents), 0)::int as s from public.refunds where payment_id = $1 and status = 'succeeded'", [pay.id])).s).toBe(1000);
  });

  it("réconciliation : liste les comptes actifs et les remboursements demandés non exécutés", async () => {
    const pay = await one<{ id: string }>("select id from public.payments where stripe_checkout_session_id = $1", [confirmed.session]);
    const r = await pro(ownerA, async () => (await one("select public.request_refund($1, 100, 'customer_request') as r", [pay.id])).r);
    await db.query("update public.refunds set created_at = now() - interval '5 minutes' where id = $1", [r.refund_id]);
    const t = await op("reconcile_targets", {});
    expect(t.accounts).toContainEqual({ stripe_account_id: ACCT, livemode: false });
    expect(t.refunds.map((x: Json) => x.id)).toContain(r.refund_id);
    await op("refund_sync", { refund_row_id: r.refund_id, stripe_refund_id: "re_retry_1", payment_intent_id: `pi_${confirmed.session}`, amount_cents: 100, status: "succeeded" });
    expect((await op("reconcile_targets", {})).refunds.map((x: Json) => x.id)).not.toContain(r.refund_id);
  });

  it("contestation et virement bancaire enregistrés", async () => {
    await op("dispute_sync", { dispute_id: "dp_1", payment_intent_id: `pi_${confirmed.session}`, amount_cents: 1800, status: "needs_response", reason: "fraudulent", event_at: epoch() });
    await op("payout_sync", { payout_id: "po_1", stripe_account_id: ACCT, amount_cents: 1730, currency: "eur", status: "paid", arrival_epoch: epoch(), event_at: epoch() });
    expect((await as(db, ownerA, () => one("select status from public.payment_disputes where stripe_dispute_id = 'dp_1'"))).status).toBe("needs_response");
    expect((await as(db, ownerA, () => one("select amount_cents from public.payouts where stripe_payout_id = 'po_1'"))).amount_cents).toBe(1730);
    expect((await as(db, ownerB, () => db.query("select 1 from public.payouts where stripe_payout_id = 'po_1'"))).rowCount).toBe(0);
  });

  it("la cliente suit son paiement uniquement avec son lien privé", async () => {
    const p = booking({ starts_at: at(14, 0, 1).toISOString() });
    const h = await book(p);
    const st = (await as(db, null, () => one("select public.public_hold_status($1, $2) as s", [h.hold_id, p.token_hash]))).s;
    expect(st).toMatchObject({ status: "open", deposit_cents: 1800, slug: slugA });
    expect((await as(db, null, () => one("select public.public_hold_status($1, $2) as s", [h.hold_id, tokenHash()]))).s).toBeNull();
    expect((await op("hold_cancel", { hold_id: h.hold_id })).ok).toBe(true);
    expect((await as(db, null, () => one("select public.public_hold_status($1, $2) as s", [h.hold_id, p.token_hash]))).s.status).toBe("cancelled");
  });
});
