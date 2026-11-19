import { describe, expect, it } from "vitest";
import { checkDemoTarget } from "@/server/demo/guard";
import fixtures from "../supabase/demo/fixtures.json";

const base = {
  appEnv: "demo",
  supabaseUrl: "https://demoref123.supabase.co",
  demoProjectRef: "demoref123",
  productionProjectRef: "prodref456",
};

describe("garde-fous de la réinitialisation démo", () => {
  it("autorise uniquement le projet démo en environnement démo", () => {
    expect(checkDemoTarget(base).ok).toBe(true);
  });
  it("refuse hors environnement démo", () => {
    expect(checkDemoTarget({ ...base, appEnv: "production" }).ok).toBe(false);
    expect(checkDemoTarget({ ...base, appEnv: undefined }).ok).toBe(false);
  });
  it("refuse si le projet démo n'est pas déclaré", () => {
    expect(checkDemoTarget({ ...base, demoProjectRef: undefined }).ok).toBe(false);
  });
  it("refuse si l'URL pointe vers un autre projet (ex. production)", () => {
    expect(checkDemoTarget({ ...base, supabaseUrl: "https://prodref456.supabase.co" }).ok).toBe(false);
  });
  it("refuse si démo et production sont déclarés identiques", () => {
    expect(checkDemoTarget({ ...base, productionProjectRef: "demoref123" }).ok).toBe(false);
  });
});

describe("fixtures démo", () => {
  it("décrivent l'entreprise fictive hybride Moka Beauty Studio", () => {
    expect(fixtures.business.name).toBe("Moka Beauty Studio");
    expect(fixtures.business.activity_mode).toBe("hybrid");
  });
  it("utilisent un domaine email non routable", () => {
    expect(fixtures.business.email.endsWith(".demo")).toBe(true);
  });
  it("ont des rendez-vous qui référencent des clientes et prestations existantes", () => {
    for (const a of fixtures.appointments) {
      expect(fixtures.customers[a.customer]).toBeDefined();
      expect(fixtures.services[a.service]).toBeDefined();
      expect(["pending", "confirmed", "completed", "cancelled", "no_show"]).toContain(a.status);
    }
  });
});
