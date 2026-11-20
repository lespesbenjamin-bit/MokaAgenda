import { describe, expect, it } from "vitest";
import {
  buildPriceSnapshot,
  centsToInput,
  depositAmountCents,
  excludingVatCents,
  formatDuration,
  formatEuros,
  indicativeMargin,
  parseEurosToCents,
  totalMobilizedMinutes,
  totalPriceCents,
  unitPriceCents,
  validateDeposit,
  validatePricing,
  type ServicePricing,
} from "@/lib/domain/pricing";

const base: ServicePricing = {
  basePriceCents: 6000,
  promoPriceCents: null,
  extraFeeCents: 0,
  vatRateBps: 0,
  places: { salon: null, home: 7000 },
  depositType: "none",
  depositValue: 0,
};
const costs = { consumablesCents: 800, productsCents: 400, otherCents: 200 };

describe("tarifs domicile / institut", () => {
  it("utilise le tarif propre au lieu, sinon le prix de base", () => {
    expect(totalPriceCents(base, "salon")).toBe(6000);
    expect(totalPriceCents(base, "home")).toBe(7000);
  });
  it("applique le prix promotionnel seulement s'il est inférieur", () => {
    const promo = { ...base, promoPriceCents: 5000 };
    expect(unitPriceCents(promo, "salon")).toBe(5000);
    expect(unitPriceCents(promo, "home")).toBe(5000);
    expect(unitPriceCents({ ...base, promoPriceCents: 6500, places: { salon: 6000 } }, "salon")).toBe(6000);
  });
  it("ajoute le supplément au total", () => {
    expect(totalPriceCents({ ...base, extraFeeCents: 500 }, "home")).toBe(7500);
  });
});

describe("TVA", () => {
  it("calcule le HT à partir du TTC", () => {
    expect(excludingVatCents(12000, 2000)).toBe(10000);
    expect(excludingVatCents(11000, 1000)).toBe(10000);
    expect(excludingVatCents(5000, 0)).toBe(5000);
  });
});

describe("acomptes", () => {
  it("calcule un acompte fixe plafonné au total et un pourcentage arrondi", () => {
    expect(depositAmountCents({ depositType: "fixed", depositValue: 1500 }, 6000)).toBe(1500);
    expect(depositAmountCents({ depositType: "fixed", depositValue: 9000 }, 6000)).toBe(6000);
    expect(depositAmountCents({ depositType: "percentage", depositValue: 30 }, 6999)).toBe(2100);
    expect(depositAmountCents({ depositType: "none", depositValue: 0 }, 6000)).toBe(0);
  });
  it("refuse un acompte négatif, un pourcentage > 100, un fixe supérieur au prix le plus bas", () => {
    expect(validateDeposit({ ...base, depositType: "fixed", depositValue: -1 })).toMatch(/négatif/);
    expect(validateDeposit({ ...base, depositType: "percentage", depositValue: 101 })).toMatch(/0 et 100/);
    expect(validateDeposit({ ...base, depositType: "fixed", depositValue: 6500 })).toMatch(/dépasser/);
    expect(validateDeposit({ ...base, depositType: "fixed", depositValue: 6000 })).toBeNull();
    expect(validateDeposit({ ...base, depositType: "percentage", depositValue: 100 })).toBeNull();
  });
  it("refuse une prestation sans lieu ou une promo supérieure au prix", () => {
    expect(validatePricing({ ...base, places: {} })).toMatch(/lieu/);
    expect(validatePricing({ ...base, promoPriceCents: 7000 })).toMatch(/promotionnel/);
    expect(validatePricing({ ...base, extraFeeCents: -1 })).toMatch(/négatifs/);
    expect(validatePricing(base)).toBeNull();
  });
});

describe("rentabilité indicative", () => {
  it("calcule la marge contributive avant déplacement (franchise de TVA)", () => {
    expect(indicativeMargin(base, costs, "salon")).toEqual({
      place: "salon",
      priceTtcCents: 6000,
      priceHtCents: 6000,
      consumablesCents: 800,
      otherDirectCostsCents: 600,
      contributionCents: 4600,
      marginRatePct: 76.7,
    });
  });
  it("raisonne en HT quand la TVA s'applique", () => {
    const m = indicativeMargin({ ...base, vatRateBps: 2000 }, costs, "salon");
    expect(m.priceHtCents).toBe(5000);
    expect(m.contributionCents).toBe(3600);
    expect(m.marginRatePct).toBe(72);
  });
  it("peut être négative et gère un prix nul", () => {
    expect(indicativeMargin({ ...base, basePriceCents: 1000, places: { salon: null } }, costs, "salon").contributionCents).toBe(-400);
    expect(indicativeMargin({ ...base, basePriceCents: 0, places: { salon: null } }, costs, "salon").marginRatePct).toBeNull();
  });
  it("additionne le temps total mobilisé", () => {
    expect(totalMobilizedMinutes({ durationMinutes: 60, prepMinutes: 10, cleanupMinutes: 15 })).toBe(85);
  });
});

describe("instantané pour un futur rendez-vous", () => {
  const svc = { id: "s1", name: "Soin", durationMinutes: 60, prepMinutes: 10, cleanupMinutes: 5, bufferMinutes: 15 };
  it("fige prix, acompte et solde", () => {
    const snap = buildPriceSnapshot(svc, { ...base, depositType: "percentage", depositValue: 30 }, costs, "home", new Date("2026-01-01T10:00:00Z"));
    expect(snap).toMatchObject({ priceTtcCents: 7000, depositAmountCents: 2100, balanceDueCents: 4900, mobilizedMinutes: 75, bufferMinutes: 15, directCostsCents: 1400 });
  });
  it("refuse un lieu non proposé", () => {
    expect(() => buildPriceSnapshot(svc, { ...base, places: { salon: null } }, costs, "home")).toThrow(/domicile/);
  });
});

describe("saisie et affichage", () => {
  it("convertit les euros saisis en centimes", () => {
    expect(parseEurosToCents("45")).toBe(4500);
    expect(parseEurosToCents("45,5")).toBe(4550);
    expect(parseEurosToCents("1 200,00 €")).toBe(120000);
    expect(parseEurosToCents("")).toBeNull();
    expect(parseEurosToCents("12,345")).toBeNaN();
    expect(parseEurosToCents("abc")).toBeNaN();
  });
  it("formate montants et durées", () => {
    expect(formatEuros(4550)).toBe("45,50 €");
    expect(centsToInput(4500)).toBe("45");
    expect(centsToInput(4550)).toBe("45,50");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(90)).toBe("1 h 30");
    expect(formatDuration(120)).toBe("2 h");
  });
});
