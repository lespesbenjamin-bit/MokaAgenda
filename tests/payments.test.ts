/**
 * Sprint 6 — couche Stripe côté serveur, avec un faux client Stripe et une
 * fausse base (aucun appel réseau) : signature du webhook, idempotence,
 * paiement confirmé, remboursement automatique, chiffrement du lien.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
let rpcImpl: (op: string, payload: Record<string, unknown>) => unknown = () => ({});

vi.mock("@/server/integrations/supabase/public", () => ({
  createSupabasePublicClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === "server_payment_op") return { data: rpcImpl(args.p_op as string, JSON.parse(args.p_payload as string)), error: null };
      return { data: null, error: null };
    },
  }),
}));
const dispatched: unknown[] = [];
vi.mock("@/server/services/public-booking", () => ({ dispatchNotifications: async (...a: unknown[]) => dispatched.push(a) }));
vi.mock("@/server/notifications/mailer", () => ({ sendEmail: async () => ({ status: "simulated", provider: "simulated" }) }));

const SECRET = "a".repeat(64);
process.env.TRAVEL_SIGNING_SECRET = SECRET;
process.env.STRIPE_SECRET_KEY = "sk_test_unitTestKey0001";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_unitTestSecret0001";

const { decryptToken, encryptToken, paymentMessage, signedPaymentOp } = await import("@/server/payments/signing");
const { readStripeConfig, setStripeClientForTests } = await import("@/server/payments/stripe");
const service = await import("@/server/payments/service");
const { sign } = await import("@/server/travel/signing");

const real = new Stripe("sk_test_unitTestKey0001");
const refundsCreated: { params: unknown; opts: unknown }[] = [];
const fake = {
  webhooks: real.webhooks,
  paymentIntents: { retrieve: async () => ({ latest_charge: { id: "ch_1", balance_transaction: { id: "txn_1", fee: 52, available_on: 1_800_000_000 } } }) },
  refunds: { create: async (params: unknown, opts: unknown) => (refundsCreated.push({ params, opts }), { id: "re_1", amount: 1800, status: "succeeded", failure_reason: null }) },
} as unknown as Stripe;

function signedEvent(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  return { payload, header: real.webhooks.generateTestHeaderString({ payload, secret: "whsec_unitTestSecret0001" }) };
}
const sessionEvent = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  object: "event",
  type: "checkout.session.completed",
  account: "acct_TestMokaA0001",
  livemode: false,
  created: 1_790_000_000,
  data: { object: { id: "cs_test_1", object: "checkout.session", mode: "payment", payment_status: "paid", payment_intent: "pi_1", amount_total: 1800, currency: "eur", created: 1_790_000_000, ...over } },
});

beforeEach(() => {
  rpcCalls.length = 0;
  dispatched.length = 0;
  refundsCreated.length = 0;
  setStripeClientForTests(fake, "sk_test_unitTestKey0001");
});

describe("signatures et secrets", () => {
  it("message signé identique au format attendu par la base", () => {
    const s = signedPaymentOp("checkout_attach", { hold_id: "h", session_id: "cs" }, SECRET, 1700000000);
    expect(paymentMessage("checkout_attach", 1700000000, s.p_payload)).toBe('pay|v1|checkout_attach|1700000000|{"hold_id":"h","session_id":"cs"}');
    expect(s.p_signature).toBe(sign('pay|v1|checkout_attach|1700000000|{"hold_id":"h","session_id":"cs"}', SECRET));
  });

  it("lien de gestion chiffré : déchiffrable avec la bonne clé seulement, toute altération refusée", () => {
    const enc = encryptToken("jeton-secret", SECRET);
    expect(enc).not.toContain("jeton");
    expect(decryptToken(enc, SECRET)).toBe("jeton-secret");
    expect(decryptToken(enc, "b".repeat(64))).toBeNull();
    expect(decryptToken(enc.slice(0, -2) + "AA", SECRET)).toBeNull();
  });

  it("clé Stripe : format vérifié ; une clé réelle est refusée hors production", () => {
    expect(readStripeConfig({ STRIPE_SECRET_KEY: "sk_test_abcdefghijk" }, "demo")).toMatchObject({ livemode: false });
    expect(readStripeConfig({ STRIPE_SECRET_KEY: "sk_live_abcdefghijk" }, "demo")).toBeNull();
    expect(readStripeConfig({ STRIPE_SECRET_KEY: "sk_live_abcdefghijk" }, "development")).toBeNull();
    expect(readStripeConfig({ STRIPE_SECRET_KEY: "sk_live_abcdefghijk" }, "production")).toMatchObject({ livemode: true });
    expect(readStripeConfig({ STRIPE_SECRET_KEY: "pk_test_abcdefghijk" }, "demo")).toBeNull();
    expect(readStripeConfig({}, "production")).toBeNull();
  });
});

describe("webhook Stripe", () => {
  it("refuse une signature absente, fausse ou un corps modifié", () => {
    const { payload, header } = signedEvent(sessionEvent("evt_aaaaaaaa1"));
    expect(() => service.verifyWebhook(payload, null)).toThrow("BAD_SIGNATURE");
    expect(() => service.verifyWebhook(payload, "t=1,v1=00")).toThrow("BAD_SIGNATURE");
    expect(() => service.verifyWebhook(payload.replace("1800", "1"), header)).toThrow("BAD_SIGNATURE");
    expect(service.verifyWebhook(payload, header).id).toBe("evt_aaaaaaaa1");
  });

  it("paiement réussi : frais relus chez Stripe, confirmation par la base, email envoyé avec le lien déchiffré", async () => {
    const enc = encryptToken("jeton-cliente", SECRET);
    rpcImpl = (op) => (op === "event_begin" ? { duplicate: false } : op === "checkout_completed" ? { outcome: "confirmed", notifications: [{ id: "n1", kind: "confirmed_customer", recipient: "c@x.fr" }], enc_token: enc, token_hash: "h".repeat(64) } : { ok: true });
    const { payload, header } = signedEvent(sessionEvent("evt_aaaaaaaa2"));
    const outcome = await service.handleEvent(service.verifyWebhook(payload, header));
    expect(outcome).toBe("confirmed");
    const ops = rpcCalls.map((c) => c.args.p_op);
    expect(ops).toEqual(["event_begin", "checkout_completed", "event_finish"]);
    const completed = JSON.parse(rpcCalls[1].args.p_payload as string);
    expect(completed).toMatchObject({ session_id: "cs_test_1", payment_intent_id: "pi_1", amount_cents: 1800, account: "acct_TestMokaA0001", fee_cents: 52, charge_id: "ch_1" });
    expect(dispatched).toHaveLength(1);
    expect((dispatched[0] as unknown[])[1]).toBe("jeton-cliente");
    expect(JSON.parse(rpcCalls[2].args.p_payload as string)).toMatchObject({ status: "processed", outcome: "confirmed" });
  });

  it("événement déjà traité : ignoré sans autre opération", async () => {
    rpcImpl = () => ({ duplicate: true });
    const { payload, header } = signedEvent(sessionEvent("evt_aaaaaaaa3"));
    expect(await service.handleEvent(service.verifyWebhook(payload, header))).toBe("duplicate");
    expect(rpcCalls).toHaveLength(1);
  });

  it("session non payée (paiement refusé ou en attente) : aucune confirmation", async () => {
    rpcImpl = (op) => (op === "event_begin" ? { duplicate: false } : { ok: true });
    const { payload, header } = signedEvent(sessionEvent("evt_aaaaaaaa4", { payment_status: "unpaid" }));
    expect(await service.handleEvent(service.verifyWebhook(payload, header))).toBe("ignored");
    expect(rpcCalls.map((c) => c.args.p_op)).not.toContain("checkout_completed");
  });

  it("créneau perdu : remboursement intégral chez Stripe avec clé d'idempotence, résultat enregistré", async () => {
    rpcImpl = (op) => (op === "event_begin" ? { duplicate: false } : op === "checkout_completed" ? { outcome: "refund_required", refund_id: "11111111-1111-1111-1111-111111111111", amount_cents: 1800, customer_email: "c@x.fr" } : { ok: true });
    const { payload, header } = signedEvent(sessionEvent("evt_aaaaaaaa5"));
    expect(await service.handleEvent(service.verifyWebhook(payload, header))).toBe("refund_required");
    expect(refundsCreated).toHaveLength(1);
    expect(refundsCreated[0].params).toMatchObject({ payment_intent: "pi_1", amount: 1800 });
    expect(refundsCreated[0].opts).toMatchObject({ stripeAccount: "acct_TestMokaA0001", idempotencyKey: "moka-refund-11111111-1111-1111-1111-111111111111" });
    const sync = rpcCalls.find((c) => c.args.p_op === "refund_sync");
    expect(JSON.parse(sync!.args.p_payload as string)).toMatchObject({ refund_row_id: "11111111-1111-1111-1111-111111111111", stripe_refund_id: "re_1", status: "succeeded" });
  });

  it("erreur de traitement : l'événement est marqué en échec et l'erreur remonte (Stripe réessaiera)", async () => {
    rpcImpl = (op) => {
      if (op === "event_begin") return { duplicate: false };
      if (op === "checkout_completed") throw new Error("MOKA_PAYMENT_UNKNOWN");
      return { ok: true };
    };
    const { payload, header } = signedEvent(sessionEvent("evt_aaaaaaaa6"));
    await expect(service.handleEvent(service.verifyWebhook(payload, header))).rejects.toThrow();
    const finish = rpcCalls.find((c) => c.args.p_op === "event_finish");
    expect(JSON.parse(finish!.args.p_payload as string)).toMatchObject({ status: "failed" });
  });

  it("type d'événement non traité : journalisé comme ignoré", async () => {
    rpcImpl = (op) => (op === "event_begin" ? { duplicate: false } : { ok: true });
    const { payload, header } = signedEvent({ ...sessionEvent("evt_aaaaaaaa7"), type: "customer.created" });
    expect(await service.handleEvent(service.verifyWebhook(payload, header))).toBe("ignored");
  });
});
