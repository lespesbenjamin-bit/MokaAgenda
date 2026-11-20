import { describe, expect, it } from "vitest";
import { navigation, isActivePath, getNavItem } from "@/config/navigation";

describe("navigation", () => {
  it("contient les 8 modules du menu principal dans l'ordre du cahier des charges", () => {
    expect(navigation.map((i) => i.label)).toEqual([
      "Tableau de bord",
      "Agenda",
      "Tournées",
      "Clientes",
      "Prestations",
      "Finances",
      "Boutique",
      "Paramètres",
    ]);
  });

  it("a des clés et des URLs uniques", () => {
    expect(new Set(navigation.map((i) => i.key)).size).toBe(navigation.length);
    expect(new Set(navigation.map((i) => i.href)).size).toBe(navigation.length);
  });

  it("marque explicitement les modules non développés comme « à venir »", () => {
    const available = navigation.filter((i) => i.status === "available").map((i) => i.key);
    expect(available).toEqual(["dashboard", "agenda", "customers", "services"]);
  });

  it("affiche exactement 3 modules + « Plus » dans la barre mobile", () => {
    expect(navigation.filter((i) => i.mobilePrimary)).toHaveLength(3);
  });

  it("détecte la page active, y compris les sous-pages", () => {
    expect(isActivePath("/agenda", "/agenda")).toBe(true);
    expect(isActivePath("/agenda/semaine", "/agenda")).toBe(true);
    expect(isActivePath("/agendas", "/agenda")).toBe(false);
  });

  it("refuse une clé inconnue", () => {
    expect(() => getNavItem("inconnu")).toThrow();
  });
});
