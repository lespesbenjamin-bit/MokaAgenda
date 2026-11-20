import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { FormAlert } from "@/components/ui/form-alert";
import { Badge } from "@/components/ui/badge";
import { ServiceForm } from "@/components/catalog/service-form";
import { toFormDefaults } from "@/components/catalog/service-form-defaults";
import { requireBusinessContext } from "@/server/services/business-context";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import { getService, listCategories, servicePhotoUrl } from "@/server/repositories/catalog";

export const metadata: Metadata = { title: "Prestation" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditServicePage({ params, searchParams }: PageProps<"/prestations/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requireBusinessContext();
  const supabase = await createSupabaseServerClient();
  const [service, categories] = await Promise.all([getService(supabase, ctx.business.id, id), listCategories(supabase, ctx.business.id)]);
  if (!service) notFound();
  const sp = await searchParams;
  const canEdit = ctx.role === "business_owner";

  return (
    <>
      <PageHeader
        title={service.name}
        eyebrow={service.archived_at ? <Badge variant="soon" className="w-fit">Archivée</Badge> : undefined}
        description={canEdit ? "Modifiez la prestation puis enregistrez." : "Consultation uniquement : seule la propriétaire peut modifier le catalogue."}
      />
      {sp.copie === "1" && (
        <div className="mb-5">
          <FormAlert type="success">Copie créée. Elle est inactive : vérifiez-la, renommez-la si besoin, puis activez-la.</FormAlert>
        </div>
      )}
      <fieldset disabled={!canEdit} className="contents">
        <ServiceForm
          defaults={toFormDefaults({ ...service, photoUrl: servicePhotoUrl(supabase, service.photo_path) })}
          categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        />
      </fieldset>
    </>
  );
}
