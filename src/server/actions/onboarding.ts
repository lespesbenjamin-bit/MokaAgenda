"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import {
  createBusiness,
  deleteLocation,
  findLocations,
  findMembershipForUser,
  removeLogo,
  saveLocation,
  updateBusiness,
  updateSettings,
  uploadLogo,
  type Business,
} from "@/server/repositories/business";
import {
  activityModeSchema,
  businessInfoSchema,
  needsSalonAddress,
  needsTravelBase,
  parseLocationForm,
  settingsSchema,
  validateLogo,
} from "@/lib/validation/onboarding";
import { toFieldErrors, withValues, type FormState } from "@/lib/validation/auth";
import { ROUTES } from "@/lib/routes";

/**
 * Toutes les écritures passent par le client Supabase de l'utilisatrice :
 * la RLS vérifie en base qu'elle est propriétaire de l'entreprise.
 * Aucune clé service_role n'est utilisée ici.
 */

const GENERIC_ERROR: FormState = { error: "L'enregistrement a échoué. Réessayez dans un instant." };

function formObject(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

async function context() {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();
  const membership = await findMembershipForUser(supabase, user.id);
  return { user, supabase, membership };
}

function ownedBusiness(membership: Awaited<ReturnType<typeof context>>["membership"]): Business | null {
  if (!membership || membership.role !== "business_owner") return null;
  return membership.business;
}

const nextStep = (business: Business, step: number) => Math.max(business.onboarding_step, step);

function goTo(step: number): never {
  revalidatePath(ROUTES.onboarding);
  redirect(`${ROUTES.onboarding}?etape=${step}`);
}

/** Étape 1 — informations de l'entreprise + logo. Crée l'entreprise au premier passage. */
export async function saveBusinessInfoAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = businessInfoSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues({ fieldErrors: toFieldErrors(parsed.error) }, formData);

  const logo = formData.get("logo");
  const logoFile = logo instanceof File && logo.size > 0 ? logo : null;
  const logoError = validateLogo(logoFile);
  if (logoError) return withValues({ fieldErrors: { logo: logoError } }, formData);

  const { user, supabase, membership } = await context();
  if (membership && membership.role !== "business_owner") return withValues({ error: "Seule la propriétaire peut modifier l'entreprise." }, formData);

  try {
    let business = membership?.business ?? null;
    if (!business) {
      await createBusiness(supabase, parsed.data);
      const created = await findMembershipForUser(supabase, user.id);
      if (!created) return withValues(GENERIC_ERROR, formData);
      business = created.business;
    } else {
      await updateBusiness(supabase, business.id, {
        name: parsed.data.name,
        activity: parsed.data.activity ?? null,
        phone: parsed.data.phone ?? null,
        email: parsed.data.email ?? null,
        onboarding_step: nextStep(business, 2),
      });
    }

    if (logoFile) {
      const path = await uploadLogo(supabase, business.id, logoFile);
      await updateBusiness(supabase, business.id, { logo_path: path });
      if (business.logo_path) await removeLogo(supabase, business.logo_path);
    }
  } catch (error) {
    console.error("[onboarding] étape 1", error);
    return withValues(GENERIC_ERROR, formData);
  }
  goTo(2);
}

/** Étape 2 — domicile, institut ou hybride. */
export async function saveActivityModeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = activityModeSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues({ fieldErrors: toFieldErrors(parsed.error) }, formData);

  const { supabase, membership } = await context();
  const business = ownedBusiness(membership);
  if (!business) goTo(1);

  try {
    await updateBusiness(supabase, business.id, { activity_mode: parsed.data.mode, onboarding_step: nextStep(business, 3) });
  } catch (error) {
    console.error("[onboarding] étape 2", error);
    return withValues(GENERIC_ERROR, formData);
  }
  goTo(3);
}

/** Étape 3 — adresses (institut, point de départ des déplacements) et zone. */
export async function saveLocationsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, membership } = await context();
  const business = ownedBusiness(membership);
  if (!business) goTo(1);
  if (!business.activity_mode) goTo(2);

  const mode = business.activity_mode;
  const parsed = parseLocationForm(mode, formObject(formData));
  if (!parsed.success) return withValues({ fieldErrors: parsed.errors }, formData);

  try {
    const { salon, travel, radiusKm } = parsed.data;
    if (salon) await saveLocation(supabase, business.id, "salon", salon);
    else await deleteLocation(supabase, business.id, "salon");
    if (travel) await saveLocation(supabase, business.id, "travel_base", travel);
    else await deleteLocation(supabase, business.id, "travel_base");
    await updateSettings(supabase, business.id, { service_radius_km: needsTravelBase(mode) ? (radiusKm ?? null) : null });
    await updateBusiness(supabase, business.id, { onboarding_step: nextStep(business, 4) });
  } catch (error) {
    console.error("[onboarding] étape 3", error);
    return withValues(GENERIC_ERROR, formData);
  }
  goTo(4);
}

/** Étape 4 — fuseau horaire et durée de rendez-vous par défaut. */
export async function saveSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = settingsSchema.safeParse(formObject(formData));
  if (!parsed.success) return withValues({ fieldErrors: toFieldErrors(parsed.error) }, formData);

  const { supabase, membership } = await context();
  const business = ownedBusiness(membership);
  if (!business) goTo(1);

  try {
    await updateSettings(supabase, business.id, {
      timezone: parsed.data.timezone,
      default_appointment_minutes: parsed.data.defaultDuration,
    });
    await updateBusiness(supabase, business.id, { onboarding_step: nextStep(business, 5) });
  } catch (error) {
    console.error("[onboarding] étape 4", error);
    return withValues(GENERIC_ERROR, formData);
  }
  goTo(5);
}

/** Étape 5 — vérifie que tout est complet puis ouvre le tableau de bord. */
export async function completeOnboardingAction(_prev: FormState): Promise<FormState> {
  void _prev; // signature imposée par useActionState
  const { supabase, membership } = await context();
  const business = ownedBusiness(membership);
  if (!business) goTo(1);
  if (!business.activity_mode) goTo(2);

  try {
    const locations = await findLocations(supabase, business.id);
    const kinds = new Set(locations.map((l) => l.kind));
    if (needsSalonAddress(business.activity_mode) && !kinds.has("salon")) goTo(3);
    if (needsTravelBase(business.activity_mode) && !kinds.has("travel_base")) goTo(3);
    if (business.onboarding_step < 5) goTo(business.onboarding_step);

    await updateBusiness(supabase, business.id, { onboarding_completed_at: new Date().toISOString() });
  } catch (error) {
    unstable_rethrow(error); // laisse passer les redirections Next.js
    console.error("[onboarding] étape 5", error);
    return GENERIC_ERROR;
  }
  revalidatePath("/", "layout");
  redirect(`${ROUTES.dashboard}?bienvenue=1`);
}
