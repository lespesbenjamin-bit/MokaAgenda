import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { CatalogTabs } from "@/components/catalog/catalog-tabs";
import { ServicesBrowser } from "@/components/catalog/services-browser";
import { loadCatalog, toListItem } from "@/server/services/catalog-context";

export const metadata: Metadata = { title: "Prestations" };

export default async function ServicesPage({ searchParams }: PageProps<"/prestations">) {
  const { categories, services, canEdit } = await loadCatalog({ includeArchived: true });
  const params = await searchParams;
  const saved = typeof params.enregistre === "string" ? params.enregistre.slice(0, 120) : null;

  return (
    <>
      <PageHeader
        title="Prestations"
        description="Votre carte de soins : durées, tarifs à domicile et en institut, acomptes et marges indicatives."
        actions={
          canEdit && (
            <Button asChild>
              <Link href="/prestations/nouvelle">
                <Plus /> Nouvelle prestation
              </Link>
            </Button>
          )
        }
      />
      <CatalogTabs current="services" />
      {saved && (
        <div className="mb-5">
          <FormAlert type="success">Prestation « {saved} » enregistrée.</FormAlert>
        </div>
      )}
      <ServicesBrowser services={services.map(toListItem)} categories={categories.map((c) => ({ id: c.id, name: c.name }))} canEdit={canEdit} />
    </>
  );
}
