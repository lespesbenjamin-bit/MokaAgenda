import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Home, Store } from "lucide-react";
import { getNavItem } from "@/config/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/layout/page-header";
import { TravelMap, type MapMarker } from "@/components/travel/travel-map";
import { TourOptimizer } from "@/components/travel/tour-optimizer";
import { requireBusinessContext } from "@/server/services/business-context";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import { loadDayTour } from "@/server/services/tours";
import { formatEuros } from "@/lib/domain/pricing";
import { addDays, localDate } from "@/lib/domain/time";

const item = getNavItem("tours");
export const metadata: Metadata = { title: item.label };

const km = (m: number) => `${(m / 1000).toFixed(1).replace(".", ",")} km`;
const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}` : `${min} min`);

export default async function ToursPage({ searchParams }: PageProps<"/tournees">) {
  const ctx = await requireBusinessContext();
  const sp = await searchParams;
  const tz = ctx.settings?.timezone ?? "Europe/Paris";
  const today = localDate(new Date(), tz);
  const day = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const supabase = await createSupabaseServerClient();
  const tour = await loadDayTour(supabase, ctx, day);
  const t = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  const longDay = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${day}T12:00:00Z`));

  if (!tour.enabled) {
    return (
      <div>
        <PageHeader title={item.label} description={item.summary} />
        <FormAlert type="info">
          Les déplacements ne sont pas encore activés.{" "}
          <Link href="/parametres/deplacements" className="font-semibold underline underline-offset-2">Configurer mes déplacements</Link>
        </FormAlert>
      </div>
    );
  }

  const markers: MapMarker[] = [];
  if (tour.start) markers.push({ ...tour.start, label: "Départ", kind: "start" });
  tour.stops.forEach((s, i) => s.coords && markers.push({ ...s.coords, label: `${t.format(new Date(s.startsAt))} ${s.customer}`, kind: s.place === "salon" ? "salon" : "home", order: i + 1 }));
  const lines = [...tour.stops.map((s) => s.legBefore?.geometry), tour.returnLeg?.geometry].filter((g): g is [number, number][] => Array.isArray(g) && g.length > 1);
  const kpis = [
    { label: "Distance", value: km(tour.totals.distanceM) },
    { label: "Temps de route", value: hm(tour.totals.travelMinutes) },
    { label: "Coût estimé", value: tour.totals.costCents != null ? formatEuros(tour.totals.costCents) : tour.vehicle ? "—" : "Véhicule à configurer" },
    { label: "Frais facturés", value: formatEuros(tour.totals.feesCents) },
    { label: "Temps de travail", value: hm(tour.totals.workMinutes) },
    { label: "Temps non productif", value: hm(tour.totals.travelMinutes + tour.totals.idleMinutes) },
  ];

  return (
    <div>
      <PageHeader title={item.label} description="Où aller, à quelle heure, combien de route et combien ça coûte." />
      <div className="mb-5 flex items-center justify-between gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Jour précédent">
          <Link href={`/tournees?date=${addDays(day, -1)}`}><ChevronLeft /></Link>
        </Button>
        <p className="text-lg font-bold first-letter:uppercase">{longDay}</p>
        <Button asChild variant="ghost" size="icon" aria-label="Jour suivant">
          <Link href={`/tournees?date=${addDays(day, 1)}`}><ChevronRight /></Link>
        </Button>
      </div>
      {tour.providerError && <div className="mb-4"><FormAlert type="error">Certains trajets n&apos;ont pas pu être calculés (service IGN indisponible). Ils sont indiqués « non calculé » : aucune valeur n&apos;est inventée.</FormAlert></div>}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className="text-lg font-bold">{k.value}</p>
          </div>
        ))}
      </div>
      {tour.totals.unknownLegs > 0 && <div className="mb-4"><FormAlert type="info">{tour.totals.unknownLegs} trajet(s) non calculé(s) : adresse non localisée ou service indisponible. Les totaux ne les incluent pas.</FormAlert></div>}
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_24rem]">
        <Card>
          <CardContent className="pt-5 sm:pt-6">
            {markers.length ? <TravelMap markers={markers} lines={lines} height={420} /> : <FormAlert type="info">Aucun rendez-vous ce jour-là.</FormAlert>}
            <p className="mt-2 text-xs text-muted-foreground">Fond de carte et itinéraires : IGN Géoplateforme. Durées sans trafic en temps réel.</p>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader><CardTitle>Ordre de passage</CardTitle></CardHeader>
            <CardContent>
              {tour.stops.length === 0 && <p className="text-sm text-muted-foreground">Aucun rendez-vous.</p>}
              <ol className="flex flex-col">
                {tour.stops.map((s, i) => (
                  <li key={s.id} className="flex flex-col">
                    <p className="py-1 pl-8 text-xs text-muted-foreground">
                      {s.legUnknown ? "↓ trajet non calculé" : s.legBefore && s.legBefore.distanceM > 0 ? `↓ ${km(s.legBefore.distanceM)} · ${Math.round(s.legBefore.durationS / 60)} min${s.legBefore.costCents != null ? ` · ${formatEuros(s.legBefore.costCents)}` : ""}` : ""}
                    </p>
                    <Link href={`/agenda/${s.id}`} className="flex items-start gap-3 rounded-xl p-2 hover:bg-secondary">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">{i + 1}</span>
                      <span className="flex-1 text-sm">
                        <span className="font-semibold">{t.format(new Date(s.startsAt))} · {s.customer}</span>
                        <span className="block text-muted-foreground">
                          {s.place === "home" ? <Home className="mr-1 inline size-3.5" /> : <Store className="mr-1 inline size-3.5" />}
                          {s.service}{s.city ? ` · ${s.city}` : ""}{s.feeCents > 0 ? ` · déplacement ${formatEuros(s.feeCents)}` : ""}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
              {tour.returnLeg && tour.returnLeg.distanceM > 0 && <p className="py-1 pl-8 text-xs text-muted-foreground">↓ retour : {km(tour.returnLeg.distanceM)} · {Math.round(tour.returnLeg.durationS / 60)} min</p>}
            </CardContent>
          </Card>
          {day >= today && (
            <Card>
              <CardHeader><CardTitle>Optimisation</CardTitle></CardHeader>
              <CardContent>
                <TourOptimizer day={day} timeZone={tz} names={Object.fromEntries(tour.stops.map((s) => [s.id, `${s.customer} (${s.service})`]))} />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
