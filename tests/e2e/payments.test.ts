/**
 * Sprint 6 — routes de paiement et de finances, dans les 3 configurations
 * (aucune clé Stripe, aucune base réelle) : jamais de plantage, jamais de
 * détail technique, rien d'accessible sans compte.
 */
import { describe, expect, it } from "vitest";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3200";
const get = (path: string) => fetch(`${BASE}${path}`, { redirect: "manual" });

describe("webhook Stripe", () => {
  it("refuse un appel non signé (ou indique que Stripe n'est pas configuré) sans rien traiter", async () => {
    const res = await fetch(`${BASE}/api/stripe/webhook`, { method: "POST", body: JSON.stringify({ id: "evt_faux", type: "checkout.session.completed" }), headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=faux" } });
    expect([400, 503]).toContain(res.status);
    const text = await res.text();
    expect(text).not.toMatch(/supabase|postgres|stack|sk_/i);
  });

  it("la réconciliation exige le secret des tâches planifiées", async () => {
    expect((await get("/api/stripe/reconcile")).status).toBe(401);
    expect((await fetch(`${BASE}/api/stripe/reconcile`, { headers: { authorization: "Bearer mauvais-secret-0123456789" } })).status).toBe(401);
  });
});

describe("finances (espace privé)", () => {
  it.each(["/finances", "/finances/rentabilite", "/finances/paiements", "/finances/objectifs", "/parametres/finances", "/parametres/paiements"])("%s exige une connexion", async (path) => {
    const res = await get(path);
    expect([302, 303, 307, 308]).toContain(res.status);
    expect(res.headers.get("location") ?? "").toContain("/connexion");
  });

  it("l'export CSV n'est jamais servi sans connexion", async () => {
    const res = await get("/api/finances/export?type=encaissements");
    expect(res.headers.get("content-type") ?? "").not.toContain("text/csv");
    expect([302, 303, 307, 308, 401, 404, 500]).toContain(res.status);
  });
});

describe("retour de paiement (cliente)", () => {
  it("identifiant invalide : 404 propre", async () => {
    expect((await get("/reserver/institut-test/paiement/pas-un-uuid")).status).toBe(404);
  });

  it("demande inconnue : message neutre, aucune confirmation déduite de l'URL, page non indexée", async () => {
    const res = await get("/reserver/institut-test/paiement/00000000-0000-4000-8000-000000000000?retour=ok");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Nous ne retrouvons pas cette demande");
    expect(html).not.toContain("rendez-vous confirmé");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});
