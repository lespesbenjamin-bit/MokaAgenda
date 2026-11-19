import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { CatalogTabs } from "@/components/catalog/catalog-tabs";
import { CategoryManager } from "@/components/catalog/category-manager";
import { requireBusinessContext } from "@/server/services/business-context";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import { listCategories, listServices } from "@/server/repositories/catalog";

export const metadata: Metadata = { title: "Catégories de prestations" };

export default async function CategoriesPage() {
  const ctx = await requireBusinessContext();
  const supabase = await createSupabaseServerClient();
  const [categories, services] = await Promise.all([
    listCategories(supabase, ctx.business.id, { includeArchived: true }),
    listServices(supabase, ctx.business.id),
  ]);
  return (
    <>
      <PageHeader title="Prestations" description="Organisez votre carte en catégories, dans l'ordre où vos clientes les verront." />
      <CatalogTabs current="categories" />
      <CategoryManager
        canEdit={ctx.role === "business_owner"}
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          isVisible: c.is_visible,
          archived: Boolean(c.archived_at),
          serviceCount: services.filter((s) => s.category_id === c.id).length,
        }))}
      />
    </>
  );
}
