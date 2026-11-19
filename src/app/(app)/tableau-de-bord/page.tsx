import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, BarChart3, Check, Circle, Info } from "lucide-react";
import { navigation } from "@/config/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Tableau de bord" };

/** Étapes de configuration — l'état réel sera lu depuis Supabase à l'étape 4. */
const setupSteps = [
  { label: "Créer votre compte", done: false },
  { label: "Renseigner votre entreprise", done: false },
  { label: "Choisir votre mode d'activité", done: false },
  { label: "Indiquer vos adresses", done: false },
  { label: "Régler vos paramètres", done: false },
];

const kpiSlots = ["Rendez-vous à venir", "Chiffre d'affaires du mois", "Acomptes encaissés", "Nouvelles clientes"];

export default function DashboardPage() {
  const modules = navigation.filter((i) => i.key !== "dashboard");
  const doneCount = setupSteps.filter((s) => s.done).length;

  return (
    <>
      <PageHeader
        eyebrow={<p className="text-sm font-medium text-muted-foreground">Bienvenue sur Moka Réservation</p>}
        title="Bonjour"
        description="Votre espace professionnel se met en place. Voici ce qui est disponible aujourd'hui et ce qui arrive."
      />

      <div
        role="note"
        className="mb-8 flex items-start gap-3 rounded-xl border border-border bg-secondary/60 p-4 text-sm"
      >
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>
          <span className="font-semibold">Version de construction.</span> La connexion, l&apos;onboarding et
          l&apos;identité de votre entreprise seront activés dans les prochaines étapes du Sprint 1.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        {/* Identité de l'entreprise */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-accent font-display text-xl font-semibold text-accent-foreground">
              ?
            </div>
            <div>
              <CardTitle>Votre entreprise</CardTitle>
              <CardDescription>Nom, logo et mode d&apos;activité seront affichés ici après l&apos;onboarding.</CardDescription>
            </div>
          </CardHeader>
        </Card>

        {/* État de configuration */}
        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
            <CardDescription>
              {doneCount} / {setupSteps.length} étapes terminées
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${(doneCount / setupSteps.length) * 100}%` }}
              />
            </div>
            <ul className="flex flex-col gap-2.5">
              {setupSteps.map((step) => (
                <li key={step.label} className="flex items-center gap-2.5 text-sm">
                  {step.done ? (
                    <Check className="size-4 text-success" />
                  ) : (
                    <Circle className="size-4 text-muted-foreground/60" />
                  )}
                  <span className={cn(!step.done && "text-muted-foreground")}>{step.label}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Emplacements KPI — aucun chiffre fictif en production */}
      <section className="mt-10" aria-labelledby="kpi-title">
        <h2 id="kpi-title" className="mb-4 font-display text-xl font-semibold">
          Indicateurs
        </h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kpiSlots.map((label) => (
            <div key={label} className="rounded-xl border border-dashed border-cream-strong bg-card/60 p-5">
              <BarChart3 className="size-4 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">{label}</p>
              <p className="mt-1 text-xs text-muted-foreground">Disponible avec l&apos;agenda</p>
            </div>
          ))}
        </div>
      </section>

      {/* Accès rapide aux modules */}
      <section className="mt-10" aria-labelledby="modules-title">
        <h2 id="modules-title" className="mb-4 font-display text-xl font-semibold">
          Modules
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.key} href={item.href} className="group">
                <Card className="h-full transition-colors group-hover:border-cream-strong group-hover:bg-ivory">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex size-10 items-center justify-center rounded-xl bg-secondary">
                        <Icon className="size-5 text-primary" />
                      </div>
                      {item.status === "available" ? (
                        <Badge variant="available">Disponible</Badge>
                      ) : (
                        <Badge variant="soon">À venir</Badge>
                      )}
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
