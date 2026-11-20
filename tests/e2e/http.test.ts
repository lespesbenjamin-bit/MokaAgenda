/**
 * Tests de navigation HTTP contre un serveur Next.js réellement démarré
 * (build de production). Vérifie redirections, protection des pages privées,
 * en-têtes de sécurité et absence de la route de démo en production.
 *
 * Lancer : E2E_BASE_URL=http://localhost:3200 npm run test:e2e
 */
import { describe, expect, it } from "vitest";
import { navigation } from "@/config/navigation";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3200";
const MODE = process.env.E2E_MODE ?? "production";
const get = (path: string, init?: RequestInit) => fetch(`${BASE}${path}`, { redirect: "manual", ...init });

describe.runIf(MODE !== "noenv")("pages publiques", () => {
  it.each(["/", "/connexion", "/inscription", "/mot-de-passe-oublie", "/verifier-email", "/reinitialiser-mot-de-passe"])(
    "%s répond 200",
    async (path) => {
      expect((await get(path)).status).toBe(200);
    },
  );

  it("une page inconnue répond 404", async () => {
    expect((await get("/page-qui-n-existe-pas")).status).toBe(404);
  });
});

describe.runIf(MODE !== "noenv")("protection des pages privées (visiteuse non connectée)", () => {
  const privatePaths = [
    ...navigation.map((i) => i.href),
    "/onboarding",
    "/onboarding?etape=3",
    "/prestations/nouvelle",
    "/prestations/categories",
    "/prestations/00000000-0000-0000-0000-000000000000",
    "/clientes/nouvelle",
    "/clientes/import",
    "/clientes/00000000-0000-0000-0000-000000000000?onglet=finances",
    "/agenda/nouveau",
    "/agenda/nouveau?debut=2027-01-04T09:00:00Z",
    "/agenda/disponibilites",
    "/agenda/00000000-0000-0000-0000-000000000000",
  ];

  it.each(privatePaths)("%s redirige vers la connexion", async (path) => {
    const res = await get(path);
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!, BASE);
    expect(location.pathname).toBe("/connexion");
    expect(decodeURIComponent(location.searchParams.get("next") ?? "")).toBe(decodeURIComponent(path));
  });

  it("un faux cookie de session ne donne pas accès (échec fermé)", async () => {
    const forged = "header.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDAifQ.signature";
    const res = await get("/tableau-de-bord", {
      headers: { cookie: `sb-e2etest-auth-token=${encodeURIComponent(JSON.stringify({ access_token: forged }))}` },
    });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/connexion");
  });
});

describe.runIf(MODE !== "noenv")("lien de confirmation email", () => {
  it("un lien sans jeton renvoie vers la connexion avec un message", async () => {
    const res = await get("/auth/confirm");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/connexion?erreur=");
  });

  it("le paramètre next ne permet pas de rediriger vers un autre site", async () => {
    const res = await get("/auth/confirm?next=//evil.com");
    const location = new URL(res.headers.get("location")!, BASE);
    expect(location.host).toBe(new URL(BASE).host);
  });
});

describe.runIf(MODE === "production")("environnement de production", () => {
  it("la route de réinitialisation démo n'existe pas (404)", async () => {
    expect((await get("/api/demo/reset")).status).toBe(404);
    expect((await get("/api/demo/reset", { method: "POST", headers: { authorization: "Bearer x" } })).status).toBe(404);
  });

  it("aucun bandeau ni donnée de démo sur la page de connexion", async () => {
    const html = await (await get("/connexion")).text();
    expect(html).not.toContain("Environnement de démonstration");
    expect(html).not.toContain("Explorer la démo");
    expect(html).not.toContain("Moka Beauty Studio");
  });
});

describe.runIf(MODE !== "noenv")("sécurité", () => {
  it("envoie les en-têtes de sécurité", async () => {
    const res = await get("/");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-powered-by")).toBeNull();
  });

  it("aucune clé secrète dans le code envoyé au navigateur", async () => {
    const html = await (await get("/connexion")).text();
    const scripts = [...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const src of scripts) {
      const js = await (await get(src)).text();
      expect(js, src).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(js, src).not.toContain("e2e-service-role-secret");
      expect(js, src).not.toContain("DEMO_USER_PASSWORD");
    }
  });
});

describe.runIf(MODE === "production")("outil d'aperçu local", () => {
  it("n'existe pas en production", async () => {
    expect((await get("/apercu-dev/prestations")).status).toBe(404);
  });
});
