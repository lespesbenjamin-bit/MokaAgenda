import { describe, expect, it } from "vitest";
import { parseServiceForm } from "@/lib/validation/services";
import { customerSchema, addressSchema } from "@/lib/validation/customers";
import { buildDemoRows } from "@/server/demo/seed";
import { validatePricing } from "@/lib/domain/pricing";

const valid = {
  name: "Soin visage",
  category_id: "",
  duration_minutes: "60",
  prep_minutes: "10",
  cleanup_minutes: "",
  base_price: "65",
  vat_rate_bps: "0",
  offer_salon: "on",
  salon_price: "",
  offer_home: "on",
  home_price: "75,50",
  deposit_type: "none",
  cost_consumables: "4",
  is_active: "on",
  online_bookable: "on",
};

describe("formulaire prestation", () => {
  it("convertit une saisie valide en valeurs à enregistrer", () => {
    const r = parseServiceForm(valid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.values).toMatchObject({ name: "Soin visage", base_price_cents: 6500, duration_minutes: 60, prep_minutes: 10, cleanup_minutes: 0, is_active: true });
    expect(r.data.places).toEqual({ salon: null, home: 7550 });
    expect(r.data.costs).toEqual({ consumablesCents: 400, productsCents: 0, otherCents: 0 });
  });
  it("exige un nom, une durée, un prix et au moins un lieu", () => {
    const r = parseServiceForm({ ...valid, name: "", duration_minutes: "2", base_price: "", offer_salon: undefined, offer_home: undefined });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(["base_price", "duration_minutes", "name"]);
    const noPlace = parseServiceForm({ ...valid, offer_salon: undefined, offer_home: undefined });
    expect(!noPlace.ok && noPlace.errors.places).toMatch(/lieu/);
  });
  it("refuse un montant négatif ou mal saisi", () => {
    const r = parseServiceForm({ ...valid, base_price: "-5", cost_products: "abc" });
    expect(!r.ok && r.errors).toMatchObject({ base_price: expect.any(String), cost_products: expect.any(String) });
  });
  it("valide les acomptes : pourcentage 0–100, fixe ≤ prix le plus bas", () => {
    expect(parseServiceForm({ ...valid, deposit_type: "percentage", deposit_percent: "120" }).ok).toBe(false);
    const tooHigh = parseServiceForm({ ...valid, deposit_type: "fixed", deposit_fixed: "70" });
    expect(!tooHigh.ok && tooHigh.errors.deposit_fixed).toMatch(/65,00/);
    const ok = parseServiceForm({ ...valid, deposit_type: "fixed", deposit_fixed: "20" });
    expect(ok.ok && ok.data.values).toMatchObject({ deposit_type: "fixed", deposit_value: 2000 });
  });
  it("refuse une promo supérieure au prix et une TVA inconnue", () => {
    expect(parseServiceForm({ ...valid, promo_price: "80" }).ok).toBe(false);
    expect(parseServiceForm({ ...valid, vat_rate_bps: "1900" }).ok).toBe(false);
  });
  it("ignore le libellé du supplément s'il n'y a pas de supplément", () => {
    const r = parseServiceForm({ ...valid, extra_fee: "", extra_fee_label: "Strass" });
    expect(r.ok && r.data.values.extra_fee_label).toBeNull();
  });
});

describe("formulaire cliente", () => {
  it("accepte un prénom seul", () => {
    expect(customerSchema.safeParse({ first_name: "Léa" }).success).toBe(true);
  });
  it("exige un prénom ou un nom", () => {
    expect(customerSchema.safeParse({ first_name: " ", last_name: "" }).success).toBe(false);
  });
  it("contrôle email, téléphone et date de naissance", () => {
    expect(customerSchema.safeParse({ first_name: "A", email: "pas-un-email" }).success).toBe(false);
    expect(customerSchema.safeParse({ first_name: "A", phone: "abc" }).success).toBe(false);
    expect(customerSchema.safeParse({ first_name: "A", birth_date: "2999-01-01" }).success).toBe(false);
    const r = customerSchema.safeParse({ first_name: "A", email: " Lea@X.FR ", birth_date: "1990-05-04" });
    expect(r.success && r.data).toMatchObject({ email: "lea@x.fr", birth_date: "1990-05-04" });
  });
  it("valide une adresse", () => {
    expect(addressSchema.safeParse({ kind: "work", line1: "1 rue A", city: "Toulouse" }).success).toBe(true);
    expect(addressSchema.safeParse({ kind: "work", line1: "", city: "Toulouse" }).success).toBe(false);
    expect(addressSchema.safeParse({ kind: "chateau", line1: "1", city: "T" }).success).toBe(false);
  });
});

describe("données démo", () => {
  const rows = buildDemoRows("00000000-0000-0000-0000-000000000001");
  it("contiennent 6 catégories, 20 prestations, 25 clientes", () => {
    expect([rows.categories.length, rows.services.length, rows.customers.length]).toEqual([6, 20, 25]);
  });
  it("ont des tarifs et acomptes cohérents selon les règles métier", () => {
    for (const s of rows.services) {
      const places: Record<string, number | null> = {};
      for (const l of rows.service_locations.filter((l) => l.service_id === s.id)) places[l.place as string] = l.price_cents as number | null;
      const problem = validatePricing({
        basePriceCents: s.base_price_cents as number,
        promoPriceCents: null,
        extraFeeCents: 0,
        vatRateBps: s.vat_rate_bps as number,
        places,
        depositType: s.deposit_type as "none",
        depositValue: s.deposit_value as number,
      });
      expect(problem, String(s.name)).toBeNull();
    }
  });
  it("rattachent tout à l'entreprise démo", () => {
    const all = Object.values(rows).flat();
    expect(all.every((r) => r.business_id === "00000000-0000-0000-0000-000000000001")).toBe(true);
  });
});
