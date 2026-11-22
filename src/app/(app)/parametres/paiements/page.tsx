import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormAlert } from "@/components/ui/form-alert";
import { StripeConnectButtons } from "@/components/finance/finance-forms";
import { isDemo } from "@/lib/env";
import { requireBusinessContext } from "@/server/services/business-context";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import { getPaymentAccount } from "@/server/repositories/finance";
import { refreshAccount } from "@/server/payments/service";
import { readStripeConfig } from "@/server/payments/stripe";
import { travelSecret } from "@/server/travel/service";

export const metadata: Metadata = { title: "Paiement en ligne" };
export const dynamic = "force-dynamic";

function State({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-sm">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />}
      <span>{children}</span>
    </p>
  );
}

export default async function PaymentSettingsPage({ searchParams }: PageProps<"/parametres/paiements">) {
  const ctx = await requireBusinessContext();
  if (ctx.role !== "business_owner") notFound();
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();
  const cfg = readStripeConfig();
  let account = await getPaymentAccount(supabase, ctx.business.id);
  // Retour de l'inscription Stripe : statut relu directement chez Stripe (jamais depuis l'URL).
  if (sp.stripe === "retour" && account && cfg) {
    await refreshAccount(account.stripe_account_id).catch(() => null);
    account = await getPaymentAccount(supabase, ctx.business.id);
  }
  return (
    <div>
      <PageHeader title="Paramètres" description="Encaissez les arrhes de vos réservations en ligne, directement sur votre compte Stripe." />
      <SettingsTabs active="/parametres/paiements" />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>Compte Stripe</CardTitle>
            <CardDescription>
              Les paiements de vos clientes arrivent sur VOTRE compte Stripe (jamais sur celui de Moka), puis Stripe les vire sur votre compte bancaire. Moka ne prend aucune commission. Aucun numéro de carte n&apos;est stocké par Moka.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {!cfg && <FormAlert type="info">Le paiement en ligne n&apos;est pas encore configuré sur le serveur (clé Stripe manquante). Voir le guide d&apos;installation, étape « Stripe ».</FormAlert>}
            {isDemo && <FormAlert type="info">Démonstration : Stripe fonctionne uniquement en mode test. Aucun paiement réel n&apos;est possible.</FormAlert>}
            {account && (
              <div className="flex flex-col gap-2">
                <State ok>Compte relié ({account.livemode ? "mode réel" : "mode test"})</State>
                <State ok={account.details_submitted}>{account.details_submitted ? "Informations transmises à Stripe" : "Inscription Stripe à terminer"}</State>
                <State ok={account.charges_enabled}>{account.charges_enabled ? "Paiements acceptés : les arrhes sont proposées sur votre page de réservation" : "Paiements pas encore activés par Stripe"}</State>
                <State ok={account.payouts_enabled}>{account.payouts_enabled ? "Virements vers votre banque activés" : "Virements pas encore activés"}</State>
                {account.requirements_due.length > 0 && <FormAlert type="info">Stripe attend encore {account.requirements_due.length} information(s). Cliquez sur « Terminer l&apos;inscription Stripe ».</FormAlert>}
                {account.disabled_reason && <p className="text-xs text-muted-foreground">Motif indiqué par Stripe : {account.disabled_reason}</p>}
              </div>
            )}
            {cfg && travelSecret() && <StripeConnectButtons connected={Boolean(account)} ready={Boolean(account?.charges_enabled && account.details_submitted && account.requirements_due.length === 0)} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Coûts</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
            <p>Ouverture du compte : gratuite.</p>
            <p>Par paiement : frais Stripe prélevés sur votre compte (tarif standard des cartes européennes : 1,5 % + 0,25 €, cartes premium et hors Europe plus chères — voir stripe.com/fr/pricing).</p>
            <p>Remboursement : les frais du paiement d&apos;origine ne sont pas rendus par Stripe.</p>
            <p>Les montants exacts des frais apparaissent dans Finances → Paiements dès que Stripe les communique.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
