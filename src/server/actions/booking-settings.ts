"use server";

import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/server/services/business-context";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import { removeLogo, updateBusiness, updateSettings, uploadCover } from "@/server/repositories/business";
import { isUniqueViolation } from "@/server/repositories/catalog";
import { bookingSettingsSchema } from "@/lib/validation/public-booking";
import { toFieldErrors, withValues, type FormState } from "@/lib/validation/auth";
import { validateLogo } from "@/lib/validation/onboarding";
import { bookingPath } from "@/lib/domain/slug";

/**
 * Réglages de la page publique de réservation. Réservé à la propriétaire ;
 * la RLS et les droits par colonne de la base font foi.
 */
export async function saveBookingSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireBusinessContext();
  if (ctx.role !== "business_owner") return { error: "Seule la propriétaire peut modifier la page de réservation." };

  const str = (k: string) => String(formData.get(k) ?? "");
  const parsed = bookingSettingsSchema.safeParse({
    booking_enabled: formData.get("booking_enabled") === "on",
    slug: str("slug"),
    public_description: str("public_description"),
    public_phone: str("public_phone"),
    public_email: str("public_email"),
    public_instagram: str("public_instagram"),
    cancellation_policy: str("cancellation_policy"),
    booking_terms: str("booking_terms"),
    cancellation_notice_hours: str("cancellation_notice_hours"),
    customer_can_cancel: formData.get("customer_can_cancel") === "on",
    customer_can_reschedule: formData.get("customer_can_reschedule") === "on",
    booking_window_days: str("booking_window_days"),
    slot_step_minutes: str("slot_step_minutes"),
    notification_email: str("notification_email"),
  });
  if (!parsed.success) return withValues({ error: "Certains champs sont à corriger.", fieldErrors: toFieldErrors(parsed.error) }, formData);

  const cover = formData.get("cover");
  const coverFile = cover instanceof File && cover.size > 0 ? cover : null;
  const coverError = validateLogo(coverFile);
  if (coverError) return withValues({ fieldErrors: { cover: coverError.replace("Le logo", "La photo") } }, formData);

  const supabase = await createSupabaseServerClient();
  const { slug, ...settings } = parsed.data;
  const previousCover = ctx.settings?.cover_path ?? null;
  try {
    if (slug !== ctx.business.slug) {
      try {
        await updateBusiness(supabase, ctx.business.id, { slug });
      } catch (error) {
        if (isUniqueViolation(error)) return withValues({ fieldErrors: { slug: "Cette adresse est déjà utilisée par une autre professionnelle." } }, formData);
        throw error;
      }
    }
    let coverPath: string | null | undefined;
    if (coverFile) coverPath = await uploadCover(supabase, ctx.business.id, coverFile);
    else if (formData.get("remove_cover") === "on") coverPath = null;

    await updateSettings(supabase, ctx.business.id, { ...settings, ...(coverPath !== undefined ? { cover_path: coverPath } : {}) });
    if (coverPath !== undefined && previousCover) await removeLogo(supabase, previousCover);
  } catch (error) {
    console.error("[paramètres] réservation en ligne", error);
    return withValues({ error: "Enregistrement impossible. Réessayez dans un instant." }, formData);
  }

  revalidatePath("/parametres");
  revalidatePath("/tableau-de-bord");
  revalidatePath(bookingPath(slug));
  if (slug !== ctx.business.slug) revalidatePath(bookingPath(ctx.business.slug));
  return { success: settings.booking_enabled ? "Enregistré. Votre page de réservation est en ligne." : "Enregistré. Votre page de réservation est désactivée." };
}
