import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityMode } from "@/lib/validation/onboarding";

/**
 * Accès aux données « entreprise ». Seul endroit qui interroge ces tables.
 * Le client passé agit au nom de l'utilisatrice : la RLS s'applique.
 */

export type MemberRole = "business_owner" | "staff";

export interface Business {
  id: string;
  name: string;
  activity: string | null;
  activity_mode: ActivityMode | null;
  phone: string | null;
  email: string | null;
  logo_path: string | null;
  /** Adresse publique : /reserver/<slug> */
  slug: string;
  onboarding_step: number;
  onboarding_completed_at: string | null;
}

export interface BusinessSettings {
  business_id: string;
  timezone: string;
  currency: string;
  default_appointment_minutes: number;
  service_radius_km: number | null;
  booking_terms: string | null;
  // Réservation en ligne (Sprint 4)
  booking_enabled: boolean;
  public_description: string | null;
  cover_path: string | null;
  public_phone: string | null;
  public_email: string | null;
  public_instagram: string | null;
  cancellation_policy: string | null;
  cancellation_notice_hours: number;
  customer_can_cancel: boolean;
  customer_can_reschedule: boolean;
  booking_window_days: number;
  slot_step_minutes: number;
  notification_email: string | null;
}

export type BookingSettingsPatch = Partial<
  Pick<
    BusinessSettings,
    | "booking_enabled"
    | "public_description"
    | "cover_path"
    | "public_phone"
    | "public_email"
    | "public_instagram"
    | "cancellation_policy"
    | "booking_terms"
    | "cancellation_notice_hours"
    | "customer_can_cancel"
    | "customer_can_reschedule"
    | "booking_window_days"
    | "slot_step_minutes"
    | "notification_email"
  >
>;

export type LocationKind = "salon" | "travel_base";

export interface BusinessLocation {
  id: string;
  kind: LocationKind;
  address_line1: string;
  postal_code: string | null;
  city: string;
}

export class RepositoryError extends Error {
  constructor(context: string, cause?: { message?: string; code?: string }) {
    super(`${context} : ${cause?.message ?? "erreur inconnue"}`);
    this.name = "RepositoryError";
  }
}

const BUSINESS_COLUMNS =
  "id, name, activity, activity_mode, phone, email, logo_path, slug, onboarding_step, onboarding_completed_at";

/** Entreprise principale de l'utilisatrice (Sprint 1 : une entreprise par compte). */
export async function findMembershipForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ business: Business; role: MemberRole } | null> {
  const { data: membership, error } = await supabase
    .from("business_members")
    .select("business_id, role")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new RepositoryError("Lecture de l'appartenance", error);
  if (!membership) return null;

  const { data: business, error: bError } = await supabase
    .from("businesses")
    .select(BUSINESS_COLUMNS)
    .eq("id", membership.business_id)
    .maybeSingle();
  if (bError) throw new RepositoryError("Lecture de l'entreprise", bError);
  if (!business) return null;
  return { business: business as Business, role: membership.role as MemberRole };
}

const SETTINGS_COLUMNS =
  "business_id, timezone, currency, default_appointment_minutes, service_radius_km, booking_terms, booking_enabled, public_description, cover_path, public_phone, public_email, public_instagram, cancellation_policy, cancellation_notice_hours, customer_can_cancel, customer_can_reschedule, booking_window_days, slot_step_minutes, notification_email";

export async function findSettings(supabase: SupabaseClient, businessId: string): Promise<BusinessSettings | null> {
  const { data, error } = await supabase
    .from("business_settings")
    .select(SETTINGS_COLUMNS)
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw new RepositoryError("Lecture des paramètres", error);
  return data as BusinessSettings | null;
}

export async function findLocations(supabase: SupabaseClient, businessId: string): Promise<BusinessLocation[]> {
  const { data, error } = await supabase
    .from("locations")
    .select("id, kind, address_line1, postal_code, city")
    .eq("business_id", businessId);
  if (error) throw new RepositoryError("Lecture des adresses", error);
  return (data ?? []) as BusinessLocation[];
}

export async function createBusiness(
  supabase: SupabaseClient,
  input: { name: string; activity?: string; phone?: string; email?: string },
): Promise<string> {
  const { data, error } = await supabase.rpc("create_business", {
    p_name: input.name,
    p_activity: input.activity ?? null,
    p_phone: input.phone ?? null,
    p_email: input.email ?? null,
  });
  if (error || !data) throw new RepositoryError("Création de l'entreprise", error ?? undefined);
  return data as string;
}

/**
 * Met à jour l'entreprise. Une mise à jour bloquée par la RLS ne renvoie
 * pas d'erreur mais 0 ligne : on le détecte et on refuse explicitement.
 */
export async function updateBusiness(
  supabase: SupabaseClient,
  businessId: string,
  patch: Partial<Omit<Business, "id">>,
): Promise<void> {
  const { data, error } = await supabase.from("businesses").update(patch).eq("id", businessId).select("id");
  if (error) throw new RepositoryError("Mise à jour de l'entreprise", error);
  if (!data || data.length === 0) throw new RepositoryError("Mise à jour de l'entreprise", { message: "non autorisée" });
}

export async function updateSettings(
  supabase: SupabaseClient,
  businessId: string,
  patch: Partial<Pick<BusinessSettings, "timezone" | "default_appointment_minutes" | "service_radius_km">> | BookingSettingsPatch,
): Promise<void> {
  const { data, error } = await supabase
    .from("business_settings")
    .update(patch)
    .eq("business_id", businessId)
    .select("business_id");
  if (error) throw new RepositoryError("Mise à jour des paramètres", error);
  if (!data || data.length === 0) throw new RepositoryError("Mise à jour des paramètres", { message: "non autorisée" });
}

/** Crée ou met à jour l'adresse d'un type donné (pas d'upsert : droits par colonne). */
export async function saveLocation(
  supabase: SupabaseClient,
  businessId: string,
  kind: LocationKind,
  address: { line1: string; postalCode?: string; city: string },
): Promise<void> {
  const values = { address_line1: address.line1, postal_code: address.postalCode ?? null, city: address.city };
  const { data: existing, error } = await supabase
    .from("locations")
    .select("id")
    .eq("business_id", businessId)
    .eq("kind", kind)
    .maybeSingle();
  if (error) throw new RepositoryError("Lecture de l'adresse", error);

  if (existing) {
    const { data, error: uError } = await supabase.from("locations").update(values).eq("id", existing.id).select("id");
    if (uError) throw new RepositoryError("Mise à jour de l'adresse", uError);
    if (!data?.length) throw new RepositoryError("Mise à jour de l'adresse", { message: "non autorisée" });
  } else {
    const { error: iError } = await supabase.from("locations").insert({ business_id: businessId, kind, ...values });
    if (iError) throw new RepositoryError("Création de l'adresse", iError);
  }
}

export async function deleteLocation(supabase: SupabaseClient, businessId: string, kind: LocationKind): Promise<void> {
  const { error } = await supabase.from("locations").delete().eq("business_id", businessId).eq("kind", kind);
  if (error) throw new RepositoryError("Suppression de l'adresse", error);
}

export const LOGO_BUCKET = "business-logos";

export async function uploadLogo(supabase: SupabaseClient, businessId: string, file: File): Promise<string> {
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${businessId}/logo-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(LOGO_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
    cacheControl: "31536000",
  });
  if (error) throw new RepositoryError("Envoi du logo", error);
  return path;
}

export async function removeLogo(supabase: SupabaseClient, path: string): Promise<void> {
  await supabase.storage.from(LOGO_BUCKET).remove([path]);
}

/** Photo de couverture de la page publique (même espace de stockage public que le logo). */
export async function uploadCover(supabase: SupabaseClient, businessId: string, file: File): Promise<string> {
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${businessId}/cover-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(LOGO_BUCKET).upload(path, file, { contentType: file.type, upsert: false, cacheControl: "31536000" });
  if (error) throw new RepositoryError("Envoi de la photo de couverture", error);
  return path;
}

export function getLogoUrl(supabase: SupabaseClient, path: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
}
