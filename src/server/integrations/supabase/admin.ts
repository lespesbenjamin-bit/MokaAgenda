import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "@/lib/env";

/**
 * Client Supabase avec la clé service_role : CONTOURNE la sécurité RLS.
 *
 * Usage strictement limité aux tâches d'administration côté serveur
 * (réinitialisation de la démo). JAMAIS pour une action utilisatrice.
 * L'import de "server-only" fait échouer la compilation si ce fichier
 * est importé par un composant exécuté dans le navigateur.
 */
export function createSupabaseAdminClient() {
  const config = getSupabasePublicConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!config || !serviceRoleKey) {
    throw new Error("Configuration administrateur Supabase manquante (SUPABASE_SERVICE_ROLE_KEY).");
  }
  return createClient(config.url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
