/**
 * Tests du build DÉMO (NEXT_PUBLIC_APP_ENV=demo). Lancer avec E2E_MODE=demo.
 * Vérifie le marquage visible et les garde-fous de la réinitialisation,
 * sans jamais toucher à une base réelle.
 */
import { describe, expect, it } from "vitest";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3200";
const MODE = process.env.E2E_MODE ?? "production";
const get = (path: string, init?: RequestInit) => fetch(`${BASE}${path}`, { redirect: "manual", ...init });

describe.runIf(MODE === "demo")("environnement démo", () => {
  it("affiche le bandeau démo sur toutes les pages publiques", async () => {
    for (const path of ["/", "/connexion", "/inscription"]) {
      expect(await (await get(path)).text(), path).toContain("Environnement de démonstration");
    }
  });

  it("propose l'accès à la démo sans compte", async () => {
    expect(await (await get("/connexion")).text()).toContain("Explorer la démo");
  });

  it("refuse la réinitialisation sans secret", async () => {
    expect((await get("/api/demo/reset")).status).toBe(401);
    expect((await get("/api/demo/reset", { headers: { authorization: "Bearer mauvais-secret-123456" } })).status).toBe(401);
  });

  it("refuse la réinitialisation si l'URL Supabase n'est pas celle du projet démo (avant toute suppression)", async () => {
    const res = await get("/api/demo/reset", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Réinitialisation refusée");
  });
});
