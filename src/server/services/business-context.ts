import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import {
  findLocations,
  findMembershipForUser,
  findSettings,
  getLogoUrl,
  type Business,
  type BusinessLocation,
  type BusinessSettings,
  type MemberRole,
} from "@/server/repositories/business";
import { ROUTES } from "@/lib/routes";

export interface BusinessContext {
  userId: string;
  userEmail: string | null;
  fullName: string | null;
  business: Business;
  role: MemberRole;
  settings: BusinessSettings | null;
  locations: BusinessLocation[];
  logoUrl: string | null;
}

/** Entreprise de l'utilisatrice connectée, ou null si aucune (onboarding non commencé). */
export const getMembership = cache(async () => {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();
  const membership = await findMembershipForUser(supabase, user.id);
  return { user, supabase, membership };
});

/**
 * Contexte complet pour l'espace pro. Redirige vers l'onboarding
 * tant que la configuration n'est pas terminée.
 */
export const requireBusinessContext = cache(async (): Promise<BusinessContext> => {
  const { user, supabase, membership } = await getMembership();
  if (!membership || !membership.business.onboarding_completed_at) redirect(ROUTES.onboarding);

  const [settings, locations] = await Promise.all([
    findSettings(supabase, membership.business.id),
    findLocations(supabase, membership.business.id),
  ]);

  const meta = user.user_metadata as { full_name?: unknown } | undefined;
  return {
    userId: user.id,
    userEmail: user.email ?? null,
    fullName: typeof meta?.full_name === "string" ? meta.full_name : null,
    business: membership.business,
    role: membership.role,
    settings,
    locations,
    logoUrl: getLogoUrl(supabase, membership.business.logo_path),
  };
});
