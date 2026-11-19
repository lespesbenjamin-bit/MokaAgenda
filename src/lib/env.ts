import { z } from "zod";

/**
 * Environnement d'exécution de l'application.
 * - production : vraies données, aucune donnée fictive autorisée.
 * - demo       : base Supabase distincte, données fictives, paiements test.
 * - development: poste local.
 */
export const appEnvSchema = z.enum(["production", "demo", "development"]);
export type AppEnv = z.infer<typeof appEnvSchema>;

export function parseAppEnv(value: string | undefined): AppEnv {
  const parsed = appEnvSchema.safeParse(value);
  return parsed.success ? parsed.data : "development";
}

export const appEnv: AppEnv = parseAppEnv(process.env.NEXT_PUBLIC_APP_ENV);
export const isDemo = appEnv === "demo";
export const isProduction = appEnv === "production";

export interface SupabasePublicConfig {
  url: string;
  publishableKey: string;
}

/**
 * Configuration publique Supabase (URL + clé publique « publishable » ou « anon »).
 * Renvoie null si elle est absente ou invalide : l'application l'affiche
 * clairement au lieu de planter.
 */
export function getSupabasePublicConfig(
  env: Record<string, string | undefined> = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
): SupabasePublicConfig | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = (env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  if (!url || !publishableKey) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") return null;
  } catch {
    return null;
  }
  return { url: url.replace(/\/+$/, ""), publishableKey };
}

/** URL publique de l'application, utilisée dans les liens envoyés par email. */
export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}
