import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ServiceForm } from "@/components/catalog/service-form";
import { EMPTY_SERVICE } from "@/components/catalog/service-form-defaults";
import { loadCatalog } from "@/server/services/catalog-context";

export const metadata: Metadata = { title: "Nouvelle prestation" };

export default async function NewServicePage() {
  const { categories, canEdit } = await loadCatalog();
  if (!canEdit) redirect("/prestations");
  return (
    <>
      <PageHeader title="Nouvelle prestation" description="Les champs marqués d'un astérisque dans votre navigateur sont obligatoires." />
      <ServiceForm defaults={EMPTY_SERVICE} categories={categories.filter((c) => !c.archived_at).map((c) => ({ id: c.id, name: c.name }))} />
    </>
  );
}
