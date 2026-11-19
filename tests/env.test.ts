import { describe, expect, it } from "vitest";
import { parseAppEnv } from "@/lib/env";

describe("parseAppEnv", () => {
  it("reconnaît les environnements valides", () => {
    expect(parseAppEnv("production")).toBe("production");
    expect(parseAppEnv("demo")).toBe("demo");
  });
  it("retombe sur development pour une valeur absente ou invalide (jamais demo par erreur)", () => {
    expect(parseAppEnv(undefined)).toBe("development");
    expect(parseAppEnv("DEMO ")).toBe("development");
  });
});

import { getSupabasePublicConfig } from "@/lib/env";

describe("getSupabasePublicConfig", () => {
  it("renvoie null si la configuration est absente (pas de plantage)", () => {
    expect(getSupabasePublicConfig({})).toBeNull();
    expect(getSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" })).toBeNull();
  });
  it("accepte la clé publishable ou l'ancienne clé anon", () => {
    expect(getSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co/", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" })).toEqual({
      url: "https://x.supabase.co",
      publishableKey: "k",
    });
  });
  it("refuse une URL non sécurisée hors local", () => {
    expect(getSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: "http://x.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "k" })).toBeNull();
  });
});
