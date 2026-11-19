import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "@/lib/env";

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super("Supabase n'est pas configuré : NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY sont requis.");
    this.name = "SupabaseNotConfiguredError";
  }
}

/**
 * Client Supabase côté serveur, agissant AU NOM de l'utilisatrice connectée
 * (clé publique + cookie de session). Toutes les requêtes sont soumises aux
 * politiques RLS. À utiliser pour toutes les opérations utilisateur.
 */
export async function createSupabaseServerClient() {
  // Lire les cookies d'abord : marque la route comme dynamique (jamais
  // pré-rendue au build), même si la configuration est absente.
  const cookieStore = await cookies();
  const config = getSupabasePublicConfig();
  if (!config) throw new SupabaseNotConfiguredError();

  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Appelé depuis un Server Component : les cookies ne peuvent pas être
          // écrits ici. Le proxy rafraîchit la session à chaque requête.
        }
      },
    },
  });
}
