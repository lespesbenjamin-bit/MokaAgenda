/**
 * Réservation publique (Sprint 4) — pages accessibles sans compte, dans les
 * 3 configurations. Aucune base réelle n'est contactée : une page inconnue
 * (ou une base injoignable) doit afficher un message propre, jamais planter.
 */
import { describe, expect, it } from "vitest";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3200";
const get = (path: string) => fetch(`${BASE}${path}`, { redirect: "manual" });

describe("page publique de réservation", () => {
  it("n'exige pas de connexion et affiche un message clair si la page est introuvable ou fermée", async () => {
    const res = await get("/reserver/institut-inexistant");
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("Réservation en ligne indisponible");
    expect(html).not.toMatch(/supabase|postgres|stack/i);
  });

  it("refuse une adresse malformée sans appel à la base", async () => {
    expect((await get("/reserver/Pas%20Valide!")).status).toBe(404);
  });
});

describe("lien de gestion d'un rendez-vous", () => {
  it("un lien inconnu affiche « Lien invalide » sans détail technique", async () => {
    const res = await get("/reservation/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Lien invalide");
    expect(html).not.toMatch(/supabase|postgres/i);
  });

  it("ne transmet jamais le lien secret à un autre site et n'est pas indexé", async () => {
    const res = await get("/reservation/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("un jeton malformé est rejeté proprement", async () => {
    const res = await get("/reservation/..%2F..%2Fetc");
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) expect(await res.text()).toContain("Lien invalide");
  });
});

describe("pages des déplacements (Sprint 5)", () => {
  it("réglages, zones et tournées exigent une connexion", async () => {
    for (const path of ["/parametres/deplacements", "/parametres/zones", "/tournees", "/tournees?date=2027-01-04"]) {
      const res = await get(path);
      expect([302, 303, 307, 308]).toContain(res.status);
      expect(res.headers.get("location") ?? "").toContain("/connexion");
    }
  });
});
