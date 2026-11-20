import type { Metadata } from "next";
import { KeyRound } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/layout/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { LocationGeocoder, TravelSettingsForm, VehicleForm } from "@/components/travel/travel-forms";
import { requireBusinessContext } from "@/server/services/business-context";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import { getTravelSettings, listGeoLocations, listVehicles } from "@/server/repositories/travel";
import { travelSecret } from "@/server/travel/service";

export const metadata: Metadata = { title: "Déplacements" };

export default async function TravelSettingsPage() {
  const ctx = await requireBusinessContext();
  const supabase = await createSupabaseServerClient();
  const [settings, locations, vehicles] = await Promise.all([
    getTravelSettings(supabase, ctx.business.id),
    listGeoLocations(supabase, ctx.business.id),
    listVehicles(supabase, ctx.business.id),
  ]);
  const salon = locations.find((l) => l.kind === "salon");
  const base = locations.find((l) => l.kind === "travel_base");
  const vehicle = vehicles.find((v) => v.is_default) ?? vehicles[0] ?? null;
  const secretOk = Boolean(travelSecret());
  const isOwner = ctx.role === "business_owner";
  const addr = (l: typeof salon) => (l ? `${l.address_line1}, ${l.postal_code ?? ""} ${l.city}` : "");

  return (
    <div>
      <PageHeader title="Paramètres" description="Vos trajets, votre véhicule et vos frais de déplacement." />
      <SettingsTabs active="/parametres/deplacements" />
      {!isOwner && <FormAlert type="info">Seule la propriétaire du compte peut modifier ces réglages.</FormAlert>}
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Points de départ</CardTitle>
              <CardDescription>Adresses privées : jamais affichées sur votre page publique. Elles sont localisées avec la Base Adresse Nationale (IGN).</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {base && <LocationGeocoder kind="travel_base" label="Départ des tournées" address={addr(base)} located={base.geocode_label} />}
              {salon && <LocationGeocoder kind="salon" label="Institut" address={addr(salon)} located={salon.geocode_label} />}
              {!base && !salon && <FormAlert type="info">Aucune adresse enregistrée : complétez l&apos;étape « Localisation » de l&apos;onboarding.</FormAlert>}
            </CardContent>
          </Card>
          {isOwner && settings && (
            <Card>
              <CardHeader>
                <CardTitle>Trajets et frais</CardTitle>
              </CardHeader>
              <CardContent>
                <TravelSettingsForm
                  hasBase={Boolean(base)}
                  hasSalon={Boolean(salon)}
                  d={{ ...settings }}
                />
              </CardContent>
            </Card>
          )}
          {isOwner && (
            <Card>
              <CardHeader>
                <CardTitle>Véhicule et coûts</CardTitle>
                <CardDescription>Sert à estimer le coût réel de chaque trajet : il est distinct des frais facturés à la cliente.</CardDescription>
              </CardHeader>
              <CardContent>
                <VehicleForm vehicle={vehicle} />
              </CardContent>
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <p className="flex items-start gap-2">
                <KeyRound className={secretOk ? "mt-0.5 size-4 shrink-0 text-success" : "mt-0.5 size-4 shrink-0 text-warning"} />
                {secretOk ? "Clé de signature des trajets installée." : "Clé de signature des trajets manquante : les trajets ne peuvent pas encore être calculés. Voir la procédure dans le guide d'installation (étape « Déplacements »)."}
              </p>
              <p className="text-muted-foreground">Trajets calculés par le service public IGN Géoplateforme (réseau routier BD TOPO), sans trafic en temps réel : la marge de sécurité compense.</p>
              <p className="text-muted-foreground">Statut : {settings?.enabled ? "trajets pris en compte" : "désactivé"} · version des réglages {settings?.version ?? "—"}.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
