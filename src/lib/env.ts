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
