import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "@/lib/env";

/**
 * Client Supabase ANONYME pour la réservation publique : clé publique,
 * aucune session, aucun cookie. Il ne peut appeler que les fonctions
 * public_* (aucun accès direct aux tables). Jamais de clé service_role.
 */
let cached: SupabaseClient | null = null;

export function createSupabasePublicClient(): SupabaseClient | null {
  const config = getSupabasePublicConfig();
  if (!config) return null;
  cached ??= createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return cached;
}
