import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpenseList, FinancialSettingsForm } from "@/components/finance/finance-forms";
import { requireBusinessContext } from "@/server/services/business-context";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import { getFinancialSettings, listExpenses } from "@/server/repositories/finance";

export const metadata: Metadata = { title: "Paramètres financiers" };

export default async function FinanceSettingsPage() {
  const ctx = await requireBusinessContext();
  if (ctx.role !== "business_owner") notFound();
  const supabase = await createSupabaseServerClient();
  const [settings, expenses] = await Promise.all([getFinancialSettings(supabase, ctx.business.id), listExpenses(supabase, ctx.business.id)]);
  return (
    <div>
      <PageHeader title="Paramètres" description="Votre régime, la TVA, vos cotisations estimées et vos charges fixes." />
      <SettingsTabs active="/parametres/finances" />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Régime, TVA et cotisations</CardTitle>
            <CardDescription>Servent uniquement aux estimations du tableau de bord financier.</CardDescription>
          </CardHeader>
          <CardContent>{settings && <FinancialSettingsForm d={settings} />}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Charges fixes</CardTitle>
            <CardDescription>Loyer, assurance, logiciels, téléphone… réparties au prorata des jours de chaque période affichée.</CardDescription>
          </CardHeader>
          <CardContent><ExpenseList expenses={expenses} /></CardContent>
        </Card>
      </div>
    </div>
  );
}
