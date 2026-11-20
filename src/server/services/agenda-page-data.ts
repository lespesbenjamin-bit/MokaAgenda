import "server-only";
import { requireBusinessContext } from "@/server/services/business-context";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import { listBookableServices } from "@/server/services/booking-catalog";
import { listCategories, toPricing } from "@/server/repositories/catalog";
import { listCustomers } from "@/server/repositories/customers";
import { offeredPlaces, totalMobilizedMinutes, totalPriceCents, type Place } from "@/lib/domain/pricing";
import { displayName } from "@/lib/domain/customers";
import type { BookableService, CustomerOption } from "@/components/agenda/appointment-form";

/** Données communes aux formulaires de rendez-vous. */
export async function loadAppointmentFormData() {
  const ctx = await requireBusinessContext();
  const supabase = await createSupabaseServerClient();
  const [services, categories, customers] = await Promise.all([
    listBookableServices(supabase, ctx.business.id),
    listCategories(supabase, ctx.business.id),
    listCustomers(supabase, ctx.business.id),
  ]);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const mode = ctx.business.activity_mode;
  const allowedPlaces: Place[] = mode === "home" ? ["home"] : mode === "salon" ? ["salon"] : ["salon", "home"];

  const bookable: BookableService[] = services.map((s) => {
    const pricing = toPricing(s);
    const prices: Partial<Record<Place, number>> = {};
    for (const p of offeredPlaces(pricing)) prices[p] = totalPriceCents(pricing, p);
    return {
      id: s.id,
      name: s.name,
      category: s.category_id ? catName.get(s.category_id) ?? null : null,
      durationMinutes: s.duration_minutes,
      mobilizedMinutes: totalMobilizedMinutes({ durationMinutes: s.duration_minutes, prepMinutes: s.prep_minutes, cleanupMinutes: s.cleanup_minutes }) + s.buffer_minutes,
      prices,
    };
  });
  const options: CustomerOption[] = customers.map((c) => ({ id: c.id, name: displayName(c), phone: c.phone, email: c.email }));
  return { ctx, supabase, services: bookable, customers: options, allowedPlaces, timeZone: ctx.settings?.timezone ?? "Europe/Paris" };
}
