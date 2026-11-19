import { describe, expect, it } from "vitest";
import { newPasswordSchema, signUpSchema, translateAuthError } from "@/lib/validation/auth";
import {
  businessInfoSchema,
  parseLocationForm,
  resolveOnboardingStep,
  settingsSchema,
  validateLogo,
} from "@/lib/validation/onboarding";

describe("inscription", () => {
  const valid = { fullName: "Léa Martin", email: " Lea@Example.FR ", password: "motdepasse1", acceptTerms: "on" };
  it("accepte un formulaire valide et normalise l'email", () => {
    const r = signUpSchema.safeParse(valid);
    expect(r.success && r.data.email).toBe("lea@example.fr");
  });
  it("refuse un mot de passe trop faible", () => {
    expect(signUpSchema.safeParse({ ...valid, password: "court1" }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...valid, password: "sanschiffre" }).success).toBe(false);
  });
  it("exige l'acceptation des conditions", () => {
    expect(signUpSchema.safeParse({ ...valid, acceptTerms: undefined }).success).toBe(false);
  });
  it("refuse un email invalide", () => {
    expect(signUpSchema.safeParse({ ...valid, email: "pas-un-email" }).success).toBe(false);
  });
  it("vérifie la confirmation du nouveau mot de passe", () => {
    expect(newPasswordSchema.safeParse({ password: "motdepasse1", confirm: "autre1234" }).success).toBe(false);
    expect(newPasswordSchema.safeParse({ password: "motdepasse1", confirm: "motdepasse1" }).success).toBe(true);
  });
  it("traduit les erreurs Supabase", () => {
    expect(translateAuthError("Invalid login credentials", "invalid_credentials")).toMatch(/incorrect/);
    expect(translateAuthError("Email not confirmed")).toMatch(/confirmée/);
    expect(translateAuthError("boom")).toMatch(/erreur est survenue/);
  });
});

describe("onboarding", () => {
  it("étape 1 : nom obligatoire, champs vides transformés en undefined", () => {
    expect(businessInfoSchema.safeParse({ name: " ", activity: "", phone: "", email: "" }).success).toBe(false);
    const r = businessInfoSchema.safeParse({ name: "Institut", activity: "", phone: "", email: "" });
    expect(r.success && r.data).toEqual({ name: "Institut", activity: undefined, phone: undefined, email: undefined });
  });
  it("étape 1 : téléphone et email contrôlés", () => {
    expect(businessInfoSchema.safeParse({ name: "I", phone: "abc", email: "" }).success).toBe(false);
    expect(businessInfoSchema.safeParse({ name: "I", phone: "", email: "x@" }).success).toBe(false);
  });
  it("étape 3 : institut seul exige l'adresse de l'institut uniquement", () => {
    const r = parseLocationForm("salon", { salon_line1: "1 rue A", salon_city: "Toulouse" });
    expect(r.success && r.data.travel).toBeUndefined();
    expect(parseLocationForm("salon", {}).success).toBe(false);
  });
  it("étape 3 : domicile exige le point de départ et valide la zone", () => {
    expect(parseLocationForm("home", { travel_line1: "2 rue B", travel_city: "Blagnac", radius_km: "15" }).success).toBe(true);
    const bad = parseLocationForm("home", { travel_line1: "2 rue B", travel_city: "Blagnac", radius_km: "500" });
    expect(!bad.success && bad.errors.radius_km).toBeTruthy();
  });
  it("étape 3 : hybride peut réutiliser l'adresse de l'institut", () => {
    const r = parseLocationForm("hybrid", { salon_line1: "1 rue A", salon_city: "Toulouse", travel_same: "on" });
    expect(r.success && r.data.travel).toEqual(r.success && r.data.salon);
  });
  it("étape 4 : fuseau et durée limités aux valeurs proposées", () => {
    expect(settingsSchema.safeParse({ timezone: "Europe/Paris", defaultDuration: "60" }).success).toBe(true);
    expect(settingsSchema.safeParse({ timezone: "Mars/Olympus", defaultDuration: "60" }).success).toBe(false);
    expect(settingsSchema.safeParse({ timezone: "Europe/Paris", defaultDuration: "61" }).success).toBe(false);
  });
  it("logo : format et taille contrôlés", () => {
    expect(validateLogo(null)).toBeNull();
    expect(validateLogo({ size: 1000, type: "image/png" })).toBeNull();
    expect(validateLogo({ size: 1000, type: "image/svg+xml" })).toMatch(/Format/);
    expect(validateLogo({ size: 3 * 1024 * 1024, type: "image/png" })).toMatch(/2 Mo/);
  });
  it("reprise : on revient à l'étape enregistrée, jamais au-delà", () => {
    expect(resolveOnboardingStep(3, undefined)).toBe(3);
    expect(resolveOnboardingStep(3, "1")).toBe(1);
    expect(resolveOnboardingStep(3, "5")).toBe(3);
    expect(resolveOnboardingStep(null, "4")).toBe(1);
    expect(resolveOnboardingStep(3, "abc")).toBe(3);
  });
});

import { withValues } from "@/lib/validation/auth";

describe("withValues", () => {
  it("renvoie les valeurs saisies sans jamais inclure les mots de passe", () => {
    const fd = new FormData();
    fd.set("email", "a@b.fr");
    fd.set("password", "secret123");
    fd.set("confirm", "secret123");
    fd.set("$ACTION_ID_x", "interne");
    expect(withValues({ error: "x" }, fd).values).toEqual({ email: "a@b.fr" });
  });
});
