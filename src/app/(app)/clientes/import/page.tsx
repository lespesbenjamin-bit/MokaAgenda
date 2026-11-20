import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { ImportWizard } from "@/components/customers/import-wizard";

export const metadata: Metadata = { title: "Importer des clientes" };

export default function ImportPage() {
  return (
    <>
      <PageHeader title="Importer des clientes" description="Depuis un fichier CSV. Vous vérifiez tout avant la moindre création de fiche." />
      <ImportWizard />
    </>
  );
}
