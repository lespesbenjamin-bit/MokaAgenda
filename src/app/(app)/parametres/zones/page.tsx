import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormAlert } from "@/components/ui/form-alert";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { AreaForm } from "@/components/travel/travel-forms";
import { TravelMap, type MapCircle, type MapMarker } from "@/components/travel/travel-map";
import { requireBusinessContext } from "@/server/services/business-context";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import { getTravelSettings, listAreas, listGeoLocations } from "@/server/repositories/travel";
import { formatEuros } from "@/lib/domain/pricing";
import { WEEKDAY_LABELS } from "@/lib/domain/appointments";

export const metadata: Metadata = { title: "Zones d'intervention" };

export default async function AreasPage() {
  const ctx = await requireBusinessContext();
  const supabase = await createSupabaseServerClient();
  const [areas, locations, settings] = await Promise.all([listAreas(supabase, ctx.business.id), listGeoLocations(supabase, ctx.business.id), getTravelSettings(supabase, ctx.business.id)]);
  const startKind = settings?.start_point === "salon" ? "salon" : "travel_base";
  const start = locations.find((l) => l.kind === startKind && l.latitude != null) ?? locations.find((l) => l.latitude != null);
  const markers: MapMarker[] = start ? [{ lat: start.latitude!, lng: start.longitude!, label: "Point de départ", kind: "start" }] : [];
  const circles: MapCircle[] = start
    ? areas.filter((z) => z.kind === "radius" && z.max_km != null && z.is_active).map((z) => ({ lat: start.latitude!, lng: start.longitude!, radiusKm: z.max_km!, label: `${z.name} (${z.max_km} km par la route)`, excluded: z.excluded }))
    : [];
  const isOwner = ctx.role === "business_owner";

  return (
    <div>
      <PageHeader title="Paramètres" description="Où vous intervenez à domicile, et à quelles conditions." />
      <SettingsTabs active="/parametres/zones" />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Carte</CardTitle>
              <CardDescription>Les cercles sont un repère visuel. Une zone « par distance » est vérifiée avec la distance ROUTIÈRE réelle depuis votre point de départ, pas à vol d&apos;oiseau.</CardDescription>
            </CardHeader>
            <CardContent>
              {start ? <TravelMap markers={markers} circles={circles} height={340} /> : <FormAlert type="info">Localisez votre point de départ dans l&apos;onglet Déplacements pour afficher la carte.</FormAlert>}
            </CardContent>
          </Card>
          {areas.map((z) => (
            <Card key={z.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>{z.name}</CardTitle>
                  {z.excluded ? <Badge variant="warning">Exclue</Badge> : <Badge variant="available">Desservie</Badge>}
                </div>
                <CardDescription>
                  {z.kind === "radius" ? `Jusqu'à ${z.max_km} km par la route` : `Codes postaux : ${(z.postcodes ?? []).join(", ")}`}
                  {z.surcharge_cents > 0 ? ` · supplément ${formatEuros(z.surcharge_cents)}` : ""}
                  {z.min_order_cents > 0 ? ` · minimum ${formatEuros(z.min_order_cents)}` : ""}
                  {z.weekdays ? ` · ${z.weekdays.map((d) => WEEKDAY_LABELS[d - 1].slice(0, 3)).join(", ")}` : ""}
                </CardDescription>
              </CardHeader>
              {isOwner && (
                <CardContent>
                  <details>
                    <summary className="cursor-pointer text-sm font-semibold">Modifier</summary>
                    <div className="mt-3"><AreaForm area={z} /></div>
                  </details>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
        <div className="flex flex-col gap-6">
          {isOwner && (
            <Card>
              <CardHeader>
                <CardTitle>Ajouter une zone</CardTitle>
                <CardDescription>Sans zone, la réservation à domicile est ouverte partout (ou dans le rayon défini à l&apos;onboarding).</CardDescription>
              </CardHeader>
              <CardContent>
                <AreaForm area={null} />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
