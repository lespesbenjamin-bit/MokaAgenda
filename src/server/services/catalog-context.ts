import "server-only";
import { requireBusinessContext } from "@/server/services/business-context";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import { listCategories, listServices, toPricing, type Service } from "@/server/repositories/catalog";
import type { ServiceListItem } from "@/components/catalog/services-browser";

export async function loadCatalog({ includeArchived = false } = {}) {
  const ctx = await requireBusinessContext();
  const supabase = await createSupabaseServerClient();
  const [categories, services] = await Promise.all([
    listCategories(supabase, ctx.business.id),
    listServices(supabase, ctx.business.id, { includeArchived }),
  ]);
  return { ctx, supabase, categories, services, canEdit: ctx.role === "business_owner" };
}

export function toListItem(s: Service): ServiceListItem {
  return {
    id: s.id,
    name: s.name,
    categoryId: s.category_id,
    durationMinutes: s.duration_minutes,
    prepMinutes: s.prep_minutes,
    cleanupMinutes: s.cleanup_minutes,
    isActive: s.is_active,
    onlineBookable: s.online_bookable,
    archived: Boolean(s.archived_at),
    pricing: toPricing(s),
    costs: { consumablesCents: s.costs.consumablesCents, productsCents: s.costs.productsCents, otherCents: s.costs.otherCents },
  };
}
