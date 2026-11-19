import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, BarChart3, Check, Circle, Home, MapPin, Store } from "lucide-react";
import { navigation } from "@/config/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/layout/page-header";
import { BusinessBadge } from "@/components/layout/business-badge";
import { requireBusinessContext } from "@/server/services/business-context";
import { demoFixtures, demoUpcomingAppointments } from "@/server/demo/fixtures";
import { ACTIVITY_MODE_LABELS, needsSalonAddress, needsTravelBase } from "@/lib/validation/onboarding";
import { isDemo } from "@/lib/env";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Tableau de bord" };

const euros = (cents: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(cents / 100);

export default async function DashboardPage({ searchParams }: PageProps<"/tableau-de-bord">) {
  const ctx = await requireBusinessContext();
  const params = await searchParams;
  const { business, settings, locations } = ctx;
  const mode = business.activity_mode;
  const kinds = new Set(locations.map((l) => l.kind));
  const firstName = ctx.fullName?.split(" ")[0];

  const setupSteps = [
    { label: "Compte créé et email confirmé", done: true },
    { label: "Informations de l'entreprise", done: Boolean(business.name) },
    { label: "Mode d'activité", done: Boolean(mode) },
    {
      label: "Adresses",
      done: Boolean(mode) && (!needsSalonAddress(mode!) || kinds.has("salon")) && (!needsTravelBase(mode!) || kinds.has("travel_base")),
    },
    { label: "Paramètres de l'agenda", done: Boolean(settings) },
    { label: "Logo", done: Boolean(business.logo_path), optional: true },
    { label: "Conditions générales de réservation", done: Boolean(settings?.booking_terms), optional: true },
  ];
  const required = setupSteps.filter((s) => !s.optional);
  const doneCount = setupSteps.filter((s) => s.done).length;

  const modules = navigation.filter((i) => i.key !== "dashboard");
  const salon = locations.find((l) => l.kind === "salon");
  const travel = locations.find((l) => l.kind === "travel_base");

  const kpis = isDemo
    ? [
        { label: "Rendez-vous à venir", value: String(demoFixtures.kpis.upcoming_appointments) },
        { label: "Chiffre d'affaires du mois", value: euros(demoFixtures.kpis.monthly_revenue_cents) },
        { label: "Acomptes encaissés", value: euros(demoFixtures.kpis.deposits_collected_cents) },
        { label: "Nouvelles clientes", value: String(demoFixtures.kpis.new_customers) },
      ]
    : [
        { label: "Rendez-vous à venir", value: null },
        { label: "Chiffre d'affaires du mois", value: null },
        { label: "Acomptes encaissés", value: null },
        { label: "Nouvelles clientes", value: null },
      ];

  return (
    <>
      <PageHeader
        eyebrow={<p className="text-sm font-medium text-muted-foreground">{business.name}</p>}
        title={firstName ? `Bonjour ${firstName}` : "Bonjour"}
        description="Voici l'état de votre espace professionnel."
      />

      {params.bienvenue === "1" && (
        <div className="mb-6">
          <FormAlert type="success">Votre espace est prêt. Bienvenue sur Moka Réservation !</FormAlert>
        </div>
      )}
      {params.motdepasse === "1" && (
        <div className="mb-6">
          <FormAlert type="success">Votre mot de passe a été modifié.</FormAlert>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Votre entreprise</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <BusinessBadge
              identity={{ name: business.name, logoUrl: ctx.logoUrl, subtitle: business.activity ?? "Activité non renseignée" }}
            />
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <Info icon={mode === "home" ? Home : Store} label="Mode d'activité" value={mode ? ACTIVITY_MODE_LABELS[mode].title : "Non renseigné"} />
              <Info icon={MapPin} label="Contact" value={[business.phone, business.email].filter(Boolean).join(" · ") || "Non renseigné"} />
              {salon && <Info icon={Store} label="Institut" value={`${salon.address_line1}, ${salon.city}`} />}
              {travel && (
                <Info
                  icon={Home}
                  label="Départ des déplacements"
                  value={`${travel.address_line1}, ${travel.city}${settings?.service_radius_km != null ? ` · ${settings.service_radius_km} km` : ""}`}
                />
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
            <CardDescription>
              {required.every((s) => s.done) ? "Configuration essentielle terminée" : "Configuration en cours"} · {doneCount}/{setupSteps.length}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-brand" style={{ width: `${(doneCount / setupSteps.length) * 100}%` }} />
            </div>
            <ul className="flex flex-col gap-2.5">
              {setupSteps.map((step) => (
                <li key={step.label} className="flex items-center gap-2.5 text-sm">
                  {step.done ? <Check className="size-4 text-success" /> : <Circle className="size-4 text-muted-foreground/60" />}
                  <span className={cn(!step.done && "text-muted-foreground")}>
                    {step.label}
                    {step.optional && !step.done && <span className="text-xs"> (facultatif)</span>}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <section className="mt-10" aria-labelledby="kpi-title">
        <div className="mb-4 flex items-center gap-3">
          <h2 id="kpi-title" className="font-display text-xl font-bold">
            Indicateurs
          </h2>
          {isDemo && <Badge variant="warning">Démo · chiffres fictifs</Badge>}
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kpis.map((kpi) =>
            kpi.value ? (
              <div key={kpi.label} className="rounded-xl border border-border bg-card p-5">
                <p className="text-sm text-muted-foreground">{kpi.label}</p>
                <p className="mt-1 text-2xl font-bold tracking-tight">{kpi.value}</p>
              </div>
            ) : (
              <div key={kpi.label} className="rounded-xl border border-dashed border-line-strong bg-card/60 p-5">
                <BarChart3 className="size-4 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">{kpi.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">Disponible avec l&apos;agenda</p>
              </div>
            ),
          )}
        </div>
      </section>

      {isDemo && <DemoCalendar />}

      <section className="mt-10" aria-labelledby="modules-title">
        <h2 id="modules-title" className="mb-4 font-display text-xl font-bold">
          Modules
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.key} href={item.href} className="group">
                <Card className="h-full transition-colors group-hover:border-line-strong group-hover:bg-surface">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex size-10 items-center justify-center rounded-xl bg-secondary">
                        <Icon className="size-5 text-primary" />
                      </div>
                      {item.status === "available" ? <Badge variant="available">Disponible</Badge> : <Badge variant="soon">À venir</Badge>}
                    </div>
                    <CardTitle className="mt-3 flex items-center gap-1">
                      {item.label}
                      <ArrowUpRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </CardTitle>
                    <CardDescription>{item.summary}</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>
    </>
  );
}

function Info({ icon: Icon, label, value }: { icon: typeof Home; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-surface p-3.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0">
        <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 font-medium break-words">{value}</dd>
      </div>
    </div>
  );
}

function DemoCalendar() {
  const items = demoUpcomingAppointments().slice(0, 5);
  const fmt = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <section className="mt-10" aria-labelledby="demo-cal-title">
      <div className="mb-4 flex items-center gap-3">
        <h2 id="demo-cal-title" className="font-display text-xl font-bold">
          Calendrier d&apos;exemple
        </h2>
        <Badge variant="warning">Démo · rendez-vous fictifs</Badge>
      </div>
      <Card>
        <ul className="divide-y divide-border">
          {items.map((a, i) => (
            <li key={i} className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-center sm:gap-4">
              <span className="w-44 shrink-0 text-sm font-semibold capitalize">{fmt.format(a.date)}</span>
              <span className="flex-1 text-sm">
                {a.service} · <span className="text-muted-foreground">{a.customer}</span>
              </span>
              <span className="flex gap-2">
                <Badge variant="soon">{a.where === "home" ? "À domicile" : "En institut"}</Badge>
                <Badge variant={a.status === "confirmed" ? "available" : "default"}>{a.status === "confirmed" ? "Confirmé" : "En attente"}</Badge>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
