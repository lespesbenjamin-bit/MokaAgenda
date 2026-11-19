/**
 * Build de production SANS variables Supabase (état d'un déploiement pas
 * encore configuré). Lancer avec E2E_MODE=noenv.
 */
import { describe, expect, it } from "vitest";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3200";
const MODE = process.env.E2E_MODE ?? "production";
const get = (path: string) => fetch(`${BASE}${path}`, { redirect: "manual" });

describe.runIf(MODE === "noenv")("déploiement sans configuration Supabase", () => {
  it("la page de connexion explique que la configuration manque", async () => {
    const res = await get("/connexion");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("pas encore configurée");
  });
  it("les pages privées restent fermées", async () => {
    for (const p of ["/tableau-de-bord", "/onboarding", "/agenda"]) {
      const res = await get(p);
      expect(res.status, p).toBe(307);
      expect(res.headers.get("location"), p).toContain("/connexion");
    }
  });
});
