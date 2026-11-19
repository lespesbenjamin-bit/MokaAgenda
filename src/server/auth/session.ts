import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient, SupabaseNotConfiguredError } from "@/server/integrations/supabase/server";
import { ROUTES } from "@/lib/routes";

/**
 * Utilisatrice connectée, vérifiée auprès de Supabase Auth (getUser fait
 * un appel serveur : un cookie falsifié ou révoqué est refusé).
 * Mémorisée pour la durée d'une requête.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    // Configuration absente : personne n'est connecté (la page de connexion l'explique).
    if (error instanceof SupabaseNotConfiguredError) return null;
    throw error;
  }
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});

/** À appeler en tête de chaque page et action privée. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect(ROUTES.login);
  return user;
}
