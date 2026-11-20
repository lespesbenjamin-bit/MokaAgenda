import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, CalendarPlus, Check, Circle, Home, MapPin, Store } from "lucide-react";
import { navigation } from "@/config/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormAlert } from "@/components/ui/form-alert";
import { PageHeader } from "@/components/layout/page-header";
import { BusinessBadge } from "@/components/layout/business-badge";
import { requireBusinessContext } from "@/server/services/business-context";
import { loadAgendaKpis } from "@/server/services/dashboard";
import { createSupabaseServerClient } from "@/server/integrations/supabase/server";
import { STATUS_LABELS } from "@/lib/domain/appointments";
import { ACTIVITY_MODE_LABELS, needsSalonAddress, needsTravelBase } from "@/lib/validation/onboarding";
import { isDemo } from "@/lib/env";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Tableau de bord" };

export default async function DashboardPage({ searchParams }: PageProps<"/tableau-de-bord">) {
  const ctx = await requireBusinessContext();
  const params = await searchParams;
  const { business, settings, locations } = ctx;
  const mode = business.activity_mode;
  const kinds = new Set(locations.map((l) => l.kind));
  const firstName = ctx.fullName?.split(" ")[0];

  const timeZone = settings?.timezone ?? "Europe/Paris";
  const supabase = await createSupabaseServerClient();
  const agenda = await loadAgendaKpis(supabase, business.id, timeZone);
  const setupSteps = [
    { label: "Compte créé et email confirmé", done: true },
    { label: "Informations de l'entreprise", done: Boolean(business.name) },
    { label: "Mode d'activité", done: Boolean(mode) },
    {
      label: "Adresses",
      done: Boolean(mode) && (!needsSalonAddress(mode!) || kinds.has("salon")) && (!needsTravelBase(mode!) || kinds.has("travel_base")),
    },
    { label: "Paramètres de l'agenda", done: Boolean(settings) },
    { label: "Horaires de travail", done: agenda.hasRules },
    { label: "Logo", done: Boolean(business.logo_path), optional: true },
    { label: "Conditions générales de réservation", done: Boolean(settings?.booking_terms), optional: true },
  ];
  const required = setupSteps.filter((s) => !s.optional);
  const doneCount = setupSteps.filter((s) => s.done).length;

  const modules = navigation.filter((i) => i.key !== "dashboard");
  const salon = locations.find((l) => l.kind === "salon");
  const travel = locations.find((l) => l.kind === "travel_base");

  const kpis = [
    { label: "Rendez-vous aujourd'hui", value: agenda.kpis.today },
    { label: "Rendez-vous à venir", value: agenda.kpis.upcoming },
    { label: "Cette semaine", value: agenda.kpis.week },
    { label: "Terminés ce mois-ci", value: agenda.kpis.completed },
    { label: "Annulés ce mois-ci", value: agenda.kpis.cancelled },
  ];
  const nextFmt = new Intl.DateTimeFormat("fr-FR", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

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
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 id="kpi-title" className="font-display text-xl font-bold">
            Agenda
          </h2>
          {isDemo && <Badge variant="warning">Démo · rendez-vous fictifs</Badge>}
          <Link href="/agenda" className="ml-auto text-sm font-semibold text-primary hover:underline">
            Ouvrir l&apos;agenda
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="rounded-xl border border-border bg-card p-5">
              <p className="text-sm text-muted-foreground">{kpi.label}</p>
              <p className="mt-1 text-2xl font-bold tracking-tight">{kpi.value}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Chiffre d&apos;affaires et rentabilité : disponibles avec le module Finances.</p>
      </section>

      <section className="mt-8" aria-labelledby="next-title">
        <h2 id="next-title" className="mb-4 font-display text-xl font-bold">
          Prochains rendez-vous
        </h2>
        {agenda.next.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong bg-card px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">Aucun rendez-vous prévu dans les 30 prochains jours.</p>
            <Link href="/agenda/nouveau" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
              <CalendarPlus className="size-4" /> Créer un rendez-vous
            </Link>
          </div>
        ) : (
          <Card>
            <ul className="divide-y divide-border">
              {agenda.next.map((a) => (
                <li key={a.id}>
                  <Link href={`/agenda/${a.id}`} className="flex flex-col gap-1 px-5 py-4 hover:bg-surface sm:flex-row sm:items-center sm:gap-4">
                    <span className="w-44 shrink-0 text-sm font-semibold capitalize">{nextFmt.format(new Date(a.startsAt))}</span>
                    <span className="flex-1 text-sm">
                      {a.service} · <span className="text-muted-foreground">{a.customer}</span>
                    </span>
                    <span className="flex gap-2">
                      <Badge variant="soon">{a.place === "home" ? `À domicile${a.city ? ` · ${a.city}` : ""}` : "En institut"}</Badge>
                      <Badge variant={a.status === "confirmed" ? "available" : "warning"}>{STATUS_LABELS[a.status]}</Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>



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
