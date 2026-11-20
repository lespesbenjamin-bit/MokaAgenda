import type { Metadata } from "next";
import Link from "next/link";
import { Upload, UserPlus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { CustomersBrowser } from "@/components/customers/customers-browser";
import { requireBusinessContext } from "@/server/services/business-context";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import { listCustomers, listPrimaryAddresses } from "@/server/repositories/customers";

export const metadata: Metadata = { title: "Clientes" };

export default async function CustomersPage() {
  const ctx = await requireBusinessContext();
  const supabase = await createSupabaseServerClient();
  const [customers, addresses] = await Promise.all([
    listCustomers(supabase, ctx.business.id, { includeArchived: true }),
    listPrimaryAddresses(supabase, ctx.business.id),
  ]);
  const cityOf = new Map(addresses.map((a) => [a.customer_id, a.city]));

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Votre fichier clientes : coordonnées, adresses, préférences et consentements."
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/clientes/import">
                <Upload /> Importer
              </Link>
            </Button>
            <Button asChild>
              <Link href="/clientes/nouvelle">
                <UserPlus /> Nouvelle cliente
              </Link>
            </Button>
          </div>
        }
      />
      <CustomersBrowser
        customers={customers.map((c) => ({
          id: c.id,
          first_name: c.first_name,
          last_name: c.last_name,
          email: c.email,
          phone: c.phone,
          city: cityOf.get(c.id) ?? null,
          archived: Boolean(c.archived_at),
          source: c.source,
          created_at: c.created_at,
          updated_at: c.updated_at,
        }))}
      />
    </>
  );
}
