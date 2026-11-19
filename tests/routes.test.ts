import { describe, expect, it } from "vitest";
import { isGuestOnlyPath, isPrivatePath, safeNextPath } from "@/lib/routes";
import { navigation } from "@/config/navigation";

describe("protection des routes", () => {
  it("toutes les pages du menu sont privées", () => {
    for (const item of navigation) expect(isPrivatePath(item.href), item.href).toBe(true);
  });
  it("l'onboarding et les sous-pages sont privés", () => {
    expect(isPrivatePath("/onboarding")).toBe(true);
    expect(isPrivatePath("/agenda/semaine")).toBe(true);
  });
  it("les pages publiques ne sont pas privées", () => {
    for (const p of ["/", "/connexion", "/inscription", "/mot-de-passe-oublie", "/auth/confirm", "/agendas"]) {
      expect(isPrivatePath(p), p).toBe(false);
    }
  });
  it("connexion et inscription sont réservées aux visiteuses", () => {
    expect(isGuestOnlyPath("/connexion")).toBe(true);
    expect(isGuestOnlyPath("/inscription")).toBe(true);
    expect(isGuestOnlyPath("/reinitialiser-mot-de-passe")).toBe(false);
  });
});

describe("safeNextPath (anti redirection ouverte)", () => {
  it("accepte un chemin interne", () => {
    expect(safeNextPath("/agenda?vue=semaine")).toBe("/agenda?vue=semaine");
  });
  it.each(["//evil.com", "https://evil.com", "/\\evil.com", "evil.com", "javascript:alert(1)", "/ok\r\nSet-Cookie:x"])(
    "refuse %s",
    (value) => {
      expect(safeNextPath(value)).toBe("/tableau-de-bord");
    },
  );
  it("utilise la valeur par défaut si absent", () => {
    expect(safeNextPath(undefined)).toBe("/tableau-de-bord");
    expect(safeNextPath(null, "/onboarding")).toBe("/onboarding");
  });
});
